# @voyant-travel/max-embed

Embed **Max** — Voyant's AI travel agent — into any web app.

Two ways to embed:

- **React** — `<MaxLauncher>` (a floating launcher + panel), `<MaxChat>` (an inline chat that fills its container), or `<MaxApp>` (the fullscreen, deep-linkable assistant).
- **Plain HTML** — a `<script>` loader that needs no build step.

The chat UI itself runs in a sandboxed iframe hosted by Voyant; these are thin,
dependency-free wrappers that mount the iframe, keep it in sync with your page's
theme/language, and animate it open and closed.

## Install

```sh
npm install @voyant-travel/max-embed
```

`react` and `react-dom` (v18 or v19) are peer dependencies for the React entry.

## Tokens

Every embed needs a short-lived embed **token** minted by _your_ backend (so the
secret API key never reaches the browser):

```
POST https://api.voyant.travel/max/v1/embed/token
```

Tokens expire (~15 min) — fetch a fresh one from your server and refresh before
expiry rather than hardcoding it.

## React — floating launcher

```tsx
import { MaxLauncher } from "@voyant-travel/max-embed"

export function App() {
  return <MaxLauncher token={token} />
}
```

## React — inline chat

```tsx
import { MaxChat } from "@voyant-travel/max-embed"

export function Support() {
  return (
    <div style={{ height: 600 }}>
      <MaxChat token={token} />
    </div>
  )
}
```

## React — fullscreen app

The whole assistant as a routed app inside a full width/height iframe — a
persistent conversation sidebar plus a canvas surface for what's being worked
on. Conversations are deep-linkable: the in-iframe location is mirrored into
your page's address bar under `basePath`, so refresh, share and browser
back/forward all work.

```tsx
import { MaxApp } from "@voyant-travel/max-embed"

// Mount this on a catch-all route, e.g. `/assistant/*`
export function Assistant() {
  return (
    <div style={{ height: "100vh" }}>
      <MaxApp token={token} basePath="/assistant" />
    </div>
  )
}
```

Route every path under `basePath` to this component (a splat/catch-all route)
so a refreshed deep-link still mounts it.

### Props

| Prop          | Type                            | Default                            | Notes                                                        |
| ------------- | ------------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| `token`       | `string`                        | —                                  | Embed JWT from your backend.                                |
| `embedOrigin` | `string`                        | `https://agent-embed.voyant.travel`| Override the iframe origin.                                 |
| `theme`       | `"light" \| "dark" \| "system"` | auto-detect                        | Force the iframe theme to match your page.                  |
| `lang`        | `string`                        | auto-detect                        | BCP-47 tag for the chat chrome.                            |
| `title`       | `string`                        | `"Max by Voyant"`                  | iframe `title`.                                             |
| `defaultOpen` | `boolean` (launcher)            | `false`                            | Start with the panel open.                                  |
| `bottom`/`right` | `number` (launcher)          | `20`                               | Launcher offset in px.                                      |
| `basePath`    | `string` (app)                  | `/`                                | Embedder path the app is mounted under; reflected in the URL. |
| `onRouteChange` | `(path: string) => void` (app)| —                                  | Fires on in-iframe navigation with the app-relative path.   |

Theme and language are auto-detected from `<html class="dark">` / `<html data-theme>` /
`<html lang>` and tracked live — toggling your page theme keeps the iframe in sync
without remounting it (chat state is preserved). Pass `theme`/`lang` to take over
either axis.

## Plain HTML — `<script>` loader

For non-React hosts (static sites, WordPress, etc.). Served from any CDN that
mirrors npm:

```html
<script src="https://unpkg.com/@voyant-travel/max-embed/max.js" defer></script>
<script>
  Max.init({ token: "<embed-jwt>", mode: "bubble" })
  // or inline:  Max.init({ token, mode: "inline", target: "#max-host" })
</script>
```

`Max.init(opts)` · `Max.open()` · `Max.close()` · `Max.destroy()`. It sniffs and
tracks the host theme/language the same way the React components do.

## License

Apache-2.0
