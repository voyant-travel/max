import { type RefObject, useEffect, useRef } from "react"

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
  theme: themeProp,
  lang: langProp,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>
  origin: string
  theme?: MaxTheme
  lang?: string
}) {
  // Latest values we've sent to the iframe — to dedupe and to push on
  // re-mount/iframe-load.
  const lastSent = useRef<{ theme: MaxTheme | null; lang: string | null }>({
    theme: null,
    lang: null,
  })

  // Track whether each axis is in auto-detect mode (no caller prop).
  const autoTheme = themeProp === undefined
  const autoLang = langProp === undefined

  function post(payload: object) {
    const target = iframeRef.current?.contentWindow
    if (!target) return
    try {
      target.postMessage(payload, origin)
    } catch {
      /* iframe might have navigated */
    }
  }

  // Push current state on iframe load, so a fresh content window picks up
  // any host changes that happened before this hook's mount.
  useEffect(() => {
    const node = iframeRef.current
    if (!node) return
    const onLoad = () => {
      if (lastSent.current.theme) post({ type: "max:setTheme", theme: lastSent.current.theme })
      if (lastSent.current.lang) post({ type: "max:setLang", lang: lastSent.current.lang })
    }
    node.addEventListener("load", onLoad)
    return () => node.removeEventListener("load", onLoad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Explicit prop changes — push immediately when the caller controls the axis.
  useEffect(() => {
    if (autoTheme || !themeProp) return
    if (lastSent.current.theme === themeProp) return
    lastSent.current.theme = themeProp
    post({ type: "max:setTheme", theme: themeProp })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTheme, themeProp])

  useEffect(() => {
    if (autoLang || !langProp) return
    if (lastSent.current.lang === langProp) return
    lastSent.current.lang = langProp
    post({ type: "max:setLang", lang: langProp })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLang, langProp])

  // Auto-detect mode — watch <html> for class / data-theme / lang changes.
  useEffect(() => {
    if (!autoTheme && !autoLang) return
    if (typeof MutationObserver === "undefined") return
    if (typeof document === "undefined") return

    // Seed lastSent with current host values so the first push on iframe load
    // carries the right state.
    if (autoTheme) lastSent.current.theme = detectHostTheme()
    if (autoLang) lastSent.current.lang = detectHostLang()

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
