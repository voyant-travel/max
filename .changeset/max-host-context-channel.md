---
"@voyant-travel/max-embed": minor
---

Add a typed, tenant-safe host-context channel and adaptive panel controls.

**Scope.** This package ships the *portable protocol contract* — the wire format,
the host-side and receiver-side validators/state machine, and the React/loader
plumbing that carries context and layout over `postMessage`. Durable snapshot
**persistence**, live entity **resolution**, and the in-iframe context/approval
**UI** are the Max platform's responsibility (tracked in platform#1515) and are
**not** part of this package and not necessarily deployed yet. What is exported
here are the contract, the ordering/verification state machine, and the status
helpers a platform (or an alternative host/iframe) builds those on top of.

- **Host context** — `MaxChat` / `MaxLauncher` / `MaxApp` (and the `<script>`
  loader via `Max.setContext` / `Max.clearContext`) accept a typed
  `MaxHostContext` describing what the operator is viewing (`product`, `booking`,
  `customer`, `departure`, `invoice`, `contract`) with a stable id, display
  label, optional route/sub-view, and version/timestamp. It streams to the iframe
  over `postMessage` and updates on host navigation **without remounting** the
  iframe, so chat state is preserved. `context={null}` is an explicit clear. The
  initial context is delivered exactly once when the (lazily-mounted) launcher
  iframe first loads — no `max:requestContext` round-trip required.
- **Receiver-side state machine** — `MaxContextReceiver` /
  `createContextReceiver` turn an untrusted host→iframe `max:setContext` stream
  into an ordered, replay-resistant, verified snapshot
  (`active` / `cleared` / `stale` / `degraded`). It enforces exact origin/source,
  the `v1` channel, exact payload shape, session/tenant/audience scope, a finite
  strictly-positive fresh `ts` and a bounded non-empty `msgId` (no `ts=0`
  bypass), replay dedupe, entity normalization, monotonic version/`capturedAt`
  ordering (out-of-order rejection), and idempotence. An injectable sync/async
  verifier resolves *display* status only (deleted/archived/unauthorized/stale) —
  it is never an authorization gate.
- **Hardened protocol** — inbound messages are validated by exact origin,
  `event.source` (this iframe only — blocks cross-tab replay), per-mount session
  id (blocks cross-session replay), optional `tenant` / `audience` scope, a
  replay/freshness guard, entity-type normalisation, and **strict per-type
  payload validation** — `max:navigate` accepts only safe app-relative paths
  (schemes, protocol-relative, traversal, backslashes, control chars, and
  malformed encoding are rejected) and layout messages require a valid layout. No
  wildcard behaviour. Existing un-enveloped control messages remain supported.
  Spec in `PROTOCOL.md`.
- **Historical snapshots (contract)** — status helpers (`deriveContextStatus`)
  keep a pinned context and represent it non-destructively
  (`active`/`stale`/`archived`/`deleted`/`unauthorized`). The actual retention and
  live resolution of stored conversations is platform#1515, not this package.
- **Adaptive layouts** — the launcher supports `normal` / `wide` / `expanded`
  layouts with responsive bounds, user-visible expand/restore controls, and
  **idempotent** host↔iframe layout round trips (`max:requestLayout` /
  `max:setLayout`) that don't ping-pong with an echoing peer. The expanded
  full-page layout is an accessible modal dialog (`role="dialog"` / `aria-modal`,
  background isolation via `inert`, focus move-in + trap, Escape to restore, and
  focus return) in both the React and loader implementations.
- **Security invariant** — the host context is a discovery hint only and must not
  bypass verification, auth, approval, or consequence preview; documented and
  exported as `CONTEXT_SECURITY_INVARIANT`.

Backwards compatible: all new props/options are optional. `PROTOCOL.md` ships in
the published package. See the migration notes in the package README.
