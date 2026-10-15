// What the Automations screen reads and shows, in plain functions with no React, so the words and the maths are tested.
// The server decides who is messaged and when (see lib/automation-service.ts). This file only turns its answers into
// sentences, lamps and groups.

export type Lamp = 'green' | 'amber' | 'red' | 'blue' | 'off'

export interface Rules {
  master_enabled: boolean
  quiet_start_hour: number
  quiet_end_hour: number
  skip_sundays: boolean
  marketing_cap_days: number
  marketing_monthly_max: number
  service_daily_max: number
  alert_on_failure: boolean
}

export interface FieldInfo {
  key: string
  label: string
  type: 'number' | 'text' | 'textarea' | 'boolean' | 'select'
  default: unknown
  value: unknown
  min?: number
  max?: number
  unit?: string
  help?: string
  options?: string[]
}

export interface Card {
  id: string
  name: string
  blurb: string
  trigger: string
  category: string
  icon: string
  kind: 'engine' | 'legacy'
  klass: 'service' | 'marketing'
  channel: 'sms' | 'email'
  schedule: string
  default_schedule: string
  claims_revenue: boolean
  template: string
  default_template: string
  email_subject: string
  placeholders: string[]
  detail: string[]
  fields: FieldInfo[]
  state: { enabled: boolean; enabled_at: string | null; last_run: string | null; run_count: number; last_result: string | null; last_status: 'ok' | 'error' | 'never' }
  setup: string | null
  next_run: string | null
  waiting: number
  next_send: string | null
  sent_30d: number
}

export interface ShopSummary { name: string; timezone: string; sms_ready: boolean; email_ready: boolean; review_link_set: boolean; has_settings: boolean }
export interface Scheduler { last_tick_at: string | null; every_minutes: number | null; status: 'ok' | 'late' | 'unknown' }
export interface Attention { id: string; kind: 'failed' | 'setup' | 'stopped'; automation_id: string | null; text: string }

export interface Overview {
  cards: Card[]
  rules: Rules
  shop: ShopSummary
  scheduler: Scheduler
  needsDatabaseUpdate: boolean
  attention: Attention[]
}

export interface PreviewRecipient {
  name: string
  to: string
  channel: 'sms' | 'email'
  why: string
  text: string
  subject: string | null
  parts: number
  send_at: string
  send_at_iso: string
  held: boolean
  notes?: string[]
}

export interface Preview {
  id: string
  name: string
  klass: string
  channel: string
  legacy?: boolean
  note: string
  problems: string[]
  message: string
  quiet_hours: { start: number; end: number; skip_sundays: boolean }
  counts: { send: number; send_now: number; held_for_quiet_hours: number; later: number; skipped: number }
  skipped_by: Array<{ reason: string; label: string; count: number }>
  recipients: PreviewRecipient[]
  later: Array<{ name: string; why: string; reason: string; label: string; send_at_iso: string }>
  skipped: Array<{ name: string; why: string; reason: string; label: string }>
}

export interface Outcome { sent: number; delivered: number; replied: number; booked: number; revenue: number }

export interface Results {
  available: boolean
  days: number
  by_automation: Record<string, Outcome>
  by_campaign: Record<string, Outcome>
  total: Outcome
  delivery_tracking: boolean
}

export interface Upcoming {
  available: boolean
  waiting_by_day: Array<{ date: string; count: number; by: Record<string, number> }>
  waiting_total: number
  next_runs: Array<{ automation_id: string; name: string; at: string }>
  appointments_to_remind: number
  service_due_soon: Array<{ name: string; vehicle: string; why: string }>
}

export interface HistoryRow {
  id: string
  automation_id: string
  campaign_id: string | null
  automation: string
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'cancelled' | 'unknown'
  delivery: string | null
  reason: string | null
  reason_code: string | null
  channel: 'sms' | 'email'
  klass: string
  name: string | null
  to: string | null
  subject: string | null
  body: string | null
  send_after: string | null
  sent_at: string | null
  error: string | null
  attempts: number
  why: string | null
  held: boolean
  created_at: string
  is_test: boolean
}

export interface RunRow {
  id: string
  automation_id: string
  automation: string
  status: string
  attempts: number
  started_at: string
  finished_at: string | null
  manual: boolean
  message: string | null
  sent: number | null
  skipped: number | null
  failed: number | null
}

// ── Words ─────────────────────────────────────────────────────────────────

export function hourLabel(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  if (h === 0) return '12 AM'
  if (h === 12) return 'noon'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

export function quietWords(r: Pick<Rules, 'quiet_start_hour' | 'quiet_end_hour' | 'skip_sundays'>): string {
  const base = `No texts from ${hourLabel(r.quiet_start_hour)} until ${hourLabel(r.quiet_end_hour)}, by each customer’s own clock`
  return r.skip_sundays ? `${base}, and none on Sundays` : base
}

const DAY = 86_400_000

function parts(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true, weekday: 'short' })
  const o: Record<string, string> = {}
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value
  return o
}

function dayNumber(ms: number, tz: string): number {
  const p = parts(ms, tz)
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) / DAY
}

/** "today at 3:00 PM", "tomorrow at 9:00 AM", "Thu, Oct 16 at 9:00 AM". In the shop's own clock. */
export function whenWords(iso: string | null | undefined, tz: string, now = Date.now()): string {
  if (!iso) return 'not scheduled'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'not scheduled'
  const clock = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(t))
  const diff = Math.round(dayNumber(t, tz) - dayNumber(now, tz))
  if (diff === 0) return `today at ${clock}`
  if (diff === 1) return `tomorrow at ${clock}`
  const date = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(t))
  return `${date} at ${clock}`
}

/** "just now", "5 min ago", "3 hr ago", "yesterday", "Oct 12". */
export function agoWords(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'a while ago'
  if (t > now) return 'soon'
  const mins = Math.floor((now - t) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 1440) return `${Math.floor(mins / 60)} hr ago`
  const days = Math.floor(mins / 1440)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

export const money = (n: number): string => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── Schedules ─────────────────────────────────────────────────────────────

export type ScheduleKind = 'every' | 'daily' | 'weekly'
export interface ScheduleParts { kind: ScheduleKind; amount: number; unit: 'minutes' | 'hours'; hour: number; minute: number; weekday: number }

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

const clockText = (hour: number, minute: number): string => {
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${hour < 12 ? 'am' : 'pm'}`
}

/** Reads the schedule text the server stores ("Daily at 9am", "Weekly on Monday at 10am", "every 2 hours"). Null when unclear. */
export function parseSchedule(text: string): ScheduleParts | null {
  const s = String(text || '').trim()
  const every = s.match(/^every\s+(\d+)\s*(m|min|minutes?|h|hr|hours?)?$/i)
  if (every) {
    const unit = (every[2] || 'h').toLowerCase().startsWith('m') ? 'minutes' : 'hours'
    return { kind: 'every', amount: Math.max(1, Number(every[1])), unit, hour: 9, minute: 0, weekday: 1 }
  }
  const time = (h: string, m: string | undefined, suffix: string | undefined): { hour: number; minute: number } | null => {
    let hour = Number(h)
    const minute = Number(m || 0)
    if (!Number.isFinite(hour) || minute > 59) return null
    const sfx = (suffix || '').toLowerCase()
    if (sfx && (hour < 1 || hour > 12)) return null
    if (!sfx && hour > 23) return null
    if (sfx === 'pm' && hour < 12) hour += 12
    if (sfx === 'am' && hour === 12) hour = 0
    return { hour, minute }
  }
  const daily = s.match(/^(?:daily\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (daily && (/^daily/i.test(s) || daily[3] || daily[2])) {
    const t = time(daily[1], daily[2], daily[3])
    return t ? { kind: 'daily', amount: 1, unit: 'hours', ...t, weekday: 1 } : null
  }
  const weekly = s.match(/^(?:weekly\s+on\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*(?:\s+(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/i)
  if (weekly) {
    const t = time(weekly[2] || '0', weekly[3], weekly[4])
    if (!t) return null
    return { kind: 'weekly', amount: 1, unit: 'hours', ...t, weekday: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(weekly[1].toLowerCase()) }
  }
  return null
}

/** The text the server understands, from the pieces on the form. */
export function buildSchedule(p: ScheduleParts): string {
  if (p.kind === 'every') {
    const n = Math.max(1, Math.floor(p.amount) || 1)
    return `every ${n} ${p.unit === 'minutes' ? (n === 1 ? 'minute' : 'minutes') : (n === 1 ? 'hour' : 'hours')}`
  }
  const at = clockText(p.hour, p.minute)
  return p.kind === 'daily' ? `Daily at ${at}` : `Weekly on ${WEEKDAYS[((p.weekday % 7) + 7) % 7]} at ${at}`
}

/** "Every 15 minutes", "Every day at 9:00 AM", "Every Monday at 10:00 AM". */
export function scheduleWords(text: string): string {
  const p = parseSchedule(text)
  if (!p) return text || 'No schedule'
  const at = `${p.hour % 12 === 0 ? 12 : p.hour % 12}:${String(p.minute).padStart(2, '0')} ${p.hour < 12 ? 'AM' : 'PM'}`
  if (p.kind === 'every') return p.amount === 1 ? `Every ${p.unit === 'minutes' ? 'minute' : 'hour'}` : `Every ${p.amount} ${p.unit}`
  if (p.kind === 'daily') return `Every day at ${at}`
  return `Every ${WEEKDAYS[p.weekday]} at ${at}`
}

/** True when the schedule needs the scheduler to wake up more often than once a day to be on time. */
export function needsFrequentChecks(text: string): boolean {
  const p = parseSchedule(text)
  return p?.kind === 'every' && (p.unit === 'minutes' || p.amount < 24)
}

// ── Status ────────────────────────────────────────────────────────────────

export interface CardStatus { lamp: Lamp; word: string; detail: string }

/** One lamp and a word for a card, worked out the same way every time. */
export function cardStatus(card: Card, rules: Pick<Rules, 'master_enabled'>, now = Date.now()): CardStatus {
  const s = card.state
  if (!rules.master_enabled) return { lamp: 'off', word: 'Switched off', detail: 'All automations are switched off, so nothing is sent.' }
  if (!s.enabled) return { lamp: 'off', word: 'Paused', detail: s.last_run ? `Last ran ${agoWords(s.last_run, now)}.` : 'It has not run yet.' }
  if (card.setup) return { lamp: 'amber', word: 'On, but cannot run yet', detail: card.setup }
  if (s.last_status === 'error') return { lamp: 'red', word: 'Last run failed', detail: s.last_result || 'Open the history to see what went wrong.' }
  if (s.last_status === 'never') return { lamp: 'blue', word: 'On, waiting for its first run', detail: card.next_run ? `Next check ${agoWords(card.next_run, now) === 'soon' ? 'soon' : 'now'}.` : '' }
  return { lamp: 'green', word: 'On', detail: s.last_result || `Last ran ${agoWords(s.last_run, now)}.` }
}

export const CATEGORY_ORDER = ['reminders', 'followups', 'reviews', 'marketing', 'leads'] as const
export const CATEGORY_LABEL: Record<string, string> = {
  reminders: 'Reminders',
  followups: 'Follow-ups',
  reviews: 'Reviews',
  marketing: 'Marketing',
  leads: 'Finding new customers',
}
export const CATEGORY_ICON: Record<string, string> = {
  reminders: 'bell',
  followups: 'message',
  reviews: 'star',
  marketing: 'send',
  leads: 'search',
}

export function groupCards(cards: readonly Card[]): Array<{ id: string; label: string; cards: Card[] }> {
  const out: Array<{ id: string; label: string; cards: Card[] }> = []
  for (const id of CATEGORY_ORDER) {
    const list = cards.filter(c => c.category === id)
    if (list.length) out.push({ id, label: CATEGORY_LABEL[id], cards: list })
  }
  const rest = cards.filter(c => !(CATEGORY_ORDER as readonly string[]).includes(c.category))
  if (rest.length) out.push({ id: 'other', label: 'Other', cards: rest })
  return out
}

export const STATUS_WORDS: Record<string, { lamp: Lamp; word: string }> = {
  queued: { lamp: 'blue', word: 'Waiting to send' },
  sending: { lamp: 'blue', word: 'Sending' },
  sent: { lamp: 'green', word: 'Sent' },
  failed: { lamp: 'red', word: 'Did not send' },
  skipped: { lamp: 'off', word: 'Left out' },
  cancelled: { lamp: 'off', word: 'Cancelled' },
  unknown: { lamp: 'amber', word: 'Not confirmed' },
}

/** Sent, then what the phone company said: "Sent", "Sent, delivered", "Sent, not delivered". */
export function messageStatus(row: Pick<HistoryRow, 'status' | 'delivery' | 'held'>): { lamp: Lamp; word: string } {
  const base = STATUS_WORDS[row.status] || { lamp: 'off' as Lamp, word: row.status }
  if (row.status === 'sent') {
    if (row.delivery === 'delivered') return { lamp: 'green', word: 'Delivered' }
    if (row.delivery === 'undelivered' || row.delivery === 'failed') return { lamp: 'red', word: 'Sent, not delivered' }
  }
  if (row.status === 'queued' && row.held) return { lamp: 'blue', word: 'Held until morning' }
  return base
}

export function outcomeParts(o: Outcome, opts: { delivery: boolean; revenue: boolean; paid?: boolean }): string[] {
  const out = [`${o.sent.toLocaleString('en-US')} sent`]
  if (opts.delivery) out.push(`${o.delivered.toLocaleString('en-US')} delivered`)
  out.push(`${o.replied.toLocaleString('en-US')} replied`)
  if (opts.revenue) {
    out.push(`${o.booked.toLocaleString('en-US')} booked`)
    if (opts.paid !== false) out.push(`${money(o.revenue)} paid`)
  }
  return out
}

/** Words for a rule-based count: "3 people", "1 person". */
export const people = (n: number): string => plural(n, 'person', 'people')

/** Group the next-30-days queue into weeks so the list stays short. */
export function dayLabel(dateKey: string, tz: string, now = Date.now()): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return dateKey
  const noon = Date.UTC(y, m - 1, d, 12)
  const diff = Math.round(Date.UTC(y, m - 1, d) / DAY - dayNumber(now, tz))
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(noon))
}

/** The scheduler line at the top of the screen. */
export function schedulerWords(s: Scheduler, now = Date.now()): { lamp: Lamp; text: string; warn: boolean } {
  if (!s.last_tick_at) return { lamp: 'amber', text: 'Alpha has not checked for due automations yet. Texts that are timed to the minute will wait until it does.', warn: true }
  const ago = agoWords(s.last_tick_at, now)
  if (s.status === 'late') return { lamp: 'red', text: `The last check was ${ago}. It is running late, so automations may go out later than their set time.`, warn: true }
  if (s.every_minutes && s.every_minutes >= 120) {
    const every = s.every_minutes >= 1440 ? 'once a day' : `about every ${Math.round(s.every_minutes / 60)} hours`
    return { lamp: 'amber', text: `Alpha checks ${every}, so a text can go out well after its set time. Ask your developer to check every 5 minutes. Last check ${ago}.`, warn: true }
  }
  return { lamp: 'green', text: `Alpha checks ${s.every_minutes ? `about every ${s.every_minutes} minutes` : 'regularly'}. Last check ${ago}.`, warn: false }
}

/** Phone numbers typed in many ways. True when there are enough digits for a US number. */
export const looksLikePhone = (v: string): boolean => v.replace(/\D/g, '').length >= 10

const ICONS: Record<string, string> = { message: 'inbox', 'check-circle': 'check', edit: 'pen' }
/** The catalog names icons by idea; this maps them to the ones the app has. */
export const iconFor = (name: string): string => ICONS[name] || name
