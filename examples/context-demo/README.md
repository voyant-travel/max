# Max embed — host-context channel demo

A runnable demo of `@voyant-travel/max-embed`'s typed host-context channel and
adaptive panel layouts. A Vite + React **host** renders the real `MaxChat` and
`MaxLauncher` components; a local **Max fixture** iframe (served for `/max*`,
see `vite.config.ts` + `fixture/max.html`) speaks the real `postMessage`
protocol — a context bar with inspect/clear, layout round trips, and a pinned
historical snapshot.

```sh
pnpm --filter @voyant-travel/max-context-demo dev
# → http://localhost:48714
```

> This is a development fixture, not a real Max backend. `embedOrigin` points at
> this dev server; the fixture does not verify the (demo) token — it only
> exercises the host-context channel and layout protocol.

What to try:

- **Select an entity** (product / booking / customer / invoice) — it streams a
  typed context to the iframe; the iframe never remounts (chat state survives).
- **Inspect / Clear** inside the panel.
- **Widen / Expand / Restore** — from the host-rendered controls *and* from the
  fixture's own request buttons (host↔iframe round trip).
- Note the **historical snapshot** keeps its own context and shows a `stale`
  badge once the host has a different live context.

The fixture is also a reference implementation of the iframe side of the
protocol — see [`../../packages/embed/PROTOCOL.md`](../../packages/embed/PROTOCOL.md).
