# @voyant-travel/max-embed

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
