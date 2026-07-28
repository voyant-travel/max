import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MaxHostContext } from "./context.js"
import { MaxApp } from "./max-app.js"
import { MaxChat } from "./max-chat.js"
import { MaxLauncher } from "./max-launcher.js"
import { cleanup, render } from "./test-utils.js"

const ORIGIN = "https://embed.example"

const product: MaxHostContext = {
  type: "product",
  id: "PRD-42",
  label: "Kilimanjaro Trek",
  version: 1,
}

afterEach(cleanup)

/** Grab the iframe and spy on posts to its contentWindow. Returns the sessionId
 *  the component put in the src so tests can echo a valid envelope back. */
function harness(container: HTMLElement) {
  const iframe = container.querySelector("iframe") as HTMLIFrameElement
  const cw = iframe.contentWindow as Window
  const posts: Array<Record<string, unknown>> = []
  cw.postMessage = ((msg: unknown) => {
    posts.push(msg as Record<string, unknown>)
  }) as typeof cw.postMessage
  const sessionId = new URL(iframe.src).searchParams.get("session") as string
  return { iframe, cw, posts, sessionId }
}

/** Dispatch an enveloped iframe→host message with a valid/overridable envelope. */
function postFromIframe(
  cw: Window,
  sessionId: string,
  type: string,
  extra: Record<string, unknown> = {},
  over: { origin?: string; source?: Window | null; sessionId?: string; tenant?: string } = {},
) {
  const data = {
    channel: "max",
    v: 1,
    sessionId: over.sessionId ?? sessionId,
    tenant: over.tenant ?? null,
    audience: null,
    msgId: `m-${Math.random()}`,
    ts: Date.now(),
    type,
    ...extra,
  }
  const event = new MessageEvent("message", {
    data,
    origin: over.origin ?? ORIGIN,
    source: "source" in over ? (over.source as Window) : cw,
  })
  act(() => {
    window.dispatchEvent(event)
  })
}

describe("useContextChannel via MaxChat", () => {
  it("sends the product context to the iframe and re-sends on navigation update", () => {
    const { container, rerender } = render(
      <MaxChat token="t" embedOrigin={ORIGIN} tenant="acme" context={undefined} />,
    )
    const { iframe, cw, posts, sessionId } = harness(container)
    // The iframe loads (real content window) — the first delivery is load-driven.
    act(() => {
      iframe.dispatchEvent(new Event("load"))
    })

    act(() => {
      rerender(<MaxChat token="t" embedOrigin={ORIGIN} tenant="acme" context={product} />)
    })
    const first = posts.filter((p) => p.type === "max:setContext")
    expect(first.at(-1)).toMatchObject({
      type: "max:setContext",
      sessionId,
      tenant: "acme",
      context: { type: "product", id: "PRD-42" },
    })

    // Host navigates to a new entity — must post again WITHOUT remounting.
    const booking: MaxHostContext = { type: "booking", id: "B-1", label: "Booking B-1" }
    act(() => {
      rerender(<MaxChat token="t" embedOrigin={ORIGIN} tenant="acme" context={booking} />)
    })
    const after = posts.filter((p) => p.type === "max:setContext")
    expect(after.at(-1)).toMatchObject({ context: { type: "booking", id: "B-1" } })
    // Same iframe DOM node — no remount, chat state preserved.
    expect(container.querySelector("iframe")).toBe(iframe)
    expect(iframe.contentWindow).toBe(cw)
  })

  it("does not re-post an unchanged context on unrelated re-renders", () => {
    const { container, rerender } = render(
      <MaxChat token="t" embedOrigin={ORIGIN} context={product} />,
    )
    const { posts } = harness(container)
    act(() => {
      rerender(<MaxChat token="t" embedOrigin={ORIGIN} context={{ ...product }} title="again" />)
    })
    expect(posts.filter((p) => p.type === "max:setContext")).toHaveLength(0)
  })

  it("drops an invalid runtime context without turning it into an explicit clear", () => {
    const { container, rerender } = render(
      <MaxChat token="t" embedOrigin={ORIGIN} context={product} />,
    )
    const { iframe, posts } = harness(container)
    act(() => {
      iframe.dispatchEvent(new Event("load"))
    })
    const before = posts.length

    act(() => {
      rerender(
        <MaxChat
          token="t"
          embedOrigin={ORIGIN}
          context={{ type: "root", id: "unsafe" } as unknown as MaxHostContext}
        />,
      )
    })

    expect(posts).toHaveLength(before)
    expect(posts.at(-1)).not.toMatchObject({ context: null })
  })

  it("re-posts when context timestamp or metadata changes", () => {
    const initial: MaxHostContext = {
      ...product,
      capturedAt: "2026-07-28T10:00:00.000Z",
      meta: { view: "overview" },
    }
    const { container, rerender } = render(
      <MaxChat token="t" embedOrigin={ORIGIN} context={initial} />,
    )
    const { iframe, posts } = harness(container)
    act(() => {
      iframe.dispatchEvent(new Event("load"))
    })

    act(() => {
      rerender(
        <MaxChat
          token="t"
          embedOrigin={ORIGIN}
          context={{
            ...initial,
            capturedAt: "2026-07-28T10:01:00.000Z",
            meta: { view: "pricing" },
          }}
        />,
      )
    })

    expect(posts.filter((p) => p.type === "max:setContext").at(-1)).toMatchObject({
      context: {
        capturedAt: "2026-07-28T10:01:00.000Z",
        meta: { view: "pricing" },
      },
    })
  })

  it("clears explicitly when context becomes null", () => {
    const { container, rerender } = render(
      <MaxChat token="t" embedOrigin={ORIGIN} context={product} />,
    )
    const { iframe, posts } = harness(container)
    act(() => {
      iframe.dispatchEvent(new Event("load"))
    })
    act(() => {
      rerender(<MaxChat token="t" embedOrigin={ORIGIN} context={null} />)
    })
    expect(posts.filter((p) => p.type === "max:setContext").at(-1)).toMatchObject({
      context: null,
    })
  })

  it("honours max:clearContext from the iframe and echoes a null context", () => {
    const onContextClear = vi.fn()
    const { container } = render(
      <MaxChat token="t" embedOrigin={ORIGIN} context={product} onContextClear={onContextClear} />,
    )
    const { cw, posts, sessionId } = harness(container)
    postFromIframe(cw, sessionId, "max:clearContext")
    expect(onContextClear).toHaveBeenCalledOnce()
    expect(posts.at(-1)).toMatchObject({ type: "max:setContext", context: null })
  })

  it("re-sends current context on max:requestContext", () => {
    const { container } = render(<MaxChat token="t" embedOrigin={ORIGIN} context={product} />)
    const { cw, posts, sessionId } = harness(container)
    postFromIframe(cw, sessionId, "max:requestContext")
    expect(posts.at(-1)).toMatchObject({ type: "max:setContext", context: { id: "PRD-42" } })
  })

  it("ignores a message from a different session (cross-session replay)", () => {
    const onContextClear = vi.fn()
    const { container } = render(
      <MaxChat token="t" embedOrigin={ORIGIN} context={product} onContextClear={onContextClear} />,
    )
    const { cw, sessionId } = harness(container)
    postFromIframe(cw, sessionId, "max:clearContext", {}, { sessionId: "someone-else" })
    expect(onContextClear).not.toHaveBeenCalled()
  })

  it("ignores a message from a foreign origin", () => {
    const onContextClear = vi.fn()
    const { container } = render(
      <MaxChat token="t" embedOrigin={ORIGIN} context={product} onContextClear={onContextClear} />,
    )
    const { cw, sessionId } = harness(container)
    postFromIframe(cw, sessionId, "max:clearContext", {}, { origin: "https://evil.example" })
    expect(onContextClear).not.toHaveBeenCalled()
  })

  it("ignores a message from a different window (cross-tab)", () => {
    const onContextClear = vi.fn()
    const { container } = render(
      <MaxChat token="t" embedOrigin={ORIGIN} context={product} onContextClear={onContextClear} />,
    )
    const { cw, sessionId } = harness(container)
    const otherWindow = { name: "attacker" } as unknown as Window
    postFromIframe(cw, sessionId, "max:clearContext", {}, { source: otherWindow })
    expect(onContextClear).not.toHaveBeenCalled()
  })

  it("rejects a mismatched tenant", () => {
    const onContextClear = vi.fn()
    const { container } = render(
      <MaxChat
        token="t"
        embedOrigin={ORIGIN}
        tenant="acme"
        context={product}
        onContextClear={onContextClear}
      />,
    )
    const { cw, sessionId } = harness(container)
    postFromIframe(cw, sessionId, "max:clearContext", {}, { tenant: "evil-corp" })
    expect(onContextClear).not.toHaveBeenCalled()
  })
})

describe("MaxLauncher — layout round trips & controls", () => {
  it("expands and restores via the on-panel control, echoing to the iframe", async () => {
    const onLayoutChange = vi.fn()
    const { container, findByLabelText } = render(
      <MaxLauncher token="t" embedOrigin={ORIGIN} defaultOpen onLayoutChange={onLayoutChange} />,
    )
    const { posts } = harness(container)

    const expandBtn = await findByLabelText("Expand Max to full page")
    act(() => {
      expandBtn.click()
    })
    expect(onLayoutChange).toHaveBeenCalledWith("expanded")
    expect(posts.filter((p) => p.type === "max:setLayout").at(-1)).toMatchObject({
      layout: "expanded",
    })

    const restoreBtn = await findByLabelText("Restore Max panel")
    act(() => {
      restoreBtn.click()
    })
    expect(onLayoutChange).toHaveBeenLastCalledWith("normal")
  })

  it("applies a layout the iframe requests (max:requestLayout)", () => {
    const onLayoutChange = vi.fn()
    const { container } = render(
      <MaxLauncher token="t" embedOrigin={ORIGIN} defaultOpen onLayoutChange={onLayoutChange} />,
    )
    const { cw, posts, sessionId } = harness(container)
    postFromIframe(cw, sessionId, "max:requestLayout", { layout: "wide" })
    expect(onLayoutChange).toHaveBeenCalledWith("wide")
    // The host echoes the applied layout back to the iframe (round trip).
    expect(posts.filter((p) => p.type === "max:setLayout").at(-1)).toMatchObject({
      layout: "wide",
    })
  })

  it("honours a legacy (un-enveloped) max:setLayout for backwards compatibility", () => {
    const onLayoutChange = vi.fn()
    const { container } = render(
      <MaxLauncher token="t" embedOrigin={ORIGIN} defaultOpen onLayoutChange={onLayoutChange} />,
    )
    const { cw } = harness(container)
    const event = new MessageEvent("message", {
      data: { type: "max:setLayout", layout: "expanded" },
      origin: ORIGIN,
      source: cw,
    })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(onLayoutChange).toHaveBeenCalledWith("expanded")
  })

  it("ignores layout requests from a foreign origin", () => {
    const onLayoutChange = vi.fn()
    const { container } = render(
      <MaxLauncher token="t" embedOrigin={ORIGIN} defaultOpen onLayoutChange={onLayoutChange} />,
    )
    const { cw, sessionId } = harness(container)
    postFromIframe(
      cw,
      sessionId,
      "max:requestLayout",
      { layout: "wide" },
      {
        origin: "https://evil.example",
      },
    )
    expect(onLayoutChange).not.toHaveBeenCalled()
  })
})

describe("MaxLauncher — lazy initial context delivery", () => {
  it("delivers the initial context exactly once when a closed launcher is first opened (no requestContext)", () => {
    const { container, getByLabelText } = render(
      <MaxLauncher token="t" embedOrigin={ORIGIN} tenant="acme" context={product} />,
    )
    // Closed launcher mounts no iframe yet.
    expect(container.querySelector("iframe")).toBeNull()

    act(() => {
      getByLabelText("Open Max chat").click()
    })
    const iframe = container.querySelector("iframe") as HTMLIFrameElement
    const cw = iframe.contentWindow as Window
    const posts: Array<Record<string, unknown>> = []
    cw.postMessage = ((m: unknown) => {
      posts.push(m as Record<string, unknown>)
    }) as typeof cw.postMessage

    // The iframe finishes loading — the initial context must arrive now, driven
    // by the mount/load and NOT by the iframe sending max:requestContext.
    act(() => {
      iframe.dispatchEvent(new Event("load"))
    })
    const delivered = posts.filter((p) => p.type === "max:setContext")
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toMatchObject({ context: { type: "product", id: "PRD-42" } })

    // A navigation retains the WindowProxy identity in browsers. A new load is
    // therefore treated as a new document generation and receives context.
    act(() => {
      iframe.dispatchEvent(new Event("load"))
    })
    expect(posts.filter((p) => p.type === "max:setContext")).toHaveLength(2)

    // Opening did not remount anything else.
    expect(container.querySelector("iframe")).toBe(iframe)
  })
})

describe("MaxLauncher — idempotent layout round trips", () => {
  it("does not re-echo an already-applied layout (breaks request/echo ping-pong)", () => {
    const onLayoutChange = vi.fn()
    const { container } = render(
      <MaxLauncher token="t" embedOrigin={ORIGIN} defaultOpen onLayoutChange={onLayoutChange} />,
    )
    const { cw, posts, sessionId } = harness(container)

    postFromIframe(cw, sessionId, "max:requestLayout", { layout: "wide" })
    expect(posts.filter((p) => p.type === "max:setLayout")).toHaveLength(1)

    // An echoing peer reflects our max:setLayout(wide) back. We're already wide,
    // so we must NOT echo again — otherwise the two sides ping-pong forever.
    postFromIframe(cw, sessionId, "max:setLayout", { layout: "wide" })
    expect(posts.filter((p) => p.type === "max:setLayout")).toHaveLength(1)
    expect(onLayoutChange).toHaveBeenCalledTimes(1)
  })
})

describe("MaxLauncher — expanded modal accessibility", () => {
  it("does not isolate the page while an expanded-default launcher is closed", () => {
    const bg = document.createElement("div")
    document.body.appendChild(bg)
    const { container } = render(
      <MaxLauncher token="t" embedOrigin={ORIGIN} defaultLayout="expanded" />,
    )
    const panel = container.querySelector('[role="dialog"]') as HTMLElement

    expect(panel.getAttribute("aria-modal")).toBeNull()
    expect(bg.hasAttribute("inert")).toBe(false)
    expect(bg.getAttribute("aria-hidden")).toBeNull()
    document.body.removeChild(bg)
  })

  it("makes the expanded panel a modal dialog, isolates the background, moves focus, and restores on Escape", async () => {
    const bg = document.createElement("div")
    bg.id = "host-bg"
    bg.innerHTML = "<button>host action</button>"
    bg.setAttribute("aria-hidden", "false")
    bg.setAttribute("data-max-inert", "host-owned")
    const alreadyInert = document.createElement("div")
    alreadyInert.setAttribute("inert", "")
    alreadyInert.setAttribute("aria-hidden", "false")
    document.body.append(bg, alreadyInert)

    const onLayoutChange = vi.fn()
    const { container, findByLabelText } = render(
      <MaxLauncher token="t" embedOrigin={ORIGIN} defaultOpen onLayoutChange={onLayoutChange} />,
    )
    const panel = container.querySelector('[role="dialog"]') as HTMLElement
    expect(panel).toBeTruthy()
    // Docked (normal) layout is a labelled dialog but not modal.
    expect(panel.getAttribute("aria-label")).toBe("Max by Voyant")
    expect(panel.getAttribute("aria-modal")).toBeNull()

    const expandBtn = await findByLabelText("Expand Max to full page")
    act(() => {
      expandBtn.click()
    })

    // Modal semantics + background isolation + focus into the dialog.
    expect(panel.getAttribute("aria-modal")).toBe("true")
    expect(bg.hasAttribute("inert")).toBe(true)
    expect(bg.getAttribute("aria-hidden")).toBe("true")
    expect(document.activeElement).toBe(panel)

    // Escape restores to normal and tears down the modal isolation.
    act(() => {
      panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(onLayoutChange).toHaveBeenLastCalledWith("normal")
    expect(panel.getAttribute("aria-modal")).toBeNull()
    expect(bg.hasAttribute("inert")).toBe(false)
    expect(bg.getAttribute("aria-hidden")).toBe("false")
    expect(bg.getAttribute("data-max-inert")).toBe("host-owned")
    expect(alreadyInert.hasAttribute("inert")).toBe(true)
    expect(alreadyInert.getAttribute("aria-hidden")).toBe("false")

    bg.remove()
    alreadyInert.remove()
  })
})

describe("MaxApp — navigation without remount", () => {
  it("mirrors an iframe navigation into the host URL without changing the iframe", () => {
    const onRouteChange = vi.fn()
    const { container } = render(
      <MaxApp token="t" embedOrigin={ORIGIN} basePath="/assistant" onRouteChange={onRouteChange} />,
    )
    const { iframe, cw, sessionId } = harness(container)
    postFromIframe(cw, sessionId, "max:navigate", { path: "/c/abc" })
    expect(onRouteChange).toHaveBeenCalledWith("/c/abc")
    expect(window.location.pathname).toBe("/assistant/c/abc")
    // No remount.
    expect(container.querySelector("iframe")).toBe(iframe)
  })
})
