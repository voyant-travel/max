/**
 * Receiver-side host-context state machine.
 *
 * The host→iframe side of the protocol streams `max:setContext` envelopes at the
 * embedded Max app. This module is the *portable contract* for the receiving
 * end: a framework-agnostic, dependency-free state machine that turns that
 * untrusted stream into an ordered, replay-resistant, verified snapshot the UI
 * can render. It is the mirror image of {@link validateInbound} (which guards the
 * host against the iframe) and reuses the very same validators
 * ({@link validateEnvelopeScope}, {@link normalizeHostContext},
 * {@link isContextOutOfOrder}).
 *
 * It does **not** persist anything, resolve entities against a backend, or render
 * UI — those live in the platform (see platform#1515) and are not part of this
 * package. What ships here is the wire-level contract + ordering/verification
 * state machine only.
 *
 * ## What every ingested message is gated by
 *
 *  1. **origin** — `event.origin` must equal the configured host origin exactly.
 *  2. **source** — when a source is configured, `event.source` must equal it
 *     (the iframe's `window.parent`). Blocks a sibling frame/tab from driving it.
 *  3. **channel / version** — `channel === "max"` and `v === 1`.
 *  4. **type + payload shape** — only `max:setContext`, whose `context` is a
 *     valid entity (re-normalised) or an explicit `null` clear.
 *  5. **session / tenant / audience** — exact scope match.
 *  6. **freshness** — `ts` must be a *finite, strictly-positive* number within the
 *     freshness window. `ts === 0` never bypasses the check.
 *  7. **msgId** — a bounded, non-empty string; duplicates are dropped (replay).
 *  8. **ordering** — a lower `version` (same entity) or older `capturedAt` is
 *     rejected as out-of-order; when neither is comparable the envelope `ts`
 *     is the fallback. The same revision is an idempotent no-op.
 *
 * ## Security invariant (discovery-only)
 *
 * The optional {@link MaxContextVerifier} resolves the *display* status of a
 * context (is it still live / archived / deleted / visible to this viewer). It is
 * **not** an authorization gate: an `active` snapshot never grants Max permission
 * to act. Every action is still re-verified server-side against the session's own
 * credentials — see {@link CONTEXT_SECURITY_INVARIANT}. Do not repurpose the
 * verifier to skip a read check, approval, or consequence preview.
 */

import {
  CONTEXT_SECURITY_INVARIANT,
  isContextOutOfOrder,
  isSameContext,
  type MaxHostContext,
  normalizeHostContext,
  parseContextTimestamp,
} from "./context.js"
import {
  DEFAULT_FRESHNESS_MS,
  MAX_CHANNEL,
  MAX_MSGID_LEN,
  type MaxSessionScope,
  validateEnvelopeScope,
} from "./protocol.js"

export { CONTEXT_SECURITY_INVARIANT }

/** Degraded reasons a verifier can attach to a context that no longer resolves. */
export type MaxContextDegradedReason = "deleted" | "archived" | "unauthorized"

/**
 * Verifier resolution. `ok: true` keeps the context `active`; `ok: false` marks
 * it `stale` (superseded but still valid) or `degraded` with a concrete reason.
 * The resolution governs *display only* — never authorization.
 */
export type MaxContextResolution =
  | { ok: true }
  | { ok: false; reason: "stale" | MaxContextDegradedReason }

/** Injectable, sync-or-async verifier. Resolves display status, not authorization. */
export type MaxContextVerifier = (
  context: MaxHostContext,
) => MaxContextResolution | Promise<MaxContextResolution>

/**
 * The receiver's current snapshot. `empty` is the pristine state (nothing
 * received yet); `cleared` is an explicit host clear. `active`/`stale`/`degraded`
 * carry the pinned context verbatim — a degraded status never drops or rewrites
 * the context, so the UI can still show *what* the conversation was about.
 */
export type MaxContextSnapshot =
  | { status: "empty"; context: null }
  | { status: "cleared"; context: null }
  | { status: "active"; context: MaxHostContext }
  | { status: "stale"; context: MaxHostContext }
  | { status: "degraded"; context: MaxHostContext; reason: MaxContextDegradedReason }

export type MaxContextReceiverReason =
  | "origin-mismatch"
  | "source-mismatch"
  | "not-object"
  | "channel-mismatch"
  | "unknown-type"
  | "version-mismatch"
  | "session-mismatch"
  | "tenant-mismatch"
  | "audience-mismatch"
  | "bad-msgid"
  | "stale-ts"
  | "replay"
  | "bad-context"
  | "bad-payload"
  | "out-of-order"
  | "superseded"

export type MaxContextIngestResult =
  | { ok: true; snapshot: MaxContextSnapshot; changed: boolean; idempotent: boolean }
  | { ok: false; reason: MaxContextReceiverReason; snapshot: MaxContextSnapshot }

export type MaxContextReceiverOptions = {
  /** Exact host origin every message must come from. */
  expectedOrigin: string
  /**
   * The window every message must originate from (the iframe's `window.parent`).
   * Enforced only when provided (`where applicable`): pass it in an iframe, omit
   * it in environments with no reliable source reference.
   */
  expectedSource?: Window | null
  /** Session/tenant/audience scope enforced on every envelope. */
  scope: MaxSessionScope
  /** Resolves display status. Sync or async. See the security invariant above. */
  verify?: MaxContextVerifier
  /** Freshness window in ms (default {@link DEFAULT_FRESHNESS_MS}). */
  freshnessMs?: number
  /** Bounded replay memory (number of `msgId`s retained). */
  replayMax?: number
  /** Injectable clock (ms) for tests. */
  now?: () => number
}

const EMPTY: MaxContextSnapshot = { status: "empty", context: null }
const CLEARED: MaxContextSnapshot = { status: "cleared", context: null }

function nowSafe(): number {
  try {
    return Date.now()
  } catch {
    return 0
  }
}

/**
 * Create a receiver-side context state machine. See the module docstring for the
 * full validation/ordering/verification contract.
 */
export class MaxContextReceiver {
  private readonly expectedOrigin: string
  private readonly hasExpectedSource: boolean
  private readonly expectedSource: Window | null | undefined
  private readonly scope: MaxSessionScope
  private readonly verify?: MaxContextVerifier
  private readonly freshnessMs: number
  private readonly replayMax: number
  private readonly clock: () => number

  private snap: MaxContextSnapshot = EMPTY
  /** Envelope timestamp used only when a context has no comparable revision marker. */
  private lastContextTs: number | null = null
  /** Monotonic id of the last committed context, guarding late verifier results. */
  private epoch = 0
  private readonly seen = new Set<string>()
  private readonly seenOrder: string[] = []

  constructor(opts: MaxContextReceiverOptions) {
    this.expectedOrigin = opts.expectedOrigin
    this.hasExpectedSource = "expectedSource" in opts
    this.expectedSource = opts.expectedSource
    this.scope = opts.scope
    this.verify = opts.verify
    this.freshnessMs = opts.freshnessMs ?? DEFAULT_FRESHNESS_MS
    this.replayMax = opts.replayMax ?? 256
    this.clock = opts.now ?? nowSafe
  }

  /** The current snapshot. Updated synchronously on accept, before verification. */
  snapshot(): MaxContextSnapshot {
    return this.snap
  }

  /** Reset to the pristine `empty` state and forget replay history. */
  reset(): void {
    this.snap = EMPTY
    this.lastContextTs = null
    this.epoch++
    this.seen.clear()
    this.seenOrder.length = 0
  }

  /**
   * Ingest one raw `MessageEvent`. The synchronous portion (validation, ordering,
   * commit of the pre-verification snapshot) runs *before* the first `await`, so
   * `snapshot()` reflects the accepted context immediately even if you don't await
   * — and ordering stays race-free regardless of verifier timing. Awaiting the
   * returned promise gives the verifier-resolved snapshot.
   */
  ingest(event: Pick<MessageEvent, "origin" | "source" | "data">): Promise<MaxContextIngestResult> {
    const committed = this.commit(event)
    if (!committed.ok) return Promise.resolve(committed)
    // A clear or an unverified accept is already reflected in `this.snap`.
    if (!committed.context || !this.verify) return Promise.resolve(committed)
    return this.runVerify(committed.context, committed.epoch ?? this.epoch, committed)
  }

  /**
   * Synchronous validation + ordering + commit. Sets `this.snap` to the
   * pre-verification state (`active`/`cleared`) and returns the decision. No
   * verifier is run here.
   */
  private commit(
    event: Pick<MessageEvent, "origin" | "source" | "data">,
  ): MaxContextIngestResult & { context?: MaxHostContext | null; epoch?: number } {
    const reject = (reason: MaxContextReceiverReason) =>
      ({ ok: false, reason, snapshot: this.snap }) as const

    if (event.origin !== this.expectedOrigin) return reject("origin-mismatch")
    if (this.hasExpectedSource) {
      if (!this.expectedSource || event.source !== this.expectedSource)
        return reject("source-mismatch")
    }

    const data = event.data
    if (!data || typeof data !== "object") return reject("not-object")
    const raw = data as Record<string, unknown>

    if (raw.channel !== MAX_CHANNEL) return reject("channel-mismatch")
    if (raw.type !== "max:setContext") return reject("unknown-type")

    const scopeFailure = validateEnvelopeScope(raw, this.scope)
    if (scopeFailure) return reject(scopeFailure)

    // Freshness: finite, strictly-positive ts within the window. ts===0 never
    // bypasses the check.
    const ts = raw.ts
    if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return reject("stale-ts")
    if (Math.abs(this.clock() - ts) > this.freshnessMs) return reject("stale-ts")

    // Bounded, non-empty msgId; drop duplicates (replay).
    const msgId = raw.msgId
    if (typeof msgId !== "string" || msgId.length === 0 || msgId.length > MAX_MSGID_LEN)
      return reject("bad-msgid")
    if (this.seen.has(msgId)) return reject("replay")
    // Record the id now that the message is scoped, fresh and uniquely
    // identified — so replaying the *same* captured message (even a
    // malformed-payload one) is always dropped, not just the well-formed ones.
    this.remember(msgId)

    // Payload shape: `context` must be present (object or explicit null).
    if (!("context" in raw)) return reject("bad-payload")

    if (raw.context === null) {
      if (this.lastContextTs !== null && ts < this.lastContextTs) return reject("out-of-order")
      this.snap = CLEARED
      this.lastContextTs = ts
      const epoch = ++this.epoch
      return {
        ok: true,
        snapshot: this.snap,
        changed: true,
        idempotent: false,
        context: null,
        epoch,
      }
    }

    const context = normalizeHostContext(raw.context)
    if (!context) return reject("bad-context")

    const current = this.snap.context
    if (isSameReceiverRevision(context, current)) {
      // Same revision → idempotent no-op (keep whatever verified status we hold).
      return { ok: true, snapshot: this.snap, changed: false, idempotent: true }
    }
    if (isContextOutOfOrder(context, current)) {
      return { ok: false, reason: "out-of-order", snapshot: this.snap }
    }
    // When neither version nor capturedAt can compare this update with the
    // current context, fall back to the already-validated envelope timestamp.
    // This prevents a delayed unversioned message from overwriting newer state,
    // while a newer message is accepted and re-verified instead of being
    // mistaken for an idempotent same-entity resend.
    if (
      (!current || !hasComparableRevision(context, current)) &&
      this.lastContextTs !== null &&
      ts < this.lastContextTs
    ) {
      return { ok: false, reason: "out-of-order", snapshot: this.snap }
    }

    this.snap = { status: "active", context }
    this.lastContextTs = ts
    const epoch = ++this.epoch
    return { ok: true, snapshot: this.snap, changed: true, idempotent: false, context, epoch }
  }

  private async runVerify(
    context: MaxHostContext,
    epoch: number,
    committed: MaxContextIngestResult,
  ): Promise<MaxContextIngestResult> {
    let resolution: MaxContextResolution
    try {
      resolution = (await this.verify?.(context)) ?? { ok: true }
    } catch {
      // A throwing verifier is treated as "cannot resolve" — degrade defensively
      // rather than silently trust an unresolved context.
      resolution = { ok: false, reason: "unauthorized" }
    }
    // A newer context landed while we were verifying — discard this stale result.
    if (epoch !== this.epoch) return { ok: false, reason: "superseded", snapshot: this.snap }

    if (resolution.ok) {
      this.snap = { status: "active", context }
    } else if (resolution.reason === "stale") {
      this.snap = { status: "stale", context }
    } else {
      this.snap = { status: "degraded", context, reason: resolution.reason }
    }
    return { ...committed, snapshot: this.snap }
  }

  private remember(msgId: string): void {
    this.seen.add(msgId)
    this.seenOrder.push(msgId)
    if (this.seenOrder.length > this.replayMax) {
      const evicted = this.seenOrder.shift()
      if (evicted !== undefined) this.seen.delete(evicted)
    }
  }
}

function hasComparableRevision(incoming: MaxHostContext, current: MaxHostContext): boolean {
  const sameEntity = incoming.type === current.type && incoming.id === current.id
  if (sameEntity && typeof incoming.version === "number" && typeof current.version === "number") {
    return true
  }
  return parseContextTimestamp(incoming) !== null && parseContextTimestamp(current) !== null
}

/** Receiver idempotence must not erase meaningful unversioned updates. */
function isSameReceiverRevision(
  incoming: MaxHostContext,
  current: MaxHostContext | null | undefined,
): boolean {
  if (!current || !isSameContext(incoming, current)) return false
  if (typeof incoming.version === "number" && typeof current.version === "number") return true

  const incomingAt = parseContextTimestamp(incoming)
  const currentAt = parseContextTimestamp(current)
  if (incomingAt !== null || currentAt !== null) {
    return incomingAt !== null && incomingAt === currentAt
  }

  // Without a revision marker, only an actually identical payload is a no-op.
  return JSON.stringify(incoming) === JSON.stringify(current)
}

/** Factory alias for {@link MaxContextReceiver}. */
export function createContextReceiver(opts: MaxContextReceiverOptions): MaxContextReceiver {
  return new MaxContextReceiver(opts)
}
