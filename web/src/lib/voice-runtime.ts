/**
 * Connects the receptionist's pure code (src/lib/voice/*) to the real services: the database, the shop's Telnyx account,
 * its email settings and its AI key. Server-only. Every lookup is limited to one shop, and the shop is found from the number
 * that was called without loading anyone else's keys.
 */
import { getServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/sms'
import { fromNumberOf, smsOptionsFor } from '@/lib/text-channel'
import { sendEmail } from '@/lib/email'
import { isSmsOptedOut, recordSmsOptIn, recordSmsOptOut } from '@/lib/sms-consent'
import { phoneKey } from '@/lib/voice/rules'
import { createVoiceClientState, verifyVoiceClientState } from '@/lib/voice-state'
import type { SmsConsent, ShopRow } from '@/lib/voice/sms-pipeline'
import type { EmailSender } from '@/lib/voice/actions'

export type ServiceDb = ReturnType<typeof getServiceClient>

export function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, '')
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return ''
}

/** The shop that owns a number, or null when no shop (or more than one) does. Secrets are loaded only for the match. */
export async function findShopByNumber(db: ServiceDb, number: string): Promise<ShopRow | null> {
  const target = phoneKey(number)
  if (target.length < 10) return null
  const { data, error } = await db.from('settings').select('shop_id,telnyx_phone_number,shop_phone').not('shop_id', 'is', null).limit(5000)
  if (error) throw new Error('settings lookup failed')
  const matches = ((data || []) as Array<{ shop_id: string; telnyx_phone_number?: string | null; shop_phone?: string | null }>)
    .filter(r => [r.telnyx_phone_number, r.shop_phone].some(v => phoneKey(v) === target))
  // A shared number is ambiguous: never route one shop's customers into another shop's inbox.
  const ids = Array.from(new Set(matches.map(m => m.shop_id)))
  if (ids.length !== 1) return null
  return loadShopRow(db, ids[0])
}

export async function loadShopRow(db: ServiceDb, shopId: string): Promise<ShopRow | null> {
  const { data, error } = await db.from('settings').select('*').eq('shop_id', shopId).limit(1).maybeSingle()
  if (error) throw new Error('settings lookup failed')
  return (data as ShopRow | null) || null
}

export function buildConsent(db: ServiceDb): SmsConsent {
  return {
    isOptedOut: (shopId, phone) => isSmsOptedOut(db, shopId, phone),
    optOut: (shopId, phone, source) => recordSmsOptOut(db, shopId, phone, source),
    optIn: (shopId, phone, source) => recordSmsOptIn(db, shopId, phone, source),
  }
}

/** Sends from the shop's own number: its Telnyx number, or its own phone when the shop chose that. Always with the shop's own keys. */
export function buildTextSender(shop: ShopRow): (to: string, text: string, opts: { idempotencyKey: string }) => Promise<void> {
  return async (to, text, opts) => {
    // Throws a plain sentence when the shop cannot text, so the caller records why nothing went out.
    const options = smsOptionsFor(shop, { idempotencyKey: opts.idempotencyKey.slice(0, 120) })
    await sendSMS(to, text, fromNumberOf(shop) || String(shop.shop_phone || ''), options)
  }
}

/** Plain-text notes to the shop's own team, from the shop's own email setup. */
export function buildEmailSender(shop: ShopRow): EmailSender {
  return async ({ to, subject, text, idempotencyKey }) => {
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    await sendEmail({
      to,
      subject,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;max-width:600px;white-space:pre-wrap">${esc(text)}</div>`,
      apiKey: shop.resend_api_key ? String(shop.resend_api_key) : undefined,
      from: shop.from_email ? String(shop.from_email) : undefined,
      replyTo: shop.shop_email ? String(shop.shop_email) : undefined,
      idempotencyKey: idempotencyKey.slice(0, 120),
    })
  }
}

/** Signs the note attached to a transferred call. Throws when the server has no signing secret at all. */
export function signCallState(data: Record<string, unknown>): string {
  return createVoiceClientState(data)
}

/** Reads the note back from a webhook. Telnyx returns it exactly as sent, which was base64-wrapped. */
export function readCallState(clientState: unknown): Record<string, unknown> | null {
  if (typeof clientState !== 'string' || !clientState) return null
  const direct = verifyVoiceClientState(clientState)
  if (direct) return direct
  try { return verifyVoiceClientState(Buffer.from(clientState, 'base64').toString('utf8')) } catch { return null }
}
