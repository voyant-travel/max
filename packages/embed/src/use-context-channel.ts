import { type RefObject, useEffect, useRef } from "react"

import { type MaxHostContext, normalizeHostContext } from "./context.js"
import { createEnvelope, type MaxSessionScope, ReplayGuard, validateInbound } from "./protocol.js"

/**
 * Push the host context into the iframe and react to the iframe's context
 * requests — without ever remounting the iframe (so chat state survives host
 * navigation).
 *
 * - **host → iframe**: whenever the `context` prop changes to a new entity/version
 *   we `postMessage` `max:setContext`. `null` is an explicit *clear* (distinct
 *   from "no context yet"). The context also re-flows on iframe `load`, so a
 *   fresh content window picks up the current selection.
 * - **iframe → host**: `max:requestContext` (iframe asking for the current
 *   selection, e.g. after boot) triggers a re-send; `max:clearContext` (the user
 *   pressed *clear* inside the iframe) invokes `onContextClear` so the host can
 *   drop its own selection state, and echoes a `max:setContext(null)`.
 *
 * The context is normalised before it ever leaves the page — a bad entity type
 * or shape is dropped, never forwarded. See {@link normalizeHostContext}.
 */
export function useContextChannel({
  iframeRef,
  origin,
  scope,
  context,
  onContextClear,
  onContextRequest,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>
  origin: string
  scope: MaxSessionScope
  context?: MaxHostContext | null
  onContextClear?: () => void
  onContextRequest?: () => void
}) {
  // Normalise once per render; `null` is a real value (explicit clear) while
  // `undefined` means "host supplies no context at all".
  const normalized = context === undefined ? undefined : normalizeHostContext(context)
  const signature = contextSignature(normalized)

  // Signature of the last context we actually sent — dedupes re-renders that
  // don't change the meaningful content.
  const lastSentSig = useRef<string | undefined>(undefined)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const clearRef = useRef(onContextClear)
  clearRef.current = onContextClear
  const requestRef = useRef(onContextRequest)
  requestRef.current = onContextRequest
  const normalizedRef = useRef(normalized)
  normalizedRef.current = normalized

  function post(payload: Record<string, unknown> & { type: "max:setContext" }) {
    const target = iframeRef.current?.contentWindow
    if (!target) return
    try {
      target.postMessage(createEnvelope(scopeRef.current, payload.type, payload), origin)
    } catch {
      /* iframe might have navigated */
    }
  }

  function sendContext(ctx: MaxHostContext | null) {
    post({ type: "max:setContext", context: ctx })
    lastSentSig.current = contextSignature(ctx)
  }

  // Host → iframe: send whenever the meaningful content changes (deduped by
  // signature so unrelated re-renders don't spam the iframe).
  useEffect(() => {
    if (normalized === undefined) return
    if (lastSentSig.current === signature) return
    sendContext(normalized)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Re-push current context when the iframe (re)loads.
  useEffect(() => {
    const node = iframeRef.current
    if (!node) return
    const onLoad = () => {
      const cur = normalizedRef.current
      if (cur !== undefined) sendContext(cur)
    }
    node.addEventListener("load", onLoad)
    return () => node.removeEventListener("load", onLoad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // iframe → host: requestContext / clearContext.
  useEffect(() => {
    const guard = new ReplayGuard()
    const onMessage = (event: MessageEvent) => {
      const result = validateInbound(event, {
        expectedOrigin: origin,
        expectedSource: iframeRef.current?.contentWindow,
        scope: scopeRef.current,
        replay: guard,
      })
      if (!result.ok) return
      const { message } = result
      if (message.type === "max:requestContext") {
        requestRef.current?.()
        const cur = normalizedRef.current
        if (cur !== undefined) sendContext(cur)
      } else if (message.type === "max:clearContext") {
        clearRef.current?.()
        sendContext(null)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin])
}

/** Stable string identity of a context for change detection. `undefined` → `""`. */
function contextSignature(ctx: MaxHostContext | null | undefined): string {
  if (ctx === undefined) return ""
  if (ctx === null) return "null"
  return JSON.stringify([
    ctx.type,
    ctx.id,
    ctx.version ?? null,
    ctx.label,
    ctx.route ?? null,
    ctx.subView ?? null,
  ])
}
