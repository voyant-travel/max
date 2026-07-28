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
  mounted = true,
  onContextClear,
  onContextRequest,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>
  origin: string
  scope: MaxSessionScope
  context?: MaxHostContext | null
  /**
   * Whether the iframe element is currently in the DOM. `MaxLauncher` mounts its
   * iframe lazily on first open, so the `load` listener must (re)attach when this
   * flips true — otherwise the initial context is never delivered to a launcher
   * that was opened after mount. Defaults to `true` (always-mounted iframes).
   */
  mounted?: boolean
  onContextClear?: () => void
  onContextRequest?: () => void
}) {
  // Normalise once per render; `null` is a real value (explicit clear) while
  // `undefined` means "host supplies no context at all".
  const normalized =
    context === undefined || context === null
      ? context
      : (normalizeHostContext(context) ?? undefined)
  const signature = contextSignature(normalized)

  // Signature of the last context we actually sent — dedupes re-renders that
  // don't change the meaningful content.
  const lastSentSig = useRef<string | undefined>(undefined)
  const scopeGeneration = `${origin}\u0000${scope.sessionId}\u0000${scope.tenant ?? ""}\u0000${scope.audience ?? ""}`
  const activeGeneration = useRef(scopeGeneration)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const clearRef = useRef(onContextClear)
  clearRef.current = onContextClear
  const requestRef = useRef(onContextRequest)
  requestRef.current = onContextRequest
  const normalizedRef = useRef(normalized)
  normalizedRef.current = normalized
  // Whether the iframe has loaded at least once. Before first load the content
  // window is still `about:blank` (the host's own origin), so posting the initial
  // context there would only trip a cross-origin "target origin does not match"
  // warning and reach nothing. We defer the *first* delivery to the `load`
  // handler; only *subsequent* changes post eagerly.
  const hasLoaded = useRef(false)
  // Credentials/scope changes navigate the iframe to a new document. Reset
  // synchronously during render so the context-change effect cannot send the
  // new scope/context into the previous document before that navigation loads.
  if (activeGeneration.current !== scopeGeneration) {
    activeGeneration.current = scopeGeneration
    hasLoaded.current = false
    lastSentSig.current = undefined
  }

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
  // signature so unrelated re-renders don't spam the iframe). The *first*
  // delivery is deferred to the `load` handler below — before load there is no
  // real content window to receive it.
  useEffect(() => {
    if (normalized === undefined) return
    if (!hasLoaded.current) return
    if (lastSentSig.current === signature) return
    sendContext(normalized)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Deliver the current context when the iframe first (or re-)loads. Re-runs when
  // `mounted` flips true so a lazily-mounted launcher iframe gets a listener; the
  // Each `load` event is a new document generation. Browsers retain the same
  // `contentWindow` object across navigations, so window identity cannot dedupe
  // loads without also starving a freshly navigated document. This is what
  // makes the initial context arrive *without* the iframe having to send
  // `max:requestContext`.
  useEffect(() => {
    const node = iframeRef.current
    if (!node) return
    const onLoad = () => {
      hasLoaded.current = true
      const cur = normalizedRef.current
      if (cur === undefined) return
      sendContext(cur)
    }
    node.addEventListener("load", onLoad)
    return () => node.removeEventListener("load", onLoad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, scopeGeneration])

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
  }, [origin, scopeGeneration])
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
    ctx.capturedAt ?? null,
    ctx.meta ?? null,
  ])
}
