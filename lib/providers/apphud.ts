import ky, { isHTTPError } from "ky"
import { z } from "zod"
import type { ApphudConfig } from "#/lib/config"
import {
  type Entitlement,
  type Entitlements,
  type Provider,
  ProviderOutage,
  parse,
} from "./types"

const customerResponseSchema = z.object({
  errors: z.unknown().nullish(),
  data: z
    .object({
      results: z
        .object({
          subscriptions: z
            .array(
              z.object({
                product_id: z.string(),
                group: z.string().nullable(),
                status: z.string(),
                expires_at: z.string().nullable(),
                in_retry_billing: z.boolean(),
              }),
            )
            .default([]),
        })
        .nullish(),
    })
    .nullish(),
})

const http = ky.create({
  baseUrl: "https://api.apphud.com",
  retry: {
    maxRetryAfter: 5000,
    backoffLimit: 5000,
    jitter: true,
  },
})

// trial/intro/promo/promotional/grace still grant access; expired/refunded do not
const ACTIVE_STATUSES = new Set([
  "trial",
  "intro",
  "promo",
  "promotional",
  "regular",
  "grace",
])

// billing retry can outlive expires_at; Apphud gives a flag, not a date —
// 30d covers Google's retry window, the longest of the stores
const RETRY_GRACE = 30 * 24 * 60 * 60 * 1000

export function entitlementsFromApphudCustomer(
  body: z.infer<typeof customerResponseSchema>,
): Entitlements {
  const out: Record<string, Entitlement> = {}
  for (const sub of body.data?.results?.subscriptions ?? []) {
    if (!ACTIVE_STATUSES.has(sub.status)) continue
    const expiresAt = sub.expires_at == null ? null : +new Date(sub.expires_at)
    const entitlement = {
      expiresAt,
      graceUntil:
        sub.in_retry_billing && expiresAt !== null
          ? expiresAt + RETRY_GRACE
          : 0,
    }
    // usable both as product id and group name, whichever the routes gate on
    out[sub.product_id] = entitlement
    if (sub.group) out[sub.group] = entitlement
  }
  return out
}

export const apphud: Provider<ApphudConfig> = {
  async getEntitlements(userId, { apiKey }) {
    try {
      const body = await http
        .get("v1/customers", {
          searchParams: { api_key: apiKey, user_id: userId },
        })
        .json()
      const parsed = parse(customerResponseSchema, body, "apphud")
      // 200 with an errors array is an Apphud-side failure, not an unknown user
      if (parsed.errors != null)
        throw new ProviderOutage("apphud errors in response", {
          cause: new Error(JSON.stringify(parsed.errors)),
        })
      if (parsed.data?.results == null) return null
      return entitlementsFromApphudCustomer(parsed)
    } catch (err) {
      if (isHTTPError(err) && err.response.status === 404) return null
      throw err
    }
  },
}
