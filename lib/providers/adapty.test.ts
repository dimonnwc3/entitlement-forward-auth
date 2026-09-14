import { beforeEach, describe, expect, mock, test } from "bun:test"
import { adapty } from "./adapty"

const fetchMock = mock(
  async (..._args: Parameters<typeof fetch>) =>
    new Response("{}", { status: 200 }),
)

const profile = (accessLevels: unknown) => ({
  data: { access_levels: accessLevels },
})

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }))
})

describe("adapty provider", () => {
  test("maps access levels keyed by id", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            profile({
              premium: {
                is_active: true,
                expires_at: null,
                grace_period_expires_at: null,
              },
            }),
          ),
          { status: 200 },
        ),
    )

    const e = await adapty.getEntitlements("u1", { secretKey: "s" })
    expect(e).toEqual({ premium: { expiresAt: null, graceUntil: 0 } })
  })

  test("grace period end date maps directly", async () => {
    const expired = new Date(Date.now() - 1000).toISOString()
    const graceEnd = new Date(Date.now() + 86400000).toISOString()
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            profile({
              premium: {
                is_active: true,
                expires_at: expired,
                grace_period_expires_at: graceEnd,
              },
            }),
          ),
          { status: 200 },
        ),
    )

    const e = await adapty.getEntitlements("u1", { secretKey: "s" })
    expect(e?.premium?.graceUntil).toBe(+new Date(graceEnd))
  })

  test("is_active false drops the level even with future expiry", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            profile({
              premium: {
                is_active: false,
                expires_at: new Date(Date.now() + 86400000).toISOString(),
                grace_period_expires_at: null,
              },
            }),
          ),
          { status: 200 },
        ),
    )

    expect(await adapty.getEntitlements("u1", { secretKey: "s" })).toEqual({})
  })

  test("array-shaped access_levels fails loud, not silent", async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify(profile([])), { status: 200 }),
    )

    expect(adapty.getEntitlements("u1", { secretKey: "s" })).rejects.toThrow(
      /adapty schema mismatch/,
    )
  })

  test("404 means unknown user", async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response("{}", { status: 404 }),
    )

    expect(await adapty.getEntitlements("ghost", { secretKey: "s" })).toBeNull()
  })

  test("CR/LF in user id is rejected, not mutated", async () => {
    expect(adapty.getEntitlements("a\nb", { secretKey: "s" })).rejects.toThrow(
      /CR\/LF/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("customer user id header is sent", async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify(profile({})), { status: 200 }),
    )

    await adapty.getEntitlements("u1", { secretKey: "s" })
    const [input, init] = fetchMock.mock.calls[0] ?? []
    const headers =
      input instanceof Request ? input.headers : new Headers(init?.headers)
    expect(headers.get("adapty-customer-user-id")).toBe("u1")
  })
})
