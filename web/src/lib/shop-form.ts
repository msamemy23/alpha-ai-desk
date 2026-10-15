/**
 * Plain checks and address helpers for the Settings and Setup screens.
 * It imports nothing, so the same code runs in the browser and under `node --test`.
 * Keep it to plain TypeScript (no enums, no parameter properties) so node can run it directly.
 */

/* ---------- address ---------- */

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** Street and "City, ST 12345" as one line, the way Settings and customer paperwork keep it. */
export function joinShopAddress(street: unknown, cityStateZip: unknown): string {
  const s = clean(street)
  const c = clean(cityStateZip)
  if (!s) return c
  if (!c) return s
  if (s.toLowerCase().endsWith(c.toLowerCase())) return s
  return `${s}, ${c}`
}

// "Houston, TX 77003" or "Houston, Texas 77003-1234" at the end of a US address.
const CITY_STATE_ZIP_TAIL = /^(.*?),\s*([^,]+,\s*[A-Za-z]{2,}\s+\d{5}(?:-\d{4})?)$/

/**
 * The reverse of joinShopAddress. When the shop profile already holds a city line and the full address ends with it,
 * that split is kept. Otherwise a US "street, city, ST 12345" line is split, and anything else stays whole in the street
 * (what was typed is the truth, so an old city line is never kept when the new address no longer has it).
 */
export function splitShopAddress(full: unknown, knownCityStateZip?: unknown): { address: string; cityStateZip: string } {
  const text = clean(full)
  const known = clean(knownCityStateZip)
  if (!text) return { address: '', cityStateZip: '' }
  if (known && text.toLowerCase().endsWith(known.toLowerCase())) {
    const head = text.slice(0, text.length - known.length).replace(/[\s,]+$/, '')
    return { address: head, cityStateZip: known }
  }
  const m = CITY_STATE_ZIP_TAIL.exec(text)
  if (m) return { address: m[1].trim(), cityStateZip: m[2].trim() }
  return { address: text, cityStateZip: '' }
}

/* ---------- field checks ---------- */

type NumberRule = { label: string; min: number; max: number; whole?: boolean; message: string }

const NUMBER_RULES: Record<string, NumberRule> = {
  labor_rate: { label: 'labor rate', min: 0, max: 1000, message: 'Enter your labor rate in dollars per hour, from 0 to 1,000. For example 120.' },
  tax_rate: { label: 'tax rate', min: 0, max: 100, message: 'Enter your tax rate as a percent, from 0 to 100. Use 0 if you do not charge tax.' },
  warranty_months: { label: 'warranty', min: 0, max: 120, whole: true, message: 'Enter the warranty in whole months, from 0 to 120. For example 12.' },
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** A phone number kept the way the phone service wants it: a plus sign, the country code and digits only. */
export function normalizePhoneE164(raw: unknown): string {
  const text = clean(raw)
  if (!text) return ''
  const digits = text.replace(/[^\d]/g, '')
  if (!digits) return text
  if (text.startsWith('+')) return `+${digits}`
  // A bare US number gets the +1 so the shop owner does not have to know about country codes.
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return text
}

export type FieldErrors = Record<string, string>

/** Which section of Settings holds each checked field, so the page can open the right one. */
export const FIELD_SECTION: Record<string, 'shop' | 'ai' | 'comms'> = {
  shop_name: 'shop',
  shop_email: 'shop',
  labor_rate: 'shop',
  tax_rate: 'shop',
  warranty_months: 'shop',
  google_review_url: 'shop',
  telnyx_phone_number: 'comms',
  from_email: 'comms',
}

/** Order the fields appear on screen, so the first problem the page jumps to is the topmost one. */
const FIELD_ORDER = ['shop_name', 'shop_email', 'labor_rate', 'tax_rate', 'warranty_months', 'google_review_url', 'telnyx_phone_number', 'from_email']

/**
 * Problems with what was typed, by field. Only a field that has a value in the form is checked, so a screen
 * that did not load a field never blocks a save over it. An empty result means the form can be saved.
 */
export function validateSettings(values: Record<string, unknown>): FieldErrors {
  const errors: FieldErrors = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(values, k) && values[k] !== undefined && values[k] !== null

  if (has('shop_name') && !clean(values.shop_name)) errors.shop_name = 'Enter your shop name. Customers see it on estimates, invoices and texts.'

  for (const key of Object.keys(NUMBER_RULES)) {
    if (!has(key)) continue
    const rule = NUMBER_RULES[key]
    const v = values[key]
    const text = typeof v === 'number' ? String(v) : clean(v)
    const n = Number(text)
    const ok = text !== '' && Number.isFinite(n) && n >= rule.min && n <= rule.max && (!rule.whole || Number.isInteger(n))
    if (!ok) errors[key] = rule.message
  }

  for (const key of ['shop_email', 'from_email']) {
    if (has(key) && clean(values[key]) && !EMAIL.test(clean(values[key]))) errors[key] = 'Enter an email address like service@yourshop.com.'
  }

  if (has('google_review_url') && clean(values.google_review_url)) {
    let ok = false
    try { const u = new URL(clean(values.google_review_url)); ok = u.protocol === 'https:' || u.protocol === 'http:' } catch { ok = false }
    if (!ok) errors.google_review_url = 'Enter the full link, starting with https://.'
  }

  if (has('telnyx_phone_number') && clean(values.telnyx_phone_number)) {
    if (!/^\+\d{10,15}$/.test(normalizePhoneE164(values.telnyx_phone_number))) errors.telnyx_phone_number = 'Enter the number with its country code, like +17135550000.'
  }

  return errors
}

/** The first field with a problem, top to bottom as it appears in Settings. */
export function firstErrorKey(errors: FieldErrors): string | null {
  for (const k of FIELD_ORDER) if (errors[k]) return k
  return Object.keys(errors)[0] ?? null
}
