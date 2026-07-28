export type {
  MaxContextMeta,
  MaxContextStatus,
  MaxEntityType,
  MaxHostContext,
  MaxSnapshotContext,
} from "./context.js"
// Typed host-context channel
export {
  CONTEXT_SECURITY_INVARIANT,
  contextKey,
  deriveContextStatus,
  isDegradedContextStatus,
  isMaxEntityType,
  isSameContext,
  MAX_CONTEXT_STATUSES,
  MAX_ENTITY_TYPES,
  normalizeHostContext,
} from "./context.js"
export { MaxSpinner } from "./loading.js"
export { MaxApp } from "./max-app.js"
export { MaxChat } from "./max-chat.js"
export { MaxLauncher } from "./max-launcher.js"
export type {
  MaxInboundMessage,
  MaxInboundType,
  MaxLayout,
  MaxOutboundType,
  MaxSessionScope,
} from "./protocol.js"

// postMessage protocol (advanced / for building a custom host or iframe side)
export {
  createSessionId,
  isMaxLayout,
  MAX_CHANNEL,
  MAX_LAYOUTS,
  PROTOCOL_VERSION,
  validateInbound,
} from "./protocol.js"
export type {
  MaxAppProps,
  MaxChatProps,
  MaxLauncherProps,
  MaxTheme,
} from "./types.js"
