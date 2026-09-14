import { once } from "node:events"
import { serve } from "bun"
import { serverErrorHandler } from "#/http/error"
import { httpHandler } from "#/http/handler"
import * as live from "#/routes/__live__"
import * as auth from "#/routes/forward-auth"

const server = serve({
  hostname: process.env.HOST ?? "0.0.0.0",
  routes: {
    "/__live__": { GET: live.GET },
    "/forward-auth": httpHandler(auth.ALL),
  },
  error: serverErrorHandler,
  idleTimeout: 120,
})

console.log(`listening on http://${server.hostname}:${server.port}`)

if (process.env.NODE_ENV === "production") {
  await Promise.race([once(process, "SIGTERM"), once(process, "SIGINT")])
  console.log("shutting down application")

  await server.stop()
  console.log("server stopped")
}
