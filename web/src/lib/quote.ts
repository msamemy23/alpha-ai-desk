/**
 * "Ask for a price" on the public booking page: what a stranger may send, and how it is checked.
 * A visitor who does not want to pick a time can still reach the shop. Nothing is texted or emailed from here, so a stranger cannot make
 * the shop message a number they typed. The request lands on the Leads tab and the shop answers it from there.
 * No imports from `@/`: the server, the page and `node --test` all run this same code.
 */

import { cleanText, looksLikeSpam, normalizePhone, phoneDisplay } from './booking.ts'

export const QUOTE_MAX = 500
export const QUOTE_FIELDS = ['name', 'phone', 'vehicle', 'message', 'email'] as const
export type QuoteField = (typeof QUOTE_FIELDS)[number]

export interface QuoteInput { name: string; phone: string; phoneShown: string; email: string; vehicle: string; message: string }
export type QuoteCleaned = { ok: true; value: QuoteInput } | { ok: false; field: QuoteField; error: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const NAME = /^\p{L}[\p{L} .'’-]*$/u

const problems = (f: Record<QuoteField, string>): Partial<Record<QuoteField, string>> => {
  const out: Partial<Record<QuoteField, string>> = {}
  const name = cleanText(f.name, 60)
  if (name.length < 2 || !/\p{L}/u.test(name) || !NAME.test(name) || looksLikeSpam(f.name)) out.name = 'Enter your name.'
  if (!normalizePhone(f.phone)) out.phone = 'Enter a 10-digit phone number.'
  if (cleanText(f.vehicle, 80).length < 3 || looksLikeSpam(f.vehicle)) out.vehicle = 'Tell us the year, make and model.'
  const message = cleanText(f.message, QUOTE_MAX)
  if (message.length < 5) out.message = 'Tell us what the car needs, even in a few words.'
  else if (looksLikeSpam(f.message)) out.message = 'Leave web addresses out of the message.'
  const email = String(f.email ?? '').trim()
  if (email && (email.length > 120 || !EMAIL.test(email))) out.email = 'Enter an email like name@example.com, or leave it empty.'
  return out
}

/** The same checks the server makes, so a mistake is caught before the trip. The server checks everything again. */
export function checkQuoteForm(f: Record<QuoteField, string>): Partial<Record<QuoteField, string>> {
  return problems({ name: f.name ?? '', phone: f.phone ?? '', vehicle: f.vehicle ?? '', message: f.message ?? '', email: f.email ?? '' })
}

export function cleanQuote(raw: unknown): QuoteCleaned {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const f = { name: String(o.name ?? ''), phone: String(o.phone ?? ''), vehicle: String(o.vehicle ?? ''), message: String(o.message ?? ''), email: String(o.email ?? '') }
  const bad = problems(f)
  const first = QUOTE_FIELDS.find(k => bad[k])
  if (first) return { ok: false, field: first, error: bad[first] as string }
  const phone = normalizePhone(f.phone) as string
  return {
    ok: true,
    value: {
      name: cleanText(f.name, 60), phone, phoneShown: phoneDisplay(phone), email: f.email.trim().toLowerCase(),
      vehicle: cleanText(f.vehicle, 80), message: cleanText(f.message, QUOTE_MAX),
    },
  }
}
