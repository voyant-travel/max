// The generative-UI card contract — optional. Tools can attach a `card` to
// their result to render a rich widget instead of plain JSON.
export {
  type AgentCard,
  type AgentCardKind,
  type Block,
  extractCard,
  parseCard,
} from "./cards.js"
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
