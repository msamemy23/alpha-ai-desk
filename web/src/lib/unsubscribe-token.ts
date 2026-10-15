import { createHmac, timingSafeEqual } from 'node:crypto'

// A signed, no-login unsubscribe link for emails the shop sends. The link says which shop and which
// email address; the signature stops anyone from unsubscribing a different address by editing it.
// It never expires, because an unsubscribe link must keep working for as long as the email exists.

function secret(): string {
  return process.env.UNSUBSCRIBE_SECRET
    || process.env.INTERNAL_API_SECRET
    || process.env.CRON_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || ''
}

const sign = (payload: string): string => createHmac('sha256', secret()).update(`unsubscribe:${payload}`).digest('base64url')

export function createUnsubscribeToken(shopId: string, email: string): string {
  if (!secret()) throw new Error('No signing secret is configured')
  const payload = Buffer.from(JSON.stringify({ s: shopId, e: email.trim().toLowerCase() })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

export function verifyUnsubscribeToken(token: unknown): { shopId: string; email: string } | null {
  if (typeof token !== 'string' || !token || token.length > 600 || !secret()) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = sign(payload)
  try {
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { s?: unknown; e?: unknown }
    if (typeof parsed.s !== 'string' || typeof parsed.e !== 'string' || !parsed.s || !/^[^\s@]+@[^\s@]+$/.test(parsed.e)) return null
    return { shopId: parsed.s, email: parsed.e }
  } catch {
    return null
  }
}

export const unsubscribeUrl = (baseUrl: string, token: string): string => `${baseUrl.replace(/\/+$/, '')}/api/outreach/unsubscribe?t=${encodeURIComponent(token)}`
