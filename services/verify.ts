import { timingSafeEqual } from "node:crypto"
import { CryptoHasher } from "bun"

const SIGNATURE_MAX_AGE = 5 * 60 * 1000 // 5 min

export function verify({
  method,
  host,
  path,
  timestamp,
  signature,
  userId,
  signingSecrets,
}: {
  method: string
  host: string
  path: string
  timestamp: string
  signature: string
  userId: string
  signingSecrets: string[]
}): boolean {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  if (Math.abs(Date.now() - ts) > SIGNATURE_MAX_AGE) return false

  const message = `${method.toUpperCase()}\n${host.toLowerCase()}\n${path}\n${timestamp}\n${userId}`
  const submitted = new TextEncoder().encode(signature)

  // rotation overlap: sign with the first secret, verify against any
  return signingSecrets.some((secret) => {
    const hasher = new CryptoHasher("sha256", secret)
    hasher.update(message)
    const expected = new TextEncoder().encode(hasher.digest("hex"))

    return (
      expected.length === submitted.length &&
      timingSafeEqual(expected, submitted)
    )
  })
}
