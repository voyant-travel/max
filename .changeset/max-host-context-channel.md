---
"@voyant-travel/max-embed": minor
---

Add a typed, tenant-safe host-context channel and adaptive panel controls.

- **Host context** — `MaxChat` / `MaxLauncher` / `MaxApp` (and the `<script>`
  loader via `Max.setContext` / `Max.clearContext`) accept a typed
  `MaxHostContext` describing what the operator is viewing (`product`, `booking`,
  `customer`, `departure`, `invoice`, `contract`) with a stable id, display
  label, optional route/sub-view, and version/timestamp. It streams to the iframe
  over `postMessage` and updates on host navigation **without remounting** the
  iframe, so chat state is preserved. `context={null}` is an explicit clear.
- **Hardened protocol** — inbound messages are validated by exact origin,
  `event.source` (this iframe only — blocks cross-tab replay), per-mount session
  id (blocks cross-session replay), optional `tenant` / `audience` scope, a
  replay/freshness guard, and entity-type normalisation. No wildcard behaviour.
  Existing un-enveloped control messages remain supported. Spec in `PROTOCOL.md`.
- **Historical snapshots** retain their original context and never inherit the
  current host context; a `MaxContextStatus`
  (`active`/`stale`/`archived`/`deleted`/`unauthorized`) represents pinned
  contexts non-destructively (`deriveContextStatus`).
- **Adaptive layouts** — the launcher supports `normal` / `wide` / `expanded`
  layouts with responsive bounds, user-visible expand/restore controls, and
  host↔iframe layout round trips (`max:requestLayout` / `max:setLayout`).
- **Security invariant** — the host context is a discovery hint only and must not
  bypass verification, auth, approval, or consequence preview; documented and
  exported as `CONTEXT_SECURITY_INVARIANT`.

Backwards compatible: all new props/options are optional. See the migration notes
in the package README.
