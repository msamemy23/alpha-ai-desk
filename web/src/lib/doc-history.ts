// The history of a document, in plain words: what changed, who did it, when.
//
// describeChange compares the document as it was last saved with the version being saved, and says
// what is different. The events are written to document_events (migration 046); payments are read
// from the payments table and shown in the same list.

import { calculateDocumentTotals } from '@/lib/document-money'
import { displayLines, jobNameOf } from '@/lib/doc-lines'
import type { DisplayLine, Line } from '@/lib/doc-lines'

type DocLike = Record<string, unknown>
const text = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))
const usd = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export type EventKind =
  | 'edited' | 'status' | 'sent' | 'viewed' | 'approved' | 'declined' | 'partial' | 'signed' | 'link_revoked' | 'link_created'
  | 'void' | 'restored' | 'converted' | 'supplement' | 'note' | 'deleted' | 'extended' | 'options' | 'payment' | 'created'

export interface HistoryEvent {
  id: string
  kind: EventKind | string
  actor: string
  summary: string
  detail?: unknown
  created_at: string
}

export const EVENT_TITLES: Record<string, string> = {
  edited: 'Edited', status: 'Status changed', sent: 'Sent', viewed: 'Customer looked', approved: 'Customer approved', declined: 'Customer declined',
  partial: 'Customer approved some work', signed: 'Signed', link_revoked: 'Link turned off', link_created: 'Link made', void: 'Voided',
  restored: 'Restored', converted: 'Turned into an invoice', supplement: 'Supplement added', note: 'Customer left a note', deleted: 'Deleted',
  extended: 'Expiry changed', options: 'Options changed', payment: 'Payment', created: 'Created',
}

export const eventTitle = (kind: string): string => EVENT_TITLES[kind] || 'Updated'

const lineKey = (l: DisplayLine): string => `${l.kind}|${l.job.toLowerCase()}|${l.description.toLowerCase()}`

export interface ChangeSummary {
  /** Nothing to record when false. */
  changed: boolean
  /** The lines, tax, supplies or total moved. Edits like this on a sent document matter most. */
  material: boolean
  summary: string
  changes: string[]
  totalBefore: number
  totalAfter: number
}

const SCALARS: [string, string][] = [
  ['customer_name', 'Customer'], ['doc_date', 'Date'], ['expires_date', 'Good through'], ['due_date', 'Due date'],
  ['vehicle_year', 'Vehicle year'], ['vehicle_make', 'Vehicle make'], ['vehicle_model', 'Vehicle model'], ['vehicle_vin', 'VIN'],
  ['notes', 'Notes'], ['warranty_type', 'Warranty'], ['payment_terms', 'Payment terms'],
]

/** Compares two versions of a document and lists what is different. Private notes are mentioned, not quoted. */
export function describeChange(before: DocLike, after: DocLike): ChangeSummary {
  const changes: string[] = []
  const tb = calculateDocumentTotals(before)
  const ta = calculateDocumentTotals(after)

  const b = displayLines(before)
  const a = displayLines(after)
  const bucket = (lines: DisplayLine[]) => {
    const m = new Map<string, DisplayLine[]>()
    for (const l of lines) {
      const k = lineKey(l)
      m.set(k, [...(m.get(k) || []), l])
    }
    return m
  }
  const bm = bucket(b)
  const am = bucket(a)
  let added = 0
  let removed = 0
  let repriced = 0
  for (const [k, list] of am) {
    const old = bm.get(k) || []
    list.forEach((l, i) => {
      const o = old[i]
      if (!o) {
        added += 1
        changes.push(`Added ${l.description}${l.job ? ` (${l.job})` : ''}, ${usd(l.total)}`)
      } else if (Math.abs(o.total - l.total) > 0.004 || o.qty !== l.qty) {
        repriced += 1
        changes.push(`Changed ${l.description}: ${usd(o.total)} to ${usd(l.total)}`)
      }
    })
  }
  for (const [k, list] of bm) {
    const now = am.get(k) || []
    list.forEach((l, i) => {
      if (!now[i]) {
        removed += 1
        changes.push(`Removed ${l.description}${l.job ? ` (${l.job})` : ''}, ${usd(l.total)}`)
      }
    })
  }

  let material = added + removed + repriced > 0
  if (Math.abs(tb.taxRate - ta.taxRate) > 1e-9) { changes.push(`Tax rate ${tb.taxRate}% to ${ta.taxRate}%`); material = true }
  if (tb.applyTax !== ta.applyTax) { changes.push(ta.applyTax ? 'Tax turned on' : 'Tax turned off'); material = true }
  if (tb.shopSupplies !== ta.shopSupplies) { changes.push(`Shop supplies ${usd(tb.shopSupplies)} to ${usd(ta.shopSupplies)}`); material = true }
  if (tb.sublet !== ta.sublet) { changes.push(`Sublet ${usd(tb.sublet)} to ${usd(ta.sublet)}`); material = true }
  if (tb.deposit !== ta.deposit) { changes.push(`Deposit ${usd(tb.deposit)} to ${usd(ta.deposit)}`) }

  for (const [key, label] of SCALARS) {
    const x = text(before[key]).trim()
    const y = text(after[key]).trim()
    if (x === y) continue
    if (key === 'notes') changes.push('Notes changed')
    else changes.push(`${label}: ${x || 'blank'} to ${y || 'blank'}`)
  }
  if (text(before.internal_notes).trim() !== text(after.internal_notes).trim()) changes.push('Private notes changed')

  const parts: string[] = []
  if (added) parts.push(`${added} added`)
  if (removed) parts.push(`${removed} removed`)
  if (repriced) parts.push(`${repriced} changed`)
  const totalMoved = Math.abs(tb.total - ta.total) > 0.004
  const head = parts.length ? `Lines: ${parts.join(', ')}.` : changes.length ? `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}.` : ''
  const summary = [head, totalMoved ? `Total ${usd(tb.total)} to ${usd(ta.total)}.` : ''].filter(Boolean).join(' ')

  return {
    changed: changes.length > 0 || totalMoved,
    material: material || totalMoved,
    summary: summary || 'Saved.',
    changes: changes.slice(0, 40),
    totalBefore: tb.total,
    totalAfter: ta.total,
  }
}

export function statusEventKind(from: string, to: string): EventKind {
  if (to === 'Void') return 'void'
  if (from === 'Void') return 'restored'
  return 'status'
}

export interface PaymentRow { id: string; amount: number | string; method?: string | null; note?: string | null; paid_at?: string | null; created_at?: string | null }

/** Events and payments in one list, newest first. */
export function mergeTimeline(events: HistoryEvent[], payments: PaymentRow[]): HistoryEvent[] {
  const pays: HistoryEvent[] = payments.map((p) => ({
    id: `pay-${p.id}`,
    kind: 'payment',
    actor: 'Shop',
    summary: `${usd(Number(p.amount) || 0)}${p.method ? ` by ${text(p.method)}` : ''}${p.note ? `. ${text(p.note)}` : ''}`,
    created_at: text(p.paid_at || p.created_at),
  }))
  return [...events, ...pays].sort((x, y) => (x.created_at < y.created_at ? 1 : x.created_at > y.created_at ? -1 : 0))
}

/** "Today 3:42 PM", "Oct 12 at 9:05 AM". Passing the clock keeps this testable. */
export function whenLabel(iso: string, nowMs: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date(nowMs)
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return `Today ${time}`
  const y = new Date(nowMs - 86400000)
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}) })
  return `${date} at ${time}`
}

/** Short line on the document card: who has seen it and what they did. */
export interface LinkSummary { sentAt: string | null; viewedAt: string | null; views: number; answeredAt: string | null; answer: string; answerNote?: boolean }

export function linkLine(s: LinkSummary | undefined, nowMs: number): string {
  if (!s) return ''
  if (s.answeredAt) return `${s.answer || 'Answered'} ${whenLabel(s.answeredAt, nowMs).toLowerCase()}`
  if (s.viewedAt) return `Customer looked ${whenLabel(s.viewedAt, nowMs).toLowerCase()}${s.views > 1 ? `, ${s.views} times` : ''}`
  if (s.sentAt) return `Sent ${whenLabel(s.sentAt, nowMs).toLowerCase()}, not opened yet`
  return ''
}

export const jobList = (lines: Line[]): string[] => Array.from(new Set(lines.map(jobNameOf).filter(Boolean)))

/**
 * The parts of a document kept as an earlier version: lines, fees, tax, dates, notes and the customer and vehicle
 * details. Payments, the document number and the status of payment are never part of a version, so putting one back
 * can never touch money already taken or the numbering.
 */
export const REVISION_FIELDS = [
  'parts', 'labors', 'shop_supplies', 'sublet', 'deposit', 'tax_rate', 'apply_tax', 'notes', 'doc_date', 'expires_date', 'due_date',
  'customer_name', 'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_mileage', 'vehicle_vin', 'payment_terms',
  'warranty_type', 'warranty_months', 'warranty_mileage', 'warranty_exclusions',
] as const

export function revisionSnapshot(doc: DocLike): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of REVISION_FIELDS) if (doc[key] !== undefined) out[key] = doc[key]
  return out
}

/** A snapshot is only kept when it is a reasonable size; the database also enforces a limit. */
export const REVISION_MAX_CHARS = 250000

/* ───────────────────────── What customers did with their links ───────────────────────── */

export interface LinkRowLite {
  document_id: string
  created_at: string
  channel?: string | null
  first_viewed_at?: string | null
  last_viewed_at?: string | null
  view_count?: number | null
  email_opened_at?: string | null
  completed_at?: string | null
  response?: string | null
  revoked_at?: string | null
}

export function answerWords(response: string | null | undefined): string {
  switch (response) {
    case 'approved': return 'Approved'
    case 'partial': return 'Approved some work'
    case 'declined': return 'Declined'
    case 'signed': return 'Signed'
    default: return 'Answered'
  }
}

const later = (a: string | null, b: string | null | undefined): string | null => (!b ? a : !a || b > a ? b : a)

/**
 * One line of "who looked and what they did" per document, from its links. A link the shop turned off does not count
 * as sent or viewed, but an answer given before it was turned off still shows. Texted or emailed links count as sent;
 * a link only copied does not (the shop knows whether it was pasted into a message).
 */
export function summarizeLinks(rows: LinkRowLite[], notes: Set<string> = new Set()): Record<string, LinkSummary> {
  const out: Record<string, LinkSummary> = {}
  const latestAnswer: Record<string, string> = {}
  for (const r of rows) {
    if (!r || !r.document_id) continue
    const s = out[r.document_id] || (out[r.document_id] = { sentAt: null, viewedAt: null, views: 0, answeredAt: null, answer: '', answerNote: notes.has(r.document_id) })
    if (r.completed_at && (!s.answeredAt || r.completed_at > s.answeredAt)) {
      s.answeredAt = r.completed_at
      latestAnswer[r.document_id] = answerWords(r.response)
      s.answer = latestAnswer[r.document_id]
    }
    if (r.revoked_at && !r.completed_at) continue
    if (r.channel !== 'copy') s.sentAt = later(s.sentAt, r.created_at)
    s.viewedAt = later(s.viewedAt, r.last_viewed_at || r.first_viewed_at)
    s.views += Number(r.view_count) || 0
  }
  for (const id of Object.keys(out)) {
    const s = out[id]
    if (!s.sentAt && !s.viewedAt && !s.answeredAt) delete out[id]
  }
  return out
}
