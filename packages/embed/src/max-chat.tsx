import { useMemo, useRef, useState } from "react"

import { LoadingOverlay, resolveDark } from "./loading.js"
import { DEFAULT_EMBED_ORIGIN, type MaxChatProps } from "./types.js"
import { readInitialHostSnapshot, useHostSync } from "./use-host-sync.js"

/**
 * Inline iframe rendering Max's chat surface. Place it inside a sized container
 * (e.g. a `<div className="h-[600px]">`) — it fills the host element.
 *
 * The token must be minted server-side via `POST /max/v1/embed/token` and is
 * short-lived (~15min); refresh from your backend rather than hardcoding it.
 *
 * Theme and language are auto-detected from the host's `<html class>` /
 * `<html lang>` by default, and tracked live via postMessage so toggling the
 * host theme keeps the iframe in sync without remounting (chat state preserved).
 * Pass `theme` / `lang` explicitly to take over either axis.
 *
 * While the iframe loads, a branded loading state covers the surface so it never
 * flashes blank — it fades out on load (and fires `onLoad`).
 */
export function MaxChat({
  token,
  embedOrigin = DEFAULT_EMBED_ORIGIN,
  title = "Max by Voyant",
  theme,
  lang,
  className,
  style,
  onLoad,
}: MaxChatProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const origin = useMemo(() => embedOrigin.replace(/\/$/, ""), [embedOrigin])
  const dark = useMemo(() => resolveDark({ theme, lang }), [theme, lang])

  // Initial src — read host once for the URL so the iframe boots with the
  // correct theme/lang and we avoid a colour flash. Updates after mount flow
  // through `useHostSync` via postMessage; the URL stays stable.
  const src = useMemo(() => {
    const snapshot = readInitialHostSnapshot({ theme, lang })
    const params = new URLSearchParams({ token })
    if (snapshot.theme) params.set("theme", snapshot.theme)
    if (snapshot.lang) params.set("lang", snapshot.lang)
    return `${origin}/max?${params.toString()}`
  }, [token, origin])

  useHostSync({ iframeRef, origin, theme, lang })

  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      <iframe
        ref={iframeRef}
        src={src}
        title={title}
        allow="clipboard-read; clipboard-write"
        onLoad={() => {
          setLoaded(true)
          onLoad?.()
        }}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          border: 0,
          background: "transparent",
          colorScheme: "normal",
        }}
      />
      <LoadingOverlay show={!loaded} dark={dark} />
    </div>
  )
}
