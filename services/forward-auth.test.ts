import { beforeEach, describe, expect, mock, test } from "bun:test"
import { HTTPError, NetworkError, TimeoutError } from "ky"
import type { AppEntry } from "#/lib/config"
import { type Entitlements, ProviderOutage } from "#/lib/providers/types"

const getEntitlements = mock<
  (userId: string, config: unknown) => Promise<Entitlements>
>(async () => null)

const real = await import("#/lib/providers")
mock.module("#/lib/providers", () => ({
  ...real,
  providers: {
    ...real.providers,
    revenuecat: { getEntitlements },
  },
}))

const { authenticate } = await import("#/services/forward-auth")

const app: AppEntry = { provider: { name: "revenuecat", secretKey: "sk_test" } }
const identity = (userId: string) => ({ appId: "myapp", userId })

const httpError = (status: number) =>
  new HTTPError(
    new Response(null, { status }),
    new Request("https://api.revenuecat.com"),
    {
      method: "GET",
    } as never,
  )

beforeEach(() => {
  getEntitlements.mockReset()
  getEntitlements.mockImplementation(async () => null)
})

describe("authenticate fail-open on provider outage", () => {
  test("5xx fails open", async () => {
    getEntitlements.mockImplementationOnce(async () => {
      throw httpError(503)
    })

    expect(await authenticate([], identity("outage-5xx"), app)).toBe(true)
  })

  test("429 fails open", async () => {
    getEntitlements.mockImplementationOnce(async () => {
      throw httpError(429)
    })

    expect(await authenticate([], identity("outage-429"), app)).toBe(true)
  })

  test("network error fails open", async () => {
    getEntitlements.mockImplementationOnce(async () => {
      throw new NetworkError(new Request("https://api.revenuecat.com"))
    })

    expect(await authenticate([], identity("outage-net"), app)).toBe(true)
  })

  test("bare TypeError transport failure fails open (Bun)", async () => {
    getEntitlements.mockImplementationOnce(async () => {
      throw new TypeError(
        "Unable to connect. Is the computer able to access the url?",
      )
    })

    expect(await authenticate([], identity("outage-ty"), app)).toBe(true)
  })

  test("other TypeErrors are bugs, fail closed", async () => {
    getEntitlements.mockImplementationOnce(async () => {
      throw new TypeError(
        "Cannot read properties of undefined (reading 'entitlements')",
      )
    })

    expect(authenticate([], identity("bug-ty"), app)).rejects.toBeInstanceOf(
      TypeError,
    )
  })

  test("ProviderOutage (200 with errors body) fails open", async () => {
    getEntitlements.mockImplementationOnce(async () => {
      throw new ProviderOutage("apphud errors in response")
    })

    expect(await authenticate([], identity("outage-errors"), app)).toBe(true)
  })

  test("timeout fails open", async () => {
    getEntitlements.mockImplementationOnce(async () => {
      throw new TimeoutError(new Request("https://api.revenuecat.com"))
    })

    expect(await authenticate([], identity("outage-timeout"), app)).toBe(true)
  })

  test("outage result is not cached", async () => {
    getEntitlements.mockImplementationOnce(async () => {
      throw httpError(503)
    })
    getEntitlements.mockImplementationOnce(async () => null)

    const id = identity("outage-nocache")
    expect(await authenticate([], id, app)).toBe(true)
    // no positive cache entry: provider recovered and says the user is unknown
    expect(await authenticate([], id, app)).toBe(false)
  })

  test("4xx keeps failing", async () => {
    getEntitlements.mockImplementationOnce(async () => {
      throw httpError(401)
    })

    expect(authenticate([], identity("badkey"), app)).rejects.toBeInstanceOf(
      HTTPError,
    )
  })
})

describe("authenticate", () => {
  test("unknown user is forbidden, not a client error", async () => {
    getEntitlements.mockImplementationOnce(async () => null)

    expect(await authenticate([], identity("unknown"), app)).toBe(false)
  })
  test("granted access is cached", async () => {
    getEntitlements.mockImplementationOnce(async () => ({}))

    const id = identity("cached")
    expect(await authenticate([], id, app)).toBe(true)
    expect(await authenticate([], id, app)).toBe(true)
    expect(getEntitlements).toHaveBeenCalledTimes(1)
  })

  test("concurrent lookups share one inflight provider request", async () => {
    let calls = 0
    getEntitlements.mockImplementation(async () => {
      calls++
      await new Promise((r) => setTimeout(r, 20))
      return {}
    })

    const id = identity("inflight")
    const [a, b] = await Promise.all([
      authenticate([], id, app),
      authenticate([], id, app),
    ])
    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(calls).toBe(1)
  })

  test("any one required entitlement grants access (OR)", async () => {
    getEntitlements.mockImplementationOnce(async () => ({
      pro: { expiresAt: null, graceUntil: 0 },
    }))

    expect(
      await authenticate(["pro", "ultimate"], identity("any-of"), app),
    ).toBe(true)
  })

  test("missing entitlement is forbidden", async () => {
    getEntitlements.mockImplementationOnce(async () => ({
      pro: { expiresAt: null, graceUntil: 0 },
    }))

    expect(await authenticate(["ultimate"], identity("basic"), app)).toBe(false)
  })

  test("expired entitlement is forbidden", async () => {
    getEntitlements.mockImplementationOnce(async () => ({
      pro: { expiresAt: Date.now() - 1000, graceUntil: 0 },
    }))

    expect(await authenticate(["pro"], identity("expired"), app)).toBe(false)
  })
})
