import type { AgentCard } from "@voyant-travel/max-cards"
import type { z } from "zod"

/**
 * How risky a tool is. Voyant uses this to decide whether a call runs
 * automatically (`read`), is allowed with light guarding (`routine-write`), or
 * needs explicit user approval before it executes (`destructive`).
 */
export type ToolTier = "read" | "routine-write" | "destructive"

/** A worked example that helps the model call the tool with the right args. */
export type ToolExample = {
  /** Something a user might say that should trigger this tool. */
  userMessage: string
  /** The arguments the model should produce for that message. */
  args: Record<string, unknown>
  /** Optional note explaining the example. */
  notes?: string
}

/**
 * Context Voyant sends with every tool call. Use it to scope the work to the
 * calling operator / organization / end user. These ids come from Voyant — your
 * webhook never has to supply them.
 */
export type ToolCallContext = {
  /** The tool being invoked. */
  toolName: string
  operatorId: string
  organizationId: string
  userId: string
}

/**
 * Return this from a handler (via {@link file}) to hand back a downloadable
 * file — a generated PDF, an export, an image — instead of a JSON payload. Set
 * the tool's `outputKind: "file"` so Voyant renders it as an attachment.
 */
export type ToolFileResult = {
  type: "file"
  label: string
  filename: string
  mediaType: string
  downloadUrl: string
  expiresAt?: string
}

/**
 * A plain JSON result optionally carrying a rich {@link AgentCard} that renders
 * as a widget in the Max chat. Attach a card by returning `{ ...data, card }`.
 */
export type WithCard<T extends Record<string, unknown> = Record<string, unknown>> = T & {
  card?: AgentCard
}

export type ToolHandler<TInput> = (args: TInput, ctx: ToolCallContext) => unknown | Promise<unknown>

export type ToolConfig<TSchema extends z.ZodType> = {
  /** Unique name. Letters, digits, `_` and `-` only. */
  name: string
  /** What the tool does — shown to the model to decide when to call it. */
  description: string
  /** Zod schema for the tool's arguments. Doubles as runtime validation. */
  input: TSchema
  /** Defaults to `read`. */
  tier?: ToolTier
  /** Voyant capability scopes the caller must hold to use the tool. */
  requiredScopes?: readonly string[]
  /** Short hints that nudge the model toward correct usage. */
  usageHints?: readonly string[]
  /** Worked examples (user message -> args). */
  examples?: readonly ToolExample[]
  /** `json` (default) or `file` when the handler returns a {@link ToolFileResult}. */
  outputKind?: "json" | "file"
  /** Runs when the tool is called. Receives validated args + call context. */
  handler: ToolHandler<z.infer<TSchema>>
}

export type MaxTool<TSchema extends z.ZodType = z.ZodType> = ToolConfig<TSchema>

/**
 * The wire shape of a single tool in the manifest Voyant stores for an
 * operator. Produced by {@link toToolDefinition}; you rarely build it by hand.
 */
export type RemoteToolDefinition = {
  name: string
  description: string
  usageHints?: readonly string[]
  examples?: readonly ToolExample[]
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  outputKind?: "json" | "file"
  tier: ToolTier
  requiredScopes: readonly string[]
}

/**
 * The manifest you register with Voyant so Max knows your tools exist and where
 * to call them. Produced by {@link toManifest}.
 */
export type RemoteToolsConfig = {
  version: string
  /** Base URL Voyant calls; tools are invoked at `{callBaseUrl}/v1/max/tools/{name}/call`. */
  callBaseUrl?: string
  /** Header Voyant sends the auth token in. Defaults to `Authorization`. */
  authHeaderName?: string
  /** Secret Voyant presents to your webhook. Stored encrypted by Voyant. */
  authToken?: string
  tools: RemoteToolDefinition[]
}
