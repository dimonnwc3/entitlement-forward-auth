import { beforeEach, describe, expect, mock, test } from "bun:test"
import { iaphub } from "./iaphub"

const fetchMock = mock(
  async (..._args: Parameters<typeof fetch>) =>
    new Response("{}", { status: 200 }),
)

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }))
})

const config = { apiKey: "k", appId: "app" }

describe("iaphub provider", () => {
  test("maps active products by product id and group name", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            activeProducts: [
              {
                id: "subscription2_tier10",
                type: "renewable_subscription",
                sku: "subscription2_tier10",
                expirationDate: new Date(Date.now() + 86400000).toISOString(),
                groupName: "premium",
              },
              {
                id: "vipmode_tier50",
                type: "non_consumable",
              },
            ],
          }),
          { status: 200 },
        ),
    )

    const e = await iaphub.getEntitlements("u1", config)
    expect(Object.keys(e ?? {}).sort()).toEqual([
      "premium",
      "subscription2_tier10",
      "vipmode_tier50",
    ])
    // non_consumable has no expirationDate -> lifetime
    expect(e?.vipmode_tier50).toEqual({ expiresAt: null, graceUntil: 0 })
    expect(e?.premium?.expiresAt).toBeGreaterThan(Date.now())
  })

  test("retry period extends expiry", async () => {
    const expired = new Date(Date.now() - 1000).toISOString()
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            activeProducts: [
              {
                id: "sub",
                type: "renewable_subscription",
                expirationDate: expired,
                isSubscriptionRetryPeriod: true,
              },
            ],
          }),
          { status: 200 },
        ),
    )

    const e = await iaphub.getEntitlements("u1", config)
    expect(e?.sub?.graceUntil).toBeGreaterThan(Date.now())
  })

  test("404 means unknown user", async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response("{}", { status: 404 }),
    )

    expect(await iaphub.getEntitlements("ghost", config)).toBeNull()
  })
})
