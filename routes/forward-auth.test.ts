import { describe, expect, test } from "bun:test"
import type { Route } from "#/lib/config"
import { forwardedTarget, matchRoute } from "./forward-auth"

function route(r: Partial<Route>): Route {
  return { entitlements: [], ...r }
}

describe("forwardedTarget", () => {
  const f = (over: Partial<Parameters<typeof forwardedTarget>[0]>) =>
    forwardedTarget({
      method: "get",
      uri: "/x",
      for: [],
      ...over,
    })

  test("absolute uri: path+query from url, host from url, port dropped", () => {
    expect(
      f({
        method: "GET",
        uri: "https://app.example.com:8443/api/v1/x?q=1",
      }),
    ).toEqual({
      method: "GET",
      path: "/api/v1/x?q=1",
      host: "app.example.com",
    })
  })

  test("path+query uri with separate host, method uppercased", () => {
    expect(
      f({ method: "get", uri: "/api/v1/x?q=1", host: "APP.example.com" }),
    ).toEqual({
      method: "GET",
      path: "/api/v1/x?q=1",
      host: "app.example.com",
    })
  })

  test("strips the port from the forwarded host", () => {
    expect(f({ host: "app.example.com:8080" })).toEqual({
      method: "GET",
      path: "/x",
      host: "app.example.com",
    })
  })

  test("keeps ipv6 literal, strips brackets and port", () => {
    expect(f({ host: "[::1]:8080" })).toEqual({
      method: "GET",
      path: "/x",
      host: "::1",
    })
  })

  test("rejects when no host can be determined", () => {
    expect(f({})).toBeNull()
  })

  test("rejects unparseable host (bare ipv6 without brackets)", () => {
    expect(f({ host: "::1" })).toBeNull()
  })
})

describe("matchRoute", () => {
  const t = (over: Partial<Parameters<typeof matchRoute>[1]>) => ({
    method: "GET",
    host: "any.example.com",
    path: "/x",
    ...over,
  })

  test("host-scoped route beats hostless route with longer path", () => {
    const hostless = route({ paths: ["/api/v1/*"] })
    const hostScoped = route({ host: "api.example.com", paths: ["/*"] })

    expect(
      matchRoute(
        [hostless, hostScoped],
        t({ host: "api.example.com", path: "/api/v1/x" }),
      ),
    ).toBe(hostScoped)
  })

  test("exact beats wildcard regardless of config order", () => {
    const wild = route({ paths: ["/api/*"] })
    const exact = route({ paths: ["/api/x"] })

    expect(matchRoute([wild, exact], t({ path: "/api/x" }))).toBe(exact)
    expect(matchRoute([exact, wild], t({ path: "/api/x" }))).toBe(exact)
  })

  test("longer wildcard wins when exactness is equal", () => {
    const broad = route({ paths: ["/v1/*"] })
    const narrow = route({ paths: ["/v1/convert/*"] })

    expect(matchRoute([broad, narrow], t({ path: "/v1/convert/source" }))).toBe(
      narrow,
    )
    expect(matchRoute([broad, narrow], t({ path: "/v1/x" }))).toBe(broad)
  })

  test("exact path does not match sub-paths", () => {
    const r = route({ paths: ["/v1/complete"] })

    expect(matchRoute([r], t({ path: "/v1/complete/extra" }))).toBeUndefined()
  })

  test("query string is ignored", () => {
    const exact = route({ paths: ["/v1/complete"] })
    const wild = route({ paths: ["/v1/*"] })

    expect(matchRoute([exact], t({ path: "/v1/complete?stream=true" }))).toBe(
      exact,
    )
    expect(matchRoute([wild], t({ path: "/v1/complete?stream=true" }))).toBe(
      wild,
    )
  })

  test("wildcard does not bleed into longer segments", () => {
    const r = route({ paths: ["/v1/*"] })

    expect(matchRoute([r], t({ path: "/v10" }))).toBeUndefined()
    expect(matchRoute([r], t({ path: "/v1" }))).toBe(r)
    expect(matchRoute([r], t({ path: "/v1/" }))).toBe(r)
    expect(matchRoute([r], t({ path: "/v1/x" }))).toBe(r)
  })

  test("root-only via exact /, everything via /*", () => {
    const root = route({ paths: ["/"] })
    const all = route({ paths: ["/*"] })

    expect(matchRoute([root, all], t({ path: "/" }))).toBe(root)
    expect(matchRoute([root, all], t({ path: "/deep/path" }))).toBe(all)
  })

  test("method filter: listed methods pass, others miss, absent = any", () => {
    const writes = route({ methods: ["POST", "PUT"], paths: ["/v1/*"] })
    const any = route({ paths: ["/v1/*"] })

    expect(matchRoute([writes], t({ method: "POST", path: "/v1/x" }))).toBe(
      writes,
    )
    expect(matchRoute([writes], t({ method: "PUT", path: "/v1/x" }))).toBe(
      writes,
    )
    expect(
      matchRoute([writes], t({ method: "GET", path: "/v1/x" })),
    ).toBeUndefined()
    expect(matchRoute([any], t({ method: "DELETE", path: "/v1/x" }))).toBe(any)
  })

  test("one route covers several paths", () => {
    const r = route({
      paths: ["/v1/convert/source", "/v1alpha/convert/source"],
    })

    expect(matchRoute([r], t({ path: "/v1/convert/source" }))).toBe(r)
    expect(matchRoute([r], t({ path: "/v1alpha/convert/source" }))).toBe(r)
    expect(matchRoute([r], t({ path: "/v1/other" }))).toBeUndefined()
  })

  test("route without paths matches any path", () => {
    const r = route({ host: "convert.example.com" })

    expect(
      matchRoute(
        [r],
        t({ host: "convert.example.com", path: "/anything/here" }),
      ),
    ).toBe(r)
  })

  test("skips routes scoped to another host", () => {
    const other = route({ host: "other.example.com", paths: ["/*"] })

    expect(
      matchRoute([other], t({ host: "any.example.com", path: "/x" })),
    ).toBeUndefined()
  })
})
