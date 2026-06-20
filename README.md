# Max

The public, consumer-facing toolkit for **Max** — Voyant's AI travel agent — plus
the **Voyant CLI**. Everything you need to embed Max, extend it with your own
tools, and drive the Voyant platform from your terminal, versioned and published
to npm under the `@voyant-travel` scope.

## Packages

| Package | Install | What it's for |
| --- | --- | --- |
| [**@voyant-travel/max-embed**](./packages/embed) | `npm i @voyant-travel/max-embed` | Drop Max into any web app — React `<MaxLauncher>` / `<MaxChat>`, or a plain `<script>` loader. |
| [**@voyant-travel/max-sdk**](./packages/sdk) | `npm i @voyant-travel/max-sdk` | Write custom tools for Max: define them with Zod, serve them over HTTP, register the manifest. |
| [**@voyant-travel/max-cards**](./packages/cards) | `npm i @voyant-travel/max-cards` | The Zod contract for Max's generative-UI cards (the rich widgets tool results render). |
| [**@voyant-travel/cli**](./packages/cli) | `npm i -g @voyant-travel/cli` | Unified CLI for the Voyant open-source framework and Voyant Cloud. |

## Embed Max

```tsx
import { MaxLauncher } from "@voyant-travel/max-embed"

export function App() {
  return <MaxLauncher token={token} />
}
```

The chat runs in a sandboxed iframe hosted by Voyant; the component mounts it,
keeps it in sync with your page's theme/language, and animates it open and
closed. There's also a no-build `<script>` loader for static sites. Tokens are
short-lived and minted by your backend — see the
[package README](./packages/embed).

## Extend Max with custom tools

```ts
import { defineTool, createMaxToolsHandler, toManifest } from "@voyant-travel/max-sdk"
import { z } from "zod"

const lookupBooking = defineTool({
  name: "acme_lookup_booking",
  description: "Look up a booking by its reference.",
  tier: "read",
  input: z.object({ reference: z.string() }),
  handler: async ({ reference }, ctx) =>
    (await db.bookings.find(reference, ctx.organizationId)) ?? { notFound: true },
})

// Serve (Cloudflare Worker, Hono, Next.js, Deno, Bun…)
export default { fetch: createMaxToolsHandler([lookupBooking], { authToken: SECRET }) }

// Register with Voyant
const manifest = toManifest([lookupBooking], { callBaseUrl: "https://acme.example.com" })
```

Max validates each call against your Zod schema, confirms `destructive` actions
with the user, and renders results — optionally as rich cards. See the
[package README](./packages/sdk).

## Voyant CLI

```sh
npm i -g @voyant-travel/cli
voyant --help
```

Scaffolding, codegen, database tooling and a TS runner for the open-source
framework (no login), plus a full Voyant Cloud control plane (apps, env, deploy,
logs, secrets) once you `voyant login`. Full docs in the
[package README](./packages/cli).

## Develop

```sh
pnpm install
pnpm check-types
pnpm build
pnpm test
pnpm lint
```

Releases are managed with [Changesets](https://github.com/changesets/changesets):
add one with `pnpm changeset`, then `pnpm release` publishes.

## License

Apache-2.0. See [LICENSE](./LICENSE).
