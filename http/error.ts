import type { ErrorLike } from "bun"
import { isHTTPError, isNetworkError, isTimeoutError } from "ky"
import { ZodError } from "zod"
import { isErrorLike } from "#/lib/utils"
import { status } from "./utils"

export function responseForError(err: unknown) {
  switch (true) {
    case err instanceof ZodError: {
      return status(400)
    }

    case isNetworkError(err): {
      return status(503)
    }

    case isTimeoutError(err): {
      return status(504)
    }

    case isHTTPError(err): {
      return status(err.response.status >= 500 ? err.response.status : 500)
    }

    case isErrorLike(err): {
      return responseForErrorLike(err)
    }

    default: {
      return status(500)
    }
  }
}

function responseForErrorLike(err: ErrorLike) {
  switch (true) {
    case err.code === "ENOENT": {
      return status(404)
    }

    default: {
      return status(500)
    }
  }
}

export async function serverErrorHandler(err: ErrorLike) {
  const res = responseForErrorLike(err)

  if (res.status >= 500) {
    console.error(err)
  }

  return res
}
