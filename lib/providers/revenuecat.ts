import ky, { isHTTPError } from "ky"
import { z } from "zod"
import type { RevenueCatConfig } from "#/lib/config"
import {
  type Entitlement,
  type Entitlements,
  type Provider,
  parse,
} from "./types"

const subscriberResponseSchema = z.object({
  subscriber: z.object({
    entitlements: z.record(
      z.string(),
      z.object({
        expires_date: z.string().nullable(),
        product_identifier: z.string(),
        purchase_date: z.string(),
        grace_period_expires_date: z.string().nullable(),
      }),
    ),
  }),
})

const http = ky.create({
  baseUrl: "https://api.revenuecat.com",
  retry: {
    maxRetryAfter: 5000,
    backoffLimit: 5000,
    jitter: true,
  },
})

export function entitlementsFromSubscriber(
  subscriber: z.infer<typeof subscriberResponseSchema>["subscriber"],
): Entitlements {
  const out: Record<string, Entitlement> = {}
  for (const [id, e] of Object.entries(subscriber.entitlements)) {
    out[id] = {
      expiresAt: e.expires_date === null ? null : +new Date(e.expires_date),
      graceUntil:
        e.grace_period_expires_date === null
          ? 0
          : +new Date(e.grace_period_expires_date),
    }
  }
  return out
}

async function getSubscriber(
  id: string,
  secretKey: string,
  existingOnly: boolean,
) {
  // Get or Create Customer
  const res = await http.get(`v1/subscribers/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  })

  const body = await res.json()

  if (res.status === 201 && existingOnly) {
    // we do not want to create dummy customers
    deleteSubscriber(id, secretKey).catch(console.error)
    return null
  }

  return parse(subscriberResponseSchema, body, "revenuecat").subscriber
}

async function deleteSubscriber(id: string, secretKey: string) {
  await http
    .delete(`v1/subscribers/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    .json()
    .catch((err) => {
      // For retry-safe flows, treat both 200 and 404 as successful "ensure deleted" completion.
      if (!isHTTPError(err)) throw err
      if (err.response.status !== 404) throw err
    })
}

export const revenuecat: Provider<RevenueCatConfig> = {
  async getEntitlements(userId, { secretKey }) {
    const subscriber = await getSubscriber(userId, secretKey, true)
    if (!subscriber) return null
    return entitlementsFromSubscriber(subscriber)
  },
}
