import { useEffect, useMemo, useRef, useState } from "react"

import { LoadingOverlay, resolveDark } from "./loading.js"
import { DEFAULT_EMBED_ORIGIN, type MaxLauncherProps } from "./types.js"
import { readInitialHostSnapshot, useHostSync } from "./use-host-sync.js"

const Z = 2147483600
const BUBBLE_W = 420

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
}: MaxLauncherProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [mounted, setMounted] = useState(defaultOpen)
  // Latched full-screen state. The embedded app requests it (`max:setLayout`)
  // when a turn enters a canvas workflow — the panel grows to a near-fullscreen
  // overlay and stays there until the user collapses or closes it. Never
  // auto-reverts, so the operator isn't yanked back mid-task.
  const [expanded, setExpanded] = useState(false)
  // `visible` keeps the panel in the DOM through the close animation; `entered`
  // is the on-screen state we animate to/from. Splitting them lets both the
  // open and close transitions play (toggling `display` in one render would
  // skip them). `loaded` hides the loading overlay once the iframe is ready.
  const [visible, setVisible] = useState(defaultOpen)
  const [entered, setEntered] = useState(defaultOpen)
  const [loaded, setLoaded] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const origin = useMemo(() => embedOrigin.replace(/\/$/, ""), [embedOrigin])

  const dark = useMemo(() => resolveDark({ theme, lang }), [theme, lang])

  // Drive the enter/exit animation off `open`: a frame after opening we flip
  // `entered` so the panel springs in; on close we drop `entered` first, then
  // unmount from layout after the transition settles.
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
  // boots with the right look. Live updates flow via postMessage instead of
  // src changes (which would remount the iframe and lose chat state). theme/lang
  // are intentionally omitted from the deps so the src never recomputes.
  const src = useMemo(() => {
    const snapshot = readInitialHostSnapshot({ theme, lang })
    const params = new URLSearchParams({ token })
    if (snapshot.theme) params.set("theme", snapshot.theme)
    if (snapshot.lang) params.set("lang", snapshot.lang)
    return `${origin}/max/bubble?${params.toString()}`
  }, [token, origin])

  useHostSync({ iframeRef, origin, theme, lang })

  // In-iframe messages: "Close" posts `max:close`; a canvas workflow posts
  // `max:setLayout`. Honoured from the embed origin only so an unrelated page
  // can't drive the launcher.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return
      const data = event.data as { type?: string; layout?: string } | null
      if (!data) return
      if (data.type === "max:close") {
        setOpen(false)
        setExpanded(false)
      } else if (data.type === "max:setLayout") {
        if (data.layout === "expanded") {
          // A canvas workflow needs room — make sure we're open and grow.
          setMounted(true)
          setOpen(true)
          setExpanded(true)
        } else if (data.layout === "normal") {
          setExpanded(false)
        }
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [origin])

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
        style={{
          position: "fixed",
          // Expanded: a centred near-fullscreen overlay (capped ~1280px on wide
          // screens, 16px margins otherwise). Normal: the bottom-right panel.
          right: expanded ? "max(16px, calc(50vw - 640px))" : right,
          left: expanded ? "max(16px, calc(50vw - 640px))" : undefined,
          top: expanded ? 16 : undefined,
          bottom: expanded ? 16 : bottom + 68,
          width: expanded ? "auto" : BUBBLE_W,
          // Near full-height panel (16px top margin) to match the taller design.
          height: expanded ? "auto" : `calc(100vh - ${bottom + 84}px)`,
          maxWidth: expanded ? "none" : `calc(100vw - ${right * 2}px)`,
          borderRadius: expanded ? 16 : 20,
          overflow: "hidden",
          background: "transparent",
          boxShadow: "0 24px 60px rgba(15,15,15,0.22), 0 2px 8px rgba(15,15,15,0.12)",
          zIndex: Z,
          display: visible ? "block" : "none",
          opacity: entered ? 1 : 0,
          // Grows out of the launcher button when docked; from the centre when
          // expanded. Size changes ease so the expand feels deliberate.
          transformOrigin: expanded ? "50% 50%" : "100% 100%",
          transform: entered ? "translateY(0) scale(1)" : "translateY(12px) scale(0.96)",
          transition:
            "opacity 200ms ease, transform 300ms cubic-bezier(0.16,1,0.3,1), right 280ms ease, left 280ms ease, top 280ms ease, bottom 280ms ease, width 280ms ease, height 280ms ease, border-radius 280ms ease",
        }}
      >
        {mounted && (
          <iframe
            ref={iframeRef}
            src={src}
            title={title}
            allow="clipboard-read; clipboard-write"
            onLoad={() => setLoaded(true)}
            style={{
              width: "100%",
              height: "100%",
              border: 0,
              background: "transparent",
              colorScheme: "normal",
            }}
          />
        )}
        <LoadingOverlay show={!loaded} dark={dark} />
      </div>

      <button
        type="button"
        aria-label={open ? "Close Max chat" : "Open Max chat"}
        onClick={() => {
          setMounted(true)
          setOpen((v) => {
            if (v) setExpanded(false) // collapse on close so reopen is docked
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
