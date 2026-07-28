# @voyant-travel/max-embed

## 0.5.0

### Minor Changes

- 31386b8: Add a typed, tenant-safe host-context channel and adaptive panel controls.

  **Scope.** This package ships the _portable protocol contract_ — the wire format,
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
    verifier resolves _display_ status only (deleted/archived/unauthorized/stale) —
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

## 0.4.0

### Minor Changes

- f69f178: Add `MaxApp` — a fullscreen embed of the whole Max assistant as a routed app
  inside a full width/height iframe. Unlike `MaxChat`, the in-iframe location
  (conversations, and soon artifacts) is mirrored into the embedder's address bar
  under a configurable `basePath`, so deep-links, refresh, share and the browser
  back/forward buttons all work across the cross-origin iframe boundary. Exposes
  an `onRouteChange` callback for hosts that want to sync their own router.

  Also: `MaxLauncher` and the `<script>` loader now honour a `max:setLayout`
  message from the embedded app. When a turn enters a canvas workflow the floating
  panel grows to a centred near-fullscreen overlay and stays there (latched, no
  auto-revert) until the user collapses or closes it — so the assistant can show a
  chat + live preview split without being confined to the 420px bubble.

## 0.3.0

### Minor Changes

- Export `MaxSpinner` — the branded Max loading spinner used by `MaxChat` / `MaxLauncher`. Host shells can render the same spinner during their own pre-chat work (e.g. minting an embed token) so the loading state stays consistent instead of showing a different loader. Also exports the `MaxTheme` type.

## 0.2.0

### Minor Changes

- `MaxChat` now renders a branded loading state (a spinning Max sparkle on a themed surface) until the iframe is ready, instead of flashing blank, and accepts an `onLoad` callback. The loading overlay is shared with `MaxLauncher`. `className`/`style` now apply to a wrapping element (which the iframe fills) so the overlay can sit on top.

## 0.1.0

### Minor Changes

- Initial release: embed Max via the React `MaxLauncher` / `MaxChat` components or a framework-agnostic `<script>` loader, with host theme/language sync and open/close + loading animations.
