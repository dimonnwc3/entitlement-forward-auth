import ky, { isHTTPError } from "ky"
import { z } from "zod"
import type { AdaptyConfig } from "#/lib/config"
import {
  type Entitlement,
  type Entitlements,
  type Provider,
  parse,
} from "./types"

const profileResponseSchema = z.object({
  data: z.object({
    access_levels: z.record(
      z.string(),
      z.object({
        is_active: z.boolean(),
        expires_at: z.string().nullable(),
        grace_period_expires_at: z.string().nullish(),
      }),
    ),
  }),
})

const http = ky.create({
  baseUrl: "https://api.adapty.io/api/v2/server-side-api",
  retry: {
    maxRetryAfter: 5000,
    backoffLimit: 5000,
    jitter: true,
  },
})

export function entitlementsFromAdaptyProfile(
  body: z.infer<typeof profileResponseSchema>,
): Entitlements {
  const out: Record<string, Entitlement> = {}
  for (const [id, level] of Object.entries(body.data.access_levels)) {
    // is_active is authoritative: false means no access even with a future
    // expires_at (e.g. starts_at in the future)
    if (!level.is_active) continue
    out[id] = {
      expiresAt: level.expires_at === null ? null : +new Date(level.expires_at),
      graceUntil:
        level.grace_period_expires_at == null
          ? 0
          : +new Date(level.grace_period_expires_at),
    }
  }
  return out
}

export const adapty: Provider<AdaptyConfig> = {
  async getEntitlements(userId, { secretKey }) {
    if (/[\r\n]/.test(userId)) {
      // header injection attempt
      throw new Error("adapty user id contains CR/LF")
    }

    try {
      const body = await http
        .get("profile/", {
          headers: {
            Authorization: `Api-Key ${secretKey}`,
            "adapty-customer-user-id": userId,
          },
        })
        .json()
      return entitlementsFromAdaptyProfile(
        parse(profileResponseSchema, body, "adapty"),
      )
    } catch (err) {
      if (isHTTPError(err) && err.response.status === 404) return null
      throw err
    }
  },
}
