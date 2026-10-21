import { createHmac, timingSafeEqual } from 'node:crypto'

// A signed, no-login unsubscribe link for emails the shop sends. The link says which shop and which
// email address; the signature stops anyone from unsubscribing a different address by editing it.
// It never expires, because an unsubscribe link must keep working for as long as the email exists.

/** Every secret a link may have been signed with, newest choice first. New links use the first. */
function secrets(): string[] {
  const all = [process.env.UNSUBSCRIBE_SECRET, process.env.INTERNAL_API_SECRET, process.env.CRON_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY]
  return all.filter((v): v is string => typeof v === 'string' && v.length > 0).filter((v, i, a) => a.indexOf(v) === i)
}

const secret = (): string => secrets()[0] || ''

const signWith = (key: string, payload: string): string => createHmac('sha256', key).update(`unsubscribe:${payload}`).digest('base64url')
const sign = (payload: string): string => signWith(secret(), payload)

export function createUnsubscribeToken(shopId: string, email: string): string {
  if (!secret()) throw new Error('No signing secret is configured')
  const payload = Buffer.from(JSON.stringify({ s: shopId, e: email.trim().toLowerCase() })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifyUnsubscribeToken(token: unknown): { shopId: string; email: string } | null {
  if (typeof token !== 'string' || !token || token.length > 600 || !secret()) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  // A link must keep working after a new secret is set (audit B3: setting CRON_SECRET would otherwise have broken
  // every unsubscribe link already emailed, which were signed with the service key). So any configured secret is accepted.
  const matches = secrets().some(key => {
    const expected = signWith(key, payload)
    return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  })
  try {
    if (!matches) return null
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { s?: unknown; e?: unknown }
    if (typeof parsed.s !== 'string' || typeof parsed.e !== 'string' || !parsed.s || !/^[^\s@]+@[^\s@]+$/.test(parsed.e)) return null
    return { shopId: parsed.s, email: parsed.e }
  } catch {
    return null
  }
}

export const unsubscribeUrl = (baseUrl: string, token: string): string => `${baseUrl.replace(/\/+$/, '')}/api/outreach/unsubscribe?t=${encodeURIComponent(token)}`
