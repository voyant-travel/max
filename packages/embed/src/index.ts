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
  isContextOutOfOrder,
  isDegradedContextStatus,
  isMaxEntityType,
  isSameContext,
  MAX_CONTEXT_STATUSES,
  MAX_ENTITY_TYPES,
  normalizeHostContext,
  parseContextTimestamp,
} from "./context.js"
export type {
  MaxContextDegradedReason,
  MaxContextIngestResult,
  MaxContextReceiverOptions,
  MaxContextReceiverReason,
  MaxContextResolution,
  MaxContextSnapshot,
  MaxContextVerifier,
} from "./context-receiver.js"
// Receiver-side context state machine (portable contract — see PROTOCOL.md)
export {
  createContextReceiver,
  MaxContextReceiver,
} from "./context-receiver.js"
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
  isSafeAppPath,
  MAX_CHANNEL,
  MAX_LAYOUTS,
  PROTOCOL_VERSION,
  validateEnvelopeScope,
  validateInbound,
} from "./protocol.js"
export type {
  MaxAppProps,
  MaxChatProps,
  MaxLauncherProps,
  MaxTheme,
} from "./types.js"
