// The estimates and invoices lists: search, filters, sorting, saved views, file export.
//
// Pure functions over rows the page has already loaded. Totals come from document-money.ts.

import { calculateDocumentTotals } from '@/lib/document-money'
import { expiryState, daysBetween, isIsoDay } from '@/lib/doc-approval'
import type { LinkSummary } from '@/lib/doc-history'

type DocLike = Record<string, unknown>
const text = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

export interface ListRow {
  doc: DocLike & { id: string; type: string; status: string }
  total: number
  balance: number
  paid: number
  /** Money is still owed on a sent or unpaid invoice. */
  owes: boolean
  link?: LinkSummary
}

const OWED = new Set(['Unpaid', 'Partial', 'Sent'])

export function makeRow(doc: ListRow['doc'], link?: LinkSummary): ListRow {
  const t = calculateDocumentTotals(doc)
  return { doc, total: t.total, balance: t.balanceDue, paid: t.amountPaid, owes: OWED.has(text(doc.status)) && t.balanceDue > 0.005, link }
}

export type ListFilter =
  | 'all' | 'draft' | 'waiting' | 'viewed' | 'approved' | 'declined' | 'expiring' | 'void'
  | 'unpaid' | 'part' | 'paid' | 'overdue'

export type ListSort = 'newest' | 'oldest' | 'amount_high' | 'amount_low' | 'customer'
export type ListRange = 'any' | '7d' | '30d' | '90d' | 'year'

export const SORT_LABELS: Record<ListSort, string> = {
  newest: 'Newest first', oldest: 'Oldest first', amount_high: 'Biggest amount', amount_low: 'Smallest amount', customer: 'Customer A to Z',
}
export const RANGE_LABELS: Record<ListRange, string> = {
  any: 'Any time', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', year: 'This year',
}

export const dayOf = (doc: DocLike): string => {
  const d = text(doc.doc_date).slice(0, 10)
  return isIsoDay(d) ? d : text(doc.created_at).slice(0, 10)
}

export function inRange(doc: DocLike, range: ListRange, todayIso: string): boolean {
  if (range === 'any') return true
  const d = dayOf(doc)
  if (!isIsoDay(d)) return true
  if (range === 'year') return d.slice(0, 4) === todayIso.slice(0, 4)
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const age = daysBetween(d, todayIso)
  return age >= 0 && age < days
}

/** Past the due date and still owing. Documents with no due date are not overdue. */
export function isOverdue(row: ListRow, todayIso: string): boolean {
  if (row.doc.type === 'Estimate' || !row.owes) return false
  const due = text(row.doc.due_date).slice(0, 10)
  return isIsoDay(due) && daysBetween(due, todayIso) > 0
}

export function matchesFilter(f: ListFilter, row: ListRow, todayIso: string): boolean {
  const s = text(row.doc.status)
  switch (f) {
    case 'all': return s !== 'Void'
    case 'draft': return s === 'Draft'
    case 'waiting': return s === 'Sent'
    case 'viewed': return s === 'Sent' && !!row.link?.viewedAt && !row.link?.answeredAt
    case 'approved': return s === 'Approved'
    case 'declined': return s === 'Declined'
    case 'expiring': {
      if (row.doc.type !== 'Estimate' || (s !== 'Sent' && s !== 'Draft')) return false
      const st = expiryState(row.doc.expires_date, todayIso).state
      return st === 'soon' || st === 'today' || st === 'expired'
    }
    case 'void': return s === 'Void'
    case 'unpaid': return row.owes
    case 'part': return s === 'Partial'
    case 'paid': return s === 'Paid'
    case 'overdue': return isOverdue(row, todayIso)
  }
}

/** Everything searchable in one lowercase string: numbers, names, car, plate, VIN, and the work itself. */
export function haystack(doc: DocLike): string {
  const lines: string[] = []
  for (const key of ['parts', 'labors'] as const) {
    const list = Array.isArray(doc[key]) ? (doc[key] as DocLike[]) : []
    for (const l of list) if (l && typeof l === 'object') lines.push(text(l.name), text(l.operation), text(l.description), text(l.brand), text(l.part_number), text(l.job))
  }
  return [
    doc.doc_number, doc.customer_name, doc.customer_phone, doc.customer_email, doc.status,
    doc.vehicle_year, doc.vehicle_make, doc.vehicle_model, doc.vehicle_plate, doc.vehicle_vin, doc.notes,
    ...lines,
  ].map(text).join(' ').toLowerCase()
}

/** Every word typed must be found somewhere. "brake smith" finds Smith's brake job. */
export function matchesSearch(row: ListRow, query: string, cache?: Map<string, string>): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  let hay = cache?.get(row.doc.id)
  if (hay === undefined) {
    hay = haystack(row.doc)
    cache?.set(row.doc.id, hay)
  }
  return words.every((w) => hay!.includes(w))
}

export function sortRows(rows: ListRow[], sort: ListSort): ListRow[] {
  const copy = rows.slice()
  const created = (r: ListRow) => text(r.doc.created_at)
  switch (sort) {
    case 'oldest': return copy.sort((a, b) => (created(a) < created(b) ? -1 : created(a) > created(b) ? 1 : 0))
    case 'amount_high': return copy.sort((a, b) => b.total - a.total)
    case 'amount_low': return copy.sort((a, b) => a.total - b.total)
    case 'customer': return copy.sort((a, b) => text(a.doc.customer_name).localeCompare(text(b.doc.customer_name)))
    default: return copy.sort((a, b) => (created(a) < created(b) ? 1 : created(a) > created(b) ? -1 : 0))
  }
}

export interface ListQuery { filter: ListFilter; sort: ListSort; range: ListRange; search: string }
export const DEFAULT_QUERY: ListQuery = { filter: 'all', sort: 'newest', range: 'any', search: '' }

export function runQuery(rows: ListRow[], q: ListQuery, todayIso: string): ListRow[] {
  const cache = new Map<string, string>()
  const visible = rows.filter((r) => matchesFilter(q.filter, r, todayIso) && inRange(r.doc, q.range, todayIso) && matchesSearch(r, q.search, cache))
  return sortRows(visible, q.sort)
}

/* ───────────────────────── Follow-up hints ───────────────────────── */

export interface Hint { tone: 'amber' | 'red' | 'blue'; text: string }

/** One short line telling the writer what needs attention on a row, or null. */
export function rowHint(row: ListRow, todayIso: string, nowMs: number): Hint | null {
  const s = text(row.doc.status)
  if (s === 'Void') return null
  if (row.doc.type === 'Estimate') {
    const ex = expiryState(row.doc.expires_date, todayIso)
    if ((s === 'Sent' || s === 'Draft') && ex.state === 'expired') return { tone: 'red', text: 'Expired' }
    if (s === 'Sent' && (ex.state === 'soon' || ex.state === 'today')) return { tone: 'amber', text: ex.state === 'today' ? 'Expires today' : `Expires in ${ex.daysLeft} days` }
    if (s === 'Approved' && row.link?.answerNote) return { tone: 'blue', text: 'Customer left a note' }
    if (s === 'Sent' && row.link?.viewedAt && !row.link.answeredAt) {
      const days = Math.floor((nowMs - new Date(row.link.viewedAt).getTime()) / 86400000)
      return days >= 2 ? { tone: 'amber', text: 'Looked at it, no answer yet' } : { tone: 'blue', text: 'Customer looked' }
    }
    if (s === 'Sent') {
      const sent = text(row.doc.sent_at) || row.link?.sentAt || ''
      const days = sent ? Math.floor((nowMs - new Date(sent).getTime()) / 86400000) : 0
      if (days >= 3) return { tone: 'amber', text: `No answer after ${days} days` }
    }
    return null
  }
  if (isOverdue(row, todayIso)) return { tone: 'red', text: `Overdue ${daysBetween(text(row.doc.due_date).slice(0, 10), todayIso)} days` }
  return null
}

/* ───────────────────────── File export ───────────────────────── */

/** A cell that starts with = + - or @ would run as a formula in a spreadsheet, so it gets a leading apostrophe. */
export function csvCell(value: unknown): string {
  let s = text(value).replace(/\r?\n/g, ' ')
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const CSV_HEADERS = ['Number', 'Type', 'Status', 'Date', 'Customer', 'Vehicle', 'Total', 'Paid', 'Balance', 'Good through or due', 'Sent']

export function rowsToCsv(rows: ListRow[]): string {
  const money = (n: number) => n.toFixed(2)
  const lines = rows.map((r) => {
    const d = r.doc
    const car = [d.vehicle_year, d.vehicle_make, d.vehicle_model].map(text).filter(Boolean).join(' ')
    const date = r.doc.type === 'Estimate' ? text(d.expires_date).slice(0, 10) : text(d.due_date).slice(0, 10)
    return [d.doc_number, d.type, d.status, dayOf(d), d.customer_name, car, money(r.total), money(r.paid), money(r.balance), date, text(d.sent_at).slice(0, 10)].map(csvCell).join(',')
  })
  return [CSV_HEADERS.join(','), ...lines].join('\r\n') + '\r\n'
}

/* ───────────────────────── Saved views ───────────────────────── */

export interface SavedView { id: string; name: string; query: ListQuery }

const FILTERS = new Set<ListFilter>(['all', 'draft', 'waiting', 'viewed', 'approved', 'declined', 'expiring', 'void', 'unpaid', 'part', 'paid', 'overdue'])
const SORTS = new Set<ListSort>(['newest', 'oldest', 'amount_high', 'amount_low', 'customer'])
const RANGES = new Set<ListRange>(['any', '7d', '30d', '90d', 'year'])

export function normalizeViews(raw: unknown): SavedView[] {
  return (Array.isArray(raw) ? raw : [])
    .map((v): SavedView | null => {
      if (!v || typeof v !== 'object') return null
      const o = v as Record<string, unknown>
      const q = (o.query && typeof o.query === 'object' ? o.query : {}) as Record<string, unknown>
      const name = text(o.name).replace(/\s+/g, ' ').trim().slice(0, 40)
      const id = text(o.id)
      if (!name || !id) return null
      return {
        id, name,
        query: {
          filter: FILTERS.has(q.filter as ListFilter) ? (q.filter as ListFilter) : 'all',
          sort: SORTS.has(q.sort as ListSort) ? (q.sort as ListSort) : 'newest',
          range: RANGES.has(q.range as ListRange) ? (q.range as ListRange) : 'any',
          search: text(q.search).slice(0, 80),
        },
      }
    })
    .filter((v): v is SavedView => v !== null)
    .slice(0, 12)
}

export function sameQuery(a: ListQuery, b: ListQuery): boolean {
  return a.filter === b.filter && a.sort === b.sort && a.range === b.range && a.search.trim() === b.search.trim()
}

/** Paging plan for loading every document: first page fast, then the rest. */
export function pageRanges(total: number, firstPage: number, pageSize: number): [number, number][] {
  const out: [number, number][] = []
  let from = 0
  let size = firstPage
  while (from < total) {
    out.push([from, Math.min(from + size, total) - 1])
    from += size
    size = pageSize
  }
  return out
}

/**
 * Puts a freshly loaded newest page into the documents already on screen. A page that is not full is everything there
 * is, so it replaces the list. A full page replaces its own stretch of the list: rows in it are updated, new ones
 * are added, and rows that fall inside that stretch but are missing from it were deleted elsewhere, so they go.
 * Older rows beyond the page are kept as they are.
 */
export function mergeFirstPage<T extends { id: string; created_at?: string | null }>(existing: T[], page: T[], pageIsFull: boolean): T[] {
  if (!pageIsFull || existing.length === 0) return page.slice()
  const ids = new Set(page.map((r) => r.id))
  const oldest = page.reduce<string>((min, r) => { const c = text(r.created_at); return c && (!min || c < min) ? c : min }, '')
  const older = existing.filter((r) => !ids.has(r.id) && (!oldest || (text(r.created_at) !== '' && text(r.created_at) < oldest)))
  return [...page, ...older]
}
