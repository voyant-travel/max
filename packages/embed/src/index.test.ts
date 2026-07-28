import { describe, expect, it } from "vitest"

import {
  CONTEXT_SECURITY_INVARIANT,
  createContextReceiver,
  MaxContextReceiver,
  type MaxContextReceiverOptions,
  type MaxContextSnapshot,
  ReplayGuard,
  type ValidateOptions,
  type ValidateResult,
  validateInbound,
} from "./index.js"

describe("package root receiver exports", () => {
  it("supports the documented consumer import surface", () => {
    const options: MaxContextReceiverOptions = {
      expectedOrigin: "https://host.example",
      scope: { sessionId: "session", tenant: null, audience: null },
    }
    const receiver = createContextReceiver(options)
    const snapshot: MaxContextSnapshot = receiver.snapshot()

    expect(receiver).toBeInstanceOf(MaxContextReceiver)
    expect(snapshot).toEqual({ status: "empty", context: null })
    expect(CONTEXT_SECURITY_INVARIANT).toMatch(/discovery hint only/i)
  })

  it("exports the protocol validator and replay API for custom consumers", () => {
    const source = {} as Window
    const options: ValidateOptions = {
      expectedOrigin: "https://iframe.example",
      expectedSource: source,
      scope: { sessionId: "session" },
      replay: new ReplayGuard(),
    }
    const result: ValidateResult = validateInbound(
      { origin: "https://wrong.example", source, data: null },
      options,
    )

    expect(result).toEqual({ ok: false, reason: "origin-mismatch" })
  })
})
