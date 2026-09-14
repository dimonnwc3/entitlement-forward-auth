import { ZodError, type z } from "zod"

export interface Entitlement {
  // null = lifetime, never expires
  expiresAt: number | null
  // end of billing grace period, 0 when none
  graceUntil: number
}

export type Entitlements = Record<string, Entitlement> | null

export interface Provider<TConfig> {
  getEntitlements(userId: string, config: TConfig): Promise<Entitlements>
}

export function isEntitlementActive(e: Entitlement): boolean {
  if (e.expiresAt === null) return true
  return Math.max(e.expiresAt, e.graceUntil) > Date.now()
}

export class ProviderOutage extends Error {}

export function parse<T>(
  schema: z.ZodType<T>,
  body: unknown,
  provider: string,
): T {
  try {
    return schema.parse(body)
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(`${provider} schema mismatch`, { cause: err })
    }
    throw err
  }
}
