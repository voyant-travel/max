# Contributing

This repo publishes Max's consumer-facing packages: `@voyant-travel/max-embed`
and `@voyant-travel/max-sdk`.

## Scope

- **Embedding Max** — the React components and the `<script>` loader that mount
  the Voyant-hosted chat iframe and keep it in sync with the host page.
- **Extending Max** — the SDK for authoring custom tools (define with Zod, serve
  over HTTP, register the manifest) and the generative-UI card contract.

Out of scope: the agent runtime and server-side code (lives in `voyant-cloud`),
the framework runtime (lives in `voyant-travel/voyant`), and the Voyant CLI
(lives in its own repo).

## Working rules

- Keep the public API small and well-typed; everything published is a stable
  contract.
- The embed packages stay dependency-light and framework-agnostic where possible.
- The SDK must run anywhere the Web `fetch` API does (Workers, Node, Deno, Bun).

## Before opening a PR

```sh
pnpm check-types
pnpm test
pnpm build
pnpm lint
```

## Releases

Add a changeset (`pnpm changeset`) for any user-visible change. CI opens a
release PR; merging it publishes to npm.
