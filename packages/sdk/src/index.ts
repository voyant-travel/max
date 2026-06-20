// Re-export the generative-UI card contract so tools can attach rich widgets
// to their results without a second dependency.
export {
  type AgentCard,
  type AgentCardKind,
  type Block,
  extractCard,
  parseCard,
} from "@voyant-travel/max-cards"
export { defineTool, file } from "./define-tool.js"
export { type CreateHandlerOptions, createMaxToolsHandler } from "./handler.js"
export { type ManifestOptions, toManifest, toToolDefinition } from "./manifest.js"
export type {
  MaxTool,
  RemoteToolDefinition,
  RemoteToolsConfig,
  ToolCallContext,
  ToolConfig,
  ToolExample,
  ToolFileResult,
  ToolHandler,
  ToolTier,
  WithCard,
} from "./types.js"
