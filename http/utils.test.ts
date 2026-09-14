import { describe, expect, test } from "bun:test"
import { getForwardedHeaders } from "./utils"

function forwarded(headers: Record<string, string>) {
  return getForwardedHeaders(new Request("http://auth.local/", { headers }))
}

describe("getForwardedHeaders", () => {
  test("remaps all standard headers", () => {
    expect(
      forwarded({
        "x-forwarded-method": "GET",
        "x-forwarded-uri": "/api/v1/x?q=1",
        "x-forwarded-host": "app.example.com",
        "x-forwarded-proto": "https",
        "x-forwarded-port": "8443",
        "x-forwarded-for": "192.0.2.60, 10.0.0.1",
      }),
    ).toEqual({
      method: "GET",
      uri: "/api/v1/x?q=1",
      host: "app.example.com",
      proto: "https",
      port: "8443",
      for: ["192.0.2.60", "10.0.0.1"],
    })
  })

  test("optional headers absent", () => {
    expect(
      forwarded({ "x-forwarded-method": "GET", "x-forwarded-uri": "/x" }),
    ).toEqual({
      method: "GET",
      uri: "/x",
      host: undefined,
      proto: undefined,
      port: undefined,
      for: [],
    })
  })

  test("falls back to x-original-* headers", () => {
    expect(
      forwarded({
        "x-original-method": "GET",
        "x-original-uri": "/x",
        "x-original-host": "app.example.com",
      }),
    ).toEqual({
      method: "GET",
      uri: "/x",
      host: "app.example.com",
      proto: undefined,
      port: undefined,
      for: [],
    })
  })

  test("host keeps only first entry of a comma list", () => {
    expect(
      forwarded({
        "x-forwarded-method": "GET",
        "x-forwarded-uri": "/x",
        "x-forwarded-host": "a.example.com, b.example.com",
      })?.host,
    ).toBe("a.example.com")
  })

  test("rejects when method or uri is missing", () => {
    expect(forwarded({ "x-forwarded-uri": "/x" })).toBeNull()
    expect(forwarded({ "x-forwarded-method": "GET" })).toBeNull()
  })
})
