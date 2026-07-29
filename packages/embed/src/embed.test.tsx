import { act, Suspense, startTransition } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MaxHostContext } from "./context.js"
import { MaxApp } from "./max-app.js"
import { MaxChat } from "./max-chat.js"
import { MaxLauncher } from "./max-launcher.js"
import { cleanup, render } from "./test-utils.js"
import type { MaxAppProps, MaxChatProps, MaxLauncherProps } from "./types.js"

const ORIGIN = "https://embed.example"
const OTHER_ORIGIN = "https://embed-b.example"

const product: MaxHostContext = {
  type: "product",
  id: "PRD-42",
  label: "Kilimanjaro Trek",
  version: 1,
}

afterEach(cleanup)

describe("trusted host bootstrap", () => {
  it.each([
    ["MaxChat", () => <MaxChat token="t" embedOrigin={ORIGIN} />],
    ["MaxApp", () => <MaxApp token="t" embedOrigin={ORIGIN} />],
    ["MaxLauncher", () => <MaxLauncher token="t" embedOrigin={ORIGIN} defaultOpen />],
  ])("%s includes the host origin before mounting its iframe", (_, View) => {
    const { container } = render(<View />)
    const iframe = container.querySelector("iframe") as HTMLIFrameElement

    expect(new URL(iframe.src).searchParams.get("hostOrigin")).toBe(window.location.origin)
  })
})

/** Grab the iframe and spy on posts to its contentWindow. Returns the sessionId
 *  the component put in the src so tests can echo a valid envelope back. */
function harness(container: HTMLElement) {
  const iframe = container.querySelector("iframe") as HTMLIFrameElement
  const cw = iframe.contentWindow as Window
  const posts: Array<Record<string, unknown>> = []
  const targetOrigins: string[] = []
  cw.postMessage = ((msg: unknown, targetOrigin: string) => {
    posts.push(msg as Record<string, unknown>)
    targetOrigins.push(targetOrigin)
  }) as typeof cw.postMessage
  const sessionId = new URL(iframe.src).searchParams.get("session") as string
  return { iframe, cw, posts, sessionId, targetOrigins }
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
  it.each([
    ["MaxChat", (props: Record<string, unknown>) => <MaxChat {...(props as MaxChatProps)} />],
    ["MaxApp", (props: Record<string, unknown>) => <MaxApp {...(props as MaxAppProps)} />],
    [
      "MaxLauncher",
      (props: Record<string, unknown>) => (
        <MaxLauncher defaultOpen {...(props as MaxLauncherProps)} />
      ),
    ],
  ])("%s creates a fresh scope and gates context until the new document loads", (_, View) => {
    const onContextClear = vi.fn()
    const common = { embedOrigin: ORIGIN, context: product, onContextClear }
    const { container, rerender } = render(View({ ...common, token: "a", tenant: "tenant-a" }))
    const first = harness(container)
    act(() => first.iframe.dispatchEvent(new Event("load")))
    first.posts.length = 0

    act(() => rerender(View({ ...common, token: "b", tenant: "tenant-b" })))
    const next = harness(container)
    const nextSession = new URL(next.iframe.src).searchParams.get("session") as string
    expect(nextSession).not.toBe(first.sessionId)
    expect(new URL(next.iframe.src).searchParams.get("tenant")).toBe("tenant-b")
    expect(next.posts.filter((p) => p.type === "max:setContext")).toHaveLength(0)
    postFromIframe(next.cw, first.sessionId, "max:clearContext", {}, { tenant: "tenant-a" })
    expect(onContextClear).not.toHaveBeenCalled()

    act(() => next.iframe.dispatchEvent(new Event("load")))
    expect(next.posts.filter((p) => p.type === "max:setContext").at(-1)).toMatchObject({
      sessionId: nextSession,
      tenant: "tenant-b",
    })
  })

  it("handles a replacement load with the stable listener and current scope", () => {
    const { container, rerender } = render(
      <MaxChat token="a" embedOrigin={ORIGIN} tenant="tenant-a" context={product} />,
    )
    const first = harness(container)
    act(() => first.iframe.dispatchEvent(new Event("load")))

    act(() => {
      rerender(<MaxChat token="b" embedOrigin={OTHER_ORIGIN} tenant="tenant-b" context={product} />)
    })
    const next = harness(container)

    // The replacement document gets exactly its one real load event; the
    // stable callback must already see the just-committed scope and origin.
    act(() => next.iframe.dispatchEvent(new Event("load")))
    expect(next.posts.filter((p) => p.type === "max:setContext").at(-1)).toMatchObject({
      sessionId: new URL(next.iframe.src).searchParams.get("session"),
      tenant: "tenant-b",
    })
    expect(next.targetOrigins.at(-1)).toBe(OTHER_ORIGIN)
  })

  it("does not publish scope from a suspended concurrent render", async () => {
    const never = new Promise<void>(() => {})
    function BlockedRender({ blocked }: { blocked: boolean }) {
      if (blocked) throw never
      return null
    }
    function ConcurrentHost({
      blocked,
      token,
      embedOrigin,
      tenant,
    }: {
      blocked: boolean
      token: string
      embedOrigin: string
      tenant: string
    }) {
      return (
        <Suspense fallback={null}>
          <MaxChat token={token} embedOrigin={embedOrigin} tenant={tenant} context={product} />
          <BlockedRender blocked={blocked} />
        </Suspense>
      )
    }

    const { container, rerender } = render(
      <ConcurrentHost blocked={false} token="a" embedOrigin={ORIGIN} tenant="tenant-a" />,
    )
    const current = harness(container)
    act(() => current.iframe.dispatchEvent(new Event("load")))
    current.posts.length = 0
    current.targetOrigins.length = 0

    act(() => {
      startTransition(() => {
        rerender(<ConcurrentHost blocked token="b" embedOrigin={OTHER_ORIGIN} tenant="tenant-b" />)
      })
    })

    // The transition has not committed, so a load from the still-live iframe
    // must continue using the committed A scope rather than render-attempt B.
    expect(container.querySelector("iframe")).toBe(current.iframe)
    act(() => current.iframe.dispatchEvent(new Event("load")))
    expect(current.posts.filter((p) => p.type === "max:setContext").at(-1)).toMatchObject({
      sessionId: current.sessionId,
      tenant: "tenant-a",
    })
    expect(current.targetOrigins.at(-1)).toBe(ORIGIN)

    current.posts.length = 0
    current.targetOrigins.length = 0
    act(() => {
      document.documentElement.className = "dark"
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(current.posts.filter((p) => p.type === "max:setTheme").at(-1)).toMatchObject({
      channel: "max",
      sessionId: current.sessionId,
      tenant: "tenant-a",
      theme: "dark",
    })
    expect(current.targetOrigins.at(-1)).toBe(ORIGIN)
    document.documentElement.className = ""
  })

  it.each([
    ["MaxChat", (props: Record<string, unknown>) => <MaxChat {...(props as MaxChatProps)} />],
    ["MaxApp", (props: Record<string, unknown>) => <MaxApp {...(props as MaxAppProps)} />],
    [
      "MaxLauncher",
      (props: Record<string, unknown>) => (
        <MaxLauncher defaultOpen {...(props as MaxLauncherProps)} />
      ),
    ],
  ])("%s treats a normalized embedOrigin change as a fresh security boundary", (_, View) => {
    const common = { token: "t", context: product, tenant: "tenant-a" }
    const { container, rerender } = render(View({ ...common, embedOrigin: `${ORIGIN}/` }))
    const first = harness(container)
    act(() => first.iframe.dispatchEvent(new Event("load")))

    act(() => rerender(View({ ...common, embedOrigin: `${OTHER_ORIGIN}/` })))
    const next = harness(container)
    const nextUrl = new URL(next.iframe.src)
    const nextSession = nextUrl.searchParams.get("session") as string

    expect(nextUrl.origin).toBe(OTHER_ORIGIN)
    expect(nextSession).not.toBe(first.sessionId)
    expect(next.posts.filter((p) => p.type === "max:setContext")).toHaveLength(0)

    act(() => next.iframe.dispatchEvent(new Event("load")))
    expect(next.posts.filter((p) => p.type === "max:setContext").at(-1)).toMatchObject({
      sessionId: nextSession,
      tenant: "tenant-a",
    })
  })

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

describe("useHostSync origin transitions", () => {
  it("pushes detected values when controlled props return to auto mode", async () => {
    document.documentElement.className = "light"
    document.documentElement.lang = "en"
    const { container, rerender } = render(
      <MaxChat token="t" embedOrigin={ORIGIN} theme="dark" lang="fr" />,
    )
    const current = harness(container)
    act(() => current.iframe.dispatchEvent(new Event("load")))
    current.posts.length = 0

    act(() => rerender(<MaxChat token="t" embedOrigin={ORIGIN} />))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(current.posts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "max:setTheme", theme: "light" }),
        expect.objectContaining({ type: "max:setLang", lang: "en" }),
      ]),
    )

    document.documentElement.className = ""
    document.documentElement.removeAttribute("lang")
  })

  it("replays an auto-detected language clear after iframe reload", async () => {
    document.documentElement.lang = "en"
    const { container } = render(<MaxChat token="t" embedOrigin={ORIGIN} />)
    const current = harness(container)
    act(() => current.iframe.dispatchEvent(new Event("load")))
    current.posts.length = 0

    act(() => document.documentElement.removeAttribute("lang"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(current.posts.filter((post) => post.type === "max:setLang").at(-1)).toMatchObject({
      lang: "",
    })

    current.posts.length = 0
    act(() => current.iframe.dispatchEvent(new Event("load")))
    expect(current.posts.filter((post) => post.type === "max:setLang").at(-1)).toMatchObject({
      lang: "",
    })
  })

  it("rebinds load and auto-detect updates to the new normalized origin", async () => {
    document.documentElement.className = "light"
    document.documentElement.lang = "en"
    const { container, rerender } = render(
      <MaxChat token="t" embedOrigin={`${ORIGIN}/`} context={product} />,
    )
    const first = harness(container)
    act(() => first.iframe.dispatchEvent(new Event("load")))
    first.posts.length = 0

    act(() => rerender(<MaxChat token="t" embedOrigin={`${OTHER_ORIGIN}/`} context={product} />))
    const next = harness(container)
    const nextSession = new URL(next.iframe.src).searchParams.get("session") as string
    act(() => next.iframe.dispatchEvent(new Event("load")))
    expect(next.posts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "max",
          v: 1,
          sessionId: nextSession,
          type: "max:setTheme",
          theme: "light",
        }),
        expect.objectContaining({
          channel: "max",
          v: 1,
          sessionId: nextSession,
          type: "max:setLang",
          lang: "en",
        }),
      ]),
    )
    expect(next.targetOrigins).toEqual(next.targetOrigins.map(() => OTHER_ORIGIN))
    next.posts.length = 0

    act(() => {
      document.documentElement.className = "dark"
      document.documentElement.lang = "fr"
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(next.posts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channel: "max",
          sessionId: nextSession,
          type: "max:setTheme",
          theme: "dark",
        }),
        expect.objectContaining({
          channel: "max",
          sessionId: nextSession,
          type: "max:setLang",
          lang: "fr",
        }),
      ]),
    )
    expect(next.targetOrigins).toEqual(next.targetOrigins.map(() => OTHER_ORIGIN))
    expect(first.posts).toHaveLength(0)

    document.documentElement.className = ""
    document.documentElement.removeAttribute("lang")
  })
})

describe("MaxLauncher — layout round trips & controls", () => {
  it("withholds a new scoped layout from the old document until replacement load", async () => {
    const { container, rerender, findByLabelText } = render(
      <MaxLauncher token="token-a" tenant="tenant-a" embedOrigin={ORIGIN} defaultOpen />,
    )
    const first = harness(container)
    act(() => first.iframe.dispatchEvent(new Event("load")))
    first.posts.length = 0

    act(() =>
      rerender(<MaxLauncher token="token-b" tenant="tenant-b" embedOrigin={ORIGIN} defaultOpen />),
    )
    const next = harness(container)
    const nextSession = new URL(next.iframe.src).searchParams.get("session") as string
    const expand = await findByLabelText("Expand Max to full page")
    act(() => expand.click())
    expect(next.posts.filter((post) => post.type === "max:setLayout")).toHaveLength(0)

    act(() => next.iframe.dispatchEvent(new Event("load")))
    expect(next.posts.filter((post) => post.type === "max:setLayout").at(-1)).toMatchObject({
      sessionId: nextSession,
      tenant: "tenant-b",
      layout: "expanded",
    })
  })

  it("expands and restores via the on-panel control, echoing to the iframe", async () => {
    const onLayoutChange = vi.fn()
    const { container, findByLabelText } = render(
      <MaxLauncher token="t" embedOrigin={ORIGIN} defaultOpen onLayoutChange={onLayoutChange} />,
    )
    const { iframe, posts } = harness(container)
    act(() => iframe.dispatchEvent(new Event("load")))
    posts.length = 0

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
    const { iframe, cw, posts, sessionId } = harness(container)
    act(() => iframe.dispatchEvent(new Event("load")))
    posts.length = 0
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

  it("keeps launcher protocol refs on the committed scope during suspension", () => {
    const never = new Promise<void>(() => {})
    const committedLayoutChange = vi.fn()
    const speculativeLayoutChange = vi.fn()
    function BlockedRender({ blocked }: { blocked: boolean }) {
      if (blocked) throw never
      return null
    }
    function ConcurrentLauncher({
      blocked,
      token,
      tenant,
      onLayoutChange,
    }: {
      blocked: boolean
      token: string
      tenant: string
      onLayoutChange: (layout: "normal" | "wide" | "expanded") => void
    }) {
      return (
        <Suspense fallback={null}>
          <MaxLauncher
            token={token}
            tenant={tenant}
            embedOrigin={token === "a" ? ORIGIN : OTHER_ORIGIN}
            defaultOpen
            onLayoutChange={onLayoutChange}
          />
          <BlockedRender blocked={blocked} />
        </Suspense>
      )
    }

    const { container, rerender } = render(
      <ConcurrentLauncher
        blocked={false}
        token="a"
        tenant="tenant-a"
        onLayoutChange={committedLayoutChange}
      />,
    )
    const current = harness(container)
    act(() => current.iframe.dispatchEvent(new Event("load")))
    current.posts.length = 0
    current.targetOrigins.length = 0

    act(() => {
      startTransition(() =>
        rerender(
          <ConcurrentLauncher
            blocked
            token="b"
            tenant="tenant-b"
            onLayoutChange={speculativeLayoutChange}
          />,
        ),
      )
    })
    postFromIframe(
      current.cw,
      current.sessionId,
      "max:requestLayout",
      { layout: "wide" },
      { tenant: "tenant-a" },
    )

    expect(committedLayoutChange).toHaveBeenCalledWith("wide")
    expect(speculativeLayoutChange).not.toHaveBeenCalled()
    expect(current.posts.filter((post) => post.type === "max:setLayout").at(-1)).toMatchObject({
      sessionId: current.sessionId,
      tenant: "tenant-a",
      layout: "wide",
    })
    expect(current.targetOrigins.at(-1)).toBe(ORIGIN)
  })
})

describe("MaxApp — scoped route transitions", () => {
  it("withholds popstate from the old document and replays it after replacement load", () => {
    window.history.replaceState(null, "", "/max")
    const { container, rerender } = render(
      <MaxApp token="token-a" tenant="tenant-a" embedOrigin={ORIGIN} basePath="/max" />,
    )
    const first = harness(container)
    act(() => first.iframe.dispatchEvent(new Event("load")))
    first.posts.length = 0

    act(() =>
      rerender(<MaxApp token="token-b" tenant="tenant-b" embedOrigin={ORIGIN} basePath="/max" />),
    )
    const next = harness(container)
    const nextSession = new URL(next.iframe.src).searchParams.get("session") as string
    act(() => {
      window.history.replaceState(null, "", "/max/c/new")
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
    expect(next.posts.filter((post) => post.type === "max:setRoute")).toHaveLength(0)

    act(() => next.iframe.dispatchEvent(new Event("load")))
    expect(next.posts.filter((post) => post.type === "max:setRoute").at(-1)).toMatchObject({
      sessionId: nextSession,
      tenant: "tenant-b",
      path: "/c/new",
    })
  })

  it("keeps the committed route scope during a suspended transition", () => {
    const never = new Promise<void>(() => {})
    const onRouteChange = vi.fn()
    function BlockedRender({ blocked }: { blocked: boolean }) {
      if (blocked) throw never
      return null
    }
    function ConcurrentApp({
      blocked,
      token,
      tenant,
    }: {
      blocked: boolean
      token: string
      tenant: string
    }) {
      return (
        <Suspense fallback={null}>
          <MaxApp
            token={token}
            tenant={tenant}
            embedOrigin={token === "a" ? ORIGIN : OTHER_ORIGIN}
            basePath="/max"
            onRouteChange={onRouteChange}
          />
          <BlockedRender blocked={blocked} />
        </Suspense>
      )
    }

    window.history.replaceState(null, "", "/max")
    const { container, rerender } = render(
      <ConcurrentApp blocked={false} token="a" tenant="tenant-a" />,
    )
    const current = harness(container)
    act(() => current.iframe.dispatchEvent(new Event("load")))

    act(() => {
      startTransition(() => rerender(<ConcurrentApp blocked token="b" tenant="tenant-b" />))
    })
    postFromIframe(
      current.cw,
      current.sessionId,
      "max:navigate",
      { path: "/c/committed" },
      {
        tenant: "tenant-a",
      },
    )

    expect(window.location.pathname).toBe("/max/c/committed")
    expect(onRouteChange).toHaveBeenCalledWith("/c/committed")
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
    const { iframe, cw, posts, sessionId } = harness(container)
    act(() => iframe.dispatchEvent(new Event("load")))
    posts.length = 0

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
