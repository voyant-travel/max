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
 *       tenant: "acme",   // tenant scope enforced on inbound messages
 *       audience: "desk", // audience/surface scope enforced on inbound messages
 *     })
 *
 *     // Typed host-context channel (a discovery hint for Max — see SECURITY):
 *     Max.setContext({ type: "booking", id: "VYT-10423", label: "Booking VYT-10423" })
 *     Max.clearContext() // explicit clear
 *   </script>
 *
 * SECURITY: the host context is a *discovery hint only*. It never authorises
 * anything — Max re-verifies identity, auth, approval and consequence-preview
 * for every action regardless of the supplied context.
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
  var WIDE_W = 640
  var Z = 2147483600
  var PROTOCOL_VERSION = 1
  // Bounds mirror the TS `normalizeHostContext` so the loader and React paths
  // normalise identically (id/label length caps, primitive-only meta bag).
  var MAX_ID_LEN = 512
  var MAX_LABEL_LEN = 200
  var MAX_META_KEYS = 32
  var MAX_META_KEY_LEN = 128
  var MAX_META_STRING_LEN = 2048
  var MAX_MSGID_LEN = 200
  var FRESHNESS_MS = 30000
  // Panel spans nearly the full viewport height: 16px top margin + 88px below
  // (clears the 56px launcher + gap). Matches the taller Figma panel.
  var PANEL_H = "calc(100vh - 104px)"
  function allowlist(values) {
    var out = Object.create(null)
    for (var i = 0; i < values.length; i++) out[values[i]] = 1
    return out
  }
  var ENTITY_TYPES = allowlist([
    "product",
    "booking",
    "customer",
    "departure",
    "invoice",
    "contract",
  ])
  var INBOUND_TYPES = allowlist([
    "max:ready",
    "max:close",
    "max:navigate",
    "max:requestLayout",
    "max:setLayout",
    "max:requestContext",
    "max:clearContext",
  ])
  var LEGACY_INBOUND = allowlist(["max:ready", "max:close", "max:navigate", "max:setLayout"])

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
    session: null,
    tenant: null,
    audience: null,
    /** undefined = host supplies no context; null = explicit clear. */
    context: undefined,
    launcherEl: null,
    panelEl: null,
    backdropEl: null,
    controlsEl: null,
    iframeEl: null,
    observer: null,
    msgListener: null,
    open: false,
    layout: "normal",
    seenIds: Object.create(null),
    seenOrder: [],
    modal: null,
    generation: 0,
  }

  function makeId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function")
        return window.crypto.randomUUID()
    } catch (e) {
      /* fall through */
    }
    return "m" + Math.random().toString(16).slice(2) + Date.now().toString(16)
  }

  // ---- postMessage envelope + inbound validation --------------------------

  function envelope(type, payload) {
    var msg = {
      channel: "max",
      v: PROTOCOL_VERSION,
      sessionId: state.session,
      tenant: state.tenant || null,
      audience: state.audience || null,
      msgId: makeId(),
      ts: Date.now(),
      type: type,
    }
    if (payload)
      for (var k in payload) if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k]
    return msg
  }

  // Bounded replay guard: reject duplicate msgIds and stale/malformed timestamps.
  // Mirrors the TS receiver: finite, strictly-positive ts within the freshness
  // window (a NaN/0 ts never bypasses the check) and a bounded, non-empty msgId.
  function replayAccept(msgId, ts) {
    if (typeof msgId !== "string" || !msgId || msgId.length > MAX_MSGID_LEN) return false
    if (typeof ts !== "number" || !isFinite(ts) || ts <= 0) return false
    if (Math.abs(Date.now() - ts) > FRESHNESS_MS) return false
    if (state.seenIds[msgId]) return false
    state.seenIds[msgId] = 1
    state.seenOrder.push(msgId)
    if (state.seenOrder.length > 256) delete state.seenIds[state.seenOrder.shift()]
    return true
  }

  // Validate an inbound message. Returns the message object or null.
  // Strict: exact origin, source === our iframe, session/tenant/audience scope.
  function validateInbound(event) {
    if (event.origin !== state.origin) return null
    if (!state.iframeEl || event.source !== state.iframeEl.contentWindow) return null
    var d = event.data
    if (!d || typeof d !== "object") return null
    var type = d.type
    if (typeof type !== "string" || !INBOUND_TYPES[type]) return null
    if (d.channel !== "max") {
      // Legacy un-enveloped control messages, gated by origin+source only.
      return LEGACY_INBOUND[type] ? d : null
    }
    if (d.v !== PROTOCOL_VERSION) return null
    if (d.sessionId !== state.session) return null
    if (state.tenant != null && (d.tenant || null) !== state.tenant) return null
    if (state.audience != null && (d.audience || null) !== state.audience) return null
    if (!replayAccept(d.msgId, d.ts)) return null
    return d
  }

  // Primitive-only metadata bag (mirrors TS `normalizeMeta`): keeps up to
  // MAX_META_KEYS string/number/boolean/null entries, drops nested objects/fns.
  function normalizeMeta(input) {
    if (!input || typeof input !== "object") return null
    var out = {}
    var n = 0
    for (var k in input) {
      if (!Object.prototype.hasOwnProperty.call(input, k)) continue
      if (n >= MAX_META_KEYS) break
      if (!k || k.length > MAX_META_KEY_LEN) continue
      var v = input[k]
      if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out[k] = typeof v === "string" ? v.slice(0, MAX_META_STRING_LEN) : v
        n++
      }
    }
    return n > 0 ? out : null
  }

  // Mirror of TS `normalizeHostContext`: closed entity-type set, trimmed &
  // length-bounded id/label, primitive-only meta, route/subView/version/capturedAt.
  function normalizeContext(input) {
    if (!input || typeof input !== "object") return null
    if (!ENTITY_TYPES[input.type]) return null
    var id = typeof input.id === "string" ? input.id.trim() : ""
    if (!id || id.length > MAX_ID_LEN) return null
    var out = { type: input.type, id: id }
    out.label =
      typeof input.label === "string" && input.label.trim()
        ? input.label.trim().slice(0, MAX_LABEL_LEN)
        : id
    if (typeof input.route === "string" && input.route) out.route = input.route.slice(0, 2048)
    if (typeof input.subView === "string" && input.subView) out.subView = input.subView.slice(0, 128)
    if (Object.prototype.hasOwnProperty.call(input, "version")) {
      if (typeof input.version !== "number" || !isFinite(input.version) || input.version < 0 || Math.floor(input.version) !== input.version) return null
      out.version = input.version
    }
    if (Object.prototype.hasOwnProperty.call(input, "capturedAt")) {
      if (typeof input.capturedAt !== "string" || !input.capturedAt || !isFinite(Date.parse(input.capturedAt))) return null
      out.capturedAt = input.capturedAt
    }
    var meta = normalizeMeta(input.meta)
    if (meta) out.meta = meta
    return out
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

  function sendContext(ctx) {
    postToIframe(envelope("max:setContext", { context: ctx }))
    state.context = ctx
  }

  function srcFor(path) {
    var u = state.origin.replace(/\/$/, "") + path
    var qs = "token=" + encodeURIComponent(state.token || "")
    qs += "&hostOrigin=" + encodeURIComponent(window.location.origin)
    if (state.theme) qs += "&theme=" + encodeURIComponent(state.theme)
    if (state.lang) qs += "&lang=" + encodeURIComponent(state.lang)
    qs += "&session=" + encodeURIComponent(state.session)
    if (state.tenant) qs += "&tenant=" + encodeURIComponent(state.tenant)
    if (state.audience) qs += "&audience=" + encodeURIComponent(state.audience)
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

  // Host-rendered layout controls (wide / expand / restore) overlaid on the
  // panel — the iframe can't resize the host-owned panel, so the host owns them.
  function ensureControls(panel) {
    if (state.controlsEl) return state.controlsEl
    var wrap = document.createElement("div")
    wrap.style.cssText = [
      "position:absolute",
      "top:8px",
      "right:8px",
      "display:flex",
      "gap:6px",
      "z-index:3",
    ].join(";")
    function mkBtn(label, svg, onClick) {
      var b = document.createElement("button")
      b.type = "button"
      b.setAttribute("aria-label", label)
      b.style.cssText = [
        "width:26px",
        "height:26px",
        "display:grid",
        "place-items:center",
        "border:0",
        "border-radius:8px",
        "background:rgba(15,16,13,0.55)",
        "color:#fff",
        "cursor:pointer",
        "-webkit-backdrop-filter:blur(6px)",
        "backdrop-filter:blur(6px)",
      ].join(";")
      b.innerHTML = svg
      b.addEventListener("click", onClick)
      return b
    }
    var wideSvg =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7 4 12l4 5M16 7l4 5-4 5"/></svg>'
    var expandSvg =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>'
    var restoreSvg =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v6H3M21 15h-6v6M4 20l6-6M20 4l-6 6"/></svg>'
    var wideBtn = mkBtn("Widen Max panel", wideSvg, function () {
      applyLayout(state.layout === "wide" ? "normal" : "wide")
    })
    var expandBtn = mkBtn("Expand Max to full page", expandSvg, function () {
      applyLayout(state.layout === "expanded" ? "normal" : "expanded")
    })
    wrap.appendChild(wideBtn)
    wrap.appendChild(expandBtn)
    panel.appendChild(wrap)
    state.controlsEl = wrap
    state.controlsWideBtn = wideBtn
    state.controlsExpandBtn = expandBtn
    syncControls()
    return wrap
  }

  function syncControls() {
    if (!state.controlsEl) return
    var expanded = state.layout === "expanded"
    state.controlsWideBtn.style.display = expanded ? "none" : "grid"
    state.controlsWideBtn.setAttribute(
      "aria-label",
      state.layout === "wide" ? "Narrow Max panel" : "Widen Max panel",
    )
    state.controlsExpandBtn.setAttribute(
      "aria-label",
      expanded ? "Restore Max panel" : "Expand Max to full page",
    )
    state.controlsExpandBtn.innerHTML = expanded
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v6H3M21 15h-6v6M4 20l6-6M20 4l-6 6"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>'
  }

  // ---- Modal a11y for the expanded/full-page panel -----------------------
  // Mirrors the React `focus-trap` helper: isolate the background (inert +
  // aria-hidden), move focus into the dialog, trap Tab, close on Escape, and
  // return focus on exit.

  var FOCUSABLE =
    'a[href],area[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),' +
    'select:not([disabled]),textarea:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])'

  function getFocusable(container) {
    var list = []
    var nodes = container.querySelectorAll(FOCUSABLE)
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i]
      if (el.getAttribute("aria-hidden") === "true") continue
      var style = null
      try {
        style = window.getComputedStyle(el)
      } catch (e) {
        /* jsdom / detached */
      }
      if (style && style.display === "none") continue
      list.push(el)
    }
    return list
  }

  function trapTab(container, event) {
    var focusable = getFocusable(container)
    if (focusable.length === 0) {
      event.preventDefault()
      container.focus()
      return
    }
    var first = focusable[0]
    var last = focusable[focusable.length - 1]
    var active = document.activeElement
    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault()
        last.focus()
      }
    } else if (active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function isolateBackground(target) {
    var changed = []
    var node = target
    var body = document.body
    while (node && node !== body && node.parentElement) {
      var parent = node.parentElement
      var children = parent.children
      for (var i = 0; i < children.length; i++) {
        var sib = children[i]
        if (sib === node) continue
        if (sib.hasAttribute("inert")) continue
        changed.push({
          element: sib,
          inert: sib.getAttribute("inert"),
          ariaHidden: sib.getAttribute("aria-hidden"),
          marker: sib.getAttribute("data-max-inert"),
        })
        sib.setAttribute("inert", "")
        sib.setAttribute("aria-hidden", "true")
        sib.setAttribute("data-max-inert", "")
      }
      node = parent
    }
    return {
      restore: function () {
        for (var i = 0; i < changed.length; i++) {
          restoreAttribute(changed[i].element, "inert", changed[i].inert)
          restoreAttribute(changed[i].element, "aria-hidden", changed[i].ariaHidden)
          restoreAttribute(changed[i].element, "data-max-inert", changed[i].marker)
        }
      },
    }
  }

  function restoreAttribute(element, name, value) {
    if (value === null) element.removeAttribute(name)
    else element.setAttribute(name, value)
  }

  function enterModal(panel) {
    if (state.modal && state.modal.active) return
    panel.setAttribute("aria-modal", "true")
    var previous = document.activeElement
    var isolated = isolateBackground(panel)
    var onKey = function (e) {
      if (e.key === "Escape") {
        e.stopPropagation()
        applyLayout("normal")
      } else if (e.key === "Tab") {
        trapTab(panel, e)
      }
    }
    panel.addEventListener("keydown", onKey)
    state.modal = { active: true, panel: panel, previous: previous, isolated: isolated, onKey: onKey }
    try {
      panel.focus()
    } catch (e) {
      /* detached */
    }
  }

  function exitModal() {
    var m = state.modal
    if (!m || !m.active) return
    m.panel.removeAttribute("aria-modal")
    m.panel.removeEventListener("keydown", m.onKey)
    m.isolated.restore()
    if (m.previous && typeof m.previous.focus === "function") {
      try {
        m.previous.focus()
      } catch (e) {
        /* previously-focused node may be gone */
      }
    }
    state.modal = null
  }

  function ensurePanel() {
    if (state.panelEl) return state.panelEl
    ensureStyles()
    var panel = document.createElement("div")
    panel.setAttribute("role", "dialog")
    panel.setAttribute("aria-label", "Max by Voyant")
    panel.setAttribute("tabindex", "-1")
    panel.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:88px",
      "width:min(" + BUBBLE_W + "px, calc(100vw - 40px))",
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
    var generation = state.generation
    state.iframeEl.addEventListener("load", function () {
      if (state.generation !== generation) return
      loader.style.opacity = "0"
      setTimeout(function () {
        loader.style.display = "none"
      }, 260)
      // Re-push the current context to a fresh content window.
      if (state.context !== undefined) sendContext(state.context)
      postToIframe(envelope("max:setTheme", { theme: state.theme }))
      postToIframe(envelope("max:setLang", { lang: state.lang || "" }))
      // A host may request wide/expanded while the iframe is still loading.
      // The eager acknowledgement targets the initial document and can be
      // dropped, so replay the applied layout to this loaded generation.
      postToIframe(envelope("max:setLayout", { layout: state.layout }))
    })
    document.body.appendChild(panel)
    ensureControls(panel)
    state.panelEl = panel
    return panel
  }

  function openPanel() {
    var p = ensurePanel()
    var b = ensureBackdrop()
    var generation = state.generation
    b.style.display = "block"
    p.style.display = "block"
    requestAnimationFrame(function () {
      if (state.generation !== generation) return
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
    var generation = state.generation
    p.style.opacity = "0"
    p.style.transform = "translateY(12px) scale(0.96)"
    if (b) b.style.opacity = "0"
    // A closing/closed panel is not modal, even while its visual exit animation
    // is finishing. Release host-page isolation immediately.
    exitModal()
    setTimeout(function () {
      if (state.generation !== generation) return
      if (!state.open) {
        p.style.display = "none"
        if (b) b.style.display = "none"
        // Reset to docked while hidden so the next open isn't stuck expanded.
        if (state.layout !== "normal") applyLayout("normal")
      }
    }, 300)
    state.open = false
  }

  // Responsive layout: normal (~420px docked), wide (~640px docked), expanded
  // (centred near-fullscreen, capped on wide screens). All widths are clamped to
  // the viewport. `expanded` is latched — it never auto-reverts.
  function applyLayout(layout) {
    if (layout !== "normal" && layout !== "wide" && layout !== "expanded") return
    var changed = state.layout !== layout
    state.layout = layout
    var p = state.panelEl
    if (!p) return
    p.style.transition =
      "opacity 200ms ease,transform 300ms cubic-bezier(0.16,1,0.3,1)," +
      "right 280ms ease,left 280ms ease,top 280ms ease,bottom 280ms ease," +
      "width 280ms ease,height 280ms ease,border-radius 280ms ease"
    if (layout === "expanded") {
      p.style.right = "max(16px, calc(50vw - 640px))"
      p.style.left = "max(16px, calc(50vw - 640px))"
      p.style.top = "16px"
      p.style.bottom = "16px"
      p.style.width = "auto"
      p.style.height = "auto"
      p.style.maxWidth = "none"
      p.style.transformOrigin = "50% 50%"
    } else {
      var w = layout === "wide" ? WIDE_W : BUBBLE_W
      p.style.right = "20px"
      p.style.left = ""
      p.style.top = ""
      p.style.bottom = "88px"
      p.style.width = "min(" + w + "px, calc(100vw - 40px))"
      p.style.height = PANEL_H
      p.style.maxWidth = "calc(100vw - 40px)"
      p.style.transformOrigin = "100% 100%"
    }
    // Expanded is a modal dialog: enter/exit focus isolation accordingly.
    if (layout === "expanded") enterModal(p)
    else exitModal()
    syncControls()
    // Echo the applied layout back to the iframe (host↔iframe round trip) — but
    // only when it actually changed. This is idempotent: an echoing peer that
    // reflects our `max:setLayout` back lands on the same layout, so we don't
    // echo again and the loop stops (no ping-pong).
    if (changed) postToIframe(envelope("max:setLayout", { layout: layout }))
    if (changed && typeof state.onLayoutChange === "function") state.onLayoutChange(layout)
  }

  // Messages FROM the iframe (embed origin + our iframe only): Close, canvas-
  // driven layout changes, and context requests/clears.
  function installIframeMessageListener() {
    if (state.msgListener) window.removeEventListener("message", state.msgListener)
    state.msgListener = function (event) {
      var data = validateInbound(event)
      if (!data) return
      if (data.type === "max:close") {
        if (state.layout !== "normal") applyLayout("normal")
        closePanel()
      } else if (data.type === "max:requestLayout" || data.type === "max:setLayout") {
        if (data.layout === "expanded" || data.layout === "wide") {
          openPanel()
          applyLayout(data.layout)
        } else if (data.layout === "normal") {
          applyLayout("normal")
        }
      } else if (data.type === "max:requestContext") {
        if (state.context !== undefined) sendContext(state.context)
      } else if (data.type === "max:clearContext") {
        if (typeof state.onContextClear === "function") state.onContextClear()
        sendContext(null)
      }
    }
    window.addEventListener("message", state.msgListener)
  }

  function mountInline() {
    var host =
      typeof state.target === "string" ? document.querySelector(state.target) : state.target
    if (!host) {
      console.error("[Max] inline mode requires a valid `target` element or selector")
      return
    }
    if (!(host instanceof HTMLElement)) return
    host.innerHTML = ""
    host.style.position = host.style.position || "relative"
    state.iframeEl = makeIframe(srcFor("/max"))
    state.iframeEl.style.minHeight = "480px"
    var generation = state.generation
    state.iframeEl.addEventListener("load", function () {
      if (state.generation !== generation) return
      if (state.context !== undefined) sendContext(state.context)
      postToIframe(envelope("max:setTheme", { theme: state.theme }))
      postToIframe(envelope("max:setLang", { lang: state.lang || "" }))
    })
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
    // Re-initialisation is a new security boundary just like explicit destroy:
    // tear down any prior tenant/session, listeners, replay cache and DOM first.
    destroy()
    state.token = opts.token
    state.mode = opts.mode === "inline" ? "inline" : "bubble"
    state.origin = (opts.embedOrigin || DEFAULT_ORIGIN).replace(/\/$/, "")
    state.target = opts.target || null
    state.session = makeId()
    state.tenant = typeof opts.tenant === "string" && opts.tenant ? opts.tenant : null
    state.audience = typeof opts.audience === "string" && opts.audience ? opts.audience : null
    state.onContextClear = typeof opts.onContextClear === "function" ? opts.onContextClear : null
    state.onLayoutChange = typeof opts.onLayoutChange === "function" ? opts.onLayoutChange : null
    state.context =
      opts.context === undefined
        ? undefined
        : opts.context === null
          ? null
          : normalizeContext(opts.context) || undefined

    var explicitTheme =
      opts.theme === "light" || opts.theme === "dark" || opts.theme === "system"
        ? opts.theme
        : null
    var explicitLang = typeof opts.lang === "string" && opts.lang.length > 0 ? opts.lang : null
    state.autoTheme = explicitTheme === null
    state.autoLang = explicitLang === null
    state.theme = explicitTheme || detectHostTheme()
    state.lang = explicitLang || detectHostLang()

    if (state.mode === "inline") {
      whenReady(function () {
        mountInline()
        installHostObserver()
        installIframeMessageListener()
      })
    } else {
      whenReady(function () {
        ensureLauncher()
        installHostObserver()
        installIframeMessageListener()
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
          postToIframe(envelope("max:setTheme", { theme: next }))
        }
      }
      if (state.autoLang) {
        var nextLang = detectHostLang()
        if (nextLang !== state.lang) {
          state.lang = nextLang
          postToIframe(envelope("max:setLang", { lang: nextLang || "" }))
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

  // Public context API. `setContext(null)` / `clearContext()` are explicit
  // clears — Max never silently drops a context.
  function setContext(ctx) {
    var norm = ctx == null ? null : normalizeContext(ctx)
    if (ctx != null && norm == null) {
      console.error("[Max] setContext: invalid context (unknown entity type or missing id)")
      return
    }
    sendContext(norm)
  }

  function clearContext() {
    sendContext(null)
  }

  function setLayout(layout) {
    if (state.mode !== "bubble") return
    whenReady(function () {
      if (layout === "expanded" || layout === "wide") openPanel()
      applyLayout(layout)
    })
  }

  function destroy() {
    state.generation++
    exitModal()
    if (state.observer) state.observer.disconnect()
    if (state.msgListener) window.removeEventListener("message", state.msgListener)
    if (state.iframeEl) state.iframeEl.remove()
    if (state.launcherEl) state.launcherEl.remove()
    if (state.panelEl) state.panelEl.remove()
    if (state.backdropEl) state.backdropEl.remove()
    state.launcherEl = null
    state.panelEl = null
    state.backdropEl = null
    state.controlsEl = null
    state.iframeEl = null
    state.observer = null
    state.msgListener = null
    state.open = false
    state.layout = "normal"
    state.token = null
    state.mode = "bubble"
    state.origin = DEFAULT_ORIGIN
    state.target = null
    state.theme = null
    state.lang = null
    state.autoTheme = false
    state.autoLang = false
    state.session = null
    state.tenant = null
    state.audience = null
    state.context = undefined
    state.onContextClear = null
    state.onLayoutChange = null
    state.controlsWideBtn = null
    state.controlsExpandBtn = null
    state.seenIds = Object.create(null)
    state.seenOrder = []
    state.modal = null
  }

  function whenReady(fn) {
    var generation = state.generation
    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        function () {
          if (state.generation === generation) fn()
        },
        { once: true },
      )
    } else {
      if (state.generation === generation) fn()
    }
  }

  window.Max = {
    __initialized: true,
    init: init,
    open: open,
    close: close,
    setContext: setContext,
    clearContext: clearContext,
    setLayout: setLayout,
    destroy: destroy,
  }
})()
