import { beforeEach, describe, expect, mock, test } from "bun:test"
import { apphud } from "./apphud"
import { ProviderOutage } from "./types"

const fetchMock = mock(
  async (..._args: Parameters<typeof fetch>) =>
    new Response("{}", { status: 200 }),
)

const customer = (subscriptions: unknown[]) => ({
  data: { results: { subscriptions } },
})

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }))
})

describe("apphud provider", () => {
  test("maps active subscriptions by product id and group", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            customer([
              {
                product_id: "com.apphud.gold",
                group: "Premium_0001",
                status: "regular",
                expires_at: new Date(Date.now() + 86400000).toISOString(),
                in_retry_billing: false,
              },
              {
                product_id: "com.apphud.trial",
                group: null,
                status: "trial",
                expires_at: new Date(Date.now() + 86400000).toISOString(),
                in_retry_billing: false,
              },
            ]),
          ),
          { status: 200 },
        ),
    )

    const e = await apphud.getEntitlements("u1", { apiKey: "k" })
    expect(Object.keys(e ?? {}).sort()).toEqual([
      "Premium_0001",
      "com.apphud.gold",
      "com.apphud.trial",
    ])
    expect(e?.Premium_0001?.expiresAt).toBeGreaterThan(Date.now())
  })

  test("expired and refunded statuses are dropped", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            customer([
              {
                product_id: "a",
                group: null,
                status: "expired",
                expires_at: null,
                in_retry_billing: false,
              },
              {
                product_id: "b",
                group: null,
                status: "refunded",
                expires_at: null,
                in_retry_billing: false,
              },
            ]),
          ),
          { status: 200 },
        ),
    )

    expect(await apphud.getEntitlements("u1", { apiKey: "k" })).toEqual({})
  })

  test("null expires_at means lifetime", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            customer([
              {
                product_id: "lifetime",
                group: null,
                status: "promotional",
                expires_at: null,
                in_retry_billing: false,
              },
            ]),
          ),
          { status: 200 },
        ),
    )

    const e = await apphud.getEntitlements("u1", { apiKey: "k" })
    expect(e).toEqual({ lifetime: { expiresAt: null, graceUntil: 0 } })
  })

  test("grace status grants access", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            customer([
              {
                product_id: "graceful",
                group: null,
                status: "grace",
                expires_at: new Date(Date.now() + 86400000).toISOString(),
                in_retry_billing: true,
              },
            ]),
          ),
          { status: 200 },
        ),
    )

    const e = await apphud.getEntitlements("u1", { apiKey: "k" })
    expect(e?.graceful).toBeDefined()
  })

  test("retry billing extends expiry", async () => {
    const expired = new Date(Date.now() - 1000).toISOString()
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            customer([
              {
                product_id: "sub",
                group: null,
                status: "regular",
                expires_at: expired,
                in_retry_billing: true,
              },
            ]),
          ),
          { status: 200 },
        ),
    )

    const e = await apphud.getEntitlements("u1", { apiKey: "k" })
    expect(e?.sub?.graceUntil).toBeGreaterThan(Date.now())
  })

  test("200 with errors array fails as outage", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            data: null,
            errors: [{ message: "internal error" }],
          }),
          { status: 200 },
        ),
    )

    expect(
      apphud.getEntitlements("u1", { apiKey: "k" }),
    ).rejects.toBeInstanceOf(ProviderOutage)
  })

  test("absent required field fails loud, not silent", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            customer([{ product_id: "x", group: null, status: "regular" }]),
          ),
          { status: 200 },
        ),
    )

    expect(apphud.getEntitlements("u1", { apiKey: "k" })).rejects.toThrow(
      /apphud schema mismatch/,
    )
  })

  test("missing results means unknown user", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(JSON.stringify({ data: { results: null } }), {
          status: 200,
        }),
    )

    expect(await apphud.getEntitlements("ghost", { apiKey: "k" })).toBeNull()
  })

  test("404 means unknown user", async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response("{}", { status: 404 }),
    )

    expect(await apphud.getEntitlements("ghost", { apiKey: "k" })).toBeNull()
  })
})
