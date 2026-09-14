import type { ErrorLike } from "bun"

export const isErrorLike = (err: unknown): err is ErrorLike =>
  err instanceof Error

export function prettyMilliseconds(ms: number): string {
  if (ms < 1) return "1ms"
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(2)}m`
}
