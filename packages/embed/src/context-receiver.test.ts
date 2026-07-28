import { describe, expect, it, vi } from "vitest"

import { CONTEXT_SECURITY_INVARIANT, type MaxHostContext } from "./context.js"
import {
  createContextReceiver,
  MaxContextReceiver,
  type MaxContextResolution,
  type MaxContextVerifier,
} from "./context-receiver.js"
import type { MaxSessionScope } from "./protocol.js"

const HOST_ORIGIN = "https://host.example"
const PARENT = { name: "parent" } as unknown as Window
const OTHER = { name: "other" } as unknown as Window
const NOW = 1_700_000_000_000

const scope: MaxSessionScope = { sessionId: "sess-1", tenant: "acme", audience: "desktop" }

const booking: MaxHostContext = {
  type: "booking",
  id: "VYT-10423",
  label: "Booking VYT-10423",
  version: 3,
}

type Over = {
  origin?: string
  source?: Window | null
  sessionId?: string
  tenant?: string | null
  audience?: string | null
  msgId?: string
  ts?: number
  type?: string
  channel?: string
  noContext?: boolean
}

let idc = 0
function ev(context: MaxHostContext | null | undefined, over: Over = {}) {
  const data: Record<string, unknown> = {
    channel: "channel" in over ? over.channel : "max",
    v: 1,
    sessionId: over.sessionId ?? scope.sessionId,
    tenant: "tenant" in over ? over.tenant : scope.tenant,
    audience: "audience" in over ? over.audience : scope.audience,
    msgId: over.msgId ?? `m-${idc++}`,
    ts: over.ts ?? NOW,
    type: over.type ?? "max:setContext",
  }
  if (!over.noContext) data.context = context
  return {
    origin: over.origin ?? HOST_ORIGIN,
    source: "source" in over ? (over.source as Window) : PARENT,
    data,
  }
}

function makeReceiver(opts: Partial<Parameters<typeof createContextReceiver>[0]> = {}) {
  return createContextReceiver({
    expectedOrigin: HOST_ORIGIN,
    expectedSource: PARENT,
    scope,
    now: () => NOW,
    ...opts,
  })
}

describe("MaxContextReceiver — transport / envelope gates", () => {
  it("accepts a well-formed setContext and exposes an active snapshot", async () => {
    const r = makeReceiver()
    const result = await r.ingest(ev(booking))
    expect(result.ok).toBe(true)
    expect(r.snapshot()).toEqual({ status: "active", context: booking })
  })

  it("rejects a foreign origin", async () => {
    const r = makeReceiver()
    const res = await r.ingest(ev(booking, { origin: "https://evil.example" }))
    expect(res).toMatchObject({ ok: false, reason: "origin-mismatch" })
    expect(r.snapshot().status).toBe("empty")
  })

  it("rejects a foreign source when a source is configured", async () => {
    const r = makeReceiver()
    const res = await r.ingest(ev(booking, { source: OTHER }))
    expect(res).toMatchObject({ ok: false, reason: "source-mismatch" })
  })

  it("rejects when configured source is null", async () => {
    const r = makeReceiver({ expectedSource: null })
    expect(await r.ingest(ev(booking))).toMatchObject({ ok: false, reason: "source-mismatch" })
  })

  it("skips the source check when no source is configured (where applicable)", async () => {
    const r = createContextReceiver({ expectedOrigin: HOST_ORIGIN, scope, now: () => NOW })
    const res = await r.ingest(ev(booking, { source: OTHER }))
    expect(res.ok).toBe(true)
  })

  it("rejects non-objects, wrong channel, and unknown types", async () => {
    const r = makeReceiver()
    expect(await r.ingest({ origin: HOST_ORIGIN, source: PARENT, data: "nope" })).toMatchObject({
      ok: false,
      reason: "not-object",
    })
    expect(await r.ingest(ev(booking, { channel: "other" }))).toMatchObject({
      ok: false,
      reason: "channel-mismatch",
    })
    expect(await r.ingest(ev(booking, { type: "max:setLayout" }))).toMatchObject({
      ok: false,
      reason: "unknown-type",
    })
  })

  it("enforces version / session / tenant / audience scope", async () => {
    const r = makeReceiver()
    expect(await r.ingest(ev(booking, { sessionId: "other" }))).toMatchObject({
      reason: "session-mismatch",
    })
    expect(await r.ingest(ev(booking, { tenant: "evil" }))).toMatchObject({
      reason: "tenant-mismatch",
    })
    expect(await r.ingest(ev(booking, { audience: "mobile" }))).toMatchObject({
      reason: "audience-mismatch",
    })
  })
})

describe("MaxContextReceiver — freshness / replay / payload", () => {
  it("never lets ts=0 bypass freshness", async () => {
    const r = makeReceiver()
    expect(await r.ingest(ev(booking, { ts: 0 }))).toMatchObject({ ok: false, reason: "stale-ts" })
  })

  it("rejects NaN / negative / stale / future timestamps", async () => {
    const r = makeReceiver()
    expect(await r.ingest(ev(booking, { ts: Number.NaN }))).toMatchObject({ reason: "stale-ts" })
    expect(await r.ingest(ev(booking, { ts: -5 }))).toMatchObject({ reason: "stale-ts" })
    expect(await r.ingest(ev(booking, { ts: NOW - 60_000 }))).toMatchObject({ reason: "stale-ts" })
    expect(await r.ingest(ev(booking, { ts: NOW + 60_000 }))).toMatchObject({ reason: "stale-ts" })
  })

  it("rejects empty and oversized msgIds", async () => {
    const r = makeReceiver()
    expect(await r.ingest(ev(booking, { msgId: "" }))).toMatchObject({ reason: "bad-msgid" })
    expect(await r.ingest(ev(booking, { msgId: "x".repeat(5000) }))).toMatchObject({
      reason: "bad-msgid",
    })
  })

  it("drops a replayed msgId", async () => {
    const r = makeReceiver()
    expect((await r.ingest(ev(booking, { msgId: "dup" }))).ok).toBe(true)
    expect(await r.ingest(ev(booking, { msgId: "dup" }))).toMatchObject({ reason: "replay" })
  })

  it("rejects a missing context key (bad payload) and a bad entity type", async () => {
    const r = makeReceiver()
    expect(await r.ingest(ev(undefined, { noContext: true }))).toMatchObject({
      reason: "bad-payload",
    })
    expect(
      await r.ingest(ev({ type: "root", id: "x", label: "x" } as unknown as MaxHostContext)),
    ).toMatchObject({ reason: "bad-context" })
  })

  it("normalises the entity (trims id, drops non-primitive meta)", async () => {
    const r = makeReceiver()
    await r.ingest(
      ev({
        type: "customer",
        id: "  C-1  ",
        label: "Ada",
        meta: { tier: "gold", blob: { x: 1 } },
      } as unknown as MaxHostContext),
    )
    const snap = r.snapshot()
    expect(snap.status).toBe("active")
    expect(snap.context).toMatchObject({ id: "C-1", meta: { tier: "gold" } })
    expect((snap.context as MaxHostContext).meta).not.toHaveProperty("blob")
  })
})

describe("MaxContextReceiver — clear / ordering / idempotence", () => {
  it("transitions to cleared on an explicit null context", async () => {
    const r = makeReceiver()
    await r.ingest(ev(booking))
    await r.ingest(ev(null))
    expect(r.snapshot()).toEqual({ status: "cleared", context: null })
  })

  it("applies a higher version and rejects a lower one (out-of-order)", async () => {
    const r = makeReceiver()
    await r.ingest(ev(booking)) // v3
    const up = await r.ingest(ev({ ...booking, version: 4, label: "v4" }))
    expect(up.ok).toBe(true)
    expect((r.snapshot().context as MaxHostContext).version).toBe(4)

    const down = await r.ingest(ev({ ...booking, version: 2, label: "v2" }))
    expect(down).toMatchObject({ ok: false, reason: "out-of-order" })
    expect((r.snapshot().context as MaxHostContext).version).toBe(4) // unchanged
  })

  it("treats the same revision as an idempotent no-op", async () => {
    const r = makeReceiver()
    await r.ingest(ev(booking))
    const again = await r.ingest(ev({ ...booking, label: "same rev" }, { msgId: "fresh" }))
    expect(again).toMatchObject({ ok: true, changed: false, idempotent: true })
    // Snapshot keeps the first revision's fields.
    expect((r.snapshot().context as MaxHostContext).label).toBe("Booking VYT-10423")
  })

  it("advances ordering after an idempotent context resend", async () => {
    const r = makeReceiver()
    await r.ingest(ev(booking, { ts: NOW - 20_000 }))
    await r.ingest(ev({ ...booking, label: "same rev" }, { ts: NOW }))

    const delayed = await r.ingest(
      ev({ type: "customer", id: "C-older", label: "Delayed customer" }, { ts: NOW - 10_000 }),
    )

    expect(delayed).toMatchObject({ ok: false, reason: "out-of-order" })
    expect(r.snapshot().context).toMatchObject({ id: booking.id })
  })

  it("orders different entities by capturedAt", async () => {
    const r = makeReceiver()
    const early: MaxHostContext = {
      type: "product",
      id: "P-1",
      label: "P1",
      capturedAt: "2026-07-28T10:00:00.000Z",
    }
    const late: MaxHostContext = {
      type: "customer",
      id: "C-1",
      label: "C1",
      capturedAt: "2026-07-28T10:05:00.000Z",
    }
    await r.ingest(ev(late))
    expect(await r.ingest(ev(early))).toMatchObject({ ok: false, reason: "out-of-order" })
    expect((r.snapshot().context as MaxHostContext).id).toBe("C-1")
  })

  it("orders and re-verifies same-entity updates that omit version", async () => {
    const verify = vi.fn<MaxContextVerifier>(() => ({ ok: true }))
    const r = makeReceiver({ verify })
    const bookingWithoutVersion = { type: booking.type, id: booking.id, label: booking.label }
    const first = { ...bookingWithoutVersion, capturedAt: "2026-07-28T10:00:00.000Z" }
    const next = { ...first, label: "updated", capturedAt: "2026-07-28T10:01:00.000Z" }
    await r.ingest(ev(first))
    expect((await r.ingest(ev(next))).ok).toBe(true)
    expect(verify).toHaveBeenCalledTimes(2)
    expect(r.snapshot().context).toMatchObject({ label: "updated" })

    expect(await r.ingest(ev({ ...first, capturedAt: "2026-07-28T09:59:00.000Z" }))).toMatchObject({
      ok: false,
      reason: "out-of-order",
    })
  })

  it("falls back to envelope timestamps for changed contexts with no revision marker", async () => {
    const verify = vi.fn<MaxContextVerifier>(() => ({ ok: true }))
    const r = makeReceiver({ verify })
    const unversioned = { type: booking.type, id: booking.id, label: booking.label }
    await r.ingest(ev(unversioned, { ts: NOW - 1_000 }))
    await r.ingest(ev({ ...unversioned, label: "new" }, { ts: NOW }))
    expect(verify).toHaveBeenCalledTimes(2)
    expect(r.snapshot().context).toMatchObject({ label: "new" })

    expect(
      await r.ingest(ev({ ...unversioned, label: "delayed" }, { ts: NOW - 500 })),
    ).toMatchObject({ ok: false, reason: "out-of-order" })
  })

  it("updates the snapshot synchronously (before await) when there is no verifier", () => {
    const r = makeReceiver()
    void r.ingest(ev(booking))
    expect(r.snapshot().status).toBe("active")
  })

  it("reset() clears state and replay memory", async () => {
    const r = makeReceiver()
    await r.ingest(ev(booking, { msgId: "dup" }))
    r.reset()
    expect(r.snapshot().status).toBe("empty")
    // The same msgId is accepted again after reset.
    expect((await r.ingest(ev(booking, { msgId: "dup" }))).ok).toBe(true)
  })
})

describe("MaxContextReceiver — verifier (display-only resolution)", () => {
  it("keeps active when the verifier resolves ok", async () => {
    const verify = vi.fn<MaxContextVerifier>(() => ({ ok: true }))
    const r = makeReceiver({ verify })
    await r.ingest(ev(booking))
    expect(verify).toHaveBeenCalledWith(booking)
    expect(r.snapshot().status).toBe("active")
  })

  it.each([
    ["deleted", "degraded"],
    ["archived", "degraded"],
    ["unauthorized", "degraded"],
    ["stale", "stale"],
  ] as const)("maps a %s resolution to a %s snapshot", async (reason, status) => {
    const verify: MaxContextVerifier = () => ({ ok: false, reason }) as MaxContextResolution
    const r = makeReceiver({ verify })
    await r.ingest(ev(booking))
    const snap = r.snapshot()
    expect(snap.status).toBe(status)
    expect(snap.context).toEqual(booking) // context preserved verbatim
    if (status === "degraded" && snap.status === "degraded") expect(snap.reason).toBe(reason)
  })

  it("supports an async verifier", async () => {
    const verify: MaxContextVerifier = async () => ({ ok: false, reason: "archived" })
    const r = makeReceiver({ verify })
    const res = await r.ingest(ev(booking))
    expect(res.ok).toBe(true)
    expect(r.snapshot()).toMatchObject({ status: "degraded", reason: "archived" })
  })

  it("degrades defensively when the verifier throws", async () => {
    const verify: MaxContextVerifier = () => {
      throw new Error("boom")
    }
    const r = makeReceiver({ verify })
    await r.ingest(ev(booking))
    expect(r.snapshot()).toMatchObject({ status: "degraded", reason: "unauthorized" })
  })

  it("discards a late verifier result superseded by a newer context", async () => {
    const deferreds = new Map<string, (r: MaxContextResolution) => void>()
    const verify: MaxContextVerifier = (ctx) =>
      new Promise<MaxContextResolution>((resolve) => {
        deferreds.set(`${ctx.type}:${ctx.id}:${ctx.version}`, resolve)
      })
    const r = makeReceiver({ verify })

    const first = r.ingest(ev(booking)) // v3, verify pending
    const second = r.ingest(ev({ ...booking, version: 5 })) // v5, newer, verify pending
    // Resolve the newer one first → snapshot becomes active v5.
    deferreds.get("booking:VYT-10423:5")?.({ ok: true })
    const secondResult = await second
    expect(secondResult.ok).toBe(true)
    expect((r.snapshot().context as MaxHostContext).version).toBe(5)
    // Now resolve the stale (older) verify → must NOT overwrite the v5 snapshot.
    deferreds.get("booking:VYT-10423:3")?.({ ok: false, reason: "deleted" })
    const firstResult = await first
    expect(firstResult).toMatchObject({ ok: false, reason: "superseded" })
    expect(r.snapshot()).toMatchObject({ status: "active" })
    expect((r.snapshot().context as MaxHostContext).version).toBe(5)
  })
})

describe("MaxContextReceiver — misc", () => {
  it("is available as a class and a factory", () => {
    expect(new MaxContextReceiver({ expectedOrigin: HOST_ORIGIN, scope })).toBeInstanceOf(
      MaxContextReceiver,
    )
    expect(createContextReceiver({ expectedOrigin: HOST_ORIGIN, scope })).toBeInstanceOf(
      MaxContextReceiver,
    )
  })

  it("re-exports the discovery-only security invariant", () => {
    expect(typeof CONTEXT_SECURITY_INVARIANT).toBe("string")
    expect(CONTEXT_SECURITY_INVARIANT).toMatch(/discovery hint only/i)
  })
})
