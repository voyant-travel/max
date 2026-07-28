import { afterEach, beforeEach, describe, expect, it } from "vitest"
// Inline the loader source via Vite's `?raw` import (no node:fs → no @types/node).
import LOADER_SRC from "../loader/max.js?raw"

/**
 * Behavioural tests for the framework-agnostic `<script>` loader (`loader/max.js`).
 * The loader is a plain IIFE that attaches `window.Max` and drives the DOM, so we
 * evaluate it fresh in jsdom and exercise it through its public API + real
 * `message` events — asserting parity with the React/TS side (context
 * normalisation, strict inbound validation, replay/freshness, layout round trips,
 * and modal a11y).
 */

const ORIGIN = "https://iframe.example"

type MaxApi = {
  init: (o: Record<string, unknown>) => void
  open: () => void
  close: () => void
  setContext: (c: unknown) => void
  clearContext: () => void
  setLayout: (l: string) => void
  destroy: () => void
}

type Win = Window & { Max?: MaxApi }

function evalLoader(): MaxApi {
  // Fresh IIFE execution → fresh private `state`.
  new Function(LOADER_SRC)()
  return (window as unknown as Win).Max as MaxApi
}

let posts: Array<Record<string, unknown>>

/** Boot the bubble loader, open it, and spy on messages posted to the iframe. */
function boot(initOpts: Record<string, unknown> = {}) {
  const Max = evalLoader()
  Max.init({ token: "t", mode: "bubble", embedOrigin: ORIGIN, ...initOpts })
  Max.open()
  const iframe = document.querySelector("iframe") as HTMLIFrameElement
  const cw = iframe.contentWindow as Window
  posts = []
  cw.postMessage = ((m: unknown) => {
    posts.push(m as Record<string, unknown>)
  }) as typeof cw.postMessage
  const session = new URL(iframe.src).searchParams.get("session") as string
  return { Max, iframe, cw, session }
}

function inbound(
  cw: Window,
  session: string,
  type: string,
  extra: Record<string, unknown> = {},
  over: {
    origin?: string
    source?: Window | null
    session?: string
    tenant?: string | null
    ts?: number
    msgId?: string
    channel?: string
  } = {},
) {
  const data: Record<string, unknown> = {
    channel: "channel" in over ? over.channel : "max",
    v: 1,
    sessionId: over.session ?? session,
    tenant: "tenant" in over ? over.tenant : null,
    audience: null,
    msgId: over.msgId ?? `m-${Math.random()}`,
    ts: over.ts ?? Date.now(),
    type,
    ...extra,
  }
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: over.origin ?? ORIGIN,
      source: "source" in over ? (over.source as Window) : cw,
    }),
  )
}

const setContextPosts = () => posts.filter((p) => p.type === "max:setContext")
const setLayoutPosts = () => posts.filter((p) => p.type === "max:setLayout")

beforeEach(() => {
  const w = window as unknown as Win
  if (w.Max) {
    try {
      w.Max.destroy()
    } catch {
      /* ignore */
    }
  }
  w.Max = undefined
  document.body.innerHTML = ""
  document.head.innerHTML = ""
  document.documentElement.removeAttribute("class")
  document.documentElement.removeAttribute("data-theme")
  document.documentElement.removeAttribute("lang")
})

afterEach(() => {
  const w = window as unknown as Win
  try {
    w.Max?.destroy()
  } catch {
    /* ignore */
  }
})

describe("loader — context normalization parity", () => {
  it("trims id, caps/falls back label, keeps primitive-only meta, drops junk", () => {
    const { session } = boot({ tenant: "acme" })
    ;(window as unknown as Win).Max?.setContext({
      type: "booking",
      id: "  B-1  ",
      label: "   ",
      version: 2,
      route: "/bookings/B-1",
      subView: "payments",
      meta: { tier: "gold", vip: true, blob: { x: 1 }, fn: () => 1 },
    })
    const last = setContextPosts().at(-1)
    expect(last).toMatchObject({
      type: "max:setContext",
      sessionId: session,
      tenant: "acme",
      context: {
        type: "booking",
        id: "B-1",
        label: "B-1", // fell back to id (label was whitespace)
        version: 2,
        route: "/bookings/B-1",
        subView: "payments",
        meta: { tier: "gold", vip: true },
      },
    })
    expect((last?.context as Record<string, unknown>).meta).not.toHaveProperty("blob")
    expect((last?.context as Record<string, unknown>).meta).not.toHaveProperty("fn")
  })

  it("rejects an unknown entity type and an over-long id (no post)", () => {
    boot()
    const Max = (window as unknown as Win).Max
    Max?.setContext({ type: "root", id: "x", label: "x" })
    Max?.setContext({ type: "booking", id: "x".repeat(600), label: "x" })
    expect(setContextPosts()).toHaveLength(0)
  })

  it("does not accept Object.prototype names as entity types", () => {
    boot()
    ;(window as unknown as Win).Max?.setContext({ type: "toString", id: "x" })
    expect(setContextPosts()).toHaveLength(0)
  })

  it("rejects invalid supplied revision markers instead of dropping them", () => {
    boot()
    const Max = (window as unknown as Win).Max
    Max?.setContext({ type: "booking", id: "B-1", version: -1 })
    Max?.setContext({ type: "booking", id: "B-1", version: 1.5 })
    Max?.setContext({ type: "booking", id: "B-1", capturedAt: "not-a-date" })
    expect(setContextPosts()).toHaveLength(0)
  })
})

describe("loader — lifecycle isolation", () => {
  it("removes an inline iframe and re-inits bubble under a fresh tenant scope", () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const Max = evalLoader()
    Max.init({ token: "a", mode: "inline", target: host, embedOrigin: ORIGIN, tenant: "tenant-a" })
    const inline = host.querySelector("iframe") as HTMLIFrameElement
    expect(inline).not.toBeNull()

    Max.init({ token: "b", mode: "bubble", embedOrigin: ORIGIN, tenant: "tenant-b" })
    Max.open()
    const bubble = document.querySelector("iframe") as HTMLIFrameElement
    expect(host.contains(inline)).toBe(false)
    expect(document.querySelectorAll("iframe")).toHaveLength(1)
    expect(new URL(bubble.src).searchParams.get("tenant")).toBe("tenant-b")
    expect(new URL(bubble.src).searchParams.get("session")).not.toBe(
      new URL(inline.src).searchParams.get("session"),
    )
  })

  it("does not leak context or scope from init A through destroy into init B", () => {
    const { Max } = boot({
      tenant: "tenant-a",
      audience: "surface-a",
      context: { type: "booking", id: "A-1" },
    })
    Max.destroy()

    Max.init({ token: "b", mode: "bubble", embedOrigin: ORIGIN })
    Max.open()
    const iframe = document.querySelector("iframe") as HTMLIFrameElement
    const cw = iframe.contentWindow as Window
    const freshPosts: Array<Record<string, unknown>> = []
    cw.postMessage = ((message: unknown) => {
      freshPosts.push(message as Record<string, unknown>)
    }) as typeof cw.postMessage
    iframe.dispatchEvent(new Event("load"))

    const url = new URL(iframe.src)
    expect(url.searchParams.has("tenant")).toBe(false)
    expect(url.searchParams.has("audience")).toBe(false)
    expect(freshPosts.filter((message) => message.type === "max:setContext")).toHaveLength(0)
  })

  it("treats re-init without an explicit destroy as a fresh security boundary", () => {
    const { Max } = boot({
      tenant: "tenant-a",
      context: { type: "booking", id: "A-1" },
    })

    Max.init({ token: "b", mode: "bubble", embedOrigin: ORIGIN, tenant: "tenant-b" })
    Max.open()
    const iframe = document.querySelector("iframe") as HTMLIFrameElement
    const url = new URL(iframe.src)

    expect(document.querySelectorAll("iframe")).toHaveLength(1)
    expect(url.searchParams.get("tenant")).toBe("tenant-b")
  })
})

describe("loader — strict inbound validation", () => {
  it("re-sends context on a valid max:requestContext", () => {
    const { cw, session } = boot()
    ;(window as unknown as Win).Max?.setContext({ type: "booking", id: "B-1", label: "B-1" })
    const before = setContextPosts().length
    inbound(cw, session, "max:requestContext")
    expect(setContextPosts().length).toBe(before + 1)
  })

  it("ignores foreign origin, source, session and tenant", () => {
    const { cw, session } = boot({ tenant: "acme" })
    ;(window as unknown as Win).Max?.setContext({ type: "booking", id: "B-1", label: "B-1" })
    const before = setContextPosts().length
    inbound(cw, session, "max:requestContext", {}, { origin: "https://evil.example" })
    inbound(
      cw,
      session,
      "max:requestContext",
      {},
      { source: { name: "other" } as unknown as Window },
    )
    inbound(cw, session, "max:requestContext", {}, { session: "other-session" })
    inbound(cw, session, "max:requestContext", {}, { tenant: "evil" })
    expect(setContextPosts().length).toBe(before)
  })

  it("drops replays and stale/malformed timestamps (no ts=0 bypass)", () => {
    const { cw, session } = boot()
    ;(window as unknown as Win).Max?.setContext({ type: "booking", id: "B-1", label: "B-1" })
    const before = setContextPosts().length
    // Replay: same msgId twice → only the first re-sends.
    inbound(cw, session, "max:requestContext", {}, { msgId: "dup" })
    inbound(cw, session, "max:requestContext", {}, { msgId: "dup" })
    expect(setContextPosts().length).toBe(before + 1)
    // ts=0 / NaN / stale → ignored.
    inbound(cw, session, "max:requestContext", {}, { ts: 0 })
    inbound(cw, session, "max:requestContext", {}, { ts: Number.NaN })
    inbound(cw, session, "max:requestContext", {}, { ts: Date.now() - 60_000 })
    expect(setContextPosts().length).toBe(before + 1)
  })

  it("accepts prototype-shaped msgIds once and rejects prototype-shaped message types", () => {
    const { cw, session } = boot()
    ;(window as unknown as Win).Max?.setContext({ type: "booking", id: "B-1" })
    const before = setContextPosts().length
    inbound(cw, session, "max:requestContext", {}, { msgId: "toString" })
    expect(setContextPosts()).toHaveLength(before + 1)
    inbound(cw, session, "toString", {}, { msgId: "constructor" })
    expect(setContextPosts()).toHaveLength(before + 1)
  })

  it("clears on max:clearContext and echoes a null context", () => {
    let cleared = 0
    const { cw, session } = boot({ onContextClear: () => cleared++ })
    ;(window as unknown as Win).Max?.setContext({ type: "booking", id: "B-1", label: "B-1" })
    inbound(cw, session, "max:clearContext")
    expect(cleared).toBe(1)
    expect(setContextPosts().at(-1)).toMatchObject({ context: null })
  })
})

describe("loader — idempotent layout round trips", () => {
  it("applies + echoes a requested layout once, and does not re-echo an unchanged layout", () => {
    const { cw, session } = boot()
    inbound(cw, session, "max:requestLayout", { layout: "wide" })
    expect(setLayoutPosts()).toHaveLength(1)
    expect(setLayoutPosts().at(-1)).toMatchObject({ layout: "wide" })
    // Echoing peer reflects it back — already wide → no re-echo (no ping-pong).
    inbound(cw, session, "max:setLayout", { layout: "wide" })
    expect(setLayoutPosts()).toHaveLength(1)
  })

  it("ignores a layout request with a bad layout value", () => {
    const { cw, session } = boot()
    inbound(cw, session, "max:requestLayout", { layout: "huge" })
    expect(setLayoutPosts()).toHaveLength(0)
  })

  it("replays a host-applied layout after the bubble iframe loads", () => {
    const { Max, iframe } = boot()

    Max.setLayout("wide")
    expect(setLayoutPosts()).toHaveLength(1)

    iframe.dispatchEvent(new Event("load"))
    expect(setLayoutPosts()).toHaveLength(2)
    expect(setLayoutPosts().at(-1)).toMatchObject({ layout: "wide" })
  })
})

describe("loader — expanded modal accessibility", () => {
  it("marks the expanded panel modal, isolates the background, focuses it, and restores on Escape", () => {
    const bg = document.createElement("div")
    bg.id = "host-bg"
    bg.innerHTML = "<button>host</button>"
    document.body.appendChild(bg)

    const { cw, session } = boot()
    const panel = document.querySelector('[role="dialog"]') as HTMLElement
    expect(panel.getAttribute("aria-label")).toBe("Max by Voyant")
    expect(panel.getAttribute("aria-modal")).toBeNull()

    inbound(cw, session, "max:requestLayout", { layout: "expanded" })
    expect(panel.getAttribute("aria-modal")).toBe("true")
    expect(bg.hasAttribute("inert")).toBe(true)
    expect(bg.getAttribute("aria-hidden")).toBe("true")
    expect(document.activeElement).toBe(panel)

    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    expect(panel.getAttribute("aria-modal")).toBeNull()
    expect(bg.hasAttribute("inert")).toBe(false)
    expect(bg.getAttribute("aria-hidden")).toBeNull()

    document.body.removeChild(bg)
  })

  it("releases modal isolation immediately when an expanded panel closes", () => {
    const bg = document.createElement("div")
    document.body.appendChild(bg)
    const { Max } = boot()
    Max.setLayout("expanded")
    expect(bg.hasAttribute("inert")).toBe(true)
    Max.close()
    expect(bg.hasAttribute("inert")).toBe(false)
    expect(bg.getAttribute("aria-hidden")).toBeNull()
    document.body.removeChild(bg)
  })

  it("preserves host-owned aria-hidden, inert, and marker attributes", () => {
    const aria = document.createElement("div")
    aria.setAttribute("aria-hidden", "false")
    aria.setAttribute("data-max-inert", "host-owned")
    const inert = document.createElement("div")
    inert.setAttribute("inert", "")
    inert.setAttribute("aria-hidden", "false")
    document.body.append(aria, inert)
    const { Max } = boot()
    Max.setLayout("expanded")
    Max.setLayout("normal")

    expect(aria.hasAttribute("inert")).toBe(false)
    expect(aria.getAttribute("aria-hidden")).toBe("false")
    expect(aria.getAttribute("data-max-inert")).toBe("host-owned")
    expect(inert.hasAttribute("inert")).toBe(true)
    expect(inert.getAttribute("aria-hidden")).toBe("false")
    aria.remove()
    inert.remove()
  })
})
