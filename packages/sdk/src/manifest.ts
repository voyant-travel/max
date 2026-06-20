import { z } from "zod"

import type { MaxTool, RemoteToolDefinition, RemoteToolsConfig } from "./types.js"

/** Convert a single tool into its manifest (wire) definition. */
export function toToolDefinition(tool: MaxTool): RemoteToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    ...(tool.usageHints ? { usageHints: tool.usageHints } : {}),
    ...(tool.examples ? { examples: tool.examples } : {}),
    inputSchema: jsonSchema(tool.input),
    ...(tool.outputKind ? { outputKind: tool.outputKind } : {}),
    tier: tool.tier ?? "read",
    requiredScopes: tool.requiredScopes ?? [],
  }
}

export type ManifestOptions = {
  /** Manifest version string. Defaults to `"1"`. */
  version?: string
  /** Public base URL Voyant should call your tools at. */
  callBaseUrl?: string
  /** Header Voyant sends the auth token in. Defaults to `Authorization`. */
  authHeaderName?: string
}

/**
 * Build the manifest you register with Voyant from a set of tools. Each tool's
 * Zod schema is converted to JSON Schema for the model.
 *
 * @example
 * ```ts
 * const manifest = toManifest([lookupBooking, createQuote], {
 *   callBaseUrl: "https://acme.example.com",
 * })
 * // -> register `manifest` with Voyant for your operator
 * ```
 */
export function toManifest(
  tools: readonly MaxTool[],
  options: ManifestOptions = {},
): RemoteToolsConfig {
  return {
    version: options.version ?? "1",
    ...(options.callBaseUrl ? { callBaseUrl: options.callBaseUrl } : {}),
    ...(options.authHeaderName ? { authHeaderName: options.authHeaderName } : {}),
    tools: tools.map(toToolDefinition),
  }
}

/** Zod -> JSON Schema, stripped of the `$schema` preamble. */
function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>
  delete out.$schema
  return out
}
