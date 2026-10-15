/**
 * Reports the owner saves by name, and emails that go out on a schedule.
 *
 * A scheduled report is a standing permission to email numbers to named people, so it is built to be predictable:
 *  - it goes only to addresses the owner typed in, never to customers, and at most five of them;
 *  - it always covers the week or month that just ended, so the same period is never sent twice (the period is the key);
 *  - the owner sees the exact subject, recipients and text before turning it on, can send a test to themselves, and can
 *    pause it with one switch;
 *  - turning a schedule on does not send the period that just ended, only the next one.
 */
import { isCompareMode, isRangeKey, isDayKey, scheduledPeriod } from './report-ranges.ts'
import type { CompareSpec, RangeSpec } from './report-ranges.ts'
import type { Range } from './reports.ts'

export type ReportKind = 'summary' | 'sales' | 'profit' | 'receivables' | 'tax'
export const REPORT_KINDS: { key: ReportKind; label: string; help: string }[] = [
  { key: 'summary', label: 'Shop summary', help: 'What changed, money in, what is owed, and the biggest kinds of work.' },
  { key: 'sales', label: 'Sales breakdown', help: 'Sales by kind of work, advisor and technician.' },
  { key: 'profit', label: 'Profit and loss', help: 'Income, cost of goods, expenses and what is left.' },
  { key: 'receivables', label: 'Who owes you', help: 'Unpaid invoices by age and by customer.' },
  { key: 'tax', label: 'Sales tax', help: 'Tax collected, by authority and by month.' },
]
export const isReportKind = (v: unknown): v is ReportKind => REPORT_KINDS.some(k => k.key === v)

export type Schedule = 'none' | 'weekly' | 'monthly'
export const MAX_RECIPIENTS = 5

export interface SavedReport {
  id: string
  name: string
  kind: ReportKind
  range: RangeSpec
  compare: CompareSpec
  schedule: Schedule
  recipients: string[]
  enabled: boolean
  /** The period key of the last scheduled send (or of the period that was current when the schedule was turned on). */
  last_period: string | null
  last_sent_at: string | null
  created_at: string
}

export interface SavedWrite { name: string; kind: ReportKind; range: RangeSpec; compare: CompareSpec; schedule: Schedule; recipients: string[]; enabled: boolean }
export type SavedField = 'name' | 'kind' | 'range' | 'compare' | 'schedule' | 'recipients'

const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** A plain, conservative check: one address, no spaces, something@something.tld. */
export function isEmail(v: unknown): v is string {
  const s = String(v ?? '').trim()
  return s.length <= 254 && /^[^\s@<>,;"()[\]\\]+@[^\s@<>,;"()[\]\\.]+(\.[^\s@<>,;"()[\]\\.]+)+$/.test(s)
}

/** Addresses typed in a box, split on commas, semicolons, spaces and new lines. Duplicates (any case) are dropped. */
export function parseRecipients(text: unknown): { good: string[]; bad: string[] } {
  const parts = (Array.isArray(text) ? text.map(String) : String(text ?? '').split(/[\s,;]+/)).map(s => s.trim()).filter(Boolean)
  const seen = new Set<string>()
  const good: string[] = [], bad: string[] = []
  for (const p of parts) {
    if (!isEmail(p)) { bad.push(p); continue }
    const k = p.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k); good.push(p)
  }
  return { good, bad }
}

export function checkSaved(input: Record<string, unknown>): { ok: true; value: SavedWrite } | { ok: false; errors: Partial<Record<SavedField, string>> } {
  const errors: Partial<Record<SavedField, string>> = {}
  const name = clean(input.name, 80)
  if (!name) errors.name = 'Give the report a name, like "Monday summary".'
  if (!isReportKind(input.kind)) errors.kind = 'Choose which report to save.'
  const r = (input.range && typeof input.range === 'object' ? input.range : {}) as Record<string, unknown>
  const range: RangeSpec = isRangeKey(r.key) ? { key: r.key } : { key: '30d' }
  if (range.key === 'custom') {
    if (isDayKey(r.from) && isDayKey(r.to) && r.from <= r.to) { range.from = r.from; range.to = r.to } else errors.range = 'Pick a first and last day, with the first day before the last.'
  }
  const c = (input.compare && typeof input.compare === 'object' ? input.compare : {}) as Record<string, unknown>
  const compare: CompareSpec = isCompareMode(c.mode) ? { mode: c.mode } : { mode: 'previous' }
  if (compare.mode === 'custom') {
    if (isDayKey(c.from) && isDayKey(c.to) && c.from <= c.to) { compare.from = c.from; compare.to = c.to } else errors.compare = 'Pick both comparison days, with the first before the last.'
  }
  const schedule: Schedule = input.schedule === 'weekly' || input.schedule === 'monthly' ? input.schedule : 'none'
  const { good, bad } = parseRecipients(input.recipients)
  if (bad.length) errors.recipients = `${bad.slice(0, 3).join(', ')} ${bad.length === 1 ? 'is not an email address' : 'are not email addresses'}.`
  else if (good.length > MAX_RECIPIENTS) errors.recipients = `Send to at most ${MAX_RECIPIENTS} people. Use a group address for more.`
  else if (schedule !== 'none' && good.length === 0) errors.recipients = 'Add at least one email address to send this to.'
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { name, kind: input.kind as ReportKind, range, compare, schedule, recipients: good, enabled: schedule !== 'none' && input.enabled !== false } }
}

/** Rows from the database arrive with loose types. */
export function savedFrom(raw: Record<string, unknown>): SavedReport {
  const rec = parseRecipients(raw.recipients).good
  const kind = isReportKind(raw.kind) ? raw.kind : 'summary'
  const range = (raw.range && typeof raw.range === 'object' ? raw.range : {}) as Record<string, unknown>
  const compare = (raw.compare && typeof raw.compare === 'object' ? raw.compare : {}) as Record<string, unknown>
  return {
    id: String(raw.id ?? ''), name: clean(raw.name, 80) || 'Saved report', kind,
    range: isRangeKey(range.key) ? { key: range.key, ...(isDayKey(range.from) ? { from: range.from } : {}), ...(isDayKey(range.to) ? { to: range.to } : {}) } : { key: '30d' },
    compare: isCompareMode(compare.mode) ? { mode: compare.mode, ...(isDayKey(compare.from) ? { from: compare.from } : {}), ...(isDayKey(compare.to) ? { to: compare.to } : {}) } : { mode: 'previous' },
    schedule: raw.schedule === 'weekly' || raw.schedule === 'monthly' ? raw.schedule : 'none',
    recipients: rec.slice(0, MAX_RECIPIENTS), enabled: raw.enabled === true,
    last_period: raw.last_period ? String(raw.last_period) : null, last_sent_at: raw.last_sent_at ? String(raw.last_sent_at) : null,
    created_at: String(raw.created_at ?? ''),
  }
}

export interface DuePeriod { key: string; range: Range; previous: Range; title: string }

/** The period a scheduled report should go out for today, or null when it is paused, not scheduled, or already sent. */
export function duePeriod(s: SavedReport, today: string): DuePeriod | null {
  if (!s.enabled || s.schedule === 'none' || !s.recipients.length) return null
  const p = scheduledPeriod(s.schedule, today)
  return p.key === s.last_period ? null : p
}

/** The period to record when a schedule is turned on, so the first send is the next period and not an immediate surprise. */
export function periodToSkip(schedule: Schedule, today: string): string | null {
  return schedule === 'none' ? null : scheduledPeriod(schedule, today).key
}

/** The next day a scheduled report will go out, for the screen to state plainly. */
export function nextSendDay(schedule: Schedule, today: string): string {
  const d = new Date(`${today}T12:00:00`)
  if (schedule === 'weekly') { const add = ((8 - d.getDay()) % 7) || 7; d.setDate(d.getDate() + add) }
  else { d.setMonth(d.getMonth() + 1, 1) }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export interface EmailPreview { to: string[]; subject: string; text: string }

export function emailSubject(shopName: string, name: string, periodTitle: string): string {
  const shop = shopName.trim()
  return `${shop ? `${shop}: ` : ''}${name} - ${periodTitle}`.slice(0, 200)
}
