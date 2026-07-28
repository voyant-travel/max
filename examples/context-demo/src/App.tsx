import {
  createContextReceiver,
  MaxChat,
  type MaxContextReceiver,
  type MaxContextSnapshot,
  type MaxHostContext,
  MaxLauncher,
} from "@voyant-travel/max-embed"
import { type CSSProperties, useRef, useState } from "react"

// The embed origin the iframe is served from. Defaults to this same dev server
// (same-origin, `vite.config.ts` serves the fixture for `/max*`). Set
// `VITE_EMBED_ORIGIN` to point at a *cross-origin* fixture server
// (`vite.fixture.config.ts` on 127.0.0.1:48715) to exercise the real
// cross-origin postMessage path. In production this is agent-embed.voyant.travel.
const EMBED_ORIGIN =
  (import.meta.env.VITE_EMBED_ORIGIN as string | undefined) ?? window.location.origin

// A short-lived embed token would normally be minted by your backend. The
// fixture doesn't verify it — it only exercises the host-context channel.
const DEMO_TOKEN = "demo-token"

const ENTITIES: MaxHostContext[] = [
  {
    type: "product",
    id: "PRD-42",
    label: "Kilimanjaro Machame 8-Day",
    route: "/products/PRD-42",
    subView: "itinerary",
    version: 1,
    capturedAt: "2026-07-28T09:00:00Z",
    meta: { region: "Tanzania", price: 2890 },
  },
  {
    type: "booking",
    id: "VYT-10423",
    label: "Booking VYT-10423 — A. Lovelace",
    route: "/bookings/VYT-10423",
    version: 1,
  },
  {
    type: "customer",
    id: "CUS-7781",
    label: "Ada Lovelace",
    route: "/customers/CUS-7781",
    version: 1,
  },
  {
    type: "invoice",
    id: "INV-55012",
    label: "Invoice INV-55012 (€2,890)",
    route: "/invoices/INV-55012",
    version: 1,
  },
]

const RCV_SESSION = "rcv-sess"
const RCV_BOOKING: MaxHostContext = {
  type: "booking",
  id: "VYT-10423",
  label: "Booking VYT-10423",
  version: 1,
}

export function App() {
  const [context, setContext] = useState<MaxHostContext | null>(null)
  const [log, setLog] = useState<Array<{ id: number; line: string }>>([])

  // --- Receiver state machine harness (drives the real MaxContextReceiver) ----
  const [recSnap, setRecSnap] = useState<MaxContextSnapshot>({ status: "empty", context: null })
  const [recLine, setRecLine] = useState("no messages yet")
  const simulateDeleted = useRef(false)
  const [deletedOn, setDeletedOn] = useState(false)
  const receiverRef = useRef<MaxContextReceiver | null>(null)
  if (!receiverRef.current) {
    receiverRef.current = createContextReceiver({
      expectedOrigin: EMBED_ORIGIN,
      // No expectedSource here (crafted events) — the source check is skipped.
      scope: { sessionId: RCV_SESSION, tenant: "acme", audience: "agent-desktop" },
      verify: () => (simulateDeleted.current ? { ok: false, reason: "deleted" } : { ok: true }),
    })
  }

  const craft = (over: {
    origin?: string
    sessionId?: string
    context?: MaxHostContext | null
  }) => ({
    origin: over.origin ?? EMBED_ORIGIN,
    source: null,
    data: {
      channel: "max",
      v: 1,
      sessionId: over.sessionId ?? RCV_SESSION,
      tenant: "acme",
      audience: "agent-desktop",
      msgId: `m-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ts: Date.now(),
      type: "max:setContext",
      context: "context" in over ? over.context : null,
    },
  })

  const feed = async (
    label: string,
    over: { origin?: string; sessionId?: string; context?: MaxHostContext | null },
  ) => {
    const r = receiverRef.current
    if (!r) return
    const result = await r.ingest(craft(over))
    setRecSnap(r.snapshot())
    setRecLine(
      `${label} → ${result.ok ? "accepted" : `rejected(${result.reason})`} · snapshot: ${r.snapshot().status}`,
    )
  }

  const pushLog = (line: string) =>
    setLog((l) =>
      [
        { id: (l[0]?.id ?? 0) + 1, line: `${new Date().toISOString().slice(11, 19)}  ${line}` },
        ...l,
      ].slice(0, 12),
    )

  const select = (c: MaxHostContext) => {
    setContext(c)
    pushLog(`host → select ${c.type}:${c.id}`)
  }
  const clear = () => {
    setContext(null)
    pushLog("host → clear context")
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Max embed — typed host-context channel</h1>
      <p style={{ color: "#5b5b52", marginTop: 0 }}>
        Selecting an entity streams a typed context to the iframe over the validated postMessage
        channel — the iframe never remounts, so chat state survives. Try inspect / clear inside the
        panel, widen / expand, and note the pinned historical snapshot keeps its own context.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
        {ENTITIES.map((e) => (
          <button
            key={e.id}
            type="button"
            data-testid={`select-${e.type}`}
            onClick={() => select(e)}
            style={btn(context?.id === e.id)}
          >
            {e.type}: {e.id}
          </button>
        ))}
        <button type="button" data-testid="host-clear" onClick={clear} style={btn(false)}>
          clear
        </button>
      </div>

      <div data-testid="host-context" style={card}>
        <strong>Host selection:</strong>{" "}
        {context ? (
          <code>
            {context.type}:{context.id} — {context.label}
          </code>
        ) : (
          <em>none</em>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 20 }}>
        <section>
          <h2 style={h2}>Inline &lt;MaxChat&gt;</h2>
          <div
            style={{
              height: 460,
              border: "1px solid #e4e4dd",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <MaxChat
              token={DEMO_TOKEN}
              embedOrigin={EMBED_ORIGIN}
              tenant="acme"
              audience="agent-desktop"
              context={context}
              onContextClear={() => {
                pushLog("iframe → clearContext (user pressed clear)")
                setContext(null)
              }}
            />
          </div>
        </section>

        <section>
          <h2 style={h2}>Event log</h2>
          <ol
            data-testid="host-log"
            style={{
              ...card,
              minHeight: 460,
              margin: 0,
              listStyle: "none",
              padding: 12,
              fontFamily: "monospace",
              fontSize: 12,
            }}
          >
            {log.map((l) => (
              <li key={l.id}>{l.line}</li>
            ))}
          </ol>
        </section>
      </div>

      {/* Receiver-side state machine (MaxContextReceiver) driven by crafted
          host→iframe messages — exercises ordering, scope rejection and the
          display-only verifier (degraded). */}
      <section style={{ marginTop: 24 }}>
        <h2 style={h2}>Receiver state machine (MaxContextReceiver)</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <button
            type="button"
            data-testid="rcv-v1"
            style={btn(false)}
            onClick={() => feed("setContext v1", { context: RCV_BOOKING })}
          >
            valid v1
          </button>
          <button
            type="button"
            data-testid="rcv-v2"
            style={btn(false)}
            onClick={() =>
              feed("setContext v2", {
                context: { ...RCV_BOOKING, version: 2, label: "Booking v2" },
              })
            }
          >
            newer v2
          </button>
          <button
            type="button"
            data-testid="rcv-stale"
            style={btn(false)}
            onClick={() => feed("stale v1", { context: RCV_BOOKING })}
          >
            out-of-order v1
          </button>
          <button
            type="button"
            data-testid="rcv-bad-origin"
            style={btn(false)}
            onClick={() =>
              feed("forged origin", { origin: "https://evil.example", context: RCV_BOOKING })
            }
          >
            forged origin
          </button>
          <button
            type="button"
            data-testid="rcv-bad-session"
            style={btn(false)}
            onClick={() => feed("forged session", { sessionId: "attacker", context: RCV_BOOKING })}
          >
            forged session
          </button>
          <button
            type="button"
            data-testid="rcv-clear"
            style={btn(false)}
            onClick={() => feed("clear", { context: null })}
          >
            clear
          </button>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, font: "inherit" }}>
            <input
              type="checkbox"
              data-testid="rcv-deleted"
              checked={deletedOn}
              onChange={(e) => {
                simulateDeleted.current = e.target.checked
                setDeletedOn(e.target.checked)
              }}
            />
            verifier: simulate deleted
          </label>
        </div>
        <div data-testid="rcv-snapshot" style={card}>
          <strong>Snapshot:</strong> <code>{recSnap.status}</code>
          {recSnap.status === "degraded" ? <code> ({recSnap.reason})</code> : null}
          {recSnap.context ? (
            <code>
              {" "}
              — {recSnap.context.type}:{recSnap.context.id} v{recSnap.context.version ?? "?"}
            </code>
          ) : null}
          <div
            data-testid="rcv-line"
            style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12 }}
          >
            {recLine}
          </div>
        </div>
      </section>

      {/* Floating launcher demonstrates the normal / wide / expanded layouts and
          the host↔iframe layout round trip with user-visible controls. */}
      <MaxLauncher
        token={DEMO_TOKEN}
        embedOrigin={EMBED_ORIGIN}
        tenant="acme"
        audience="agent-desktop"
        context={context}
        defaultOpen
        onLayoutChange={(l) => pushLog(`layout → ${l}`)}
        onContextClear={() => setContext(null)}
      />
    </div>
  )
}

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e4dd",
  borderRadius: 12,
  padding: "10px 14px",
}
const h2: CSSProperties = {
  fontSize: 14,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#5b5b52",
}
const btn = (active: boolean): CSSProperties => ({
  padding: "8px 12px",
  borderRadius: 9,
  border: active ? "2px solid #ff5100" : "1px solid #d9d9d0",
  background: active ? "#fff3ee" : "#fff",
  cursor: "pointer",
  font: "inherit",
})
