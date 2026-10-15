/**
 * Plain helpers for the Automations screen: who a built-in automation will reach, what its last run did,
 * and what a schedule means in words. No imports, so the tests can load this file directly.
 *
 * The audience helpers copy the rules the server uses when it runs each automation
 * (src/app/api/growth/*). They only read rows the screen already has; nothing here sends anything.
 */

export type Row = Record<string, any>

const DAY = 86_400_000

export const OPT_OUT_LINE = 'Reply STOP to opt out.'

/** True when a text tells people how to opt out. */
export const hasOptOutLine = (text: string): boolean => /\bstop\b/i.test(text)

export const digitsOf = (value: unknown): string => String(value ?? '').replace(/\D/g, '')
/** Last ten digits, so +1 (281) 555-0101 and 2815550101 are the same number. */
export const phoneKey = (value: unknown): string => digitsOf(value).slice(-10)
const present = (value: unknown): boolean => String(value ?? '').trim() !== ''

const when = (value: unknown): number => {
  const t = Date.parse(String(value ?? ''))
  return Number.isFinite(t) ? t : NaN
}

// ── Promotional text ──────────────────────────────────────────────────────

export const BLAST_DEFAULT = 'Hi {name}! We have a special this week at your local auto repair shop. Reply to this text or call us to schedule.'
export const BLAST_LIMIT = 100

/** The template the server really uses: the saved one, trimmed and cut to 1600 characters, or the default. */
export function blastTemplate(raw: unknown): string {
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 1600) : BLAST_DEFAULT
}

/** The first word of a name, or "there". */
export function firstWord(name: unknown): string {
  return String(name ?? 'there').trim().split(/\s+/)[0] || 'there'
}

/** One person's copy of the promotional text. */
export function blastText(template: string, customerName: unknown): string {
  return template.replace(/\{name\}/gi, firstWord(customerName))
}

export interface Split<T> { send: T[]; optedOut: T[]; noPhone: T[] }

/**
 * Who the promotional text reaches. `customers` must be the rows the server reads: customers with a phone value,
 * oldest first, cut to the limit. The server does not look for the same number twice, so `shared` counts the people
 * who would get a second copy.
 */
export function blastAudience(customers: Row[]): Split<Row> & { shared: number } {
  const out: Split<Row> & { shared: number } = { send: [], optedOut: [], noPhone: [], shared: 0 }
  const seen = new Set<string>()
  for (const c of customers) {
    if (c.sms_opted_out) { out.optedOut.push(c); continue }
    if (!present(c.phone)) { out.noPhone.push(c); continue }
    out.send.push(c)
    const key = phoneKey(c.phone)
    if (seen.has(key)) out.shared += 1
    seen.add(key)
  }
  return out
}

// ── Who the other built-in automations reach ──────────────────────────────

/** Review requests: customers with an invoice in the last 7 days, not asked in the last 7 days. */
export function reviewAudience(input: { docs: Row[]; customers: Row[]; requests: Row[]; now: number }): Split<Row> & { alreadyAsked: Row[] } {
  const since = input.now - 7 * DAY
  const ids = new Set(input.docs.filter(d => d.customer_id && when(d.created_at) >= since).map(d => String(d.customer_id)))
  const asked = new Set(input.requests.filter(r => when(r.created_at) >= since).map(r => String(r.phone ?? '')))
  const out: Split<Row> & { alreadyAsked: Row[] } = { send: [], optedOut: [], noPhone: [], alreadyAsked: [] }
  for (const c of input.customers) {
    if (!ids.has(String(c.id))) continue
    if (!present(c.phone)) { out.noPhone.push(c); continue }
    if (asked.has(String(c.phone))) { out.alreadyAsked.push(c); continue }
    if (c.sms_opted_out) { out.optedOut.push(c); continue }
    out.send.push(c)
  }
  return out
}

/** Win-back: the last invoice is older than the number of months, and nobody texted them in the last 30 days. */
export function winBackAudience(input: { customers: Row[]; docs: Row[]; followups: Row[]; months: number; now: number }): Split<Row & { monthsAgo: number }> {
  const last = new Map<string, number>()
  for (const d of input.docs) {
    const t = when(d.created_at)
    if (!d.customer_id || !Number.isFinite(t)) continue
    const key = String(d.customer_id)
    if (!last.has(key) || t > (last.get(key) as number)) last.set(key, t)
  }
  const cutoff = new Date(input.now)
  cutoff.setMonth(cutoff.getMonth() - input.months)
  const recent = new Set(input.followups.filter(f => when(f.created_at) >= input.now - 30 * DAY).map(f => String(f.customer_id)))
  const out: Split<Row & { monthsAgo: number }> = { send: [], optedOut: [], noPhone: [] }
  for (const c of input.customers) {
    const visit = last.get(String(c.id))
    if (visit === undefined || visit >= cutoff.getTime() || recent.has(String(c.id))) continue
    const row = { ...c, monthsAgo: Math.floor((input.now - visit) / (30 * DAY)) }
    if (c.sms_opted_out) out.optedOut.push(row)
    else if (!present(c.phone)) out.noPhone.push(row)
    else out.send.push(row)
  }
  return out
}

export interface EstimateTarget { id: string; name: string; via: 'text' | 'email' | 'none' }

/** Estimate follow-ups: sent between `hours` hours and 14 days ago, not booked or cancelled, not followed up before. */
export function estimateAudience(input: { estimates: Row[]; customers: Row[]; sentIds: string[]; hours: number; now: number }): EstimateTarget[] {
  const newest = input.now - input.hours * 3_600_000
  const oldest = input.now - 14 * DAY
  const done = new Set(input.sentIds.map(String))
  const byId = new Map(input.customers.map(c => [String(c.id), c]))
  const out: EstimateTarget[] = []
  for (const e of input.estimates) {
    const t = when(e.created_at)
    if (!(t <= newest && t >= oldest)) continue
    if (e.status === 'converted' || e.status === 'cancelled' || done.has(String(e.id))) continue
    const c = (e.customer_id ? byId.get(String(e.customer_id)) : null) || { name: e.customer_name, phone: e.customer_phone, email: e.customer_email, sms_opted_out: false }
    const via = present(c.phone) && !c.sms_opted_out ? 'text' : present(c.email) ? 'email' : 'none'
    out.push({ id: String(e.id), name: String(c.name || e.customer_name || 'Customer'), via })
  }
  return out
}

export interface ApptTarget { id: string; name: string; time: string; service: string }

/** Appointment reminders: tomorrow, scheduled or confirmed, not reminded yet, with a number to text. */
export function appointmentAudience(input: { appts: Row[]; customers: Row[]; tomorrow: string }): Split<ApptTarget> {
  const byId = new Map(input.customers.map(c => [String(c.id), c]))
  const out: Split<ApptTarget> = { send: [], optedOut: [], noPhone: [] }
  for (const a of input.appts) {
    if (a.date !== input.tomorrow || !['Scheduled', 'Confirmed'].includes(String(a.status)) || a.reminder_sent_at) continue
    const c = a.customer_id ? byId.get(String(a.customer_id)) : null
    const phone = String(c?.phone || a.phone || '').trim()
    const row = { id: String(a.id), name: String(a.customer_name || 'Customer'), time: String(a.time || ''), service: String(a.service || '') }
    if (!phone) out.noPhone.push(row)
    else if (c?.sms_opted_out) out.optedOut.push(row)
    else out.send.push(row)
  }
  return out
}

/** Automatic lead emails: the oldest new leads, up to the limit. Leads with no address are passed over but still count against the limit. */
export function leadEmailAudience(leads: Row[], limit: number): { send: Row[]; passedOver: number } {
  const batch = leads
    .filter(l => l.status === 'new' && l.email !== null && l.email !== undefined)
    .sort((a, b) => (when(a.created_at) || 0) - (when(b.created_at) || 0))
    .slice(0, limit)
  const send = batch.filter(l => present(l.email))
  return { send, passedOver: batch.length - send.length }
}

/** Today's date plus one day, as the shop's own calendar shows it (YYYY-MM-DD). */
export function tomorrowIn(timeZone: string, now: number): string {
  const at = new Date(now + DAY)
  let zone = timeZone || 'America/Chicago'
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(at) } catch { zone = 'America/Chicago' }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const v = Object.fromEntries(parts.map(p => [p.type, p.value]))
  return `${v.year}-${v.month}-${v.day}`
}

// ── What the last run did ─────────────────────────────────────────────────

export interface ResultSummary { tone: 'ok' | 'warn' | 'error' | 'info'; text: string }

const readNumber = (raw: string, key: string): number | null => {
  const m = raw.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`))
  return m ? Number(m[1]) : null
}
const readString = (raw: string, key: string): string | null => {
  const m = raw.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))
  return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ') : null
}
const countOf = (raw: string, re: RegExp): number => (raw.match(re) || []).length
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The server keeps the first 500 characters of what a run returned, so this reads numbers out of it even when the
 * JSON is cut off. It says what happened in a sentence, or returns null when there is nothing to say.
 */
export function describeResult(id: string, raw: string | null | undefined, status: 'ok' | 'error' | 'never' = 'ok'): ResultSummary | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const looksJson = text.startsWith('{')
  if (!looksJson) {
    return status === 'error' ? { tone: 'error', text: text.slice(0, 200) } : null
  }
  // An error inside one person's line (after "results") is not an error for the whole run.
  const head = text.split('"results"')[0]
  const error = readString(head, 'error')
  if (error) return { tone: 'error', text: error.slice(0, 200) }

  const message = readString(head, 'message')
  const numSent = readNumber(text, 'sent') ?? readNumber(text, 'messages_sent') ?? readNumber(text, 'followed_up')
  const sent = numSent ?? countOf(text, /"sent"\s*:\s*true/g)
  const failedItems = readNumber(text, 'messages_failed') ?? countOf(text, /"sent"\s*:\s*false(?![^}]*"skipped"\s*:\s*true)/g)
  const tried = readNumber(text, 'attempted') ?? readNumber(text, 'total') ?? readNumber(text, 'total_stale_customers') ?? readNumber(text, 'processed')
  const warn = failedItems > 0

  // A run the server marked as failed that still sent some things says so; one that sent nothing just failed.
  const failedRun = status === 'error'
  if (failedRun && !sent) return { tone: 'error', text: 'The last run did not finish.' }
  const done = (tone: ResultSummary['tone'], t: string): ResultSummary => (
    failedRun ? { tone: 'warn', text: `${t} Some did not go out.` } : { tone: warn && tone === 'ok' ? 'warn' : tone, text: t }
  )

  switch (id) {
    case 'review_requests':
      if (numSent === 0 && /no recent customers/i.test(message || '')) return { tone: 'info', text: 'No customers had a recent invoice, so no texts went out.' }
      return done(sent ? 'ok' : 'info', sent ? `Asked ${plural(sent, 'customer', 'customers')} for a review.` : 'No review requests went out.')
    case 'estimate_followups':
      return done(sent ? 'ok' : 'info', sent ? `Followed up on ${plural(sent, 'estimate', 'estimates')}.` : 'No estimates needed a follow-up.')
    case 're_engagement':
      return done(sent ? 'ok' : 'info', sent ? `Texted ${plural(sent, 'customer', 'customers')} who had not been in for a while.` : 'No one had been away long enough to text.')
    case 'service_reminders':
    case 'appointment_reminders':
      return done(sent ? 'ok' : 'info', sent ? `Sent ${plural(sent, 'reminder', 'reminders')}.` : 'Nothing was due, so no reminders went out.')
    case 'lead_discovery': {
      const n = readNumber(text, 'total_leads')
      return { tone: n ? 'ok' : 'info', text: n ? `Found ${plural(n, 'new lead', 'new leads')}.` : 'No new leads this time.' }
    }
    case 'lead_outreach':
      return done(sent ? 'ok' : 'info', sent ? `Emailed ${plural(sent, 'lead', 'leads')}${tried && tried > sent ? ` of ${tried}` : ''}.` : 'No new leads had an email address to write to.')
    case 'sms_blast':
      return done(sent ? 'ok' : 'info', sent ? `Texted ${plural(sent, 'customer', 'customers')}${tried && tried > sent ? ` of ${tried}` : ''}.` : 'No texts went out.')
    case 'social_posts':
      return { tone: 'ok', text: 'Saved a draft post. Nothing was published.' }
    default:
      return done('ok', 'Finished.')
  }
}

// ── Schedules ─────────────────────────────────────────────────────────────

const DAYS: Record<string, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' }

const timeWords = (hour: string, minute: string | undefined, ampm: string | undefined): string | null => {
  let h = Number(hour)
  const m = Number(minute || '0')
  if (!Number.isInteger(h) || !Number.isInteger(m) || m < 0 || m > 59) return null
  const suffix = ampm?.toLowerCase()
  if (suffix) { if (h < 1 || h > 12) return null } else if (h > 23) return null
  let isPm = suffix === 'pm'
  if (!suffix) { isPm = h >= 12; h = h % 12 || 12 }
  return `${h}:${String(m).padStart(2, '0')} ${isPm ? 'pm' : 'am'}`
}

/**
 * A custom schedule in words ("Every day at 8:00 am"), or null when the server would not understand it.
 * Accepts the same shapes as the server: "8:00am", "17:30", "mon 9:00am", "daily 6pm", "weekly on friday".
 */
export function scheduleWords(schedule: string): string | null {
  const s = schedule.trim()
  const daily = s.match(/^(?:daily\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (daily) {
    const t = timeWords(daily[1], daily[2], daily[3])
    return t ? `Every day at ${t}` : null
  }
  const named = s.match(/^(?:weekly\s+on\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*(?:\s+(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i)
  if (named) {
    const day = DAYS[named[1].toLowerCase()]
    if (!named[2]) return `Every ${day}`
    const t = timeWords(named[2], named[3], named[4])
    return t ? `Every ${day} at ${t}` : null
  }
  return null
}

// ── Numbers typed into a form ─────────────────────────────────────────────

/** A whole number from what was typed, or null when it is empty, not a number or out of range. */
export function wholeNumber(text: string, min: number, max: number): number | null {
  const t = text.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= min && n <= max ? n : null
}
