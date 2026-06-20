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
import { defineTool, type WithCard } from "@voyant-travel/max-sdk"

handler: async ({ reference }, ctx): Promise<WithCard> => {
  const booking = await db.bookings.find(reference, ctx.organizationId)
  return {
    ...booking,
    card: { kind: "booking", reference: booking.reference, status: booking.status /* … */ },
  }
}
```

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
