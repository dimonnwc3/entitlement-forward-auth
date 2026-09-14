import ky, { isHTTPError } from "ky"
import { z } from "zod"
import type { QonversionConfig } from "#/lib/config"
import { type Entitlements, type Provider, parse } from "./types"

const entitlementItemSchema = z.object({
  id: z.string(),
  is_active: z.boolean().optional(),
  expires_at: z.string().nullable(),
})

const http = ky.create({
  baseUrl: "https://api.qonversion.io",
  retry: {
    maxRetryAfter: 5000,
    backoffLimit: 5000,
    jitter: true,
  },
})

// v4 lists are paginated but the docs do not pin the wrapper key; try the
// common ones and fall back to a bare array. Unknown shape throws instead of
// parsing into {} and silently 403-ing every user.
function entitlementsItems(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  if (body !== null && typeof body === "object") {
    for (const key of ["items", "data", "results"]) {
      const value = (body as Record<string, unknown>)[key]
      if (Array.isArray(value)) return value
    }
  }
  throw new Error("qonversion schema mismatch: no entitlement list in response")
}

export function entitlementsFromQonversionItems(
  items: unknown[],
): Entitlements {
  const out: Record<string, { expiresAt: number | null; graceUntil: 0 }> = {}
  for (const item of items) {
    const e = parse(entitlementItemSchema, item, "qonversion")
    if (e.is_active === false) continue
    out[e.id] = {
      expiresAt: e.expires_at == null ? null : +new Date(e.expires_at),
      graceUntil: 0,
    }
  }
  return out
}

export const qonversion: Provider<QonversionConfig> = {
  async getEntitlements(userId, { secretKey }) {
    try {
      const body = await http
        .get(`v4/users/${encodeURIComponent(userId)}/entitlements`, {
          headers: { Authorization: `Bearer ${secretKey}` },
        })
        .json()
      return entitlementsFromQonversionItems(entitlementsItems(body))
    } catch (err) {
      if (isHTTPError(err) && err.response.status === 404) return null
      throw err
    }
  },
}
