import type { Server } from "bun"
import { config } from "#/lib/config"
import { prettyMilliseconds } from "#/lib/utils"
import { Context } from "./context"
import { responseForError } from "./error"

export function httpHandler(handler: (ctx: Context) => Promise<Response>) {
  return async (req: Request, server: Server<unknown>): Promise<Response> => {
    let error: unknown

    const ctx = new Context(req, {}, config, server)

    const res = await handler(ctx).catch((err) => {
      if (err instanceof Response) return err
      error = err
      return responseForError(err)
    })

    const duration = prettyMilliseconds(performance.now() - ctx.startAt)

    if (error && res.status >= 500) {
      console.error(error, { requestId: ctx.requestId })
    }

    console.log(
      `${req.method} ${ctx.url.pathname} ${res.status} ${duration} ${ctx.requestId}`,
    )

    return res
  }
}
