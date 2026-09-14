import { describe, expect, test } from "bun:test"
import { isEntitlementActive } from "./types"

const DAY = 24 * 60 * 60 * 1000

describe("isEntitlementActive", () => {
  test("lifetime entitlement is active", () => {
    expect(isEntitlementActive({ expiresAt: null, graceUntil: 0 })).toBe(true)
  })

  test("future expiry is active", () => {
    expect(
      isEntitlementActive({ expiresAt: Date.now() + DAY, graceUntil: 0 }),
    ).toBe(true)
  })

  test("past expiry without grace is inactive", () => {
    expect(
      isEntitlementActive({ expiresAt: Date.now() - DAY, graceUntil: 0 }),
    ).toBe(false)
  })

  test("past expiry with future grace period is active", () => {
    expect(
      isEntitlementActive({
        expiresAt: Date.now() - DAY,
        graceUntil: Date.now() + DAY,
      }),
    ).toBe(true)
  })

  test("expired grace period is inactive", () => {
    expect(
      isEntitlementActive({
        expiresAt: Date.now() - 2 * DAY,
        graceUntil: Date.now() - DAY,
      }),
    ).toBe(false)
  })
})
