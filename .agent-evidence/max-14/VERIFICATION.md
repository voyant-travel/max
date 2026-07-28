# max#14 — verification record

Typed tenant-safe host-context channel + adaptive panel controls for
`@voyant-travel/max-embed`.

## Automated checks (exact commands & results)

Run from the repo root.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ (initial); lockfile later updated by adding `jsdom`, `@testing-library/react`, and the `examples/context-demo` workspace, so subsequent installs use `pnpm install` |
| `pnpm --filter @voyant-travel/max-embed check-types` | ✅ `tsc --noEmit`, no errors |
| `pnpm --filter @voyant-travel/max-embed test` | ✅ **50 tests passed** (3 files: `context.test.ts`, `protocol.test.ts`, `embed.test.tsx`) |
| `pnpm exec biome check packages/embed` | ✅ 19 files checked, no fixes |
| `pnpm --filter @voyant-travel/max-embed build` | ✅ `tsc -p tsconfig.build.json`, `dist/` emitted incl. `context`, `protocol`, `use-context-channel` |
| `node --check packages/embed/loader/max.js` | ✅ loader syntax OK |

Test coverage maps to the acceptance criteria:

- **product context / navigation updates** — `embed.test.tsx › sends the product
  context … re-sends on navigation update` (asserts same iframe DOM node → no remount).
- **cross-tab / cross-session / invalid origin / tenant** — `protocol.test.ts`
  transport + scope suites and `embed.test.tsx › ignores a message from a
  different session/origin/window/tenant`.
- **stale / deleted / archived / unauthorized records** — `context.test.ts ›
  deriveContextStatus (historical snapshots)`.
- **clear behavior** — `embed.test.tsx › honours max:clearContext … echoes null`,
  `clears explicitly when context becomes null`.
- **historical snapshots** — `context.test.ts` (pinned context never mutated).
- **expansion round trips** — `embed.test.tsx › expands and restores …`,
  `applies a layout the iframe requests` (asserts host echoes `max:setLayout` back),
  legacy `max:setLayout` compatibility.
- **replay** — `protocol.test.ts › replay guard` (duplicate msgId + stale ts).

## Browser verification (chrome-devtools MCP)

Runnable demo: `examples/context-demo` (Vite React host + a local Max **fixture**
iframe served for `/max*`). Started on the unique high port **48714**:

```
pnpm --filter @voyant-travel/max-context-demo dev   # http://localhost:48714
```

The demo renders the **real** `MaxChat` and `MaxLauncher` components with the new
`context` / `tenant` / `audience` / layout props, pointed at the local fixture via
`embedOrigin`. Exercised via chrome-devtools MCP:

1. **Context display + inspect** — selecting `booking:VYT-10423` in the host streamed
   a typed context to both iframes; the fixture context bar showed it `active`, and
   *Inspect* revealed the normalized JSON. → `01-context-active-inspect.png`
2. **Navigation update without remount** — switching host selection
   product → customer updated the iframe context (updates counter 3 → 4) while the
   typed chat message *"Client wants an upgrade"* and the iframe's `contentWindow`
   were preserved (`sameContentWindow_noRemount: true`). → `04-context-customer-clean.png`
3. **Expand / restore round trip** — the host-rendered *Expand* control grew the
   launcher to a centred full-page overlay; the fixture reported `applied layout:
   expanded` (host→iframe echo). → `02-launcher-expanded.png`
4. **iframe-requested layout (reverse round trip)** — clicking the fixture's own
   *wide* button posted `max:requestLayout`; the host applied `wide` and echoed
   `max:setLayout` back so the fixture showed `applied layout: wide`. → `03-launcher-wide-from-iframe.png`
5. **Explicit clear** — the fixture *Clear* button posted `max:clearContext`; the
   host dropped its selection (`Host selection: none`) and logged
   *"iframe → clearContext (user pressed clear)"*.
6. **Historical snapshot** — the pinned snapshot `booking:VYT-90001` stayed put and
   flipped to a `stale` badge once the host had a different live context — it never
   inherited the current selection.
7. **Security rejection** — forged `message` events (correct source but a foreign
   `sessionId`; a spoofed `evil.example` origin; a different `source` window
   simulating another tab) were all ignored — host selection unchanged.

**Console:** clean after the fixes — no errors, no warnings, no failed requests
(the earlier `favicon.ico` 404 and a React "setState during render" warning were
both fixed; see below).

### Bugs found & fixed during browser verification

- `MaxLauncher` called `onLayoutChange` **inside** the `setLayout` updater
  (render phase) → React "Cannot update a component while rendering" warning.
  Moved the notification to a dedicated effect.
- iframe-initiated `max:requestLayout` did **not** echo the applied layout back,
  so the iframe's view of the layout went stale. Now echoes `max:setLayout` to
  complete the round trip.

## Screenshots

- `01-context-active-inspect.png` — booking context active + inspect JSON + preserved chat.
- `02-launcher-expanded.png` — launcher expanded full-page; fixture shows `expanded`.
- `03-launcher-wide-from-iframe.png` — iframe-requested `wide` applied + echoed.
- `04-context-customer-clean.png` — customer context, clean console, stale snapshot.
