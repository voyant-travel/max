import { type RefObject, useEffect, useRef } from "react"

/**
 * Two-way route sync between the embedder page and the fullscreen Max iframe.
 *
 * The iframe runs its own router but lives in a cross-origin browsing context,
 * so its location can't touch the embedder's address bar directly. This hook
 * bridges the two:
 *
 *   - iframe → host: on `max:navigate`, the host rewrites its own URL under
 *     `basePath` via `history.pushState` (so refresh / share / deep-link work)
 *     and notifies `onRouteChange`.
 *   - host → iframe: on browser back/forward (`popstate`) the host replays the
 *     target path into the iframe via `max:setRoute`.
 *
 * Paths on the wire are app-relative (`/`, `/c/<id>`, …). The host maps them
 * to `basePath + path` for its own URL.
 *
 * A loop guard prevents the echo: a `max:navigate` whose path we *just* pushed
 * to the iframe (because of a popstate) is not re-pushed to history.
 */
export function useRouteSync({
  iframeRef,
  origin,
  basePath,
  onRouteChange,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>
  origin: string
  basePath: string
  onRouteChange?: (path: string) => void
}) {
  // The app-relative path most recently replayed *into* the iframe from a
  // popstate. While the iframe settles on it we suppress the history echo.
  const replayedToIframe = useRef<string | null>(null)

  // Keep the latest callback without re-subscribing the message listener.
  const onRouteChangeRef = useRef(onRouteChange)
  onRouteChangeRef.current = onRouteChange

  useEffect(() => {
    function post(path: string) {
      const target = iframeRef.current?.contentWindow
      if (!target) return
      try {
        target.postMessage({ type: "max:setRoute", path }, origin)
      } catch {
        /* iframe might have navigated */
      }
    }

    function handleMessage(event: MessageEvent) {
      if (event.origin !== origin) return
      const data = event.data as { type?: string; path?: string } | null
      if (!data) return

      if (data.type === "max:ready") {
        // The iframe booted with the deep-linked path already in its `src`, so
        // nothing to replay here; this hook is ready for its navigations.
        return
      }

      if (data.type === "max:navigate" && typeof data.path === "string") {
        const appPath = data.path
        if (replayedToIframe.current === appPath) {
          // We caused this navigation via popstate — don't push history again.
          replayedToIframe.current = null
          return
        }
        const hostPath = appPathToHostPath(appPath, basePath)
        if (hostPath !== currentHostPath()) {
          window.history.pushState(null, "", hostPath)
        }
        onRouteChangeRef.current?.(appPath)
      }
    }

    function handlePopState() {
      const appPath = hostPathToAppPath(basePath)
      replayedToIframe.current = appPath
      post(appPath)
      onRouteChangeRef.current?.(appPath)
    }

    window.addEventListener("message", handleMessage)
    window.addEventListener("popstate", handlePopState)
    return () => {
      window.removeEventListener("message", handleMessage)
      window.removeEventListener("popstate", handlePopState)
    }
  }, [iframeRef, origin, basePath])
}

/** Normalize a configured base path: leading slash, no trailing slash, `""` for root. */
export function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === "/") return ""
  const withLead = basePath.startsWith("/") ? basePath : `/${basePath}`
  return withLead.replace(/\/$/, "")
}

/** Current embedder path the Max iframe occupies, as an app-relative path. */
export function hostPathToAppPath(basePath: string): string {
  if (typeof window === "undefined") return "/"
  const base = normalizeBasePath(basePath)
  const path = window.location.pathname
  if (!base) return path || "/"
  if (path === base) return "/"
  if (path.startsWith(`${base}/`)) return path.slice(base.length) || "/"
  return "/"
}

/** Map an app-relative path back onto the embedder's URL under `basePath`. */
export function appPathToHostPath(appPath: string, basePath: string): string {
  const base = normalizeBasePath(basePath)
  const clean = appPath === "/" ? "" : appPath
  return `${base}${clean}` || "/"
}

function currentHostPath(): string {
  if (typeof window === "undefined") return "/"
  return window.location.pathname
}
