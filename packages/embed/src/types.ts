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
  /** Extra class names for the wrapping iframe. */
  className?: string
  /** Inline styles for the wrapping iframe. */
  style?: React.CSSProperties
}

export type MaxLauncherProps = MaxChatProps & {
  /** Start with the panel open. Defaults to false. */
  defaultOpen?: boolean
  /** Bottom offset for the floating launcher in px. Defaults to 20. */
  bottom?: number
  /** Right offset for the floating launcher in px. Defaults to 20. */
  right?: number
}
