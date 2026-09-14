import { beforeEach, describe, expect, mock, test } from "bun:test"
import { qonversion } from "./qonversion"

const fetchMock = mock(
  async (..._args: Parameters<typeof fetch>) =>
    new Response("{}", { status: 200 }),
)

const page = (items: unknown[]) => ({ items })

beforeEach(() => {
  globalThis.fetch = fetchMock as unknown as typeof fetch
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => new Response("{}", { status: 200 }))
})

describe("qonversion provider", () => {
  test("maps items with ISO expires_at", async () => {
    const future = new Date(Date.now() + 3600_000).toISOString()
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            page([
              { id: "plus", is_active: true, expires_at: future },
              { id: "lifetime", is_active: true, expires_at: null },
            ]),
          ),
          { status: 200 },
        ),
    )

    const e = await qonversion.getEntitlements("u1", { secretKey: "sk" })
    expect(e?.plus?.expiresAt).toBe(+new Date(future))
    expect(e?.lifetime).toEqual({ expiresAt: null, graceUntil: 0 })
  })

  test("accepts bare array and data/results wrappers", async () => {
    for (const body of [
      [{ id: "premium", is_active: true, expires_at: null }],
      { data: [{ id: "premium", is_active: true, expires_at: null }] },
      { results: [{ id: "premium", is_active: true, expires_at: null }] },
    ]) {
      fetchMock.mockImplementationOnce(
        async () => new Response(JSON.stringify(body), { status: 200 }),
      )
      expect(
        await qonversion.getEntitlements("u1", { secretKey: "sk" }),
      ).toEqual({ premium: { expiresAt: null, graceUntil: 0 } })
    }
  })

  test("is_active false is dropped", async () => {
    fetchMock.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify(
            page([{ id: "premium", is_active: false, expires_at: null }]),
          ),
          { status: 200 },
        ),
    )

    expect(await qonversion.getEntitlements("u1", { secretKey: "sk" })).toEqual(
      {},
    )
  })

  test("unknown wrapper fails loud, not silent {}", async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response(JSON.stringify({ foo: "bar" }), { status: 200 }),
    )

    expect(
      qonversion.getEntitlements("u1", { secretKey: "sk" }),
    ).rejects.toThrow(/qonversion schema mismatch/)
  })

  test("item without id or expires_at fails loud", async () => {
    for (const item of [{ is_active: true }, { id: "x", is_active: true }]) {
      fetchMock.mockImplementationOnce(
        async () => new Response(JSON.stringify(page([item])), { status: 200 }),
      )
      expect(
        qonversion.getEntitlements("u1", { secretKey: "sk" }),
      ).rejects.toThrow(/qonversion schema mismatch/)
    }
  })

  test("404 means unknown user", async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response("{}", { status: 404 }),
    )

    expect(
      await qonversion.getEntitlements("ghost", { secretKey: "sk" }),
    ).toBeNull()
  })
})
