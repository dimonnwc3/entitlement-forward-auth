import ky, { isHTTPError } from "ky"
import { z } from "zod"
import type { IaphubConfig } from "#/lib/config"
import { type Entitlements, type Provider, parse } from "./types"

const userResponseSchema = z.object({
  activeProducts: z
    .array(
      z.object({
        // product id
        id: z.string(),
        type: z.string(),
        groupName: z.string().nullish(),
        expirationDate: z.string().nullish(),
        isSubscriptionRetryPeriod: z.boolean().nullish(),
      }),
    )
    .default([]),
})

const http = ky.create({
  baseUrl: "https://api.iaphub.com",
  // IAPHUB rate limit: 5 r/s per endpoint, be gentle on retries
  retry: {
    limit: 1,
    maxRetryAfter: 5000,
    backoffLimit: 5000,
    jitter: true,
  },
})

// billing retry period can outlive expirationDate; IAPHUB gives a flag, not a
// date — 30d covers Google's retry window, the longest of the stores
const RETRY_GRACE = 30 * 24 * 60 * 60 * 1000

export function entitlementsFromIaphubUser(
  body: z.infer<typeof userResponseSchema>,
): Entitlements {
  const out: Record<string, { expiresAt: number | null; graceUntil: number }> =
    {}
  for (const p of body.activeProducts) {
    const expiresAt =
      p.expirationDate == null ? null : +new Date(p.expirationDate)
    const entitlement = {
      expiresAt,
      graceUntil:
        p.isSubscriptionRetryPeriod && expiresAt !== null
          ? expiresAt + RETRY_GRACE
          : 0,
    }
    // usable both as product id and group name, whichever the routes gate on
    out[p.id] = entitlement
    if (p.groupName) out[p.groupName] = entitlement
  }
  return out
}

export const iaphub: Provider<IaphubConfig> = {
  async getEntitlements(userId, { apiKey, appId }) {
    try {
      const body = await http
        .get(
          `v1/app/${encodeURIComponent(appId)}/user/${encodeURIComponent(userId)}`,
          { headers: { Authorization: `ApiKey ${apiKey}` } },
        )
        .json()
      return entitlementsFromIaphubUser(
        parse(userResponseSchema, body, "iaphub"),
      )
    } catch (err) {
      if (isHTTPError(err) && err.response.status === 404) return null
      throw err
    }
  },
}
