# Roadmap

## Now

- **@voyant-travel/max-embed** — React launcher + inline chat + `<script>` loader.
- **@voyant-travel/max-sdk** — author custom tools (Zod), serve them, register the manifest.
- **@voyant-travel/max-cards** — the generative-UI card contract.
- **@voyant-travel/cli** — open-source framework tooling + Voyant Cloud control plane.

## Next

- Web component / vanilla build of the embed for non-React, no-CDN setups.
- SDK: typed helpers for building each bespoke card kind (not just the union type).
- SDK: local dev harness to exercise tools against a mock Max runtime.
- Framework adapters for the tools handler (Express/Fastify request shims).
- Examples app: an end-to-end operator backend exposing a few custom tools.

## Later

- First-class TypeScript types for the embed<->host postMessage protocol.
- CLI: scaffolding for a custom-tools backend (`voyant max tools new`).
