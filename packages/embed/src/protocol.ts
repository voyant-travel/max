/**
 * The public `postMessage` protocol between the host page and the Max iframe.
 *
 * This module is framework-agnostic (no React) so it can be unit-tested in
 * isolation and reused by both the React components and the `<script>` loader.
 * It owns the wire format and — critically — the *inbound validation* that keeps
 * the channel tenant-safe and replay-resistant.
 *
 * ## Threat model & checks
 *
 * A `message` event reaching the host can come from anywhere: another tab on the
 * embed origin, a nested frame, a stale/replayed message, or a page pretending
 * to be Max. Every inbound message is gated by, in order:
 *
 *  1. **origin** — `event.origin` must equal the configured embed origin exactly.
 *     No `"*"`, no substring/suffix matching, no protocol-relative slack.
 *  2. **source** — `event.source` must be *our* iframe's `contentWindow`. This is
 *     what stops a same-origin sibling tab/frame from driving this launcher
 *     (cross-tab replay): the browser sets `source` and it can't be forged.
 *  3. **shape** — a known message `type`; anything else is dropped.
 *
 * Messages that opt into the versioned *envelope* (everything the current embed
 * and the fixture/updated iframe send) are additionally gated by:
 *
 *  4. **protocol version** — `v` must match {@link PROTOCOL_VERSION}.
 *  5. **session identity** — `sessionId` must equal this mount's id. A different
 *     mount / a captured older session is rejected (cross-session replay).
 *  6. **tenant / audience scope** — when configured, must match exactly.
 *  7. **replay / freshness** — a per-window {@link ReplayGuard} drops duplicate
 *     `msgId`s and messages whose `ts` is outside the freshness window.
 *  8. **entity type** — any context payload is re-normalised; a bad entity type
 *     is rejected, never applied.
 *
 * Legacy un-enveloped control messages (`max:close`, `max:setLayout`,
 * `max:navigate`, `max:ready`) from already-deployed iframes are still accepted,
 * but *only* after passing the origin + source checks (1–3). They can never
 * carry a context, so the tenant-sensitive surface is always fully validated.
 */

import { type MaxHostContext, normalizeHostContext } from "./context.js"

/** Bumped only on a breaking change to the wire format. */
export const PROTOCOL_VERSION = 1

/** Discriminator that marks an enveloped Max message. */
export const MAX_CHANNEL = "max" as const

/** Default freshness window for enveloped messages (ms). */
export const DEFAULT_FRESHNESS_MS = 30_000

/** Upper bound on a `msgId` we're willing to remember (defence against a
 *  megabyte string blowing up the replay set). Must be non-empty. */
export const MAX_MSGID_LEN = 200

/** Upper bound on an app-relative navigation path. */
export const MAX_PATH_LEN = 2048

/** Session/tenant scope this mount enforces on every enveloped message. */
export type MaxSessionScope = {
  /** Per-mount opaque id. Both sides echo it; a mismatch is rejected. */
  sessionId: string
  /** Tenant the embed token is scoped to. When set, enforced on inbound. */
  tenant?: string | null
  /** Audience/surface the token targets. When set, enforced on inbound. */
  audience?: string | null
}

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

/** Layouts the launcher panel can occupy. */
export type MaxLayout = "normal" | "wide" | "expanded"

export const MAX_LAYOUTS: readonly MaxLayout[] = ["normal", "wide", "expanded"]

export function isMaxLayout(value: unknown): value is MaxLayout {
  return value === "normal" || value === "wide" || value === "expanded"
}

/**
 * A navigation/route path is only accepted when it is a *safe, app-relative
 * absolute path*. This is the sole sink for iframe-supplied paths (they get
 * replayed into `history.pushState`), so it must reject anything a browser might
 * resolve to a foreign document:
 *
 *  - must begin with a single `/` (app-relative absolute — no scheme, no bare
 *    relative segment);
 *  - not `//host` / `/\host` (protocol-relative — browsers treat both as an
 *    absolute URL to another origin);
 *  - no backslashes (normalised to `/` by browsers, used to smuggle `//`);
 *  - no control characters (tab/newline/NUL are stripped by URL parsing and can
 *    hide a scheme or host);
 *  - no `..` traversal segments, raw or percent-encoded;
 *  - valid percent-encoding (a malformed `%` sequence is rejected outright);
 *  - within a sane length bound.
 */
export function isSafeAppPath(value: unknown): value is string {
  if (typeof value !== "string") return false
  if (value.length === 0 || value.length > MAX_PATH_LEN) return false
  if (value.charCodeAt(0) !== 47 /* "/" */) return false
  if (value.charCodeAt(1) === 47 /* "//" protocol-relative */) return false
  if (value.includes("\\")) return false
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    if (c <= 0x1f || c === 0x7f) return false // control chars
  }
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false // malformed percent-encoding
  }
  if (decoded.includes("\\")) return false
  if (decoded.charCodeAt(0) === 47 && decoded.charCodeAt(1) === 47) return false
  for (let i = 0; i < decoded.length; i++) {
    const c = decoded.charCodeAt(i)
    if (c <= 0x1f || c === 0x7f) return false
  }
  for (const seg of decoded.split("/")) {
    if (seg === "..") return false
  }
  return true
}

/** Outbound message types (host → iframe). */
export type MaxOutboundType =
  | "max:setTheme"
  | "max:setLang"
  | "max:setRoute"
  | "max:setContext"
  | "max:setLayout"

/** Inbound message types (iframe → host). */
export type MaxInboundType =
  | "max:ready"
  | "max:close"
  | "max:navigate"
  | "max:requestLayout"
  | "max:setLayout"
  | "max:requestContext"
  | "max:clearContext"

const INBOUND_TYPES = new Set<MaxInboundType>([
  "max:ready",
  "max:close",
  "max:navigate",
  "max:requestLayout",
  "max:setLayout",
  "max:requestContext",
  "max:clearContext",
])

/** The un-enveloped control messages we still honour from legacy iframes. */
const LEGACY_INBOUND_TYPES = new Set<MaxInboundType>([
  "max:ready",
  "max:close",
  "max:navigate",
  "max:setLayout",
])

/** Envelope fields present on every non-legacy message. */
export type MaxEnvelope = {
  channel: typeof MAX_CHANNEL
  v: number
  sessionId: string
  tenant?: string | null
  audience?: string | null
  msgId: string
  ts: number
}

export type MaxInboundMessage = MaxEnvelope & {
  type: MaxInboundType
  path?: string
  layout?: MaxLayout
  context?: MaxHostContext | null
}

// ---------------------------------------------------------------------------
// Envelope creation (outbound)
// ---------------------------------------------------------------------------

let msgCounter = 0

/** Cryptographically-random id where available, with a deterministic fallback. */
function randomId(): string {
  try {
    const c = (globalThis as { crypto?: Crypto }).crypto
    if (c && typeof c.randomUUID === "function") return c.randomUUID()
    if (c && typeof c.getRandomValues === "function") {
      const b = new Uint8Array(16)
      c.getRandomValues(b)
      return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
    }
  } catch {
    /* fall through */
  }
  msgCounter = (msgCounter + 1) % Number.MAX_SAFE_INTEGER
  return `m${msgCounter}-${now()}`
}

function now(): number {
  try {
    return Date.now()
  } catch {
    return 0
  }
}

/** A fresh session id for a mount. */
export function createSessionId(): string {
  return randomId()
}

/**
 * Build an enveloped outbound message. The extra fields (`theme`, `lang`,
 * `path`, `context`, `layout`) are merged in verbatim so the wire shape stays
 * backwards compatible with existing un-enveloped consumers — they read `type` +
 * their payload key and ignore the envelope.
 */
export function createEnvelope(
  scope: MaxSessionScope,
  type: MaxOutboundType,
  payload: Record<string, unknown> = {},
): MaxEnvelope & { type: MaxOutboundType } & Record<string, unknown> {
  return {
    channel: MAX_CHANNEL,
    v: PROTOCOL_VERSION,
    sessionId: scope.sessionId,
    tenant: scope.tenant ?? null,
    audience: scope.audience ?? null,
    msgId: randomId(),
    ts: now(),
    type,
    ...payload,
  }
}

// ---------------------------------------------------------------------------
// Replay guard
// ---------------------------------------------------------------------------

/**
 * Bounded FIFO of seen `msgId`s plus a freshness window. Rejects any message
 * whose id was seen before (replay) or whose timestamp is outside
 * `[now - freshnessMs, now + freshnessMs]` (stale capture / clock-skew abuse).
 */
export class ReplayGuard {
  private readonly seen = new Set<string>()
  private readonly order: string[] = []
  constructor(
    private readonly max = 256,
    private readonly freshnessMs = DEFAULT_FRESHNESS_MS,
  ) {}

  /** Returns `true` and records the id when the message is fresh & unseen. */
  accept(msgId: string, ts: number, at: number = now()): boolean {
    if (typeof msgId !== "string" || msgId.length === 0 || msgId.length > MAX_MSGID_LEN)
      return false
    if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return false
    // Reject stale or future-dated messages. There is deliberately no zero-clock
    // escape hatch: an envelope without a real positive timestamp is untrusted.
    if (!Number.isFinite(at) || at <= 0 || Math.abs(at - ts) > this.freshnessMs) return false
    if (this.seen.has(msgId)) return false
    this.seen.add(msgId)
    this.order.push(msgId)
    if (this.order.length > this.max) {
      const evicted = this.order.shift()
      if (evicted !== undefined) this.seen.delete(evicted)
    }
    return true
  }
}

// ---------------------------------------------------------------------------
// Inbound validation
// ---------------------------------------------------------------------------

export type ValidateOptions = {
  /** Exact origin the iframe is served from. */
  expectedOrigin: string
  /** Our iframe's `contentWindow`. When present, `event.source` must equal it. */
  expectedSource: Window | null | undefined
  /** Session/tenant scope to enforce on enveloped messages. */
  scope: MaxSessionScope
  /** Shared replay guard for this window. */
  replay?: ReplayGuard
  /** Clock for freshness checks (injectable for tests). */
  at?: number
}

export type ValidateResult =
  | { ok: true; message: MaxInboundMessage; legacy: boolean }
  | { ok: false; reason: ValidateFailure }

export type ValidateFailure =
  | "origin-mismatch"
  | "source-mismatch"
  | "not-object"
  | "unknown-type"
  | "version-mismatch"
  | "session-mismatch"
  | "tenant-mismatch"
  | "audience-mismatch"
  | "bad-msgid"
  | "stale-ts"
  | "replay"
  | "bad-context"
  | "bad-path"
  | "bad-layout"

/** Scope-field failures shared by every enveloped-message validator. */
export type EnvelopeScopeFailure =
  | "version-mismatch"
  | "session-mismatch"
  | "tenant-mismatch"
  | "audience-mismatch"

/**
 * Validate the versioned envelope's scope fields (`v`, `sessionId`,
 * `tenant`, `audience`) against this mount's scope. Shared by
 * {@link validateInbound} (host side) and the receiver-side state machine so the
 * tenant/session/version gate is defined in exactly one place.
 */
export function validateEnvelopeScope(
  raw: Record<string, unknown>,
  scope: MaxSessionScope,
): EnvelopeScopeFailure | null {
  if (raw.v !== PROTOCOL_VERSION) return "version-mismatch"
  if (raw.sessionId !== scope.sessionId) return "session-mismatch"
  if (scope.tenant != null && (raw.tenant ?? null) !== scope.tenant) return "tenant-mismatch"
  if (scope.audience != null && (raw.audience ?? null) !== scope.audience)
    return "audience-mismatch"
  return null
}

/**
 * Strict per-`type` payload validation, shared by the legacy and enveloped
 * paths. A message whose payload doesn't match its type exactly is rejected —
 * never silently coerced. Context payloads are handled by the caller (they only
 * ride the enveloped path).
 */
function validatePayload(
  type: MaxInboundType,
  raw: Record<string, unknown>,
): { ok: true; path?: string; layout?: MaxLayout } | { ok: false; reason: ValidateFailure } {
  switch (type) {
    case "max:navigate": {
      if (!isSafeAppPath(raw.path)) return { ok: false, reason: "bad-path" }
      return { ok: true, path: raw.path }
    }
    case "max:requestLayout":
    case "max:setLayout": {
      if (!isMaxLayout(raw.layout)) return { ok: false, reason: "bad-layout" }
      return { ok: true, layout: raw.layout }
    }
    default:
      return { ok: true }
  }
}

/**
 * Validate a raw `MessageEvent` against the protocol. Pure and total: returns a
 * discriminated result rather than throwing, so callers can branch (and tests
 * can assert the exact failure reason).
 */
export function validateInbound(
  event: Pick<MessageEvent, "origin" | "source" | "data">,
  opts: ValidateOptions,
): ValidateResult {
  // (1) origin — exact match only.
  if (event.origin !== opts.expectedOrigin) return { ok: false, reason: "origin-mismatch" }

  // (2) source — must be our iframe. Blocks cross-tab / cross-frame injection.
  // If we don't yet have a contentWindow (iframe not mounted) we can't trust
  // any source, so reject.
  if (!opts.expectedSource || event.source !== opts.expectedSource)
    return { ok: false, reason: "source-mismatch" }

  const data = event.data
  if (!data || typeof data !== "object") return { ok: false, reason: "not-object" }
  const raw = data as Record<string, unknown>

  const type = raw.type
  if (typeof type !== "string" || !INBOUND_TYPES.has(type as MaxInboundType))
    return { ok: false, reason: "unknown-type" }
  const inboundType = type as MaxInboundType

  const enveloped = raw.channel === MAX_CHANNEL

  if (!enveloped) {
    // Legacy path: only the small control set, only after origin+source passed.
    if (!LEGACY_INBOUND_TYPES.has(inboundType)) return { ok: false, reason: "unknown-type" }
    // Payloads are still validated strictly — a legacy `max:navigate` with an
    // unsafe path or a `max:setLayout` with a bogus layout is dropped.
    const payload = validatePayload(inboundType, raw)
    if (!payload.ok) return payload
    const legacyMsg: MaxInboundMessage = {
      channel: MAX_CHANNEL,
      v: PROTOCOL_VERSION,
      sessionId: opts.scope.sessionId,
      tenant: opts.scope.tenant ?? null,
      audience: opts.scope.audience ?? null,
      msgId: "",
      ts: 0,
      type: inboundType,
    }
    if (payload.path !== undefined) legacyMsg.path = payload.path
    if (payload.layout !== undefined) legacyMsg.layout = payload.layout
    return { ok: true, message: legacyMsg, legacy: true }
  }

  // (4–6) version / session / tenant / audience — shared scope gate.
  const scopeFailure = validateEnvelopeScope(raw, opts.scope)
  if (scopeFailure) return { ok: false, reason: scopeFailure }

  // (7) identity + freshness are mandatory for every enveloped message, even
  // when a caller does not supply a replay cache.
  const msgId = raw.msgId
  if (typeof msgId !== "string" || msgId.length === 0 || msgId.length > MAX_MSGID_LEN)
    return { ok: false, reason: "bad-msgid" }
  const ts = raw.ts
  const at = opts.at ?? now()
  if (
    typeof ts !== "number" ||
    !Number.isFinite(ts) ||
    ts <= 0 ||
    !Number.isFinite(at) ||
    at <= 0 ||
    Math.abs(at - ts) > DEFAULT_FRESHNESS_MS
  )
    return { ok: false, reason: "stale-ts" }

  // A supplied cache additionally enforces duplicate detection and can use a
  // narrower caller-selected freshness window.
  if (opts.replay) {
    if (!opts.replay.accept(msgId, ts, at)) return { ok: false, reason: "replay" }
  }

  // strict per-type payload validation
  const payload = validatePayload(inboundType, raw)
  if (!payload.ok) return payload

  const message: MaxInboundMessage = {
    channel: MAX_CHANNEL,
    v: PROTOCOL_VERSION,
    sessionId: opts.scope.sessionId,
    tenant: opts.scope.tenant ?? null,
    audience: opts.scope.audience ?? null,
    msgId: typeof raw.msgId === "string" ? raw.msgId : "",
    ts: typeof raw.ts === "number" ? raw.ts : 0,
    type: inboundType,
  }

  if (payload.path !== undefined) message.path = payload.path
  if (payload.layout !== undefined) message.layout = payload.layout

  // (8) entity type — any attached context is re-normalised or rejected.
  if ("context" in raw) {
    if (raw.context === null) {
      message.context = null
    } else {
      const ctx = normalizeHostContext(raw.context)
      if (!ctx) return { ok: false, reason: "bad-context" }
      message.context = ctx
    }
  }

  return { ok: true, message, legacy: false }
}
