import { describe, expect, it } from "vitest"

import { createEnvelope, type MaxSessionScope, ReplayGuard, validateInbound } from "./protocol.js"

const ORIGIN = "https://agent-embed.voyant.travel"
const SOURCE = { name: "iframe" } as unknown as Window
const OTHER = { name: "other-tab" } as unknown as Window

const scope: MaxSessionScope = { sessionId: "sess-1", tenant: "acme", audience: "desktop" }

/** Build an enveloped inbound message as the iframe would send it. */
function inbound(
  type: string,
  extra: Record<string, unknown> = {},
  over: Partial<MaxSessionScope> = {},
) {
  return {
    channel: "max",
    v: 1,
    sessionId: over.sessionId ?? scope.sessionId,
    tenant: "tenant" in over ? over.tenant : scope.tenant,
    audience: "audience" in over ? over.audience : scope.audience,
    msgId: `m-${Math.random()}`,
    ts: Date.now(),
    type,
    ...extra,
  }
}

function ev(data: unknown, over: { origin?: string; source?: Window | null } = {}) {
  return {
    origin: over.origin ?? ORIGIN,
    source: "source" in over ? (over.source as Window) : SOURCE,
    data,
  }
}

const baseOpts = () => ({ expectedOrigin: ORIGIN, expectedSource: SOURCE, scope })

describe("validateInbound — transport checks", () => {
  it("rejects a mismatched origin (no wildcard)", () => {
    const r = validateInbound(
      ev(inbound("max:close"), { origin: "https://evil.example" }),
      baseOpts(),
    )
    expect(r).toEqual({ ok: false, reason: "origin-mismatch" })
  })

  it("rejects a message from another tab/frame (source mismatch → cross-tab replay)", () => {
    const r = validateInbound(ev(inbound("max:close"), { source: OTHER }), baseOpts())
    expect(r).toEqual({ ok: false, reason: "source-mismatch" })
  })

  it("rejects when we have no iframe yet (expectedSource null)", () => {
    const r = validateInbound(ev(inbound("max:close")), { ...baseOpts(), expectedSource: null })
    expect(r).toEqual({ ok: false, reason: "source-mismatch" })
  })

  it("rejects non-objects and unknown types", () => {
    expect(validateInbound(ev("hi"), baseOpts())).toEqual({ ok: false, reason: "not-object" })
    expect(validateInbound(ev(inbound("max:danger")), baseOpts())).toEqual({
      ok: false,
      reason: "unknown-type",
    })
  })
})

describe("validateInbound — envelope / scope checks", () => {
  it("accepts a well-formed enveloped message", () => {
    const r = validateInbound(ev(inbound("max:requestContext")), baseOpts())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.legacy).toBe(false)
      expect(r.message.type).toBe("max:requestContext")
    }
  })

  it("rejects a stale/foreign session id (cross-session replay)", () => {
    const r = validateInbound(ev(inbound("max:close", {}, { sessionId: "sess-OTHER" })), baseOpts())
    expect(r).toEqual({ ok: false, reason: "session-mismatch" })
  })

  it("rejects a mismatched tenant", () => {
    const r = validateInbound(ev(inbound("max:close", {}, { tenant: "evil-corp" })), baseOpts())
    expect(r).toEqual({ ok: false, reason: "tenant-mismatch" })
  })

  it("rejects a mismatched audience", () => {
    const r = validateInbound(ev(inbound("max:close", {}, { audience: "mobile" })), baseOpts())
    expect(r).toEqual({ ok: false, reason: "audience-mismatch" })
  })

  it("does not enforce tenant/audience when this mount declares none", () => {
    const openScope: MaxSessionScope = { sessionId: "sess-1" }
    const r = validateInbound(ev(inbound("max:close", {}, { tenant: "whatever", audience: "x" })), {
      expectedOrigin: ORIGIN,
      expectedSource: SOURCE,
      scope: openScope,
    })
    expect(r.ok).toBe(true)
  })

  it("rejects a mismatched protocol version", () => {
    const msg = { ...inbound("max:close"), v: 999 }
    expect(validateInbound(ev(msg), baseOpts())).toEqual({ ok: false, reason: "version-mismatch" })
  })
})

describe("validateInbound — entity type on context payloads", () => {
  it("normalises a valid context", () => {
    const msg = inbound("max:requestContext", {
      context: { type: "invoice", id: "INV-1", label: "Invoice 1" },
    })
    const r = validateInbound(ev(msg), baseOpts())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.message.context).toMatchObject({ type: "invoice", id: "INV-1" })
  })

  it("rejects a bad entity type in a context payload", () => {
    const msg = inbound("max:requestContext", { context: { type: "root", id: "x", label: "x" } })
    expect(validateInbound(ev(msg), baseOpts())).toEqual({ ok: false, reason: "bad-context" })
  })

  it("passes an explicit null context through (clear)", () => {
    const msg = inbound("max:clearContext", { context: null })
    const r = validateInbound(ev(msg), baseOpts())
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.message.context).toBeNull()
  })
})

describe("validateInbound — replay guard", () => {
  it("rejects a duplicated msgId (replay of a captured message)", () => {
    const guard = new ReplayGuard()
    const msg = inbound("max:close")
    const first = validateInbound(ev(msg), { ...baseOpts(), replay: guard })
    const second = validateInbound(ev(msg), { ...baseOpts(), replay: guard })
    expect(first.ok).toBe(true)
    expect(second).toEqual({ ok: false, reason: "replay" })
  })

  it("rejects a message with a stale timestamp", () => {
    const guard = new ReplayGuard(256, 1000)
    const msg = { ...inbound("max:close"), ts: 1_000 }
    const r = validateInbound(ev(msg), { ...baseOpts(), replay: guard, at: 1_000_000 })
    expect(r).toEqual({ ok: false, reason: "replay" })
  })
})

describe("validateInbound — legacy (un-enveloped) messages", () => {
  it("accepts a legacy control message after origin+source pass", () => {
    const r = validateInbound(ev({ type: "max:setLayout", layout: "expanded" }), baseOpts())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.legacy).toBe(true)
      expect(r.message.layout).toBe("expanded")
    }
  })

  it("still enforces origin on legacy messages", () => {
    const r = validateInbound(
      ev({ type: "max:close" }, { origin: "https://evil.example" }),
      baseOpts(),
    )
    expect(r).toEqual({ ok: false, reason: "origin-mismatch" })
  })

  it("does not accept the new context types over the legacy (un-enveloped) path", () => {
    const r = validateInbound(ev({ type: "max:requestContext" }), baseOpts())
    expect(r).toEqual({ ok: false, reason: "unknown-type" })
  })
})

describe("createEnvelope", () => {
  it("stamps channel/version/scope and a unique msgId", () => {
    const a = createEnvelope(scope, "max:setContext", { context: null })
    const b = createEnvelope(scope, "max:setContext", { context: null })
    expect(a.channel).toBe("max")
    expect(a.v).toBe(1)
    expect(a.sessionId).toBe("sess-1")
    expect(a.tenant).toBe("acme")
    expect(a.type).toBe("max:setContext")
    expect(a.context).toBeNull()
    expect(a.msgId).not.toBe(b.msgId)
  })
})
