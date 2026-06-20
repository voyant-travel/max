# @voyant-travel/max-embed

## 0.2.0

### Minor Changes

- `MaxChat` now renders a branded loading state (a spinning Max sparkle on a themed surface) until the iframe is ready, instead of flashing blank, and accepts an `onLoad` callback. The loading overlay is shared with `MaxLauncher`. `className`/`style` now apply to a wrapping element (which the iframe fills) so the overlay can sit on top.

## 0.1.0

### Minor Changes

- Initial release: embed Max via the React `MaxLauncher` / `MaxChat` components or a framework-agnostic `<script>` loader, with host theme/language sync and open/close + loading animations.
