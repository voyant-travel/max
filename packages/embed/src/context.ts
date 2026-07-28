/**
 * Typed, tenant-safe host context for Max.
 *
 * The *host context* is a small, structured hint the embedding app hands to Max
 * describing what the operator is currently looking at — a booking, a customer,
 * an invoice, … — so the assistant can offer relevant help without the user
 * re-typing an identifier.
 *
 * SECURITY INVARIANT (read {@link CONTEXT_SECURITY_INVARIANT}): the host context
 * is a *discovery hint only*. It never authorises anything. Max must still run
 * its own verification, authentication, approval and consequence-preview steps
 * for every action, exactly as if the context had not been supplied. A hostile
 * or stale context can point at an entity the user may not touch; downstream
 * auth is what actually protects it. Do not use the context to skip a check.
 */

/**
 * Human-readable statement of the security invariant, exported so consumers can
 * surface it in their own docs/tooling and so it is impossible to miss.
 */
export const CONTEXT_SECURITY_INVARIANT =
  "Host context is a discovery hint only. It MUST NOT bypass or short-circuit " +
  "identity verification, authentication, authorization, human approval, or " +
  "consequence preview. Every action Max takes is re-verified server-side " +
  "against the session's own credentials regardless of the supplied context."

/**
 * Entity kinds a host context may point at. Kept deliberately closed — an
 * unknown entity type is rejected by {@link normalizeHostContext} rather than
 * forwarded to the iframe, so a typo or a malicious payload can't smuggle an
 * arbitrary `type` across the channel.
 */
export const MAX_ENTITY_TYPES = [
  "product",
  "booking",
  "customer",
  "departure",
  "invoice",
  "contract",
] as const

export type MaxEntityType = (typeof MAX_ENTITY_TYPES)[number]

const ENTITY_TYPE_SET = new Set<string>(MAX_ENTITY_TYPES)

/** Narrowing guard for {@link MaxEntityType}. */
export function isMaxEntityType(value: unknown): value is MaxEntityType {
  return typeof value === "string" && ENTITY_TYPE_SET.has(value)
}

/**
 * Small serialisable metadata bag. Kept to primitives so the context always
 * round-trips cleanly through `postMessage`'s structured clone and can be safely
 * logged/inspected.
 */
export type MaxContextMeta = Record<string, string | number | boolean | null>

/**
 * The typed host context. `type` + `id` identify the entity; everything else is
 * presentation/versioning. `id` is opaque to the embed — it is only ever
 * compared for equality and displayed, never parsed.
 */
export type MaxHostContext = {
  /** Entity kind. One of {@link MAX_ENTITY_TYPES}. */
  type: MaxEntityType
  /** Stable, tenant-scoped identifier for the entity. Opaque to the embed. */
  id: string
  /** Human-readable label shown in the context chip (e.g. "Booking VYT-10423"). */
  label: string
  /** Optional deep-link route within the host app for "open in app". */
  route?: string
  /** Optional sub-view within the entity (e.g. "itinerary", "payments"). */
  subView?: string
  /**
   * Monotonic version the host bumps on every context change. Lets the iframe
   * distinguish a genuinely new context from a duplicate re-send and lets a
   * historical snapshot detect that it is pinned to an older version.
   */
  version?: number
  /** ISO-8601 timestamp of when the host captured this context. */
  capturedAt?: string
  /** Optional small metadata bag (primitives only). */
  meta?: MaxContextMeta
}

/**
 * Lifecycle status of a context *as attached to a stored conversation snapshot*.
 *
 * A historical conversation retains the exact context it was created with; it
 * must never silently inherit the host's *current* context. When that pinned
 * context can no longer be resolved (the entity was deleted, archived, the
 * viewer lost access, or the host has since moved on) we represent it with one
 * of these non-destructive statuses instead of dropping or rewriting it.
 */
export type MaxContextStatus =
  /** Pinned context still resolves and matches the live entity. */
  | "active"
  /** Host has since navigated elsewhere; the pinned context is older but valid. */
  | "stale"
  /** Underlying entity was archived. */
  | "archived"
  /** Underlying entity was deleted. */
  | "deleted"
  /** Current viewer is not authorised to resolve the pinned entity. */
  | "unauthorized"

export const MAX_CONTEXT_STATUSES: readonly MaxContextStatus[] = [
  "active",
  "stale",
  "archived",
  "deleted",
  "unauthorized",
]

/** True when the status marks the pinned context as no longer live/authoritative. */
export function isDegradedContextStatus(status: MaxContextStatus): boolean {
  return status !== "active"
}

/**
 * A pinned context plus its lifecycle status, as carried by a stored snapshot.
 * The `context` is preserved verbatim even when `status` is degraded, so the UI
 * can still show *what* the conversation was about without resolving it live.
 */
export type MaxSnapshotContext = {
  context: MaxHostContext
  status: MaxContextStatus
}

const MAX_LABEL_LEN = 200
const MAX_ID_LEN = 512
const MAX_META_KEYS = 32

/**
 * Validate and normalise an untrusted context-like value into a
 * {@link MaxHostContext}, or return `null` if it can't be trusted.
 *
 * Used on both ends of the channel: the host normalises the prop before sending
 * (so a bad shape never leaves the page) and the receiver normalises again (so a
 * forged message with a bogus entity type is dropped, not applied). Rejecting
 * here is how "entity type is validated by the protocol" is enforced.
 */
export function normalizeHostContext(input: unknown): MaxHostContext | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>

  if (!isMaxEntityType(raw.type)) return null

  const id = typeof raw.id === "string" ? raw.id.trim() : ""
  if (!id || id.length > MAX_ID_LEN) return null

  const label =
    typeof raw.label === "string" && raw.label.trim().length > 0
      ? raw.label.trim().slice(0, MAX_LABEL_LEN)
      : id

  const out: MaxHostContext = { type: raw.type, id, label }

  if (typeof raw.route === "string" && raw.route.length > 0) out.route = raw.route
  if (typeof raw.subView === "string" && raw.subView.length > 0) out.subView = raw.subView
  if (typeof raw.version === "number" && Number.isFinite(raw.version)) out.version = raw.version
  if (typeof raw.capturedAt === "string" && raw.capturedAt.length > 0)
    out.capturedAt = raw.capturedAt

  const meta = normalizeMeta(raw.meta)
  if (meta) out.meta = meta

  return out
}

function normalizeMeta(input: unknown): MaxContextMeta | null {
  if (!input || typeof input !== "object") return null
  const out: MaxContextMeta = {}
  let n = 0
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_META_KEYS) break
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[k] = v
      n++
    }
  }
  return n > 0 ? out : null
}

/** Stable identity of a context: two contexts are "the same entity" when equal. */
export function contextKey(context: MaxHostContext | null | undefined): string | null {
  if (!context) return null
  return `${context.type}:${context.id}`
}

/**
 * Whether two contexts describe the same entity at the same version. Used to
 * dedupe re-sends and to decide whether a snapshot's pinned context is stale
 * relative to the live host context.
 */
export function isSameContext(
  a: MaxHostContext | null | undefined,
  b: MaxHostContext | null | undefined,
): boolean {
  if (!a || !b) return a === b
  return a.type === b.type && a.id === b.id && (a.version ?? null) === (b.version ?? null)
}

/**
 * Derive the display status of a snapshot's pinned context against the live host
 * context. Never mutates or replaces the pinned context — purely descriptive.
 *
 * - if the pinned entity is known-gone (caller passes `resolved: false`) →
 *   the caller-supplied degraded status (deleted/archived/unauthorized).
 * - else if it differs from the current host context → `"stale"`.
 * - else → `"active"`.
 */
export function deriveContextStatus(
  pinned: MaxHostContext,
  live: MaxHostContext | null | undefined,
  resolution?: {
    resolved: boolean
    reason?: Extract<MaxContextStatus, "deleted" | "archived" | "unauthorized">
  },
): MaxContextStatus {
  if (resolution && !resolution.resolved) return resolution.reason ?? "deleted"
  if (!isSameContext(pinned, live)) return "stale"
  return "active"
}
