import { isHTTPError, isNetworkError, isTimeoutError } from "ky"
import pMemoize from "p-memoize"
import type { AppEntry } from "#/lib/config"
import { providers } from "#/lib/providers"
import { isEntitlementActive, ProviderOutage } from "#/lib/providers/types"

const CACHE_TTL = 15 * 60 * 1000 // 15 min
const NEGATIVE_CACHE_TTL = 30 * 1000 // 30 sec
const CACHE_SIZE = 50000

interface CacheEntry {
  ok: boolean
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function cacheKey(appId: string, userId: string, entitlements: string[]) {
  return `${appId}\n${userId}\n${entitlements.toSorted().join("\n")}`
}

function evictIfNeeded() {
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key)
  }

  if (cache.size <= CACHE_SIZE) return

  // Map iterates in insertion order, drop oldest until under the cap
  for (const key of cache.keys()) {
    if (cache.size <= CACHE_SIZE) break
    cache.delete(key)
  }
}

export interface Identity {
  appId: string
  userId: string
}

function isProviderOutage(err: unknown): boolean {
  if (err instanceof ProviderOutage) return true

  if (isHTTPError(err)) {
    const { status } = err.response
    return status >= 500 || status === 429
  }

  // Bun's fetch surfaces connection failures as bare TypeErrors with this
  // message; any other TypeError is our bug and must fail closed
  if (err instanceof TypeError && err.message.startsWith("Unable to connect")) {
    return true
  }

  return isNetworkError(err) || isTimeoutError(err)
}

// inflight requests dedupe across all providers, keyed by provider config + user
const lookupEntitlements = pMemoize(
  async (userId: string, provider: AppEntry["provider"]) => {
    const impl = providers[provider.name]
    const { name: _name, ...config } = provider

    // config shape already validated by appSchema at boot
    return impl.getEntitlements(userId, config as never)
  },
  { shouldCache: () => false, cacheKey: JSON.stringify },
)

export async function authenticate(
  requiredEntitlements: string[],
  identity: Identity,
  app: AppEntry,
): Promise<boolean> {
  const key = cacheKey(identity.appId, identity.userId, requiredEntitlements)
  const cached = cache.get(key)

  if (cached && cached.expiresAt > Date.now()) {
    return cached.ok
  }
  if (cached) cache.delete(key)

  let entitlements: Awaited<ReturnType<typeof lookupEntitlements>>

  try {
    entitlements = await lookupEntitlements(identity.userId, app.provider)
  } catch (err) {
    if (!isProviderOutage(err)) throw err

    console.error(new Error(`${app.provider.name} outage`, { cause: err }), {
      userId: identity.userId,
      appId: identity.appId,
    })
    return true
  }

  if (entitlements === null) {
    cache.set(key, { ok: false, expiresAt: Date.now() + NEGATIVE_CACHE_TTL })
    evictIfNeeded()
    return false
  }

  // any one required entitlement grants access; an empty list requires none
  const granted =
    requiredEntitlements.length === 0 ||
    requiredEntitlements.some((e) => {
      const entitlement = entitlements[e]
      return entitlement ? isEntitlementActive(entitlement) : false
    })

  if (!granted) return false

  // save to cache only granted access
  // not granted must fetch every time, to be able to grant right after subscription purchase
  cache.set(key, { ok: true, expiresAt: Date.now() + CACHE_TTL })
  evictIfNeeded()

  return true
}
