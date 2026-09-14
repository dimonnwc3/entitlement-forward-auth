import type { Context } from "#/http/context"
import type { ForwardedHeaders } from "#/http/utils"
import { getForwardedHeaders, status } from "#/http/utils"
import type { Method, Route } from "#/lib/config"
import { authenticate, type Identity } from "#/services/forward-auth"
import { verify } from "#/services/verify"

export interface ForwardedTarget {
  method: string
  host: string
  path: string
}

export function forwardedTarget(f: ForwardedHeaders): ForwardedTarget | null {
  let path = f.uri
  let host = f.host

  try {
    const parsed = new URL(f.uri)
    path = `${parsed.pathname}${parsed.search}`
    host = host ?? parsed.hostname
  } catch {
    // path+query form, already assigned
  }

  if (!host) return null

  // Strips the port for IPv4 and bare hostnames, keeps IPv6 literals intact.
  try {
    host = new URL(`http://${host}`).hostname.replace(/^\[(.+)\]$/, "$1")
  } catch {
    return null
  }

  return { method: f.method.toUpperCase(), host, path }
}

function pathMatches(pathname: string, pattern: string) {
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2)
    // "/*" matches everything, "/v1/*" matches "/v1" itself and everything under it
    return pathname === base || pathname.startsWith(`${base}/`)
  }
  return pathname === pattern
}

// exact patterns rank by full length, "/v1/*" by its "/v1" part
function specificity(pattern: string) {
  return pattern.endsWith("/*") ? pattern.length - 2 : pattern.length
}

export function matchRoute(
  routes: Route[],
  target: ForwardedTarget,
): Route | undefined {
  // the query string never takes part in matching
  const pathname = target.path.split("?")[0] ?? ""
  let best: { route: Route; score: number } | undefined

  for (const route of routes) {
    if (route.host && route.host.toLowerCase() !== target.host.toLowerCase()) {
      continue
    }
    if (route.methods && !route.methods.includes(target.method as Method)) {
      continue
    }

    // a route without paths covers any path, ranked as a zero-length match
    let score = 0
    if (route.paths) {
      const match = route.paths
        .filter((p) => pathMatches(pathname, p))
        .sort((a, b) => specificity(b) - specificity(a))
        .at(0)

      if (!match) continue

      score = specificity(match)
    }

    // host-scoped routes win over hostless ones, then the longest match wins
    const better =
      !best ||
      (Boolean(route.host) !== Boolean(best.route.host)
        ? Boolean(route.host)
        : score > best.score)
    if (better) best = { route, score }
  }

  return best?.route
}

export async function ALL({
  req,
  config,
  requestId,
}: Context): Promise<Response> {
  const forwarded = getForwardedHeaders(req)
  const target = forwarded && forwardedTarget(forwarded)
  if (!target) return status(401)

  console.log(
    `forwarded ${target.method} ${target.host}${target.path} ${requestId}`,
  )

  const match = matchRoute(config.routes, target)

  if (!match) return status(401)

  const identity: Identity = {
    appId: req.headers.get(config.authHeaders.app) ?? config.defaultApp ?? "",
    userId: req.headers.get(config.authHeaders.user) ?? "",
  }

  if (!identity.appId || !identity.userId) return status(401)

  const app = Object.hasOwn(config.apps, identity.appId)
    ? config.apps[identity.appId]
    : undefined
  if (!app) return status(401)

  if (app.signingSecrets) {
    const timestamp = req.headers.get(config.authHeaders.timestamp)
    const signature = req.headers.get(config.authHeaders.signature)
    if (!timestamp || !signature) return status(401)

    const valid = verify({
      method: target.method,
      host: target.host,
      path: target.path,
      timestamp,
      signature,
      userId: identity.userId,
      signingSecrets: app.signingSecrets,
    })

    if (!valid) return status(401)
  }

  const granted = await authenticate(match.entitlements, identity, app)
  if (!granted) return status(403)

  return status(200, {
    ...match.headers,
    [config.responseHeaders.app]: identity.appId,
    [config.responseHeaders.user]: identity.userId,
  })
}
