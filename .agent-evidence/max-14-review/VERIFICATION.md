# max#14 review — verification record

Re-verification of the typed tenant-safe host-context channel + adaptive panel
controls for `@voyant-travel/max-embed`, covering the review findings (receiver
state machine, strict payload/path validation, idempotent layout round trips,
lazy-launcher initial delivery, loader parity, expanded-panel a11y, PROTOCOL.md
packaging, Biome scope, narrowed claims) and a **truly cross-origin** browser run.

## Automated checks (exact commands & results)

Run from the repo root unless noted.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ lockfile unchanged (no new deps added) |
| `pnpm --filter @voyant-travel/max-embed test` | ✅ **129 tests passed** (7 files: `context`, `context-receiver`, `protocol`, `embed`, `focus-trap`, `loader`, package-root exports) |
| `pnpm --filter @voyant-travel/max-embed check-types` | ✅ `tsc --noEmit`, no errors |
| `pnpm exec biome check packages/embed examples/context-demo` | ✅ clean (blanket `examples` exclusion removed; only the HTML fixture is narrowly excluded) |
| `pnpm --filter @voyant-travel/max-embed build` | ✅ `dist/` emitted incl. `context-receiver`, `focus-trap` |
| `pnpm --filter @voyant-travel/max-context-demo build` | ✅ vite build OK |
| `pnpm pack --pack-destination /tmp/max-pack` (in `packages/embed`) | ✅ tarball contains `PROTOCOL.md`, `loader/max.js`, full `dist/`; no test/src/unintended files |
| `pnpm changeset status` | ✅ `@voyant-travel/max-embed` (minor) + `@voyant-travel/max-sdk` (minor) |
| `node --check packages/embed/loader/max.js` | ✅ loader syntax OK |

## Cross-origin browser verification (chrome-devtools MCP)

Two **different-origin** dev servers (localhost ≠ 127.0.0.1 are distinct origins):

```
# fixture iframe — cross-origin
pnpm --filter @voyant-travel/max-context-demo dev:fixture           # http://127.0.0.1:48715
# host app, embedOrigin pointed at the cross-origin fixture
pnpm --filter @voyant-travel/max-context-demo dev:host-xorigin      # http://localhost:48714
```

The host renders the **real** `MaxChat` + `MaxLauncher` at `localhost:48714`; both
iframes load from `http://127.0.0.1:48715` (verified `new URL(iframe.src).origin !==
location.origin`). The fixture derives the parent origin from `document.referrer`
and enforces exact origin + `event.source === window.parent`. The demo also drives
the exported `MaxContextReceiver` directly via a small on-page harness.

**Console:** clean — no errors, no warnings (the earlier cross-origin
"target origin does not match" postMessage warning is gone: the host now defers
the first context delivery to iframe `load` instead of posting to `about:blank`).
**Network:** all requests `200`/`304`, including the cross-origin
`127.0.0.1:48715/max` and `/max/bubble` documents — **no failed requests**.

### Evidence → finding mapping

| Screenshot | Shows |
| --- | --- |
| `01-preserve-switch-stale.png` | Context switch `product → customer` streamed cross-origin; iframe `contentWindow` **unchanged** (`sameContentWindow_noRemount: true`), "Context updates received: 3" (no reset), typed chat message *"Client wants an upgrade to business class"* **preserved**; historical snapshot stays **`stale`** (never inherits the live context). |
| `02-clear-from-iframe.png` | Fixture *Clear* button → `max:clearContext` → host selection `none` + logged; explicit clear across origins. |
| `03-launcher-wide.png` | Launcher **wide** layout via the on-panel control. |
| `04-launcher-expanded-modal.png` | **Expanded** full-page modal: `role="dialog"` + `aria-modal="true"`, `aria-label="Max by Voyant"`, focus moved into the dialog (`document.activeElement === dialog`), background isolated via `inert` (host content non-focusable). |
| `05-escape-restored-focus-return.png` | **Escape** restores to normal, removes `aria-modal` + `inert`, and **returns focus** to the "Expand Max to full page" button. |
| `06-receiver-out-of-order-rejected.png` | `MaxContextReceiver`: after v1→v2, a re-sent v1 is `rejected(out-of-order)`; snapshot stays `active v2` (monotonic ordering). |
| `07-receiver-invalid-origin-session-rejected.png` | Forged origin → `rejected(origin-mismatch)`; forged session → `rejected(session-mismatch)`; snapshot unchanged (discovery-only invariant preserved). |
| `08-receiver-degraded-deleted.png` | Injectable verifier resolves *deleted* → snapshot `degraded (deleted)` with the context **preserved verbatim** (non-destructive). |

Stale is additionally shown in `01` (fixture historical snapshot badge). The
receiver's `cleared`/`active` states are exercised in the same harness sequence.

> Scope note: this exercises the **portable contract + state machine** only.
> Durable persistence, live entity resolution, and production UI are platform#1515
> and are not part of this package.

## Final blocker regression pass

The focused suite above was rerun after the final lifecycle/order review. Added
coverage verifies loader tenant/session state resets on both destroy and re-init,
invalid React contexts are dropped without clearing, unversioned receiver updates
order and re-verify correctly, a closed expanded-default launcher does not isolate
the page, stable `WindowProxy` reloads re-deliver context, package-root protocol
exports compile, prototype-shaped loader keys are safe, and pre-existing host
`inert` / `aria-hidden` values survive modal isolation. The cross-origin fixture
runtime was unchanged; its claims were narrowed to identify the fixture as an
illustrative hand-written peer, so the existing browser screenshots remain the
accurate visual evidence for the real host components and receiver harness.
The final scope-transition pass additionally verifies inline loader teardown and
inline-to-bubble tenant isolation, fresh React sessions/replay guards for token,
tenant, and audience changes, load-gated context delivery, and strict bounded
revision-marker normalization.
