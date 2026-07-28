import { useMemo, useRef, useState } from "react"

import { LoadingOverlay, resolveDark } from "./loading.js"
import { createSessionId } from "./protocol.js"
import { DEFAULT_EMBED_ORIGIN, type MaxAppProps } from "./types.js"
import { useContextChannel } from "./use-context-channel.js"
import { readInitialHostSnapshot, useHostSync } from "./use-host-sync.js"
import { hostPathToAppPath, useRouteSync } from "./use-route-sync.js"

/**
 * Fullscreen Max — the whole assistant as a routed app inside a full
 * width/height iframe, with a persistent conversation sidebar and (soon) a
 * canvas surface for previewing and editing what's being worked on.
 *
 * Unlike {@link MaxChat}, the in-iframe location is mirrored into the
 * embedder's address bar under `basePath`, so conversations and artifacts are
 * deep-linkable and the browser back/forward buttons work. Mount it inside a
 * full-size container (e.g. a route at `height: 100vh`) and route every path
 * under `basePath` to it.
 *
 * Theme/language sync and the branded loading overlay behave exactly as in
 * {@link MaxChat}.
 */
export function MaxApp({
  token,
  embedOrigin = DEFAULT_EMBED_ORIGIN,
  title = "Max by Voyant",
  theme,
  lang,
  basePath = "/",
  className,
  style,
  onLoad,
  onRouteChange,
  context,
  tenant,
  audience,
  onContextClear,
  onContextRequest,
}: MaxAppProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [loaded, setLoaded] = useState(false)
  const origin = useMemo(() => embedOrigin.replace(/\/$/, ""), [embedOrigin])
  const dark = useMemo(() => resolveDark({ theme, lang }), [theme, lang])
  const [sessionId] = useState(createSessionId)
  const scope = useMemo(
    () => ({ sessionId, tenant: tenant ?? null, audience: audience ?? null }),
    [sessionId, tenant, audience],
  )

  // Boot the iframe straight at the deep-linked path so a refreshed
  // `basePath/c/<id>` mounts the right conversation with no extra round-trip.
  // Computed once on mount; later navigations flow through `useRouteSync`.
  const [initialAppPath] = useState(() => hostPathToAppPath(basePath))

  const src = useMemo(() => {
    const snapshot = readInitialHostSnapshot({ theme, lang })
    const params = new URLSearchParams({ token })
    if (snapshot.theme) params.set("theme", snapshot.theme)
    if (snapshot.lang) params.set("lang", snapshot.lang)
    params.set("session", sessionId)
    if (tenant) params.set("tenant", tenant)
    if (audience) params.set("audience", audience)
    const path = initialAppPath === "/" ? "" : initialAppPath
    return `${origin}/max/app${path}?${params.toString()}`
  }, [token, origin, initialAppPath, sessionId, tenant, audience])

  useHostSync({ iframeRef, origin, theme, lang })
  useRouteSync({ iframeRef, origin, scope, basePath, onRouteChange })
  useContextChannel({ iframeRef, origin, scope, context, onContextClear, onContextRequest })

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
