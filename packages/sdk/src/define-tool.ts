import type { z } from "zod"

import type { MaxTool, ToolConfig, ToolFileResult } from "./types.js"

const TOOL_NAME_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Define a custom Max tool: a name + description the model reasons over, a Zod
 * schema for its arguments, and a handler that does the work. The schema is the
 * single source of truth — it generates the JSON Schema in the manifest and
 * validates incoming args at call time.
 *
 * @example
 * ```ts
 * import { defineTool } from "@voyant-travel/max-sdk"
 * import { z } from "zod"
 *
 * export const lookupBooking = defineTool({
 *   name: "acme_lookup_booking",
 *   description: "Look up a booking by its reference.",
 *   tier: "read",
 *   input: z.object({ reference: z.string().describe("Booking reference, e.g. AC-1234") }),
 *   handler: async ({ reference }, ctx) => {
 *     const booking = await db.bookings.find(reference, ctx.organizationId)
 *     return booking ?? { notFound: true }
 *   },
 * })
 * ```
 */
export function defineTool<TSchema extends z.ZodType>(
  config: ToolConfig<TSchema>,
): MaxTool<TSchema> {
  if (!TOOL_NAME_RE.test(config.name)) {
    throw new Error(`Invalid Max tool name "${config.name}": use only letters, digits, "_" or "-".`)
  }
  return config
}

/**
 * Build a file result to return from a handler whose tool sets
 * `outputKind: "file"`. Voyant renders it as a downloadable attachment.
 */
export function file(input: Omit<ToolFileResult, "type">): ToolFileResult {
  return { type: "file", ...input }
}
