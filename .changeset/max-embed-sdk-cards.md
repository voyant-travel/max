---
"@voyant-travel/max-embed": minor
"@voyant-travel/max-sdk": minor
---

Initial release of the Max consumer toolkit:

- **@voyant-travel/max-embed** — embed Max in any web app via the React `MaxLauncher`/`MaxChat` components or a framework-agnostic `<script>` loader, with host theme/language sync and open/close + loading animations.
- **@voyant-travel/max-sdk** — write custom tools for Max: `defineTool` (Zod-validated), `createMaxToolsHandler` (Web `fetch` handler), and `toManifest` to register them. Bundles the optional generative-UI card types for tools that want to return rich widgets.
