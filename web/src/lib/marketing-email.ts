// Marketing email done the way the law and the inbox providers expect: the shop's name and mailing address,
// a visible unsubscribe link, the one-click unsubscribe headers, a plain-text copy, and a server-side
// opt-out list that is checked before anything is sent.
//
// The wording (what is said) is written by the shop or by the owner-approved templates. This file only wraps it.

import type { SupabaseClient } from '@supabase/supabase-js'

export const escapeHtml = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, ch => (
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[ch] || ch
))

export interface EmailFooter {
  shopName: string
  address: string
  phone?: string
  /** Where "Unsubscribe" goes. Marketing email always has one. */
  unsubscribe?: string
}

/** The footer lines every marketing email must carry, as plain text. */
export function footerLines(footer: EmailFooter): string[] {
  const lines = [[footer.shopName, footer.address].map(s => String(s || '').trim()).filter(Boolean).join(' · ')]
  if (footer.phone?.trim()) lines.push(footer.phone.trim())
  if (footer.unsubscribe) lines.push(`Unsubscribe from emails from ${footer.shopName || 'this shop'}: ${footer.unsubscribe}`)
  return lines.filter(Boolean)
}

export function emailHtml(text: string, footer: EmailFooter): string {
  const paragraphs = text.split(/\n{2,}/).map(p => `<p style="margin:0 0 14px">${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')
  const place = [escapeHtml(footer.shopName), escapeHtml(footer.address)].filter(Boolean).join(' · ')
  const phone = footer.phone?.trim() ? `<br>${escapeHtml(footer.phone.trim())}` : ''
  const stop = footer.unsubscribe
    ? `<br><a href="${escapeHtml(footer.unsubscribe)}" style="color:#6b7280">Unsubscribe</a> from emails from ${escapeHtml(footer.shopName || 'this shop')}.`
    : ''
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">${paragraphs}<p style="margin:24px 0 0;font-size:12px;color:#6b7280">${place}${phone}${stop}</p></div>`
}

export function emailPlainText(text: string, footer: EmailFooter): string {
  return `${text.trim()}\n\n--\n${footerLines(footer).join('\n')}\n`
}

export class EmailSendError extends Error {
  status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.status = status
  }
}

export interface ResendInput {
  apiKey: string
  from: string
  to: string
  subject: string
  html: string
  text?: string
  replyTo?: string
  /** Adds the one-click unsubscribe headers mail providers look for. */
  unsubscribeUrl?: string
  idempotencyKey?: string
}

/** Sends one email through the shop's own Resend account. Throws EmailSendError when it is refused. */
export async function sendResendEmail(input: ResendInput, fetcher: typeof fetch = fetch): Promise<{ id: string | null }> {
  const headers: Record<string, string> = {}
  if (input.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${input.unsubscribeUrl}>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }
  let response: Response
  try {
    response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
        ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        reply_to: input.replyTo || undefined,
        headers: Object.keys(headers).length ? headers : undefined,
      }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw new EmailSendError(`The email service did not answer (${error instanceof Error ? error.message : 'network error'})`, null)
  }
  const data = await response.json().catch(() => ({} as Record<string, unknown>))
  if (!response.ok) {
    const why = String((data as { message?: unknown }).message || (data as { error?: unknown }).error || `Email provider returned ${response.status}`)
    throw new EmailSendError(why, response.status)
  }
  const id = (data as { id?: unknown }).id
  return { id: typeof id === 'string' ? id : null }
}

// ── The opt-out list ──────────────────────────────────────────────────────

const missing = (error: { code?: string; message?: string } | null | undefined): boolean => Boolean(error) && (
  error!.code === '42P01' || error!.code === 'PGRST205' || /schema cache|does not exist/i.test(error!.message || '')
)

export const normalizeEmail = (value: unknown): string => String(value ?? '').trim().toLowerCase()

/**
 * True when this address asked this shop to stop. Throws when that could not be checked, so nothing sends blind.
 * With `strict`, a missing opt-out table also throws, because an unsubscribe link could not be honoured either.
 */
export async function isEmailOptedOut(db: SupabaseClient, shopId: string, email: string, opts: { strict?: boolean } = {}): Promise<boolean> {
  const { data, error } = await db.from('email_opt_outs').select('email_lower').eq('shop_id', shopId).eq('email_lower', normalizeEmail(email)).maybeSingle()
  if (error) {
    if (missing(error)) {
      if (opts.strict) throw new Error('Email cannot be sent yet: the database update for unsubscribe links has not been applied.')
      return false
    }
    throw new Error('Email consent could not be checked')
  }
  return Boolean(data)
}

export async function recordEmailOptOut(db: SupabaseClient, shopId: string, email: string, source: string): Promise<void> {
  const { error } = await db.from('email_opt_outs').upsert({ shop_id: shopId, email_lower: normalizeEmail(email), source, created_at: new Date().toISOString() }, { onConflict: 'shop_id,email_lower', ignoreDuplicates: true })
  if (error) throw new Error(missing(error) ? 'The database update for email opt-outs has not been applied yet.' : error.message)
}

export async function removeEmailOptOut(db: SupabaseClient, shopId: string, email: string): Promise<void> {
  const { error } = await db.from('email_opt_outs').delete().eq('shop_id', shopId).eq('email_lower', normalizeEmail(email))
  if (error) throw new Error(error.message)
}

/** "j***@gmail.com": enough for the person to recognise their own address, not enough to read it aloud on a page. */
export function maskEmail(email: string): string {
  const [name, domain] = normalizeEmail(email).split('@')
  if (!name || !domain) return ''
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(name.length - 1, 6)))}@${domain}`
}
