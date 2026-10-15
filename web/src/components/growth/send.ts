import { getAuthJsonHeaders } from './helpers'

export type SmsResult =
  | { kind: 'sent' }
  | { kind: 'optedOut' }
  | { kind: 'rate'; waitMs: number }
  | { kind: 'failed'; error: string; fatal?: boolean }

/** True when the same problem would hit every person on the list, so there is no point trying the rest. */
export function isSystemProblem(status: number, serverText: string): boolean {
  return status === 401 || status === 403 || (status === 503 && /not configured/i.test(serverText))
}

/** The plain-words reason a send failed. Never an HTTP code. */
export function sendProblem(status: number, serverText: string, code?: string): string {
  const t = serverText.trim()
  if (status === 401) return 'You were signed out. Sign in again, then try once more.'
  if (status === 403) return 'Your account cannot send messages. Ask the owner.'
  if (status === 503 && /not configured/i.test(t)) return 'Texting is not set up for this shop yet. Connect your texting number first.'
  if (code === 'PROVIDER_ERROR' || /uncertain|do not retry/i.test(t)) return 'The carrier did not confirm this text. Look in the Inbox before you send it again.'
  if (status === 404) return t || 'That customer could not be found. Refresh and try again.'
  if (t && t.length < 160) return t.endsWith('.') ? t : `${t}.`
  return 'The text did not send. Check your connection and try again.'
}

/** Sends one text through the shop's own number. `key` makes a retry of the same send safe. */
export async function postSms(input: { to: string; message: string; customerId?: string; key: string }): Promise<SmsResult> {
  try {
    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { ...(await getAuthJsonHeaders()), 'Idempotency-Key': input.key },
      body: JSON.stringify({ to: input.to, message: input.message, ...(input.customerId ? { customer_id: input.customerId } : {}) }),
    })
    const d = await res.json().catch(() => ({} as Record<string, unknown>))
    const err = typeof d.error === 'string' ? d.error : ''
    if (res.ok && d.ok !== false && !err) return { kind: 'sent' }
    if (res.status === 409 && /opted out/i.test(err)) return { kind: 'optedOut' }
    if (res.status === 429) {
      const resetAt = Number((d.details as { resetAt?: number } | undefined)?.resetAt)
      const wait = Number.isFinite(resetAt) ? resetAt - Date.now() : 20_000
      return { kind: 'rate', waitMs: Math.min(65_000, Math.max(2_000, wait)) }
    }
    return { kind: 'failed', error: sendProblem(res.status, err, typeof d.code === 'string' ? d.code : undefined), fatal: isSystemProblem(res.status, err) }
  } catch {
    return { kind: 'failed', error: 'No connection. Check your internet and try again.', fatal: true }
  }
}

export type OutreachResult = { kind: 'sent' } | { kind: 'optedOut' } | { kind: 'failed'; error: string }

/** Texts, emails or has Alpha phone one lead. The words are sent exactly as shown on screen. */
export async function postOutreach(input: { leadId: string; method: 'sms' | 'email' | 'ai_call'; aiMode: boolean; message?: string; subject?: string }): Promise<OutreachResult> {
  try {
    const res = await fetch('/api/growth/outreach', {
      method: 'POST',
      headers: await getAuthJsonHeaders(),
      body: JSON.stringify({ lead_id: input.leadId, method: input.method, ai_mode: input.aiMode, ...(input.message ? { message: input.message } : {}), ...(input.subject ? { subject: input.subject } : {}) }),
    })
    const d = await res.json().catch(() => ({} as Record<string, unknown>))
    if (res.ok && d.success === true) return { kind: 'sent' }
    const err = typeof d.error === 'string' ? d.error : ''
    if (d.code === 'opted_out') return { kind: 'optedOut' }
    // The server already wrote these in plain words (stopped lead, needs permission, calling hours, missing address).
    if (typeof d.code === 'string' && d.code && err) return { kind: 'failed', error: err.endsWith('.') ? err : `${err}.` }
    if (res.status === 409 && /opted out/i.test(err)) return { kind: 'optedOut' }
    if (/^Email failed:/i.test(err)) return { kind: 'failed', error: `The email service turned this down (${err.replace(/^Email failed:\s*/i, '').slice(0, 120)}). Check the address and try again.` }
    if (res.status === 503 && /email/i.test(err)) return { kind: 'failed', error: 'Email sending is not set up for this shop yet. Add it in Settings.' }
    if (/failed: [45]\d\d/i.test(err)) return { kind: 'failed', error: 'The carrier or email service turned this down. Check the number or address and try again.' }
    return { kind: 'failed', error: sendProblem(res.status, err) }
  } catch {
    return { kind: 'failed', error: 'No connection. Check your internet and try again.' }
  }
}

/** Asks the shop's AI provider for a short draft. The person reads and edits it before anything is sent. */
export async function draftMessage(input: { shopName: string; shopPhone: string; channel: 'sms' | 'email'; leadName: string; service: string }): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const first = (input.leadName.trim().split(/\s+/)[0]) || 'there'
  const limit = input.channel === 'sms' ? 'Keep it under 220 characters.' : 'Keep it under 90 words and put a blank line between paragraphs.'
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 30_000)
    const res = await fetch('/api/ai-completions', {
      method: 'POST',
      headers: await getAuthJsonHeaders(),
      signal: ctl.signal,
      body: JSON.stringify({
        max_tokens: 400,
        temperature: 0.6,
        messages: [
          { role: 'system', content: `You write one short, friendly ${input.channel === 'sms' ? 'text message' : 'email'} from ${input.shopName}, an independent auto repair shop, to a person who may need car repair. ${limit} Greet them by first name. Say who it is from${input.shopPhone ? ` and give the phone number ${input.shopPhone}` : ''}. Do not invent prices, discounts, guarantees or deadlines. Do not use emoji. Output only the message itself, with no subject line and no quotation marks.` },
          { role: 'user', content: `First name: ${first}\nWhat they need: ${input.service || 'not known'}` },
        ],
      }),
    }).finally(() => clearTimeout(timer))
    const d = await res.json().catch(() => ({} as Record<string, unknown>))
    if (!res.ok) {
      const msg = typeof d.error === 'string' ? d.error : (d.error as { message?: string } | undefined)?.message || ''
      if (/not configured|api key/i.test(msg)) return { ok: false, error: 'Alpha cannot write messages until an AI key is added in Settings.' }
      return { ok: false, error: 'Alpha could not write the message right now.' }
    }
    const raw = (d.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content
    const text = String(raw || '').replace(/```[a-z]*\n?/gi, '').replace(/^["'\s]+|["'\s]+$/g, '').trim()
    if (!text) return { ok: false, error: 'Alpha did not return a message.' }
    return { ok: true, text }
  } catch {
    return { ok: false, error: 'Alpha could not write the message right now.' }
  }
}
