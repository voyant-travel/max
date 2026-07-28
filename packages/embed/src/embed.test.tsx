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

  it("clears explicitly when context becomes null", () => {
    const { container, rerender } = render(
      <MaxChat token="t" embedOrigin={ORIGIN} context={product} />,
    )
    const { posts } = harness(container)
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
    const { cw, sessionId } = harness(container)
    postFromIframe(cw, sessionId, "max:requestLayout", { layout: "wide" })
    expect(onLayoutChange).toHaveBeenCalledWith("wide")
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
