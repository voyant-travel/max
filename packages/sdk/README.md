# @voyant-travel/max-sdk

Write **custom tools** for Max, Voyant's AI travel agent.

A custom tool lets Max call _your_ backend — look up a booking in your PMS, price
a quote, trigger a workflow — as part of a conversation. You:

1. **Define** tools with a [Zod](https://zod.dev) schema for their arguments.
2. **Serve** them from an HTTP endpoint with the included request handler.
3. **Register** the generated manifest with Voyant.

Max validates each call against your schema, asks for confirmation on
`destructive` tools, and renders results — optionally as rich **cards**
(typed in this package; see below).

## Install

```sh
npm install @voyant-travel/max-sdk zod
```

## 1. Define tools

```ts
import { defineTool } from "@voyant-travel/max-sdk"
import { z } from "zod"

export const lookupBooking = defineTool({
  name: "acme_lookup_booking",
  description: "Look up a booking by its reference.",
  tier: "read", // "read" | "routine-write" | "destructive"
  input: z.object({
    reference: z.string().describe("Booking reference, e.g. AC-1234"),
  }),
  handler: async ({ reference }, ctx) => {
    // ctx = { toolName, operatorId, organizationId, userId } — all from Voyant
    const booking = await db.bookings.find(reference, ctx.organizationId)
    return booking ?? { notFound: true }
  },
})
```

Tool names must be unique and use only letters, digits, `_` or `-`. Prefix them
with your operator handle (e.g. `acme_`).

## 2. Serve them

`createMaxToolsHandler` returns a standard Web `fetch` handler — it runs anywhere
that speaks `Request`/`Response` (Cloudflare Workers, Hono, Next.js route
handlers, Deno, Bun). Mount it so it receives `POST /v1/max/tools/:name/call`.

```ts
import { createMaxToolsHandler } from "@voyant-travel/max-sdk"

const handler = createMaxToolsHandler([lookupBooking /*, ...*/], {
  authToken: process.env.MAX_TOOLS_SECRET, // Voyant presents this as a Bearer token
})

// Cloudflare Worker
export default { fetch: handler }
```

It authenticates the request, validates `args` against the tool's schema (422 on
mismatch), runs your handler, and returns the result as JSON.

## 3. Register the manifest

```ts
import { toManifest } from "@voyant-travel/max-sdk"

const manifest = toManifest([lookupBooking], {
  callBaseUrl: "https://acme.example.com",
})
// Register `manifest` with Voyant for your operator. Each tool's Zod schema is
// emitted as JSON Schema so the model knows how to call it.
```

## Rich results (cards)

Cards are **optional** — return plain JSON and Max renders it. When you want to
control the widget, return a `card` alongside your data. The card types ship with
this package:

```ts
import { defineEntityCard, defineTool, type WithCard } from "@voyant-travel/max-sdk"

handler: async ({ reference }, ctx): Promise<WithCard> => {
  const booking = await db.bookings.find(reference, ctx.organizationId)
  return {
    ...booking,
    card: defineEntityCard({
      kind: "entity",
      entityType: "booking",
      // One canonical, human-readable identity. The reference must be different.
      displayName: "Alpine escape for Ada Lovelace",
      reference: booking.reference,
      customer: "Ada Lovelace",
      product: "Alpine escape",
      departure: "Bucharest · 20–27 August 2026 EEST",
      travelers: "2 adults",
      status: { label: "On hold", tone: "warning" },
      amount: "€1,080.00",
      // Values are already formatted for the operator's locale and timezone.
      dates: [{ label: "Departure", value: "20 August 2026, 10:00 EEST" }],
      actions: [{ kind: "open", label: "Open booking", url: booking.adminUrl }],
    }),
  }
}
```

The semantic `entity` contract also supports `product`, `person`, `departure`,
`finance`, and `contract`. All use the same canonical identity, labeled date,
status, amount, fact, and labeled-action semantics. Entity-specific context is
carried by fields such as `customer`, `product`, `departure`, `travelers`,
`location`, `contact`, `capacity`, `documentType`, and `contractType` rather than
an overloaded subtitle.

### Result cardinality

Use an `entity` card for exactly one result. Use `entityCollection` only for
zero, many, or truncated-many results. A total is optional for a complete list,
must equal the included item count when supplied for a complete list, and is
required to exceed the included item count for a truncated list. A truncated
list may include one or more representative items.

```ts
import { defineEntityCard } from "@voyant-travel/max-sdk"

// Zero
defineEntityCard({
  kind: "entityCollection",
  entityType: "booking",
  state: "empty",
  label: "Bookings",
  items: [],
})

// One (never collection chrome)
defineEntityCard({
  kind: "entity",
  entityType: "booking",
  displayName: "Alpine escape for Ada Lovelace",
  reference: "BK-2607-277186",
  actions: [{ kind: "open", label: "Open booking", url: "/bookings/book_123" }],
})

const items = [
  { entityType: "booking", displayName: "Alpine escape", reference: "BK-101" },
  { entityType: "booking", displayName: "Coastal escape", reference: "BK-102" },
] as const

// Many; `total` is omitted because all results are present.
defineEntityCard({
  kind: "entityCollection",
  entityType: "booking",
  state: "many",
  label: "Bookings",
  items: [...items],
})

// Truncated many; total communicates how many results were not included.
defineEntityCard({
  kind: "entityCollection",
  entityType: "booking",
  state: "truncated",
  label: "Bookings",
  items: [...items],
  total: 27,
})
```

Existing bespoke cards remain available. See the
[semantic card migration guide](./MIGRATING-SEMANTIC-CARDS.md) before adopting
the stricter semantic schemas or upgrading producers that emitted unlabeled
open actions.

## File results

For generated PDFs/exports, set `outputKind: "file"` and return `file(...)`:

```ts
import { defineTool, file } from "@voyant-travel/max-sdk"

export const exportInvoice = defineTool({
  name: "acme_export_invoice",
  description: "Export an invoice as a PDF.",
  tier: "read",
  outputKind: "file",
  input: z.object({ invoiceId: z.string() }),
  handler: async ({ invoiceId }) => {
    const url = await renderInvoicePdf(invoiceId)
    return file({
      label: "Invoice",
      filename: `${invoiceId}.pdf`,
      mediaType: "application/pdf",
      downloadUrl: url,
    })
  },
})
```

## Tiers

| Tier            | Behaviour                                                        |
| --------------- | --------------------------------------------------------------- |
| `read`          | Runs automatically.                                             |
| `routine-write` | Runs with light guarding.                                       |
| `destructive`   | Requires explicit user approval before it executes.            |

## License

Apache-2.0
