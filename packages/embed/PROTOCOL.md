# Max embed — host ↔ iframe postMessage protocol

This document specifies the public `postMessage` protocol between a host page
(the React components in this package, or the `<script>` loader) and the Max
iframe. It is the contract an alternative host or an updated iframe must follow.

> **Security invariant.** The host context is a **discovery hint only**. It never
> authorises anything. Max re-verifies identity, authentication, authorization,
> human approval and consequence-preview for **every** action server-side against
> the session's own credentials, regardless of what context is supplied. A stale,
> forged, or over-broad context can only ever change what Max *suggests* — never
> what it is *allowed to do*. Do not use the context to bypass a check.
> (Exported at runtime as `CONTEXT_SECURITY_INVARIANT`.)

## Envelope

Every message (except the legacy control messages below) is wrapped in a
versioned envelope:

```ts
{
  channel: "max",     // discriminator
  v: 1,               // PROTOCOL_VERSION
  sessionId: string,  // per-mount id; both sides echo it
  tenant: string | null,
  audience: string | null,
  msgId: string,      // unique per message (replay dedupe)
  ts: number,         // Date.now() at send (freshness)
  type: string,       // see below
  // …type-specific payload
}
```

The host seeds the iframe with `session`, `tenant` and `audience` **query
params** on the iframe `src`; the iframe echoes them in every envelope so the
host can validate scope.

## Inbound validation (iframe → host)

The host accepts a message only if **all** hold (see `validateInbound`):

1. `event.origin` **exactly** equals the configured embed origin (no wildcard,
   no suffix match).
2. `event.source` is the host's **own** iframe `contentWindow` (blocks other
   tabs/frames — cross-tab replay).
3. `data` is an object with a known `type`.

For enveloped messages, additionally:

4. `v === 1`.
5. `sessionId` equals this mount's id (blocks cross-session replay).
6. `tenant` / `audience` match when the host declares them.
7. `msgId` is unseen and `ts` is within ±30 s (replay / freshness guard).
8. Any attached `context` re-normalises cleanly (valid entity type) — otherwise
   the whole message is dropped.

## Messages

### Host → iframe (outbound)

| `type` | Payload | Meaning |
| --- | --- | --- |
| `max:setTheme` | `{ theme }` | `"light" \| "dark" \| "system"` |
| `max:setLang` | `{ lang }` | BCP-47 tag |
| `max:setRoute` | `{ path }` | replay a route into the iframe (MaxApp) |
| `max:setContext` | `{ context }` | typed host context, or `null` to clear |
| `max:setLayout` | `{ layout }` | echo of the applied layout (round-trip ack) |

### iframe → host (inbound)

| `type` | Payload | Meaning |
| --- | --- | --- |
| `max:ready` | — | iframe booted |
| `max:close` | — | close the launcher panel |
| `max:navigate` | `{ path }` | in-iframe navigation (MaxApp mirrors to URL) |
| `max:requestLayout` | `{ layout }` | ask host for `normal \| wide \| expanded` |
| `max:requestContext` | — | ask host to (re)send the current context |
| `max:clearContext` | — | user pressed *clear* inside the iframe |

### Legacy compatibility

Already-deployed iframes may send **un-enveloped** control messages
(`max:ready`, `max:close`, `max:setLayout`, `max:navigate`). These are still
honoured, but only after the origin + source checks (1–3). They can never carry
a context, so the tenant-sensitive surface is always fully validated. New iframes
should send the full envelope.

## Host context shape

```ts
type MaxEntityType =
  | "product" | "booking" | "customer" | "departure" | "invoice" | "contract"

type MaxHostContext = {
  type: MaxEntityType
  id: string          // stable, tenant-scoped, opaque
  label: string       // human-readable
  route?: string      // host deep-link
  subView?: string    // e.g. "itinerary", "payments"
  version?: number    // bumped on each change
  capturedAt?: string // ISO-8601
  meta?: Record<string, string | number | boolean | null>
}
```

## Historical snapshots

A stored conversation retains the exact context it was created with. It must
**not** inherit the host's current context. When the pinned context can no longer
be resolved live, represent it non-destructively with a `MaxContextStatus`:

```
active | stale | archived | deleted | unauthorized
```

`deriveContextStatus(pinned, live, resolution?)` computes this without ever
mutating the pinned context.

## Layouts & round trips

`normal` (docked ~420px), `wide` (~640px), `expanded` (centred near-full-page).
All widths/heights are clamped to the viewport (responsive bounds). Either side
can drive a change:

- **user / host** → host applies + posts `max:setLayout` to the iframe.
- **iframe** → posts `max:requestLayout`; host applies + echoes `max:setLayout`.

Layout and context changes **never** change the iframe `src`, so the iframe is
never remounted and chat state is preserved.
