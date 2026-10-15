/**
 * A signed, time-stamped token on the public booking form. It proves the form was loaded from this site a few seconds
 * ago, which stops scripts that post straight at the address without ever opening the page.
 * Server only (uses node:crypto). The secret is passed in so tests can use a fake one.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const MIN_FILL_MS = 3_000
export const MAX_AGE_MS = 2 * 60 * 60 * 1000

const sign = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('base64url')

export function issueFormToken(slug: string, secret: string, now = Date.now()): string {
  const nonce = randomBytes(6).toString('base64url')
  const body = `${now.toString(36)}.${nonce}`
  return `${body}.${sign(secret, `${slug}|${body}`)}`
}

export type TokenCheck = { ok: true } | { ok: false; reason: 'missing' | 'malformed' | 'bad-signature' | 'too-fast' | 'expired' }

export function verifyFormToken(token: unknown, slug: string, secret: string, now = Date.now(), limits: { minMs?: number; maxMs?: number } = {}): TokenCheck {
  if (typeof token !== 'string' || !token) return { ok: false, reason: 'missing' }
  const parts = token.split('.')
  if (parts.length !== 3 || token.length > 120) return { ok: false, reason: 'malformed' }
  const [ts, nonce, sig] = parts
  const expected = sign(secret, `${slug}|${ts}.${nonce}`)
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad-signature' }
  const issued = parseInt(ts, 36)
  if (!Number.isFinite(issued)) return { ok: false, reason: 'malformed' }
  const age = now - issued
  if (age < (limits.minMs ?? MIN_FILL_MS)) return { ok: false, reason: 'too-fast' }
  if (age > (limits.maxMs ?? MAX_AGE_MS)) return { ok: false, reason: 'expired' }
  return { ok: true }
}
