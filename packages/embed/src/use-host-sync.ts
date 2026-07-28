import { type RefObject, useEffect, useLayoutEffect, useRef } from "react"

import { createEnvelope, type MaxSessionScope } from "./protocol.js"
import type { MaxTheme } from "./types.js"

const VALID_THEMES = new Set<MaxTheme>(["light", "dark", "system"])

function detectHostTheme(): MaxTheme | null {
  if (typeof document === "undefined") return null
  try {
    const cls = document.documentElement.classList
    if (cls.contains("dark")) return "dark"
    if (cls.contains("light")) return "light"
    const attr = document.documentElement.getAttribute("data-theme")
    if (attr === "dark" || attr === "light") return attr
    return "system"
  } catch {
    return null
  }
}

function detectHostLang(): string | null {
  if (typeof document === "undefined") return null
  try {
    const attr = document.documentElement.getAttribute("lang")
    return attr && attr.length > 0 ? attr : null
  } catch {
    return null
  }
}

/**
 * Initial values used for the iframe's `src` query string. Read once on
 * module init so the iframe boots with the correct theme/lang (no FOUC) —
 * subsequent host changes flow through `useHostSync` via postMessage.
 */
export function readInitialHostSnapshot(props: { theme?: MaxTheme; lang?: string }): {
  theme: MaxTheme | null
  lang: string | null
} {
  const theme = props.theme && VALID_THEMES.has(props.theme) ? props.theme : detectHostTheme()
  const lang = props.lang && props.lang.length > 0 ? props.lang : detectHostLang()
  return { theme, lang }
}

/**
 * Keep the iframe in sync with the host page's theme + language without
 * remounting it. On any change (caller passed new prop, or auto-detect picked
 * up a `<html class>` / `<html lang>` mutation) we send a postMessage; the
 * embedded app applies it to its providers.
 *
 * Caller-supplied props win over auto-detect: if `props.theme` is set, the
 * `<html>` observer doesn't touch theme. Same for `lang`.
 */
export function useHostSync({
  iframeRef,
  origin,
  scope,
  theme: themeProp,
  lang: langProp,
  mounted = true,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>
  origin: string
  scope: MaxSessionScope
  theme?: MaxTheme
  lang?: string
  /** See {@link useContextChannel} — re-attaches the `load` push for a lazily
   *  mounted launcher iframe. Defaults to `true`. */
  mounted?: boolean
}) {
  // Latest values we've sent to the iframe — to dedupe and to push on
  // re-mount/iframe-load.
  const lastSent = useRef<{ theme: MaxTheme | null; lang: string | null }>({
    theme: null,
    lang: null,
  })
  const initialized = useRef({ theme: false, lang: false })

  // Track whether each axis is in auto-detect mode (no caller prop).
  const autoTheme = themeProp === undefined
  const autoLang = langProp === undefined
  const scopeGeneration = `${origin}\u0000${scope.sessionId}\u0000${scope.tenant ?? ""}\u0000${scope.audience ?? ""}`
  const activeGeneration = useRef(scopeGeneration)
  const originRef = useRef(origin)
  const scopeRef = useRef(scope)
  const hasLoaded = useRef(false)

  // Keep listener-visible routing state tied to the committed iframe. Reset
  // readiness at the same commit that changes its src; updates are buffered in
  // `lastSent` and replayed by the replacement document's load event.
  useLayoutEffect(() => {
    originRef.current = origin
    scopeRef.current = scope
    if (activeGeneration.current !== scopeGeneration) {
      activeGeneration.current = scopeGeneration
      hasLoaded.current = false
    }
  })

  function post(
    payload: { type: "max:setTheme"; theme: MaxTheme } | { type: "max:setLang"; lang: string },
  ) {
    if (!hasLoaded.current) return
    const target = iframeRef.current?.contentWindow
    if (!target) return
    try {
      target.postMessage(createEnvelope(scopeRef.current, payload.type, payload), originRef.current)
    } catch {
      /* iframe might have navigated */
    }
  }

  // Push current state on iframe load, so a fresh content window picks up
  // any host changes that happened before this hook's mount.
  useLayoutEffect(() => {
    const node = iframeRef.current
    if (!node) return
    const onLoad = () => {
      if (iframeRef.current !== node) return
      hasLoaded.current = true
      if (initialized.current.theme && lastSent.current.theme) {
        post({ type: "max:setTheme", theme: lastSent.current.theme })
      }
      if (initialized.current.lang) {
        post({ type: "max:setLang", lang: lastSent.current.lang ?? "" })
      }
    }
    node.addEventListener("load", onLoad)
    return () => node.removeEventListener("load", onLoad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeRef, mounted])

  // Explicit prop changes — push immediately when the caller controls the axis.
  useEffect(() => {
    if (autoTheme || !themeProp) return
    if (lastSent.current.theme === themeProp) return
    lastSent.current.theme = themeProp
    initialized.current.theme = true
    post({ type: "max:setTheme", theme: themeProp })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTheme, themeProp])

  useEffect(() => {
    if (autoLang || !langProp) return
    if (lastSent.current.lang === langProp) return
    lastSent.current.lang = langProp
    initialized.current.lang = true
    post({ type: "max:setLang", lang: langProp })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLang, langProp])

  // Auto-detect mode — watch <html> for class / data-theme / lang changes.
  useEffect(() => {
    if (!autoTheme && !autoLang) return
    if (typeof MutationObserver === "undefined") return
    if (typeof document === "undefined") return

    // Seed and push the detected values. The immediate push matters when a
    // caller releases a previously controlled prop back to auto mode: entering
    // auto mode does not itself cause a DOM mutation.
    if (autoTheme) {
      const next = detectHostTheme()
      const changed = !initialized.current.theme || next !== lastSent.current.theme
      lastSent.current.theme = next
      initialized.current.theme = true
      if (changed && next) post({ type: "max:setTheme", theme: next })
    }
    if (autoLang) {
      const next = detectHostLang()
      const changed = !initialized.current.lang || next !== lastSent.current.lang
      lastSent.current.lang = next
      initialized.current.lang = true
      if (changed) post({ type: "max:setLang", lang: next ?? "" })
    }

    const observer = new MutationObserver(() => {
      if (autoTheme) {
        const next = detectHostTheme()
        if (next && next !== lastSent.current.theme) {
          lastSent.current.theme = next
          post({ type: "max:setTheme", theme: next })
        }
      }
      if (autoLang) {
        const next = detectHostLang()
        if (next !== lastSent.current.lang) {
          lastSent.current.lang = next
          post({ type: "max:setLang", lang: next ?? "" })
        }
      }
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "lang"],
    })
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTheme, autoLang])
}
