/**
 * What a customer is worth to the shop and how recently they came in: lifetime spend, balance owed, visits, last visit and
 * average ticket. The money arrives already worked out by the shop's document maths (total and paid per document); nothing
 * here changes how a total is calculated. Imports only list-logic's owed and paid sums so every screen agrees.
 */
import { owedOn, paidOn } from '../list-logic.ts'

export interface StatDoc { id: string; type: string; status: string; date: string; total: number; paid: number }
export interface StatJob { id: string; created: string; status: string }

export interface CustomerStats {
  /** Money actually collected on invoices and receipts. */
  lifetime: number
  /** Total of every invoice and receipt that was sent. */
  billed: number
  owed: number
  /** Repair orders on file. */
  visits: number
  firstSeen: string
  /** The newest repair order or invoice. */
  lastVisit: string
  daysSince: number | null
  /** Billed divided by the number of invoices and receipts. Null with none. */
  averageTicket: number | null
  openEstimates: { count: number; total: number }
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const live = (d: StatDoc): boolean => d.status !== 'Draft' && d.status !== 'Void'

export function customerStats(docs: StatDoc[], jobs: StatJob[], nowMs: number, createdAt = ''): CustomerStats {
  const money = docs.map(d => ({ type: d.type, status: d.status, total: d.total, paid: d.paid }))
  const billedDocs = docs.filter(d => live(d) && (d.type === 'Invoice' || d.type === 'Receipt'))
  const billed = round2(billedDocs.reduce((s, d) => s + Math.max(0, d.total), 0))
  const dates = [...billedDocs.map(d => d.date), ...jobs.map(j => j.created)].filter(Boolean).sort()
  const lastVisit = dates.length ? dates[dates.length - 1] : ''
  const first = [createdAt, ...dates].filter(Boolean).sort()[0] || ''
  const last = lastVisit ? Date.parse(lastVisit) : NaN
  const open = docs.filter(d => d.type === 'Estimate' && (d.status === 'Draft' || d.status === 'Sent'))
  return {
    lifetime: paidOn(money),
    billed,
    owed: owedOn(money),
    visits: jobs.length,
    firstSeen: first,
    lastVisit,
    daysSince: Number.isFinite(last) ? Math.max(0, Math.floor((nowMs - last) / 86_400_000)) : null,
    averageTicket: billedDocs.length ? round2(billed / billedDocs.length) : null,
    openEstimates: { count: open.length, total: round2(open.reduce((s, d) => s + Math.max(0, d.total), 0)) },
  }
}
