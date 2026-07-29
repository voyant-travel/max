import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { isolateBackground, trapTab } from "./focus-trap.js"
import { LoadingOverlay, resolveDark } from "./loading.js"
import {
  createEnvelope,
  createSessionId,
  type MaxLayout,
  ReplayGuard,
  validateInbound,
} from "./protocol.js"
import { DEFAULT_EMBED_ORIGIN, type MaxLauncherProps } from "./types.js"
import { useContextChannel } from "./use-context-channel.js"
import { readInitialHostSnapshot, useHostSync } from "./use-host-sync.js"

const Z = 2147483600

/**
 * Floating launcher button + popped-out chat panel (Intercom-style).
 *
 * Mount once at the app root. The iframe is created lazily on first open so
 * the JWT isn't validated until the user actually opens the chat.
 *
 * Theme and language are auto-detected from the host's `<html class>` /
 * `<html lang>` by default and tracked live via postMessage — toggling the
 * host theme keeps the iframe in sync without remounting (chat state preserved).
 * Pass `theme` / `lang` explicitly to take over either axis.
 *
 * The panel supports three responsive layouts — `normal` (docked bubble),
 * `wide`, and `expanded` (centred near-full-page). The embedded app can request
 * a layout (e.g. entering a canvas workflow) and the user can toggle it with the
 * on-panel expand/restore control; either way the host echoes the applied layout
 * back to the iframe so both sides stay in sync. Layout changes never remount the
 * iframe.
 */
export function MaxLauncher({
  token,
  embedOrigin = DEFAULT_EMBED_ORIGIN,
  title = "Max by Voyant",
  theme,
  lang,
  defaultOpen = false,
  bottom = 20,
  right = 20,
  defaultLayout = "normal",
  onLayoutChange,
  context,
  tenant,
  audience,
  onContextClear,
  onContextRequest,
}: MaxLauncherProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [mounted, setMounted] = useState(defaultOpen)
  // Current panel layout. `expanded` is *latched*: entering it (via the user or
  // a canvas workflow's `max:requestLayout`) grows the panel and it stays there
  // until the user restores or closes — never auto-reverts mid-task.
  const [layout, setLayout] = useState<MaxLayout>(defaultLayout)
  // `visible` keeps the panel in the DOM through the close animation; `entered`
  // is the on-screen state we animate to/from. Splitting them lets both the
  // open and close transitions play. `loaded` hides the loading overlay.
  const [visible, setVisible] = useState(defaultOpen)
  const [entered, setEntered] = useState(defaultOpen)
  const [loaded, setLoaded] = useState(false)
  const [hostOrigin, setHostOrigin] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  // The element focus should return to when the modal (expanded) panel closes.
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const origin = useMemo(() => embedOrigin.replace(/\/$/, ""), [embedOrigin])
  const sessionId = useMemo(createSessionId, [token, tenant, audience, origin])
  const loadedSessionRef = useRef<string | null>(null)
  const frameReady = loadedSessionRef.current === sessionId
  useEffect(() => setLoaded(false), [sessionId])
  useEffect(() => setHostOrigin(window.location.origin), [])
  const scope = useMemo(
    () => ({ sessionId, tenant: tenant ?? null, audience: audience ?? null }),
    [sessionId, tenant, audience],
  )

  const dark = useMemo(() => resolveDark({ theme, lang }), [theme, lang])

  // Keep the latest layout-change callback without re-subscribing listeners.
  const onLayoutChangeRef = useRef(onLayoutChange)
  const scopeRef = useRef(scope)
  const originRef = useRef(origin)
  // Always-current layout, so the idempotence check in `applyLayout` works even
  // from the message-listener effect's stale render closure.
  const layoutRef = useRef(layout)
  // Publish listener-visible protocol state only after this launcher render is
  // committed. Suspended or abandoned renders must not retarget the live iframe.
  useLayoutEffect(() => {
    onLayoutChangeRef.current = onLayoutChange
    scopeRef.current = scope
    originRef.current = origin
    layoutRef.current = layout
  })

  function postToIframe(type: "max:setLayout", payload: Record<string, unknown>) {
    // A scope change navigates the existing WindowProxy. Until the replacement
    // document loads, never disclose the new session/scope to the old document.
    if (loadedSessionRef.current !== scopeRef.current.sessionId) return
    const target = iframeRef.current?.contentWindow
    if (!target) return
    try {
      target.postMessage(createEnvelope(scopeRef.current, type, payload), originRef.current)
    } catch {
      /* iframe might have navigated */
    }
  }

  // Single entry point for layout changes: updates state and echoes the applied
  // layout back to the iframe (the host↔iframe round trip). `wide`/`expanded`
  // also ensure the panel is mounted + open so a request from the embedded app
  // can't land on a closed panel. `onLayoutChange` fires from an effect (below)
  // rather than here, so we never call a parent setState during render.
  function applyLayout(next: MaxLayout, opts: { echo?: boolean; ensureOpen?: boolean } = {}) {
    const { echo = true, ensureOpen = false } = opts
    // Idempotent: only echo when the layout actually changed. This is what breaks
    // a request/echo ping-pong — an echoing peer that reflects our `max:setLayout`
    // back lands on the same layout, so we don't echo again and the loop stops.
    const changed = next !== layoutRef.current
    layoutRef.current = next
    setLayout(next)
    if (ensureOpen || next !== "normal") {
      setMounted(true)
      setOpen(true)
    }
    if (echo && changed) postToIframe("max:setLayout", { layout: next })
  }

  // Notify the host of layout changes from an effect — skips the initial render
  // (no spurious call for `defaultLayout`) and stays out of the render phase.
  const notifiedLayout = useRef(layout)
  useEffect(() => {
    if (notifiedLayout.current === layout) return
    notifiedLayout.current = layout
    onLayoutChangeRef.current?.(layout)
  }, [layout])

  // Modal a11y for the expanded/full-page layout: while expanded the panel is a
  // `role="dialog" aria-modal` surface, so we (1) isolate the background (inert +
  // aria-hidden), (2) move focus into the panel, (3) trap Tab, (4) close on
  // Escape, and (5) return focus to the previously-focused element on exit.
  useEffect(() => {
    if (layout !== "expanded" || !open || !visible) return
    const panel = panelRef.current
    if (!panel) return
    restoreFocusRef.current =
      typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null
    const isolated = isolateBackground(panel)
    // Move focus into the dialog. Focusing the container (tabIndex -1) is robust
    // and lets the first Tab land on the first control; the trap wraps at the ends.
    try {
      panel.focus()
    } catch {
      /* detached */
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        applyLayout("normal") // restore; the cleanup below returns focus
      } else if (event.key === "Tab") {
        trapTab(panel, event)
      }
    }
    panel.addEventListener("keydown", onKeyDown)

    return () => {
      panel.removeEventListener("keydown", onKeyDown)
      isolated.restore()
      const toRestore = restoreFocusRef.current
      restoreFocusRef.current = null
      if (toRestore && typeof toRestore.focus === "function") {
        try {
          toRestore.focus()
        } catch {
          /* previously-focused node may be gone */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, open, visible])

  // Drive the enter/exit animation off `open`.
  useEffect(() => {
    if (open) {
      setVisible(true)
      const id = requestAnimationFrame(() => setEntered(true))
      return () => cancelAnimationFrame(id)
    }
    setEntered(false)
    const id = window.setTimeout(() => setVisible(false), 320)
    return () => window.clearTimeout(id)
  }, [open])

  // Initial src — captures the host theme/lang at first paint so the iframe
  // boots with the right look, plus the session/tenant/audience scope the iframe
  // echoes on its messages. Live updates flow via postMessage instead of src
  // changes (which would remount the iframe and lose chat state). theme/lang are
  // intentionally omitted from the deps so the src never recomputes.
  const src = useMemo(() => {
    const snapshot = readInitialHostSnapshot({ theme, lang })
    const params = new URLSearchParams({ token })
    if (hostOrigin) params.set("hostOrigin", hostOrigin)
    if (snapshot.theme) params.set("theme", snapshot.theme)
    if (snapshot.lang) params.set("lang", snapshot.lang)
    params.set("session", sessionId)
    if (tenant) params.set("tenant", tenant)
    if (audience) params.set("audience", audience)
    return `${origin}/max/bubble?${params.toString()}`
  }, [token, origin, hostOrigin, sessionId, tenant, audience])

  useHostSync({
    iframeRef,
    origin,
    scope,
    theme,
    lang,
    mounted: mounted && hostOrigin !== null,
  })
  useContextChannel({
    iframeRef,
    origin,
    scope,
    context,
    mounted: mounted && hostOrigin !== null,
    onContextClear,
    onContextRequest,
  })

  // Re-deliver the latest host-owned layout after a scope navigation. Layout
  // changes made while the replacement document was loading were intentionally
  // withheld by postToIframe above.
  useEffect(() => {
    if (!frameReady) return
    postToIframe("max:setLayout", { layout: layoutRef.current })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameReady, sessionId])

  // In-iframe messages, validated against the protocol (strict origin + source +
  // session/tenant, replay-guarded): "Close" posts `max:close`; a canvas workflow
  // or the app posts `max:requestLayout` (legacy `max:setLayout` still honoured).
  useEffect(() => {
    const guard = new ReplayGuard()
    const onMessage = (event: MessageEvent) => {
      const result = validateInbound(event, {
        expectedOrigin: origin,
        expectedSource: iframeRef.current?.contentWindow,
        scope: scopeRef.current,
        replay: guard,
      })
      if (!result.ok) return
      const { message } = result
      if (message.type === "max:close") {
        setOpen(false)
        applyLayout("normal", { echo: false }) // collapse on close; reopen docked
      } else if (message.type === "max:requestLayout" || message.type === "max:setLayout") {
        // Echo the applied layout back so the iframe learns the resolved state
        // (completes the host↔iframe round trip). No loop: the iframe treats the
        // echoed `max:setLayout` as display-only and doesn't respond.
        if (message.layout) applyLayout(message.layout)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, sessionId, tenant, audience])

  const geom = panelGeometry(layout, { bottom, right })
  const expanded = layout === "expanded"
  const expandedModal = expanded && open && visible

  return (
    <>
      {/* Dimmed + blurred scrim behind the panel for depth/focus. It lives in
          the host page because an iframe can't blur content outside its frame.
          `pointerEvents: none` keeps the host interactive — visual only. */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15,16,13,0.32)",
          WebkitBackdropFilter: "blur(4px)",
          backdropFilter: "blur(4px)",
          zIndex: Z - 1,
          pointerEvents: "none",
          opacity: entered ? 1 : 0,
          visibility: visible ? "visible" : "hidden",
          transition: "opacity 220ms ease, visibility 220ms ease",
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        aria-modal={expandedModal ? true : undefined}
        tabIndex={-1}
        style={{
          position: "fixed",
          ...geom,
          overflow: "hidden",
          outline: "none",
          background: "transparent",
          boxShadow: "0 24px 60px rgba(15,15,15,0.22), 0 2px 8px rgba(15,15,15,0.12)",
          zIndex: Z,
          display: visible ? "block" : "none",
          opacity: entered ? 1 : 0,
          transformOrigin: expanded ? "50% 50%" : "100% 100%",
          transform: entered ? "translateY(0) scale(1)" : "translateY(12px) scale(0.96)",
          transition:
            "opacity 200ms ease, transform 300ms cubic-bezier(0.16,1,0.3,1), right 280ms ease, left 280ms ease, top 280ms ease, bottom 280ms ease, width 280ms ease, height 280ms ease, border-radius 280ms ease",
        }}
      >
        {mounted && hostOrigin !== null && (
          <iframe
            ref={iframeRef}
            src={src}
            title={title}
            allow="clipboard-read; clipboard-write"
            onLoad={() => {
              loadedSessionRef.current = sessionId
              setLoaded(true)
            }}
            style={{
              width: "100%",
              height: "100%",
              border: 0,
              background: "transparent",
              colorScheme: "normal",
            }}
          />
        )}
        {/* User-visible layout controls — host-rendered so they can resize the
            host-owned panel (the iframe can't). Wide/expand/restore. */}
        <LayoutControls layout={layout} onLayout={(l) => applyLayout(l)} />
        <LoadingOverlay show={!loaded} dark={dark} />
      </div>

      <button
        type="button"
        aria-label={open ? "Close Max chat" : "Open Max chat"}
        onClick={() => {
          setMounted(true)
          setOpen((v) => {
            if (v) applyLayout("normal", { echo: false }) // collapse on close
            return !v
          })
        }}
        style={{
          position: "fixed",
          right,
          bottom,
          width: 56,
          height: 56,
          borderRadius: 9999,
          border: 0,
          // Voyant brand orange (mirrors --brand oklch(0.675 0.222 38)); the
          // host page has no access to the iframe's theme tokens, so hardcoded.
          background: "#ff5100",
          color: "#fff",
          boxShadow: "0 12px 28px rgba(255,81,0,0.35), 0 2px 6px rgba(0,0,0,0.18)",
          cursor: "pointer",
          zIndex: Z,
          display: "grid",
          placeItems: "center",
          transition: "transform 120ms ease",
        }}
      >
        {open ? <CloseIcon /> : <SparkleIcon />}
      </button>
    </>
  )
}

/**
 * Responsive panel geometry per layout. All widths/heights are clamped to the
 * viewport so the panel never overflows on small screens (responsive bounds).
 */
function panelGeometry(
  layout: MaxLayout,
  { bottom, right }: { bottom: number; right: number },
): CSSProperties {
  const margin = right
  if (layout === "expanded") {
    return {
      right: "max(16px, calc(50vw - 640px))",
      left: "max(16px, calc(50vw - 640px))",
      top: 16,
      bottom: 16,
      width: "auto",
      height: "auto",
      maxWidth: "none",
      borderRadius: 16,
    }
  }
  // `normal` ~420px, `wide` ~640px — both docked bottom-right, both clamped to
  // the viewport width and to a near-full height.
  const preferred = layout === "wide" ? 640 : 420
  return {
    right,
    left: undefined,
    top: undefined,
    bottom: bottom + 68,
    width: `min(${preferred}px, calc(100vw - ${margin * 2}px))`,
    height: `min(calc(100vh - ${bottom + 84}px), 900px)`,
    maxWidth: `calc(100vw - ${margin * 2}px)`,
    borderRadius: 20,
  }
}

function LayoutControls({
  layout,
  onLayout,
}: {
  layout: MaxLayout
  onLayout: (layout: MaxLayout) => void
}) {
  const btn: CSSProperties = {
    width: 26,
    height: 26,
    display: "grid",
    placeItems: "center",
    border: 0,
    borderRadius: 8,
    background: "rgba(15,16,13,0.55)",
    color: "#fff",
    cursor: "pointer",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
  }
  return (
    <div
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        display: "flex",
        gap: 6,
        zIndex: 2,
      }}
    >
      {layout !== "expanded" && (
        <button
          type="button"
          aria-label={layout === "wide" ? "Narrow Max panel" : "Widen Max panel"}
          aria-pressed={layout === "wide"}
          style={btn}
          onClick={() => onLayout(layout === "wide" ? "normal" : "wide")}
        >
          <WideIcon />
        </button>
      )}
      <button
        type="button"
        aria-label={layout === "expanded" ? "Restore Max panel" : "Expand Max to full page"}
        aria-pressed={layout === "expanded"}
        style={btn}
        onClick={() => onLayout(layout === "expanded" ? "normal" : "expanded")}
      >
        {layout === "expanded" ? <RestoreIcon /> : <ExpandIcon />}
      </button>
    </div>
  )
}

function SparkleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c.4 3.9 1.9 5.4 5.8 5.8-3.9.4-5.4 1.9-5.8 5.8-.4-3.9-1.9-5.4-5.8-5.8 3.9-.4 5.4-1.9 5.8-5.8Z" />
      <path d="M18.5 13.5c.2 2 1 2.8 3 3-2 .2-2.8 1-3 3-.2-2-1-2.8-3-3 2-.2 2.8-1 3-3Z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 3v6H3M21 15h-6v6M4 20l6-6M20 4l-6 6" />
    </svg>
  )
}

function WideIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 7 4 12l4 5M16 7l4 5-4 5" />
    </svg>
  )
}
