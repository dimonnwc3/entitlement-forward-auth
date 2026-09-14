import { describe, expect, test } from "bun:test"
import { CryptoHasher } from "bun"
import { verify } from "./verify"

const SECRET = "test-secret"
const HOST = "api.example.com"
const PATH = "/api/v1/x"
const USER = "user-1"
const NOW = Date.now()

function sign(
  method: string,
  path: string,
  timestamp: string,
  userId: string = USER,
  secret: string = SECRET,
  host: string = HOST,
) {
  const hasher = new CryptoHasher("sha256", secret)
  hasher.update(
    `${method.toUpperCase()}\n${host.toLowerCase()}\n${path}\n${timestamp}\n${userId}`,
  )
  return hasher.digest("hex")
}

function attempt(overrides: {
  method?: string
  host?: string
  path?: string
  timestamp?: string
  signature?: string
  userId?: string
  signingSecrets?: string[]
}) {
  return verify({
    method: "GET",
    host: HOST,
    path: PATH,
    timestamp: `${NOW}`,
    signature: sign("GET", PATH, `${NOW}`),
    userId: USER,
    signingSecrets: [SECRET],
    ...overrides,
  })
}

describe("verify", () => {
  test("accepts a fresh valid signature", () => {
    expect(attempt({})).toBe(true)
  })

  test("accepts a signature signed with uppercase host", () => {
    expect(
      attempt({
        host: HOST.toUpperCase(),
        signature: sign(
          "GET",
          PATH,
          `${NOW}`,
          USER,
          SECRET,
          HOST.toUpperCase(),
        ),
      }),
    ).toBe(true)
  })

  test("rejects a signature for a different host", () => {
    expect(attempt({ host: "other.example.com" })).toBe(false)
  })

  test("rejects an expired timestamp", () => {
    const ts = `${NOW - 10 * 60 * 1000}`
    expect(attempt({ timestamp: ts, signature: sign("GET", PATH, ts) })).toBe(
      false,
    )
  })

  test("rejects a future timestamp", () => {
    const ts = `${NOW + 10 * 60 * 1000}`
    expect(attempt({ timestamp: ts, signature: sign("GET", PATH, ts) })).toBe(
      false,
    )
  })

  test("rejects a tampered path", () => {
    expect(attempt({ path: "/api/v1/admin" })).toBe(false)
  })

  test("rejects a tampered method", () => {
    expect(
      attempt({ method: "DELETE", signature: sign("POST", PATH, `${NOW}`) }),
    ).toBe(false)
  })

  test("rejects a mismatched user", () => {
    expect(attempt({ userId: "user-2" })).toBe(false)
  })

  test("rejects a signature from a different secret", () => {
    expect(
      attempt({ signature: sign("GET", PATH, `${NOW}`, USER, "other-secret") }),
    ).toBe(false)
  })

  test("accepts any secret in the rotation overlap", () => {
    const rotated = "test-secret-v2"
    expect(
      attempt({
        signingSecrets: [rotated, SECRET],
        signature: sign("GET", PATH, `${NOW}`, USER, rotated),
      }),
    ).toBe(true)
    expect(
      attempt({
        signingSecrets: [rotated, SECRET],
        signature: sign("GET", PATH, `${NOW}`, USER, SECRET),
      }),
    ).toBe(true)
    expect(
      attempt({
        signingSecrets: [rotated, SECRET],
        signature: sign("GET", PATH, `${NOW}`, USER, "third-secret"),
      }),
    ).toBe(false)
  })

  test("rejects garbage timestamps", () => {
    expect(attempt({ timestamp: "abc" })).toBe(false)
    expect(attempt({ timestamp: "" })).toBe(false)
  })
})
