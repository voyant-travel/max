---
"@voyant-travel/max-embed": minor
---

Add `MaxApp` — a fullscreen embed of the whole Max assistant as a routed app
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
