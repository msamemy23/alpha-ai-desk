/**
 * What Ask Alpha reads to answer "who owes me", "what's on today" and "what's open".
 * Pure: the caller loads rows; this only adds up. Money comes from the same report code the Invoices and Reports
 * screens use (owedByCustomer / aging), so Ask Alpha can never disagree with them.
 * Imports are relative (no `@/`), so `node --test` loads this exact file.
 */
import { aging } from '../reports.ts'
import type { ReportDoc } from '../reports.ts'
import { owedByCustomer } from '../report-metrics.ts'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).trim()
const round2 = (n: number) => Math.round(n * 100) / 100

/** Job statuses that mean the car is finished and gone. Everything else is open work. */
export const DONE_JOB_STATUSES = new Set(['paid', 'closed', 'cancelled', 'canceled', 'void'])
/** Appointment statuses that are not on the schedule any more. */
const GONE_APPOINTMENTS = new Set(['cancelled', 'canceled', 'no-show', 'no show', 'deleted'])

/** The appointment's day as YYYY-MM-DD, from whichever column the row used. */
export function appointmentDay(a: Row): string {
  const raw = str(a.scheduled_date) || str(a.date)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw)
  return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : ''
}

export function addDays(dayKey: string, days: number): string {
  const d = new Date(`${dayKey}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export interface ShopSnapshot {
  today: string
  timezone: string
  receivables: {
    totalOwed: number
    unpaidInvoiceCount: number
    customers: { name: string; amount: number; invoices: number; oldestDays: number; invoiceNumbers: string[] }[]
    agingBuckets: { label: string; count: number; amount: number }[]
    /** Invoices saved but never sent. They are not counted as owed. */
    unsentDraftInvoices: number
  }
  estimates: { open: number; openTotal: number; drafts: number }
  appointments: { today: Row[]; next7Days: Row[] }
  openJobs: { count: number; byStatus: Record<string, number>; jobs: Row[] }
  notes: string[]
}

export function buildShopSnapshot(input: {
  todayKey: string
  timezone: string
  saleDocs: ReportDoc[]
  draftInvoiceCount: number
  estimates: Row[]
  estimateTotal: (row: Row) => number
  appointments: Row[]
  jobs: Row[]
  customerFilter?: string
}): ShopSnapshot {
  const { todayKey } = input
  const filter = str(input.customerFilter).toLowerCase()
  const owed = owedByCustomer(input.saleDocs, todayKey)
    .filter(c => !filter || c.name.toLowerCase().includes(filter))
  const byId = new Map(input.saleDocs.map(d => [d.id, d]))
  const age = aging(input.saleDocs, todayKey)
  const customers = owed.map(c => ({
    name: c.name, amount: round2(c.amount), invoices: c.count, oldestDays: c.oldestDays,
    invoiceNumbers: c.ids.map(id => byId.get(id)?.number || '').filter(Boolean),
  }))
  const openEstimates = input.estimates.filter(e => !['void', 'voided', 'declined', 'converted', 'approved', 'paid'].includes(str(e.status).toLowerCase()))
  const week = addDays(todayKey, 7)
  const scheduled = input.appointments
    .filter(a => !GONE_APPOINTMENTS.has(str(a.status).toLowerCase()))
    .map((a): Row & { day: string } => ({ ...a, day: appointmentDay(a) }))
    .filter(a => a.day)
    .sort((a, b) => `${a.day} ${str(a.scheduled_time) || str(a.time)}`.localeCompare(`${b.day} ${str(b.scheduled_time) || str(b.time)}`))
  const pick = (a: Row & { day: string }) => ({ day: a.day, time: str(a.scheduled_time) || str(a.time), customer: str(a.customer_name), vehicle: str(a.vehicle), service: str(a.service), tech: str(a.tech), status: str(a.status) })
  const open = input.jobs.filter(j => !DONE_JOB_STATUSES.has(str(j.status).toLowerCase()))
  const byStatus: Record<string, number> = {}
  for (const j of open) byStatus[str(j.status) || 'Unknown'] = (byStatus[str(j.status) || 'Unknown'] || 0) + 1
  const notes: string[] = []
  if (input.draftInvoiceCount) notes.push(`${input.draftInvoiceCount} invoice(s) are saved as drafts and not sent; they are not counted as owed.`)
  if (filter && !customers.length) notes.push(`No unpaid invoices matched "${input.customerFilter}".`)
  return {
    today: todayKey,
    timezone: input.timezone,
    receivables: {
      totalOwed: round2(customers.reduce((s, c) => s + c.amount, 0)),
      unpaidInvoiceCount: customers.reduce((s, c) => s + c.invoices, 0),
      customers: customers.slice(0, 25),
      agingBuckets: age.buckets.filter(b => b.count).map(b => ({ label: b.label, count: b.count, amount: b.amount })),
      unsentDraftInvoices: input.draftInvoiceCount,
    },
    estimates: {
      open: openEstimates.length,
      openTotal: round2(openEstimates.reduce((s, e) => s + (Number(input.estimateTotal(e)) || 0), 0)),
      drafts: input.estimates.filter(e => str(e.status).toLowerCase() === 'draft').length,
    },
    appointments: {
      today: scheduled.filter(a => a.day === todayKey).map(pick),
      next7Days: scheduled.filter(a => a.day > todayKey && a.day <= week).map(pick),
    },
    openJobs: {
      count: open.length,
      byStatus,
      jobs: open.slice(0, 25).map(j => ({ ro: str(j.ro_number), customer: str(j.customer_name), vehicle: [str(j.vehicle_year), str(j.vehicle_make), str(j.vehicle_model)].filter(Boolean).join(' '), status: str(j.status), tech: str(j.tech), promised: str(j.promise_date) })),
    },
    notes,
  }
}

export { shopLocalTime } from './shop-time.ts'
