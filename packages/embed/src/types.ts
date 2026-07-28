import type { MaxHostContext } from "./context.js"
import type { MaxLayout } from "./protocol.js"

export const DEFAULT_EMBED_ORIGIN = "https://agent-embed.voyant.travel"

/**
 * Theme override the host page passes to the iframe. `system` (default) means
 * the iframe picks up the iframe-window's `prefers-color-scheme`. Set to
 * `light` or `dark` to match the host page when it's themed independently.
 */
export type MaxTheme = "light" | "dark" | "system"

export type MaxChatProps = {
  /** Embed JWT minted by the operator's backend via `/max/v1/embed/token`. */
  token: string
  /** Override the embed origin. Defaults to `https://agent-embed.voyant.travel`. */
  embedOrigin?: string
  /** Forwarded to the iframe's `title` attribute. */
  title?: string
  /**
   * Force the iframe theme to match the host page. Defaults to `system`. The
   * iframe lives in its own browsing context with its own `prefers-color-scheme`,
   * so without this it can render dark while the host is light (or vice versa).
   */
  theme?: MaxTheme
  /**
   * BCP-47 language tag for the chat shell (`en`, `ro`, `ro-RO`, …). When
   * omitted the iframe falls back to the iframe-window's `navigator.language`.
   * Note: the AI's *replies* are governed by the operator's locale on the
   * server side, not by this prop — this only controls UI chrome.
   */
  lang?: string
  /** Extra class names for the wrapping element. */
  className?: string
  /** Inline styles for the wrapping element. */
  style?: React.CSSProperties
  /** Called once the chat iframe has loaded. */
  onLoad?: () => void

  // --- Tenant-safe host-context channel -----------------------------------

  /**
   * The entity the operator is currently looking at, handed to Max as a
   * *discovery hint* (a booking, customer, invoice, …). Streamed to the iframe
   * over a validated `postMessage` channel; changing it on host navigation
   * updates the iframe **without remounting it**, so chat state is preserved.
   *
   * Pass `null` to explicitly clear the context (distinct from omitting the
   * prop, which means "this host supplies no context").
   *
   * SECURITY: the context never authorises anything. Max re-verifies identity,
   * auth, approval and consequence-preview for every action regardless of what
   * is passed here. See `CONTEXT_SECURITY_INVARIANT`.
   */
  context?: MaxHostContext | null
  /**
   * Tenant the embed token is scoped to. When set, inbound messages whose
   * envelope tenant doesn't match are rejected, hardening the channel against
   * cross-tenant message injection. Should match the tenant your backend minted
   * the token for.
   */
  tenant?: string
  /**
   * Audience/surface the token targets (e.g. `"agent-desktop"`). When set,
   * enforced on inbound messages the same way as `tenant`.
   */
  audience?: string
  /**
   * The user pressed *clear* on the context chip inside the iframe. Drop your
   * own selection state here (e.g. set `context` back to `null`). The clear is
   * always explicit — Max never silently discards a context.
   */
  onContextClear?: () => void
  /** The iframe asked the host to (re)send the current context. Rarely needed. */
  onContextRequest?: () => void
}

export type MaxLauncherProps = MaxChatProps & {
  /** Start with the panel open. Defaults to false. */
  defaultOpen?: boolean
  /** Bottom offset for the floating launcher in px. Defaults to 20. */
  bottom?: number
  /** Right offset for the floating launcher in px. Defaults to 20. */
  right?: number
  /**
   * Initial panel layout. `normal` is the docked ~420px bubble, `wide` a roomier
   * ~640px panel, `expanded` a centred near-full-page overlay. The embedded app
   * can request a layout (`max:requestLayout`) and the user can toggle it with
   * the on-panel expand/restore control; the host echoes the applied layout back
   * (`max:setLayout`) so both sides stay in sync. Defaults to `normal`.
   */
  defaultLayout?: MaxLayout
  /** Called whenever the panel layout changes, with the new layout. */
  onLayoutChange?: (layout: MaxLayout) => void
}

export type MaxAppProps = MaxChatProps & {
  /**
   * Embedder path under which the Max app is mounted, e.g. `/assistant`. The
   * in-iframe location (`/c/<id>`, …) is reflected into the embedder's address
   * bar as `basePath + path`, so deep-links, refresh, share and the browser
   * back/forward buttons all work. Defaults to `/` (Max owns the whole path).
   *
   * The embedder must route every path under `basePath` to the page that
   * renders `<MaxApp>` (a catch-all / splat route) so a refreshed deep-link
   * still mounts the component.
   */
  basePath?: string
  /**
   * Called whenever the in-iframe location changes, with the app-relative path
   * (`/`, `/c/<id>`, …). Use it to sync framework router state if you don't
   * rely on the pushState the component performs itself.
   */
  onRouteChange?: (path: string) => void
}
