import { useMemo, useRef } from "react"

import { DEFAULT_EMBED_ORIGIN, type MaxChatProps } from "./types.js"
import { readInitialHostSnapshot, useHostSync } from "./use-host-sync.js"

/**
 * Inline iframe rendering Max's chat surface. Place it inside a sized container
 * (e.g. a `<div className="h-[600px]">`) — the iframe fills the host element.
 *
 * The token must be minted server-side via `POST /max/v1/embed/token` and is
 * short-lived (~15min); refresh from your backend rather than hardcoding it.
 *
 * Theme and language are auto-detected from the host's `<html class>` /
 * `<html lang>` by default, and tracked live via postMessage so toggling the
 * host theme keeps the iframe in sync without remounting (chat state preserved).
 * Pass `theme` / `lang` explicitly to take over either axis.
 */
export function MaxChat({
  token,
  embedOrigin = DEFAULT_EMBED_ORIGIN,
  title = "Max by Voyant",
  theme,
  lang,
  className,
  style,
}: MaxChatProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const origin = useMemo(() => embedOrigin.replace(/\/$/, ""), [embedOrigin])

  // Initial src — read host once for the URL so the iframe boots with the
  // correct theme/lang and we avoid a colour flash. Updates after mount flow
  // through `useHostSync` via postMessage; the URL stays stable.
  const src = useMemo(() => {
    const snapshot = readInitialHostSnapshot({ theme, lang })
    const params = new URLSearchParams({ token })
    if (snapshot.theme) params.set("theme", snapshot.theme)
    if (snapshot.lang) params.set("lang", snapshot.lang)
    return `${origin}/max?${params.toString()}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, origin])

  useHostSync({ iframeRef, origin, theme, lang })

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      allow="clipboard-read; clipboard-write"
      className={className}
      style={{
        width: "100%",
        height: "100%",
        border: 0,
        background: "transparent",
        colorScheme: "normal",
        ...style,
      }}
    />
  )
}
