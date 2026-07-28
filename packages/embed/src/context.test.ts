import { describe, expect, it } from "vitest"

import {
  contextKey,
  deriveContextStatus,
  isDegradedContextStatus,
  isMaxEntityType,
  isSameContext,
  type MaxHostContext,
  normalizeHostContext,
} from "./context.js"

const booking: MaxHostContext = {
  type: "booking",
  id: "VYT-10423",
  label: "Booking VYT-10423",
  version: 3,
}

describe("isMaxEntityType", () => {
  it("accepts the six supported entity types", () => {
    for (const t of ["product", "booking", "customer", "departure", "invoice", "contract"]) {
      expect(isMaxEntityType(t)).toBe(true)
    }
  })

  it("rejects unknown / malicious types", () => {
    expect(isMaxEntityType("admin")).toBe(false)
    expect(isMaxEntityType("")).toBe(false)
    expect(isMaxEntityType(42)).toBe(false)
    expect(isMaxEntityType(null)).toBe(false)
  })
})

describe("normalizeHostContext", () => {
  it("normalises a valid product context", () => {
    const out = normalizeHostContext({
      type: "product",
      id: "  PRD-1  ",
      label: "  Kilimanjaro Trek  ",
      route: "/products/PRD-1",
      subView: "itinerary",
      version: 2,
      capturedAt: "2026-07-28T10:00:00Z",
    })
    expect(out).toEqual({
      type: "product",
      id: "PRD-1",
      label: "Kilimanjaro Trek",
      route: "/products/PRD-1",
      subView: "itinerary",
      version: 2,
      capturedAt: "2026-07-28T10:00:00Z",
    })
  })

  it("rejects an unsupported entity type (the protocol entity-type check)", () => {
    expect(normalizeHostContext({ type: "secret", id: "x", label: "x" })).toBeNull()
  })

  it("rejects a missing / empty id", () => {
    expect(normalizeHostContext({ type: "booking", id: "", label: "x" })).toBeNull()
    expect(normalizeHostContext({ type: "booking", label: "x" })).toBeNull()
  })

  it("falls back to id when label is missing", () => {
    expect(normalizeHostContext({ type: "invoice", id: "INV-9" })?.label).toBe("INV-9")
  })

  it("keeps only primitive metadata, drops nested objects", () => {
    const out = normalizeHostContext({
      type: "customer",
      id: "C-1",
      label: "Ada",
      meta: { tier: "gold", vip: true, spend: 1200, blob: { nested: 1 }, fn: () => 1 },
    })
    expect(out?.meta).toEqual({ tier: "gold", vip: true, spend: 1200 })
  })

  it("returns null for non-objects", () => {
    expect(normalizeHostContext(null)).toBeNull()
    expect(normalizeHostContext("booking")).toBeNull()
    expect(normalizeHostContext(undefined)).toBeNull()
  })

  it("rejects invalid supplied revision markers instead of silently omitting them", () => {
    const base = { type: "booking", id: "B-1" }
    for (const version of [-1, 1.5, Number.NaN, "2", null]) {
      expect(normalizeHostContext({ ...base, version })).toBeNull()
    }
    for (const capturedAt of ["", "not-a-date", 123, null]) {
      expect(normalizeHostContext({ ...base, capturedAt })).toBeNull()
    }
  })

  it("bounds route, sub-view, metadata keys and metadata strings", () => {
    const out = normalizeHostContext({
      type: "booking",
      id: "B-1",
      route: "r".repeat(3000),
      subView: "s".repeat(300),
      meta: { ["k".repeat(129)]: "discard", note: "v".repeat(3000) },
    })
    expect(out?.route).toHaveLength(2048)
    expect(out?.subView).toHaveLength(128)
    expect(out?.meta).toEqual({ note: "v".repeat(2048) })
  })
})

describe("isSameContext / contextKey", () => {
  it("same entity + version is the same", () => {
    expect(isSameContext(booking, { ...booking })).toBe(true)
  })
  it("different version is not the same", () => {
    expect(isSameContext(booking, { ...booking, version: 4 })).toBe(false)
  })
  it("different id is not the same", () => {
    expect(isSameContext(booking, { ...booking, id: "OTHER" })).toBe(false)
  })
  it("contextKey is type:id", () => {
    expect(contextKey(booking)).toBe("booking:VYT-10423")
    expect(contextKey(null)).toBeNull()
  })
})

describe("deriveContextStatus (historical snapshots)", () => {
  it("is active when pinned matches the live context", () => {
    expect(deriveContextStatus(booking, booking)).toBe("active")
  })

  it("is stale when the host has navigated to a different entity/version", () => {
    expect(deriveContextStatus(booking, { ...booking, version: 5 })).toBe("stale")
    expect(deriveContextStatus(booking, { ...booking, id: "OTHER" })).toBe("stale")
    expect(deriveContextStatus(booking, null)).toBe("stale")
  })

  it("reports deleted / archived / unauthorized when the entity no longer resolves", () => {
    expect(deriveContextStatus(booking, booking, { resolved: false, reason: "deleted" })).toBe(
      "deleted",
    )
    expect(deriveContextStatus(booking, booking, { resolved: false, reason: "archived" })).toBe(
      "archived",
    )
    expect(deriveContextStatus(booking, booking, { resolved: false, reason: "unauthorized" })).toBe(
      "unauthorized",
    )
  })

  it("never mutates the pinned context", () => {
    const pinned = { ...booking }
    deriveContextStatus(pinned, { ...booking, version: 9 })
    expect(pinned).toEqual(booking)
  })

  it("degraded-status helper flags everything but active", () => {
    expect(isDegradedContextStatus("active")).toBe(false)
    expect(isDegradedContextStatus("stale")).toBe(true)
    expect(isDegradedContextStatus("deleted")).toBe(true)
  })
})
