import { randomUUIDv7, type Server } from "bun"
import type { Config } from "#/lib/config"

export class Context {
  constructor(
    req: Request,
    params: Record<string, string>,
    config: Config,
    server: Server<unknown>,
  ) {
    this.req = req
    this.url = new URL(req.url)
    this.params = params
    this.server = server
    this.requestId = req.headers.get("Request-Id") ?? randomUUIDv7()
    this.startAt = performance.now()
    this.config = config
  }

  req: Request
  url: URL
  params: Record<string, string>
  requestId: string
  startAt: number
  config: Config
  server: Server<unknown>
}
