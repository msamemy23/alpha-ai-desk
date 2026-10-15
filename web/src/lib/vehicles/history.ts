/**
 * Service history for one car: its repair orders, with what each one billed, plus invoices that were written without a repair
 * order. Money arrives already worked out by the shop's own document maths. Imports only a type from list-logic.
 */
import type { VehicleJob } from '../list-logic.ts'

export interface HistoryDoc {
  id: string
  type: string
  status: string
  /** The document's number as printed, e.g. INV-1001. */
  number: string
  date: string
  total: number
  paid: number
  jobId: string
  customerId: string
  vin: string
  year: string
  make: string
  model: string
}

export interface HistoryItem {
  /** "job:<id>" or "doc:<id>". */
  id: string
  kind: 'repair' | 'invoice'
  date: string
  title: string
  status: string
  mileage: number | null
  /** What it billed, from the invoice or receipt. Null when there is none. */
  billed: number | null
  /** An estimate is shown as a quote, not as money billed. */
  estimate: number | null
  docs: { id: string; type: string; number: string; status: string; total: number }[]
  jobId: string
}

const live = (d: HistoryDoc): boolean => d.status !== 'Draft' && d.status !== 'Void'
const round2 = (n: number): number => Math.round(n * 100) / 100

export function serviceHistory(jobs: VehicleJob[], docs: HistoryDoc[], car: { vin: string; ownerId: string; year: string; make: string; model: string }): HistoryItem[] {
  const jobIds = new Set(jobs.map(j => j.id))
  const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()
  const items: HistoryItem[] = []
  const claimed = new Set<string>()
  for (const j of jobs) {
    const mine = docs.filter(d => d.jobId === j.id)
    for (const d of mine) claimed.add(d.id)
    const billedDocs = mine.filter(d => live(d) && (d.type === 'Invoice' || d.type === 'Receipt'))
    const quotes = mine.filter(d => live(d) && d.type === 'Estimate')
    items.push({
      id: `job:${j.id}`, kind: 'repair', date: j.created, title: j.concern || (j.ro ? `Repair order ${j.ro}` : 'Repair order'), status: j.status,
      mileage: j.mileage,
      billed: billedDocs.length ? round2(billedDocs.reduce((sum, d) => sum + d.total, 0)) : null,
      estimate: !billedDocs.length && quotes.length ? round2(quotes[0].total) : null,
      docs: mine.map(d => ({ id: d.id, type: d.type, number: d.number, status: d.status, total: d.total })),
      jobId: j.id,
    })
  }
  // Invoices written for this car without a repair order: matched by VIN, or by owner and year, make, model.
  for (const d of docs) {
    if (claimed.has(d.id) || (d.jobId && jobIds.has(d.jobId)) || !live(d) || d.type === 'Estimate') continue
    const byVin = car.vin && d.vin && same(d.vin, car.vin)
    const byOwner = car.ownerId && d.customerId === car.ownerId && same(d.year, car.year) && same(d.make, car.make) && same(d.model, car.model)
    if (!byVin && !byOwner) continue
    items.push({
      id: `doc:${d.id}`, kind: 'invoice', date: d.date, title: `${d.type} ${d.number}`.trim(), status: d.status, mileage: null,
      billed: round2(d.total), estimate: null, docs: [{ id: d.id, type: d.type, number: d.number, status: d.status, total: d.total }], jobId: '',
    })
  }
  return items.sort((a, b) => b.date.localeCompare(a.date))
}

export interface HistoryTotals { visits: number; billed: number; lastDate: string }

export function historyTotals(items: HistoryItem[]): HistoryTotals {
  return {
    visits: items.length,
    billed: round2(items.reduce((sum, i) => sum + (i.billed || 0), 0)),
    lastDate: items.reduce((d, i) => (i.date > d ? i.date : d), ''),
  }
}
