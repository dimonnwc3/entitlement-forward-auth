import { describe, expect, test } from "bun:test"
import { entitlementsFromSubscriber } from "./revenuecat"

const DAY = 24 * 60 * 60 * 1000
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString()

function subscriber(entitlement: {
  expires_date: string | null
  grace_period_expires_date?: string | null
}) {
  return {
    entitlements: {
      pro: {
        product_identifier: "pro_monthly",
        purchase_date: "2026-01-01T00:00:00Z",
        ...entitlement,
        grace_period_expires_date:
          entitlement.grace_period_expires_date ?? null,
      },
    },
  }
}

describe("entitlementsFromSubscriber", () => {
  test("lifetime maps to null expiry", () => {
    const e = entitlementsFromSubscriber(subscriber({ expires_date: null }))
    expect(e).toEqual({ pro: { expiresAt: null, graceUntil: 0 } })
  })

  test("expiry and grace dates map to epoch millis", () => {
    const e = entitlementsFromSubscriber(
      subscriber({
        expires_date: ahead(DAY),
        grace_period_expires_date: ahead(2 * DAY),
      }),
    )
    expect(e!.pro!.expiresAt).toBeGreaterThan(Date.now())
    expect(e!.pro!.graceUntil).toBeGreaterThan(e!.pro!.expiresAt!)
  })

  test("past expiry without grace normalizes inactive", () => {
    const e = entitlementsFromSubscriber(subscriber({ expires_date: ago(DAY) }))
    expect(e!.pro!.expiresAt).toBeLessThan(Date.now())
    expect(e!.pro!.graceUntil).toBe(0)
  })
})
