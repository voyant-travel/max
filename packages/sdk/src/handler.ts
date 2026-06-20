import type { MaxTool, ToolCallContext } from "./types.js"

export type CreateHandlerOptions = {
  /**
   * Shared secret Voyant presents (matched against a `Bearer <token>`
   * Authorization header). The simplest way to authenticate calls.
   */
  authToken?: string
  /**
   * Full control over auth. Return `false` (or throw) to reject the request
   * with 401. Runs after the `authToken` check when both are set.
   */
  verifyRequest?: (request: Request) => boolean | Promise<boolean>
}

/**
 * Build a framework-agnostic request handler for your tools. It speaks the Web
 * Fetch `Request`/`Response` API, so it drops into Cloudflare Workers, Hono,
 * Next.js route handlers, Deno, Bun, or anything with an adapter.
 *
 * Mount it so it receives `POST /v1/max/tools/:name/call`. It authenticates the
 * request, validates the args against the tool's schema, runs the handler, and
 * returns the result as JSON.
 *
 * @example
 * ```ts
 * const handler = createMaxToolsHandler([lookupBooking, createQuote], {
 *   authToken: process.env.MAX_TOOLS_SECRET,
 * })
 * export default { fetch: handler } // Cloudflare Worker
 * ```
 */
export function createMaxToolsHandler(
  tools: readonly MaxTool[],
  options: CreateHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  return async (request) => {
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405)
    }

    if (options.authToken) {
      const auth = request.headers.get("authorization") ?? ""
      if (auth !== `Bearer ${options.authToken}`) {
        return json({ error: "unauthorized" }, 401)
      }
    }
    if (options.verifyRequest) {
      let ok = false
      try {
        ok = await options.verifyRequest(request)
      } catch {
        ok = false
      }
      if (!ok) return json({ error: "unauthorized" }, 401)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return json({ error: "invalid_json" }, 400)
    }

    const toolName = toolNameFromPath(request.url) ?? readString(body, "toolName")
    if (!toolName) return json({ error: "missing_tool_name" }, 400)

    const tool = byName.get(toolName)
    if (!tool) return json({ error: "unknown_tool", toolName }, 404)

    const parsed = tool.input.safeParse(readArgs(body))
    if (!parsed.success) {
      return json({ error: "invalid_args", issues: parsed.error.issues }, 422)
    }

    const ctx: ToolCallContext = {
      toolName,
      operatorId: readContext(body, "operatorId"),
      organizationId: readContext(body, "organizationId"),
      userId: readContext(body, "userId"),
    }

    try {
      const result = await tool.handler(parsed.data, ctx)
      return json(result ?? {}, 200)
    } catch (error) {
      return json(
        {
          error: "tool_failed",
          message: error instanceof Error ? error.message : String(error),
        },
        500,
      )
    }
  }
}

function toolNameFromPath(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/tools\/([^/]+)\/call\/?$/)
    return match?.[1] ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(body: unknown, key: string): string | null {
  if (!isRecord(body)) return null
  const value = body[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function readArgs(body: unknown): unknown {
  return isRecord(body) ? (body.args ?? {}) : {}
}

function readContext(body: unknown, key: string): string {
  if (!isRecord(body) || !isRecord(body.context)) return ""
  const value = body.context[key]
  return typeof value === "string" ? value : ""
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  })
}
