# @voyant-travel/max-embed

Embed **Max** — Voyant's AI travel agent — into any web app.

Two ways to embed:

- **React** — `<MaxLauncher>` (a floating launcher + panel), `<MaxChat>` (an inline chat that fills its container), or `<MaxApp>` (the fullscreen, deep-linkable assistant).
- **Plain HTML** — a `<script>` loader that needs no build step.

The chat UI itself runs in a sandboxed iframe hosted by Voyant; these are thin,
dependency-free wrappers that mount the iframe, keep it in sync with your page's
theme/language, and animate it open and closed.

## Install

```sh
npm install @voyant-travel/max-embed
```

`react` and `react-dom` (v18 or v19) are peer dependencies for the React entry.

## Tokens

Every embed needs a short-lived embed **token** minted by _your_ backend (so the
secret API key never reaches the browser):

```
POST https://api.voyant.travel/max/v1/embed/token
```

Tokens expire (~15 min) — fetch a fresh one from your server and refresh before
expiry rather than hardcoding it.

## React — floating launcher

```tsx
import { MaxLauncher } from "@voyant-travel/max-embed"

export function App() {
  return <MaxLauncher token={token} />
}
```

## React — inline chat

```tsx
import { MaxChat } from "@voyant-travel/max-embed"

export function Support() {
  return (
    <div style={{ height: 600 }}>
      <MaxChat token={token} />
    </div>
  )
}
```

## React — fullscreen app

The whole assistant as a routed app inside a full width/height iframe — a
persistent conversation sidebar plus a canvas surface for what's being worked
on. Conversations are deep-linkable: the in-iframe location is mirrored into
your page's address bar under `basePath`, so refresh, share and browser
back/forward all work.

```tsx
import { MaxApp } from "@voyant-travel/max-embed"

// Mount this on a catch-all route, e.g. `/assistant/*`
export function Assistant() {
  return (
    <div style={{ height: "100vh" }}>
      <MaxApp token={token} basePath="/assistant" />
    </div>
  )
}
```

Route every path under `basePath` to this component (a splat/catch-all route)
so a refreshed deep-link still mounts it.

### Props

| Prop          | Type                            | Default                            | Notes                                                        |
| ------------- | ------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| `token`       | `string`                        | —                                  | Embed JWT from your backend.                                |
| `embedOrigin` | `string`                        | `https://agent-embed.voyant.travel`| Override the iframe origin.                                 |
| `theme`       | `"light" \| "dark" \| "system"` | auto-detect                        | Force the iframe theme to match your page.                  |
| `lang`        | `string`                        | auto-detect                        | BCP-47 tag for the chat chrome.                            |
| `title`       | `string`                        | `"Max by Voyant"`                  | iframe `title`.                                             |
| `defaultOpen` | `boolean` (launcher)            | `false`                            | Start with the panel open.                                  |
| `bottom`/`right` | `number` (launcher)          | `20`                               | Launcher offset in px.                                      |
| `basePath`    | `string` (app)                  | `/`                                | Embedder path the app is mounted under; reflected in the URL. |
| `onRouteChange` | `(path: string) => void` (app)| —                                  | Fires on in-iframe navigation with the app-relative path.   |
| `context`     | `MaxHostContext \| null`        | —                                  | Typed host context (discovery hint). `null` clears; see below. |
| `tenant`      | `string`                        | —                                  | Tenant scope enforced on inbound messages.                  |
| `audience`    | `string`                        | —                                  | Audience/surface scope enforced on inbound messages.        |
| `onContextClear` | `() => void`                 | —                                  | User pressed *clear* inside the iframe — drop your selection. |
| `defaultLayout` | `"normal" \| "wide" \| "expanded"` (launcher) | `"normal"`          | Initial panel layout.                                       |
| `onLayoutChange` | `(layout) => void` (launcher)| —                                  | Fires when the panel layout changes.                        |

Theme and language are auto-detected from `<html class="dark">` / `<html data-theme>` /
`<html lang>` and tracked live — toggling your page theme keeps the iframe in sync
without remounting it (chat state is preserved). Pass `theme`/`lang` to take over
either axis.

## Host context — a typed, tenant-safe discovery hint

Tell Max what the operator is currently looking at so it can offer relevant help
without the user re-typing an identifier. The context streams to the iframe over
a validated `postMessage` channel; changing it on host navigation updates the
iframe **without remounting it**, so chat state is preserved.

```tsx
import { MaxChat, type MaxHostContext } from "@voyant-travel/max-embed"

function BookingPage({ booking }) {
  const context: MaxHostContext = {
    type: "booking",              // product | booking | customer | departure | invoice | contract
    id: booking.reference,        // stable, tenant-scoped, opaque
    label: `Booking ${booking.reference}`,
    route: `/bookings/${booking.reference}`,
    version: booking.rev,         // bump on every change
  }
  return (
    <MaxChat
      token={token}
      tenant="acme"
      audience="agent-desktop"
      context={context}
      onContextClear={() => {/* user cleared it inside Max — drop your selection */}}
    />
  )
}
```

Pass `context={null}` to **explicitly** clear it (distinct from omitting the prop,
which means "this host supplies no context"). The clear is always explicit — Max
never silently discards a context.

> **Security invariant.** The host context is a *discovery hint only*. It never
> authorises anything — Max re-verifies identity, auth, approval and
> consequence-preview for every action server-side, regardless of the supplied
> context. Never use it to bypass a check. Exported as `CONTEXT_SECURITY_INVARIANT`.

**Historical conversations** — the contract keeps a pinned context and represents
it non-destructively with a `MaxContextStatus`
(`active` / `stale` / `archived` / `deleted` / `unauthorized`) via
`deriveContextStatus`, so a stored conversation never has to inherit the current
host context. Actually persisting those snapshots and resolving them live is the
platform's job — see the scope note below.

The channel is strict: inbound messages are validated by exact origin, by
`event.source` (must be *this* iframe — blocks cross-tab replay), by session id
(blocks cross-session replay), by tenant/audience scope, by a replay/freshness
guard, and by strict per-type payload validation (`max:navigate` accepts only
safe app-relative paths; layout messages require a valid layout); the entity type
is validated too. Full spec in [`PROTOCOL.md`](./PROTOCOL.md).

### Receiving context (iframe / consumer side)

`MaxContextReceiver` (alias `createContextReceiver`) is the portable, framework-
agnostic state machine for the *receiving* end of the channel. Feed it raw
`message` events and it maintains an ordered, replay-resistant, verified snapshot:

```ts
import { createContextReceiver } from "@voyant-travel/max-embed"

const receiver = createContextReceiver({
  expectedOrigin: "https://your-host.example",
  expectedSource: window.parent, // the host window (strict source check)
  scope: { sessionId, tenant: "acme", audience: "agent-desktop" },
  // Optional: resolve *display* status only — never authorization.
  verify: async (ctx) => (await stillExists(ctx)) ? { ok: true } : { ok: false, reason: "deleted" },
})

window.addEventListener("message", async (event) => {
  await receiver.ingest(event)
  render(receiver.snapshot()) // { status: "active" | "cleared" | "stale" | "degraded", context }
})
```

It enforces exact origin/source, the `v1` channel, exact payload shape,
session/tenant/audience scope, a finite strictly-positive fresh `ts` and a bounded
non-empty `msgId` (a `ts=0` never bypasses freshness), replay dedupe, entity
normalization, monotonic version/`capturedAt` ordering (older updates are rejected
out-of-order), and idempotence. The `verify` callback resolves *display* status
only; it does **not** authorize actions (see the security invariant).

### Scope: what this package is (and isn't)

`@voyant-travel/max-embed` ships the **portable contract and state machine** — the
wire format, the host- and receiver-side validators, the ordering/verification
logic, and the React/loader plumbing. Durable snapshot **persistence**, live entity
**resolution**, and the in-iframe context/approval **UI** live in the Max platform
(tracked in platform#1515) and are **not** part of this package (nor necessarily
deployed yet). The runnable `examples/context-demo` fixture is a reference
implementation of the iframe side of the protocol, not a production backend.

## Panel layouts (launcher)

The floating launcher supports three responsive layouts — `normal` (docked
bubble), `wide`, and `expanded` (centred near-full-page) — with on-panel
expand / restore controls. The embedded app can request a layout and the host
echoes the applied layout back, so both stay in sync; layout changes never
remount the iframe.

## Plain HTML — `<script>` loader

For non-React hosts (static sites, WordPress, etc.). Served from any CDN that
mirrors npm:

```html
<script src="https://unpkg.com/@voyant-travel/max-embed/max.js" defer></script>
<script>
  Max.init({ token: "<embed-jwt>", mode: "bubble" })
  // or inline:  Max.init({ token, mode: "inline", target: "#max-host" })
</script>
```

`Max.init(opts)` · `Max.open()` · `Max.close()` · `Max.setContext(ctx)` ·
`Max.clearContext()` · `Max.setLayout("normal" | "wide" | "expanded")` ·
`Max.destroy()`. It sniffs and tracks the host theme/language the same way the
React components do, and speaks the same validated context/layout protocol:

```html
<script>
  Max.init({ token, mode: "bubble", tenant: "acme", audience: "agent-desktop" })
  Max.setContext({ type: "booking", id: "VYT-10423", label: "Booking VYT-10423" })
  // …on navigation:
  Max.setContext({ type: "customer", id: "CUS-7781", label: "Ada Lovelace" })
  Max.clearContext() // explicit clear
</script>
```

## Migration notes (for platform consumers)

`0.4.x → 0.5.0` is **backwards compatible** — every existing usage keeps working:

- All new props (`context`, `tenant`, `audience`, `onContextClear`,
  `defaultLayout`, `onLayoutChange`) are optional. Omit them and behaviour is
  unchanged. Same for the loader's new `tenant`/`audience`/`context` options and
  the `setContext` / `clearContext` / `setLayout` methods.
- **Outbound** messages now carry a versioned envelope (`channel`, `v`,
  `sessionId`, `tenant`, `audience`, `msgId`, `ts`) in addition to the existing
  `type` + payload. Iframes that only read `type` and their payload key are
  unaffected.
- **Inbound** validation is stricter: messages must come from *this* iframe's
  `contentWindow` (not just the right origin). Already-deployed iframes that send
  the old un-enveloped `max:close` / `max:setLayout` / `max:navigate` from their
  own content window continue to work; new context/layout-request features
  require the envelope. See [`PROTOCOL.md`](./PROTOCOL.md).
- To adopt the context channel end-to-end, the Max iframe side must read the
  `session` / `tenant` / `audience` query params and echo them in its envelopes,
  handle `max:setContext` / `max:setLayout`, and send
  `max:requestContext` / `max:clearContext` / `max:requestLayout`. A complete
  reference implementation lives in `examples/context-demo/fixture/max.html`.

## License

Apache-2.0
