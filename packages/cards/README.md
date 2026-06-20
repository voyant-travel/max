# @voyant-travel/max-cards

The Zod contract for Max's **generative-UI cards** — the rich widgets a tool
result can render in the Max chat.

A tool attaches a card by returning it on the `card` field of its result; the Max
chat validates it against this schema and renders the matching widget. Most
people consume this transitively through
[`@voyant-travel/max-sdk`](https://www.npmjs.com/package/@voyant-travel/max-sdk),
which re-exports the types — install this directly only if you need the schemas
on their own.

## Install

```sh
npm install @voyant-travel/max-cards
```

## Card kinds

Bespoke cards (each discriminated by `kind`): `customer`, `booking`,
`bookingList`, `peopleList`, `product`, `productList`, `itinerary`,
`itineraryPlan`, `offer`, `departureList`, `invoice`, `invoiceList`, `imageGrid`,
`weather`, `airQuality`, `map`, `addressCheck`.

Plus a **`dynamic`** card — a composition of presentation blocks (`heading`,
`text`, `statTiles`, `keyValues`, `badges`, `image`, `timeline`, `table`, `list`,
`divider`, `button`) for views that don't fit a bespoke kind.

## Usage

```ts
import { type AgentCard, parseCard, extractCard } from "@voyant-travel/max-cards"

const card: AgentCard = { kind: "weather" /* … */ }

parseCard(value) // -> AgentCard | null   (validate a standalone card)
extractCard(toolOutput) // -> AgentCard | null   (pull a card off a tool result)
```

## License

Apache-2.0
