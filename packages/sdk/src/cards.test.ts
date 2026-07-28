import { describe, expect, expectTypeOf, it } from "vitest"

import {
  CardActionSchema,
  defineEntityCard,
  type EntityCard,
  type EntityCollectionCard,
  entityIdentity,
  parseCard,
  parseEntityCard,
  type SemanticEntityCard,
} from "./cards.js"

const booking = {
  kind: "entity",
  entityType: "booking",
  displayName: "Alpine escape for Ada Lovelace",
  reference: "BK-2607-277186",
  customer: "Ada Lovelace",
  product: "Alpine escape",
  departure: "Bucharest · 20–27 August 2026 EEST",
  travelers: "2 adults",
  status: { label: "On hold", tone: "warning" },
  amount: "€1,080.00",
  dates: [{ label: "Departure", value: "20 August 2026, 10:00 EEST" }],
  actions: [{ kind: "open", label: "Open booking", url: "/bookings/book_123" }],
} satisfies EntityCard

describe("semantic entity cards", () => {
  it("accepts display-ready booking context", () => {
    expect(defineEntityCard(booking)).toEqual(booking)
    expectTypeOf(defineEntityCard(booking)).toEqualTypeOf<EntityCard>()
    expect(parseCard(booking)).toEqual(booking)
  })

  it("returns normalized schema output instead of claiming to preserve the exact input type", () => {
    const collection = {
      kind: "entityCollection",
      entityType: "booking",
      state: "empty",
      label: "  Bookings  ",
      items: [],
    } satisfies EntityCollectionCard

    expect(defineEntityCard(collection)).toMatchObject({ label: "Bookings" })
    expectTypeOf(defineEntityCard(collection)).toEqualTypeOf<EntityCollectionCard>()

    const normalizeUnion = (card: SemanticEntityCard) => defineEntityCard(card)
    expectTypeOf(normalizeUnion).returns.toEqualTypeOf<SemanticEntityCard>()
  })

  it.each([
    "product",
    "person",
    "departure",
    "finance",
    "contract",
  ] as const)("supports %s summaries with the same identity, date, status, and action semantics", (entityType) => {
    expect(
      parseEntityCard({
        ...booking,
        entityType,
        displayName: `${entityType} result`,
        reference: `${entityType}-123`,
      }),
    ).not.toBeNull()
  })

  it("rejects a duplicated booking id used as both title and subtitle", () => {
    expect(
      parseEntityCard({
        kind: "entity",
        entityType: "booking",
        displayName: "BK-2607-277186",
        reference: "BK-2607-277186",
      }),
    ).toBeNull()
    expect(() => entityIdentity("BK-2607-277186", "BK-2607-277186")).toThrow()
  })

  it("rejects unlabeled dates, overloaded subtitle fields, and unlabeled links", () => {
    expect(parseEntityCard({ ...booking, dates: [{ value: "2026-08-20" }] })).toBeNull()
    expect(parseEntityCard({ ...booking, subtitle: booking.reference })).toBeNull()
    expect(CardActionSchema.safeParse({ kind: "open", url: "/bookings/book_123" }).success).toBe(
      false,
    )
  })

  it.each([
    "displayName",
    "reference",
    "amount",
    "customer",
    "product",
    "departure",
    "travelers",
    "location",
    "contact",
    "capacity",
    "documentType",
    "contractType",
    "imageUrl",
  ] as const)("rejects whitespace-only semantic %s values", (field) => {
    expect(parseEntityCard({ ...booking, [field]: "   " })).toBeNull()
  })

  it("trims semantic display values and rejects whitespace-only nested labels", () => {
    expect(
      parseEntityCard({
        ...booking,
        customer: "  Ada Lovelace  ",
        status: { label: "  On hold  " },
        dates: [{ label: "  Departure  ", value: "  20 August 2026, 10:00 EEST  " }],
        facts: [{ label: "  Room  ", value: "  Twin  " }],
        actions: [{ kind: "open", label: "  Open booking  ", url: "/bookings/book_123" }],
      }),
    ).toMatchObject({
      customer: "Ada Lovelace",
      status: { label: "On hold" },
      dates: [{ label: "Departure", value: "20 August 2026, 10:00 EEST" }],
      facts: [{ label: "Room", value: "Twin" }],
      actions: [{ label: "Open booking" }],
    })

    expect(parseEntityCard({ ...booking, status: { label: "   " } })).toBeNull()
    expect(
      parseEntityCard({ ...booking, dates: [{ label: "   ", value: "20 August" }] }),
    ).toBeNull()
    expect(
      parseEntityCard({ ...booking, dates: [{ label: "Departure", value: "   " }] }),
    ).toBeNull()
    expect(parseEntityCard({ ...booking, facts: [{ label: "   ", value: "Twin" }] })).toBeNull()
    expect(parseEntityCard({ ...booking, facts: [{ label: "Room", value: "   " }] })).toBeNull()
    expect(
      parseEntityCard({
        ...booking,
        actions: [{ kind: "open", label: "   ", url: "/bookings/book_123" }],
      }),
    ).toBeNull()
  })

  it("trims action destinations and prompts and rejects whitespace-only values", () => {
    expect(
      CardActionSchema.parse({
        kind: "open",
        label: "  Open booking  ",
        url: "  /bookings/book_123  ",
      }),
    ).toEqual({ kind: "open", label: "Open booking", url: "/bookings/book_123" })
    expect(
      CardActionSchema.parse({
        kind: "prompt",
        label: "  Rebook  ",
        prompt: "  Rebook BK-123  ",
      }),
    ).toEqual({ kind: "prompt", label: "Rebook", prompt: "Rebook BK-123" })
    expect(
      CardActionSchema.safeParse({ kind: "open", label: "Open booking", url: "   " }).success,
    ).toBe(false)
    expect(
      CardActionSchema.safeParse({ kind: "prompt", label: "Rebook", prompt: "   " }).success,
    ).toBe(false)
  })

  it("preserves legacy badge and key/value whitespace behavior", () => {
    const legacy = {
      kind: "booking",
      title: "Legacy booking",
      status: { label: "   " },
      rows: [{ label: "   ", value: "   " }],
    }

    expect(parseCard(legacy)).toEqual(legacy)
  })

  it("keeps zero, many, and truncated-many collection states unambiguous", () => {
    const item = {
      entityType: "booking",
      displayName: booking.displayName,
      reference: booking.reference,
    } as const

    expect(
      parseEntityCard({
        kind: "entityCollection",
        entityType: "booking",
        state: "empty",
        label: "Bookings",
        items: [],
      }),
    ).not.toBeNull()
    expect(
      parseEntityCard({
        kind: "entityCollection",
        entityType: "booking",
        state: "many",
        label: "Bookings",
        items: [item],
      }),
    ).toBeNull()
    expect(
      parseEntityCard({
        kind: "entityCollection",
        entityType: "booking",
        state: "truncated",
        label: "Bookings",
        items: [item, { ...item, displayName: "Coastal escape", reference: "BK-2" }],
        total: 12,
      }),
    ).not.toBeNull()
  })

  it("requires complete totals to equal the number of included items", () => {
    const items = [
      { entityType: "booking", displayName: "Alpine escape", reference: "BK-1" },
      { entityType: "booking", displayName: "Coastal escape", reference: "BK-2" },
    ]

    expect(
      parseEntityCard({
        kind: "entityCollection",
        entityType: "booking",
        state: "many",
        label: "Bookings",
        items,
        total: 3,
      }),
    ).toBeNull()
    expect(
      parseEntityCard({
        kind: "entityCollection",
        entityType: "booking",
        state: "many",
        label: "Bookings",
        items,
        total: 2,
      }),
    ).not.toBeNull()
  })

  it("allows one included item when a truncated total proves more results exist", () => {
    expect(
      parseEntityCard({
        kind: "entityCollection",
        entityType: "booking",
        state: "truncated",
        label: "Bookings",
        items: [{ entityType: "booking", displayName: "Alpine escape", reference: "BK-1" }],
        total: 12,
      }),
    ).not.toBeNull()
  })

  it("trims collection labels and rejects blank collection labels", () => {
    expect(
      parseEntityCard({
        kind: "entityCollection",
        entityType: "booking",
        state: "empty",
        label: "  Bookings  ",
        items: [],
      }),
    ).toMatchObject({ label: "Bookings" })
    expect(
      parseEntityCard({
        kind: "entityCollection",
        entityType: "booking",
        state: "empty",
        label: "   ",
        items: [],
      }),
    ).toBeNull()
  })
})
