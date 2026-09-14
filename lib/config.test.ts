import { describe, expect, test } from "bun:test"
import { configSchema } from "./config"

const parse = (input: unknown) => configSchema.parse(input)

describe("configSchema", () => {
  test("minimal config: defaults", () => {
    const c = parse({})
    expect(c.routes).toEqual([])
    expect(c.apps).toEqual({})
    expect(c.authHeaders.app).toBe("X-Auth-App")
  })

  test("route defaults: entitlements empty, paths/methods absent mean any", () => {
    const c = parse({ routes: [{}] })
    expect(c.routes[0]?.entitlements).toEqual([])
    expect(c.routes[0]?.paths).toBeUndefined()
    expect(c.routes[0]?.methods).toBeUndefined()
  })

  test("accepts exact paths and /* suffixes", () => {
    expect(() =>
      parse({ routes: [{ paths: ["/", "/*", "/v1/complete", "/v1/*"] }] }),
    ).not.toThrow()
  })

  test("rejects empty paths and empty methods", () => {
    expect(() => parse({ routes: [{ paths: [] }] })).toThrow()
    expect(() => parse({ routes: [{ methods: [] }] })).toThrow()
  })

  test("rejects path without leading slash", () => {
    expect(() => parse({ routes: [{ paths: ["v1/*"] }] })).toThrow(/exact path/)
  })

  test("rejects star outside the trailing /*", () => {
    expect(() => parse({ routes: [{ paths: ["/v1*"] }] })).toThrow(/exact path/)
    expect(() => parse({ routes: [{ paths: ["/a/**"] }] })).toThrow(
      /exact path/,
    )
  })

  test("rejects lowercase and unknown methods", () => {
    expect(() => parse({ routes: [{ methods: ["get"] }] })).toThrow()
    expect(() => parse({ routes: [{ methods: ["FETCH"] }] })).toThrow()
    expect(() =>
      parse({ routes: [{ methods: ["GET", "POST"] }] }),
    ).not.toThrow()
  })

  test("rejects the old prefix field", () => {
    expect(() => parse({ routes: [{ prefix: "/v1" }] })).toThrow(/Unrecognized/)
  })

  test("defaultApp must be an apps key", () => {
    const apps = {
      myapp: { provider: { name: "revenuecat", secretKey: "sk_x" } },
    }
    expect(() => parse({ apps, defaultApp: "typpo" })).toThrow(/unknown app/)
    expect(() => parse({ apps, defaultApp: "myapp" })).not.toThrow()
  })

  test("provider name is discriminated and required", () => {
    expect(() => parse({ apps: { a: {} } })).toThrow()
    expect(() =>
      parse({
        apps: { a: { provider: { name: "paddle", secretKey: "sk" } } },
      }),
    ).toThrow()
    expect(() =>
      parse({
        apps: { a: { provider: { name: "stripe", apiKey: "k" } } },
      }),
    ).toThrow()
  })

  test("every provider name is accepted", () => {
    expect(() =>
      parse({
        apps: {
          rc: { provider: { name: "revenuecat", secretKey: "sk" } },
          adapty: { provider: { name: "adapty", secretKey: "s" } },
          web: { provider: { name: "apphud", apiKey: "k" } },
          q: { provider: { name: "qonversion", secretKey: "sk" } },
          iaphub: {
            provider: { name: "iaphub", apiKey: "k", appId: "a" },
          },
        },
      }),
    ).not.toThrow()
  })

  test("duplicate host+path rejected, same path on other host ok", () => {
    expect(() =>
      parse({
        routes: [
          { host: "a.example.com", paths: ["/v1/*"] },
          { host: "a.example.com", paths: ["/v1/*", "/v2"] },
        ],
      }),
    ).toThrow(/duplicate route/)
    expect(() =>
      parse({
        routes: [
          { host: "a.example.com", paths: ["/v1/*"] },
          { host: "b.example.com", paths: ["/v1/*"] },
        ],
      }),
    ).not.toThrow()
  })

  test("overlapping patterns on same host allowed, longest match wins", () => {
    expect(() =>
      parse({
        routes: [
          { host: "a.example.com", paths: ["/v1/*"] },
          { host: "a.example.com", paths: ["/v1/x"] },
        ],
      }),
    ).not.toThrow()
  })
})
