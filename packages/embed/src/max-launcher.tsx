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

  // The in-iframe "Close" button posts `max:close`; honour it from the embed
  // origin only so an unrelated page can't toggle the launcher.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return
      const data = event.data as { type?: string } | null
      if (data?.type === "max:close") setOpen(false)
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
          right,
          bottom: bottom + 68,
          width: BUBBLE_W,
          // Near full-height panel (16px top margin) to match the taller design.
          height: `calc(100vh - ${bottom + 84}px)`,
          maxWidth: `calc(100vw - ${right * 2}px)`,
          borderRadius: 20,
          overflow: "hidden",
          background: "transparent",
          boxShadow: "0 24px 60px rgba(15,15,15,0.22), 0 2px 8px rgba(15,15,15,0.12)",
          zIndex: Z,
          display: visible ? "block" : "none",
          opacity: entered ? 1 : 0,
          // Grows out of the launcher button in the bottom-right corner.
          transformOrigin: "100% 100%",
          transform: entered ? "translateY(0) scale(1)" : "translateY(12px) scale(0.96)",
          transition: "opacity 200ms ease, transform 300ms cubic-bezier(0.16,1,0.3,1)",
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
          setOpen((v) => !v)
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
