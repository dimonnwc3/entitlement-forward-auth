export function status(statusCode: number, headers?: Record<string, string>) {
  return new Response(null, { status: statusCode, headers })
}

export function text(
  body: string,
  statusCode?: number,
  headers?: Record<string, string>,
) {
  return new Response(body, {
    status: statusCode,
    headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
  })
}

type ForwardedName = "method" | "uri" | "host" | "proto" | "port" | "for"

export function getForwardedHeader(req: Request, name: ForwardedName) {
  return (
    req.headers.get(`x-forwarded-${name}`) ??
    req.headers.get(`x-original-${name}`)
  )
}

function firstEntry(header: string | null) {
  return header?.split(",")[0]?.trim() || undefined
}

export interface ForwardedHeaders {
  method: string
  uri: string
  host?: string
  proto?: string
  port?: string
  for: string[]
}

export function getForwardedHeaders(req: Request): ForwardedHeaders | null {
  const method = getForwardedHeader(req, "method")
  const uri = getForwardedHeader(req, "uri")
  if (!method || !uri) return null

  const chain = (getForwardedHeader(req, "for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)

  return {
    method,
    uri,
    host: firstEntry(getForwardedHeader(req, "host")),
    proto: firstEntry(getForwardedHeader(req, "proto")),
    port: firstEntry(getForwardedHeader(req, "port")),
    for: chain,
  }
}
