// Plain helpers for the Promotions screen. No imports, so they can be tested on their own.

export type Lamp = 'green' | 'amber' | 'red' | 'blue' | 'off'

/** What the audience fields on the form hold, as typed. Numbers stay text until they are sent. */
export interface AudienceForm {
  notInDays: string
  inWithinDays: string
  makes: string
  yearMin: string
  yearMax: string
  minSpend: string
  maxSpend: string
  tags: string
  tagMode: 'any' | 'all'
  hasEmail: boolean
}

export const emptyForm = (): AudienceForm => ({ notInDays: '', inWithinDays: '', makes: '', yearMin: '', yearMax: '', minSpend: '', maxSpend: '', tags: '', tagMode: 'any', hasEmail: false })

const whole = (v: string): number | undefined => {
  const t = String(v).trim().replace(/^\$/, '').replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined
  const n = Math.floor(Number(t))
  return Number.isFinite(n) && n > 0 ? n : undefined
}
const words = (v: string): string[] => [...new Set(v.split(',').map(x => x.trim()).filter(Boolean).map(x => x.slice(0, 40)))].slice(0, 20)

/** The filters the server understands. Anything left empty is simply not sent. */
export function formToAudience(f: AudienceForm): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const min = whole(f.notInDays); if (min) out.lastVisitMinDays = Math.min(min, 3650)
  const max = whole(f.inWithinDays); if (max) out.lastVisitMaxDays = Math.min(max, 3650)
  const makes = words(f.makes); if (makes.length) out.makes = makes
  const y1 = whole(f.yearMin); if (y1) out.yearMin = y1
  const y2 = whole(f.yearMax); if (y2) out.yearMax = y2
  const s1 = whole(f.minSpend); if (s1) out.minSpend = s1
  const s2 = whole(f.maxSpend); if (s2) out.maxSpend = s2
  const tags = words(f.tags); if (tags.length) { out.tags = tags; out.tagMode = f.tagMode }
  if (f.hasEmail) out.hasEmail = true
  return out
}

const str = (v: unknown): string => (typeof v === 'number' && v > 0 ? String(v) : '')

/** A saved audience, back into form fields. */
export function audienceToForm(a: unknown): AudienceForm {
  const r = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
  const list = (v: unknown): string => (Array.isArray(v) ? v.map(String).join(', ') : '')
  return {
    notInDays: str(r.lastVisitMinDays), inWithinDays: str(r.lastVisitMaxDays), makes: list(r.makes), yearMin: str(r.yearMin), yearMax: str(r.yearMax),
    minSpend: str(r.minSpend), maxSpend: str(r.maxSpend), tags: list(r.tags), tagMode: r.tagMode === 'all' ? 'all' : 'any', hasEmail: r.hasEmail === true,
  }
}

/** True when the form would send exactly the same audience as the saved one. */
export const sameAudience = (a: AudienceForm, b: AudienceForm): boolean => JSON.stringify(formToAudience(a)) === JSON.stringify(formToAudience(b))

/** Problems with the filters that the server would only say after a tap. */
export function audienceProblems(f: AudienceForm): string[] {
  const out: string[] = []
  const min = whole(f.notInDays), max = whole(f.inWithinDays)
  if (min && max && min > max) out.push('"Not in for" cannot be longer than "Last in within". Change one of them.')
  const y1 = whole(f.yearMin), y2 = whole(f.yearMax)
  if (y1 && (y1 < 1900 || y1 > 2100)) out.push('Enter a model year such as 2015.')
  if (y2 && (y2 < 1900 || y2 > 2100)) out.push('Enter a model year such as 2022.')
  if (y1 && y2 && y1 > y2) out.push('The first model year is after the second. Swap them.')
  const s1 = whole(f.minSpend), s2 = whole(f.maxSpend)
  if (s1 && s2 && s1 > s2) out.push('"Spent at least" is more than "Spent at most". Change one of them.')
  return out
}

// ── What the server sends back ────────────────────────────────────────────

export interface Counts {
  queued: number; sending: number; sent: number; failed: number; unknown: number; skipped: number; cancelled: number
  delivered: number; undelivered: number; next_send_after: string | null
}

export interface PromotionView {
  id: string
  name: string
  message: string
  email_subject: string
  audience: Record<string, unknown>
  audience_text: string
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'
  send_at: string | null
  created_at: string
  sent_at: string | null
  counts: Counts
  waiting: number
}

export interface PromotionPreview {
  problems: string[]
  matched: number
  counts: { will_receive: number; texts: number; emails: number; held_for_quiet_hours: number; left_out: number; over_limit: number }
  left_out_by: Array<{ reason: string; label: string; count: number }>
  recipients: Array<{ name: string; to: string; channel: 'sms' | 'email'; text: string; subject: string | null; parts: number; send_at_iso: string; held: boolean }>
  left_out: Array<{ name: string; reason: string; label: string }>
  first_send_iso: string | null
  last_send_iso: string | null
  quiet_hours: { start: number; end: number; skip_sundays: boolean }
}

export interface PromotionShop { sms_ready: boolean; email_ready: boolean; master_enabled: boolean; timezone: string; name: string; has_settings: boolean }

export const PROMOTION_STATUS: Record<PromotionView['status'], { lamp: Lamp; word: string }> = {
  draft: { lamp: 'off', word: 'Draft' },
  scheduled: { lamp: 'blue', word: 'Scheduled' },
  sending: { lamp: 'amber', word: 'Sending' },
  sent: { lamp: 'green', word: 'Sent' },
  cancelled: { lamp: 'off', word: 'Stopped' },
}

const n = (v: number): string => v.toLocaleString('en-US')

/** "120 sent, 4 waiting, 6 left out" for a promotion that has gone out. Drafts say who they are for instead. */
export function countsLine(p: Pick<PromotionView, 'status' | 'counts' | 'waiting' | 'audience_text'>): string {
  if (p.status === 'draft') return p.audience_text ? `For ${p.audience_text}` : 'For all customers'
  const c = p.counts
  const bits = [`${n(c.sent)} sent`]
  if (p.waiting > 0) bits.push(`${n(p.waiting)} waiting`)
  if (c.failed + c.unknown > 0) bits.push(`${n(c.failed + c.unknown)} did not send`)
  if (c.cancelled > 0) bits.push(`${n(c.cancelled)} cancelled`)
  if (c.skipped > 0) bits.push(`${n(c.skipped)} left out`)
  return bits.join(' · ')
}

// ── Shop-local time for the "send later" field ────────────────────────────

const pad = (v: number): string => String(v).padStart(2, '0')

function zonedParts(ms: number, tz: string): { y: number; m: number; d: number; h: number; min: number } {
  let zone = tz
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }) } catch { zone = 'America/Chicago' }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))
  const get = (t: string): number => Number(parts.find(p => p.type === t)?.value || 0)
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, min: get('minute') }
}

/** A value for a date-and-time field, in the shop's own clock: "2026-10-20T10:00". */
export function shopLocalValue(ms: number, tz: string): string {
  const p = zonedParts(ms, tz)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.min)}`
}

/** Tomorrow at 10:00 in the shop's own clock: a sensible first choice for "send later". */
export function tomorrowMorning(now: number, tz: string): string {
  const p = zonedParts(now, tz)
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1))
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}T10:00`
}

/** True when the typed value is a full date and time. */
export const isLocalValue = (v: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)

/** True when a text sent at this hour (0 to 23) would reach someone during quiet hours. Defaults are 9 PM to 8 AM. */
export function isAfterHours(hour: number, start = 21, end = 8): boolean {
  const h = ((Math.floor(hour) % 24) + 24) % 24
  return start > end ? h >= start || h < end : h >= start && h < end
}
