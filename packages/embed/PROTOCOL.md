# Max embed — host ↔ iframe postMessage protocol

This document specifies the public `postMessage` protocol between a host page
(the React components in this package, or the `<script>` loader) and the Max
iframe. It is the contract an alternative host or an updated iframe must follow.

> **Scope.** This package is the *portable contract* — the wire format plus the
> host-side (`validateInbound`) and receiver-side (`MaxContextReceiver`)
> validators/state machine. Durable snapshot **persistence**, live entity
> **resolution**, and the in-iframe context/approval **UI** are the Max platform's
> responsibility (platform#1515) and are **not** implemented here (nor necessarily
> deployed). The `examples/context-demo` fixture is an illustrative hand-written
> protocol peer, not the exported receiver implementation and not a backend.

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
8. The payload matches the `type` **exactly** (strict validation): `max:navigate`
   carries a *safe app-relative path* (see below); `max:requestLayout` /
   `max:setLayout` carry a valid `normal | wide | expanded`. A malformed payload
   drops the whole message.
9. Any attached `context` re-normalises cleanly (valid entity type) — otherwise
   the whole message is dropped.

### Safe navigation paths

`max:navigate` paths are the only iframe-supplied value replayed into the host's
`history.pushState`, so they are validated by `isSafeAppPath`. A path is accepted
only when it is an app-relative absolute path (`/…`) that is **not**
protocol-relative (`//host`, `/\host`), contains no backslashes, no control
characters, no `..` traversal (raw or percent-encoded), and is validly encoded and
within a length bound. Schemes (`javascript:`, `http:`), relative paths, and
malformed encodings are rejected.

### Receiver-side validation (host → iframe)

The iframe (or any consumer) validates the *host's* `max:setContext` stream with
the mirror-image `MaxContextReceiver` state machine: exact origin/source, `v1`
channel, exact payload shape, session/tenant/audience scope, a **finite,
strictly-positive** fresh `ts` (a `ts=0` never bypasses freshness), a bounded
non-empty `msgId` (replay dedupe), entity normalization, **monotonic
version/`capturedAt` ordering** with envelope-`ts` fallback (older updates
rejected out-of-order), and idempotence. It surfaces an explicit snapshot —
`active` / `cleared` / `stale` / `degraded` — with an injectable sync/async
verifier that resolves *display* status only (never authorization).

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
mutating the pinned context. This is the *contract* for representing a pinned
context; storing conversations and resolving their contexts live is the platform's
job (platform#1515), not this package.

## Layouts & round trips

`normal` (docked ~420px), `wide` (~640px), `expanded` (centred near-full-page).
All widths/heights are clamped to the viewport (responsive bounds). Either side
can drive a change:

- **user / host** → host applies + posts `max:setLayout` to the iframe.
- **iframe** → posts `max:requestLayout`; host applies + echoes `max:setLayout`.

Layout and context changes **never** change the iframe `src`, so the iframe is
never remounted and chat state is preserved.
