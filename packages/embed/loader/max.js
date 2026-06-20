/**
 * Max by Voyant — embed loader.
 *
 * Usage from a host page:
 *   <script src="https://agent-embed.voyant.travel/max.js" defer></script>
 *   <script>
 *     Max.init({ token: "<embed-jwt>", mode: "bubble" })
 *     // or for inline:
 *     Max.init({ token: "<embed-jwt>", mode: "inline", target: "#max-host" })
 *
 *     // Theme + language tracking:
 *     // By default the loader sniffs the host page on mount and keeps the
 *     // iframe in sync as the host changes — checks `<html class="dark|light">`,
 *     // `<html data-theme="dark|light">`, and `<html lang="...">`, then watches
 *     // those via MutationObserver. Updates are pushed via postMessage so the
 *     // chat state isn't lost.
 *     // Pass `theme` / `lang` explicitly to override the auto-detect:
 *     Max.init({
 *       token: "<embed-jwt>",
 *       theme: "light",   // "light" | "dark" | "system" — disables sniffing
 *       lang: "ro",       // BCP-47 tag — disables sniffing
 *     })
 *   </script>
 *
 * Tokens are minted server-side by the operator's backend via
 * `POST https://api.voyantjs.com/max/v1/embed/token`. Never bake an embed
 * token into static HTML — they're short-lived (~15min) per-user.
 */
;(function () {
  if (typeof window === "undefined") return
  if (window.Max && window.Max.__initialized) return

  var DEFAULT_ORIGIN = "https://agent-embed.voyant.travel"
  var BUBBLE_W = 420
  var Z = 2147483600
  // Panel spans nearly the full viewport height: 16px top margin + 88px below
  // (clears the 56px launcher + gap). Matches the taller Figma panel.
  var PANEL_H = "calc(100vh - 104px)"

  var state = {
    token: null,
    mode: "bubble",
    origin: DEFAULT_ORIGIN,
    target: null,
    theme: null,
    lang: null,
    /** When true, theme/lang were not explicitly set and we sniff <html>. */
    autoTheme: false,
    autoLang: false,
    launcherEl: null,
    panelEl: null,
    backdropEl: null,
    iframeEl: null,
    observer: null,
    open: false,
  }

  function detectHostTheme() {
    try {
      var cls = document.documentElement.classList
      if (cls.contains("dark")) return "dark"
      if (cls.contains("light")) return "light"
      // Many design systems use [data-theme="dark"|"light"] instead. Honour
      // both — fall through to system otherwise.
      var attr = document.documentElement.getAttribute("data-theme")
      if (attr === "dark" || attr === "light") return attr
      return "system"
    } catch (e) {
      return "system"
    }
  }

  function detectHostLang() {
    try {
      var attr = document.documentElement.getAttribute("lang")
      if (attr && attr.length > 0) return attr
      return null
    } catch (e) {
      return null
    }
  }

  function postToIframe(payload) {
    if (!state.iframeEl || !state.iframeEl.contentWindow) return
    try {
      state.iframeEl.contentWindow.postMessage(payload, state.origin)
    } catch (e) {
      /* iframe may have navigated away */
    }
  }

  function srcFor(path) {
    var u = state.origin.replace(/\/$/, "") + path
    var qs = "token=" + encodeURIComponent(state.token || "")
    if (state.theme) qs += "&theme=" + encodeURIComponent(state.theme)
    if (state.lang) qs += "&lang=" + encodeURIComponent(state.lang)
    return u + "?" + qs
  }

  function makeIframe(src) {
    var f = document.createElement("iframe")
    f.src = src
    f.title = "Max by Voyant"
    f.allow = "clipboard-read; clipboard-write"
    f.setAttribute("loading", "eager")
    f.style.border = "0"
    f.style.width = "100%"
    f.style.height = "100%"
    f.style.background = "transparent"
    f.style.colorScheme = "normal"
    return f
  }

  function ensureLauncher() {
    if (state.launcherEl) return state.launcherEl
    var btn = document.createElement("button")
    btn.type = "button"
    btn.setAttribute("aria-label", "Open Max chat")
    btn.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:20px",
      "width:56px",
      "height:56px",
      "border-radius:9999px",
      "border:0",
      // Voyant brand orange (mirrors --brand oklch(0.675 0.222 38)); the host
      // page has no access to the iframe's theme tokens, so it's hardcoded.
      "background:#ff5100",
      "color:#fff",
      "box-shadow:0 10px 25px rgba(0,0,0,0.2)",
      "cursor:pointer",
      "z-index:" + Z,
      "display:grid",
      "place-items:center",
      "font:600 14px/1 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif",
      "transition:transform 120ms ease",
    ].join(";")
    btn.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>'
    btn.addEventListener("mouseenter", function () {
      btn.style.transform = "translateY(-1px)"
    })
    btn.addEventListener("mouseleave", function () {
      btn.style.transform = "translateY(0)"
    })
    btn.addEventListener("click", function () {
      state.open ? closePanel() : openPanel()
    })
    document.body.appendChild(btn)
    state.launcherEl = btn
    return btn
  }

  // Keyframes for the loading state — injected once (cssText can't hold them).
  function ensureStyles() {
    if (document.getElementById("max-embed-styles")) return
    var s = document.createElement("style")
    s.id = "max-embed-styles"
    s.textContent =
      "@keyframes max-spin{to{transform:rotate(360deg)}}" +
      "@keyframes max-twinkle{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.18);opacity:.6}}"
    document.head.appendChild(s)
  }

  function isDarkTheme() {
    if (state.theme === "dark") return true
    if (state.theme === "light") return false
    try {
      return (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
      )
    } catch (e) {
      return false
    }
  }

  // Branded loading state shown over the panel until the iframe finishes
  // loading — a spinning ring around the twinkling Max sparkle. Sits on an
  // opaque themed surface so the panel never flashes blank/white.
  function makeLoader() {
    var dark = isDarkTheme()
    var loader = document.createElement("div")
    loader.style.cssText = [
      "position:absolute",
      "inset:0",
      "display:grid",
      "place-items:center",
      "background:" + (dark ? "#0b0b0a" : "#ffffff"),
      "z-index:2",
      "opacity:1",
      "transition:opacity 240ms ease",
    ].join(";")
    var ringTrack = dark ? "rgba(255,255,255,0.12)" : "rgba(15,16,13,0.1)"
    loader.innerHTML =
      '<div style="position:relative;width:46px;height:46px;display:grid;place-items:center">' +
      '<div style="position:absolute;inset:0;border:3px solid ' +
      ringTrack +
      ";border-top-color:#ff5100;border-radius:9999px;animation:max-spin .8s linear infinite\"></div>" +
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" style="animation:max-twinkle 1.6s ease-in-out infinite">' +
      '<path d="M5.417 10.833 6.07 12.14c.221.443.332.664.48.856.131.17.283.323.453.454.192.148.413.258.856.48L9.167 14.58l-1.308.654c-.443.221-.664.332-.856.48-.17.131-.323.283-.454.454-.148.192-.258.413-.48.856l-.652 1.307-.654-1.307c-.221-.443-.332-.664-.48-.856a2.5 2.5 0 0 0-.453-.454c-.192-.148-.413-.258-.856-.48L1.667 14.58l1.307-.654c.443-.221.664-.332.856-.48.17-.131.323-.283.454-.454.148-.192.258-.413.48-.856l.653-1.307Z" stroke="#ff5100" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M12.5 1.667l.982 2.553c.235.611.353.917.535 1.174.162.228.361.427.589.589.257.183.563.3 1.174.535L18.334 7.5l-2.554.982c-.611.235-.917.353-1.174.535a2.5 2.5 0 0 0-.589.589c-.182.257-.3.563-.535 1.174L12.5 13.333l-.982-2.553c-.235-.611-.353-.917-.535-1.174a2.5 2.5 0 0 0-.589-.589c-.257-.182-.563-.3-1.174-.535L6.667 7.5l2.553-.982c.611-.235.917-.353 1.174-.535.228-.162.427-.361.589-.589.182-.257.3-.563.535-1.174L12.5 1.667Z" stroke="#ff5100" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      "</svg>" +
      "</div>"
    return loader
  }

  // Dimmed + blurred scrim behind the panel for depth/focus. It must live in
  // the host page (the iframe can't blur content outside its own frame).
  // `pointer-events:none` keeps the host dashboard interactive — visual only.
  function ensureBackdrop() {
    if (state.backdropEl) return state.backdropEl
    var b = document.createElement("div")
    b.style.cssText = [
      "position:fixed",
      "inset:0",
      "background:rgba(15,16,13,0.32)",
      "-webkit-backdrop-filter:blur(4px)",
      "backdrop-filter:blur(4px)",
      "z-index:" + (Z - 1),
      "pointer-events:none",
      "display:none",
      "opacity:0",
      "transition:opacity 160ms ease",
    ].join(";")
    document.body.appendChild(b)
    state.backdropEl = b
    return b
  }

  function ensurePanel() {
    if (state.panelEl) return state.panelEl
    ensureStyles()
    var panel = document.createElement("div")
    panel.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:88px",
      "width:" + BUBBLE_W + "px",
      "height:" + PANEL_H,
      "max-width:calc(100vw - 40px)",
      "border-radius:16px",
      "overflow:hidden",
      "background:transparent",
      "box-shadow:0 30px 60px rgba(0,0,0,0.25)",
      "z-index:" + Z,
      "display:none",
      "opacity:0",
      // Grows out of the launcher button in the bottom-right corner.
      "transform-origin:100% 100%",
      "transform:translateY(12px) scale(0.96)",
      "transition:opacity 200ms ease,transform 300ms cubic-bezier(0.16,1,0.3,1)",
    ].join(";")
    state.iframeEl = makeIframe(srcFor("/max/bubble"))
    panel.appendChild(state.iframeEl)
    var loader = makeLoader()
    panel.appendChild(loader)
    state.iframeEl.addEventListener("load", function () {
      loader.style.opacity = "0"
      setTimeout(function () {
        loader.style.display = "none"
      }, 260)
    })
    document.body.appendChild(panel)
    state.panelEl = panel
    return panel
  }

  function openPanel() {
    var p = ensurePanel()
    var b = ensureBackdrop()
    b.style.display = "block"
    p.style.display = "block"
    requestAnimationFrame(function () {
      b.style.opacity = "1"
      p.style.opacity = "1"
      p.style.transform = "translateY(0) scale(1)"
    })
    state.open = true
  }

  function closePanel() {
    if (!state.panelEl) return
    var p = state.panelEl
    var b = state.backdropEl
    p.style.opacity = "0"
    p.style.transform = "translateY(12px) scale(0.96)"
    if (b) b.style.opacity = "0"
    setTimeout(function () {
      if (!state.open) {
        p.style.display = "none"
        if (b) b.style.display = "none"
      }
    }, 300)
    state.open = false
  }

  function mountInline() {
    var host =
      typeof state.target === "string"
        ? document.querySelector(state.target)
        : state.target
    if (!host) {
      console.error("[Max] inline mode requires a valid `target` element or selector")
      return
    }
    if (!(host instanceof HTMLElement)) return
    host.innerHTML = ""
    host.style.position = host.style.position || "relative"
    state.iframeEl = makeIframe(srcFor("/max"))
    state.iframeEl.style.minHeight = "480px"
    host.appendChild(state.iframeEl)
  }

  function init(opts) {
    if (!opts || typeof opts !== "object") {
      console.error("[Max] init() requires an options object")
      return
    }
    if (!opts.token || typeof opts.token !== "string") {
      console.error("[Max] init() requires `token`")
      return
    }
    state.token = opts.token
    state.mode = opts.mode === "inline" ? "inline" : "bubble"
    state.origin = (opts.embedOrigin || DEFAULT_ORIGIN).replace(/\/$/, "")
    state.target = opts.target || null

    var explicitTheme =
      opts.theme === "light" || opts.theme === "dark" || opts.theme === "system"
        ? opts.theme
        : null
    var explicitLang =
      typeof opts.lang === "string" && opts.lang.length > 0 ? opts.lang : null
    state.autoTheme = explicitTheme === null
    state.autoLang = explicitLang === null
    state.theme = explicitTheme || detectHostTheme()
    state.lang = explicitLang || detectHostLang()

    if (state.mode === "inline") {
      whenReady(function () {
        mountInline()
        installHostObserver()
      })
    } else {
      whenReady(function () {
        ensureLauncher()
        installHostObserver()
      })
    }
  }

  function installHostObserver() {
    // Watch <html> for class / data-theme / lang changes so the iframe stays
    // in sync when the host page toggles its theme or language at runtime.
    // postMessage is used instead of changing the iframe `src` — a src change
    // would navigate the iframe and tear down the chat state.
    if (state.observer) state.observer.disconnect()
    if (!state.autoTheme && !state.autoLang) return
    if (typeof MutationObserver !== "function") return

    state.observer = new MutationObserver(function () {
      if (state.autoTheme) {
        var next = detectHostTheme()
        if (next !== state.theme) {
          state.theme = next
          postToIframe({ type: "max:setTheme", theme: next })
        }
      }
      if (state.autoLang) {
        var nextLang = detectHostLang()
        if (nextLang !== state.lang) {
          state.lang = nextLang
          postToIframe({ type: "max:setLang", lang: nextLang || "" })
        }
      }
    })
    state.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "lang"],
    })
  }

  function open() {
    if (state.mode !== "bubble") return
    whenReady(openPanel)
  }

  function close() {
    if (state.mode !== "bubble") return
    closePanel()
  }

  function destroy() {
    if (state.observer) state.observer.disconnect()
    if (state.launcherEl) state.launcherEl.remove()
    if (state.panelEl) state.panelEl.remove()
    if (state.backdropEl) state.backdropEl.remove()
    state.launcherEl = null
    state.panelEl = null
    state.backdropEl = null
    state.iframeEl = null
    state.observer = null
    state.open = false
  }

  function whenReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true })
    } else {
      fn()
    }
  }

  window.Max = {
    __initialized: true,
    init: init,
    open: open,
    close: close,
    destroy: destroy,
  }
})()
