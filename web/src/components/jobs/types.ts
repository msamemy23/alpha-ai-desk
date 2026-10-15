import { calcTotals } from '@/lib/supabase'

/** A repair order. Columns not listed here (insurance fields and so on) are left alone on save. */
export interface Job {
  id: string
  ro_number?: string | null
  customer_id?: string | null
  customer_name: string
  concern: string
  status: string
  tech: string
  priority: string
  vehicle_year: string
  vehicle_make: string
  vehicle_model: string
  vehicle_color: string
  vehicle_engine: string
  vehicle_plate: string
  vehicle_vin: string
  vehicle_mileage: string
  promise_date: string | null
  created_at: string
  updated_at?: string
  internal_notes: string
  customer_notes: string
  is_insurance?: boolean
}

export interface JobCustomer {
  id: string
  name: string
  phone: string
  vehicle_year: string
  vehicle_make: string
  vehicle_model: string
  vehicle_color: string
  vehicle_engine: string
  vehicle_plate: string
}

/** The paperwork written for a job, with what is owed worked out once. */
export interface JobDoc {
  id: string
  job_id: string
  type: string
  doc_number: string
  status: string
  total: number
  paid: number
}

export type Lamp = 'green' | 'amber' | 'red' | 'blue' | 'off'

/** Every status a person can pick. The text is what is stored, so it must not change. */
export const STATUSES = ['New', 'Approved', 'In Progress', 'Waiting on Parts', 'Waiting on Customer', 'Completed', 'Ready for Pickup', 'Paid', 'Closed'] as const

export type StageKey = 'new' | 'approved' | 'working' | 'waiting' | 'ready' | 'done'

export interface Stage {
  key: StageKey
  label: string
  /** What a job is set to when it is dropped on this stage. */
  dropTo: string
  statuses: string[]
  lamp: Lamp
  /** One plain line for an empty column. */
  empty: string
}

export const STAGES: Stage[] = [
  { key: 'new', label: 'New', dropTo: 'New', statuses: ['New', 'Estimate Sent', 'Pending'], lamp: 'off', empty: 'Cars written up and not yet approved show here.' },
  { key: 'approved', label: 'Approved', dropTo: 'Approved', statuses: ['Approved'], lamp: 'off', empty: 'Approved work waiting for a tech shows here.' },
  { key: 'working', label: 'In progress', dropTo: 'In Progress', statuses: ['In Progress', 'In Repair'], lamp: 'blue', empty: 'Cars being worked on show here.' },
  { key: 'waiting', label: 'Waiting', dropTo: 'Waiting on Parts', statuses: ['Waiting on Parts', 'Waiting on Customer'], lamp: 'amber', empty: 'Nothing is stuck waiting.' },
  { key: 'ready', label: 'Ready for pickup', dropTo: 'Ready for Pickup', statuses: ['Completed', 'Ready for Pickup'], lamp: 'green', empty: 'Finished cars waiting for their owner show here.' },
  { key: 'done', label: 'Paid and closed', dropTo: 'Paid', statuses: ['Paid', 'Closed'], lamp: 'off', empty: 'Paid and closed jobs show here.' },
]

export const OPEN_STAGES = STAGES.filter(s => s.key !== 'done')

/** An unknown status (the assistant once wrote "Pending") is treated as new, never hidden. */
export function stageOf(status: string): Stage {
  return STAGES.find(s => s.statuses.includes(status)) || STAGES[0]
}

export function statusWord(status: string): string {
  switch (status) {
    case 'New': return 'New'
    case 'Approved': return 'Approved'
    case 'In Progress': return 'In progress'
    case 'In Repair': return 'In repair'
    case 'Estimate Sent': return 'Estimate sent'
    case 'Waiting on Parts': return 'Waiting on parts'
    case 'Waiting on Customer': return 'Waiting on customer'
    case 'Completed': return 'Work done'
    case 'Ready for Pickup': return 'Ready for pickup'
    case 'Paid': return 'Paid'
    case 'Closed': return 'Closed'
    default: return status || 'New'
  }
}

export function statusLamp(status: string): Lamp {
  switch (status) {
    case 'In Progress':
    case 'In Repair': return 'blue'
    case 'Waiting on Parts':
    case 'Waiting on Customer': return 'amber'
    case 'Completed':
    case 'Ready for Pickup':
    case 'Paid': return 'green'
    default: return 'off'
  }
}

export const isDone = (status: string) => stageOf(status).key === 'done'

/* ---------- small formatters ---------- */

/** "RO-2026-0045" reads "#0045" on a small screen; shops that number their own way (1042) are left as written. */
export function roShort(ro: string | null | undefined): string {
  const m = /^RO-\d{4}-(\d+)$/.exec(String(ro || ''))
  return m ? `#${m[1]}` : String(ro || '')
}

export const carLine = (j: Pick<Job, 'vehicle_year' | 'vehicle_make' | 'vehicle_model'>) =>
  [j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')

export const firstName = (name: string) =>
  String(name || '').replace(/^\s*walk-?\s?in\s*[:-]\s*/i, '').trim().split(/\s+/)[0] || ''

const parse = (ymd: string) => new Date(`${ymd.slice(0, 10)}T00:00:00`)

export function localKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function shortDate(ymd: string | null | undefined): string {
  return ymd ? parse(ymd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
}

export function longDate(ymd: string | null | undefined): string {
  return ymd ? parse(ymd).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ''
}

/** Whole days from one yyyy-mm-dd to another (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000)
}

export interface Due { text: string; tone: 'late' | 'soon' | 'later' }

/** When the car was promised, in plain words. A finished or closed job is never late. */
export function dueInfo(j: Pick<Job, 'promise_date' | 'status'>, todayKey: string): Due | null {
  if (!j.promise_date) return null
  const key = j.promise_date.slice(0, 10)
  const stage = stageOf(j.status).key
  const finished = stage === 'ready' || stage === 'done'
  const diff = daysBetween(todayKey, key)
  if (diff < 0 && !finished) return { text: `Late: promised ${shortDate(key)}`, tone: 'late' }
  if (diff === 0) return { text: 'Due today', tone: finished ? 'later' : 'soon' }
  if (diff === 1) return { text: 'Due tomorrow', tone: finished ? 'later' : 'soon' }
  return { text: `Due ${shortDate(key)}`, tone: 'later' }
}

/** "3 days ago", "today", for how long a car has been in the shop. */
export function openedLabel(created: string | null | undefined, todayKey: string): string {
  if (!created) return ''
  const day = localKey(new Date(created))
  const n = daysBetween(day, todayKey)
  if (n <= 0) return 'Opened today'
  if (n === 1) return 'Opened yesterday'
  return `Opened ${n} days ago`
}

/** Next RO number: one past the highest "RO-2026-0012" already used this year, so deleting a job never reuses a number. */
export function nextRoNumber(jobs: Pick<Job, 'ro_number'>[], year = new Date().getFullYear()): string {
  let max = 0
  for (const j of jobs) {
    const m = /^RO-(\d{4})-(\d+)$/.exec(String(j.ro_number || ''))
    if (m && Number(m[1]) === year) max = Math.max(max, Number(m[2]))
  }
  if (max === 0) max = jobs.length
  return `RO-${year}-${String(max + 1).padStart(4, '0')}`
}

/** What a linked estimate or invoice comes to, for the list on a job. */
export function docTotals(d: Record<string, unknown>): { total: number; paid: number } {
  try {
    const t = calcTotals(d as Parameters<typeof calcTotals>[0])
    return { total: Number(t.total) || 0, paid: Number(d.amount_paid) || 0 }
  } catch {
    return { total: 0, paid: Number(d.amount_paid) || 0 }
  }
}

/* ---------- the one thing to do next ---------- */

export interface NextStep { label: string; to?: string; href?: string; icon: string }

/**
 * The single most useful move for a job. Money is never marked paid by hand here: a car that is ready
 * gets an invoice, and only a paid invoice offers "Mark paid".
 */
export function nextStep(j: Job, docs: JobDoc[]): NextStep | null {
  const customer = j.customer_id ? `&customer=${encodeURIComponent(j.customer_id)}` : ''
  switch (j.status) {
    case 'New': return { label: 'Customer approved', to: 'Approved', icon: 'check' }
    case 'Approved': return { label: 'Start work', to: 'In Progress', icon: 'wrench' }
    case 'In Progress':
    case 'In Repair': return { label: 'Ready for pickup', to: 'Ready for Pickup', icon: 'check' }
    case 'Estimate Sent': return { label: 'Customer approved', to: 'Approved', icon: 'check' }
    case 'Waiting on Parts':
    case 'Waiting on Customer': return { label: 'Resume work', to: 'In Progress', icon: 'wrench' }
    case 'Completed':
    case 'Ready for Pickup': {
      const invoices = docs.filter(d => d.type === 'Invoice')
      if (invoices.some(d => d.status === 'Paid')) return { label: 'Mark paid and close', to: 'Paid', icon: 'check' }
      const open = invoices[0]
      if (open) return { label: 'Collect payment', href: `/invoices?document=${encodeURIComponent(open.id)}`, icon: 'dollar' }
      return { label: 'Write invoice', href: `/invoices?new=1&job=${encodeURIComponent(j.id)}${customer}`, icon: 'invoice' }
    }
    case 'Paid': return { label: 'Close job', to: 'Closed', icon: 'check' }
    default: return j.status === 'Closed' ? null : { label: 'Customer approved', to: 'Approved', icon: 'check' }
  }
}

/** Sort: late first, then by promise date, then newest. */
export function byUrgency(todayKey: string) {
  return (a: Pick<Job, 'promise_date' | 'created_at'>, b: Pick<Job, 'promise_date' | 'created_at'>) => {
    const ak = a.promise_date ? a.promise_date.slice(0, 10) : '9999-12-31'
    const bk = b.promise_date ? b.promise_date.slice(0, 10) : '9999-12-31'
    const aLate = ak < todayKey ? 0 : 1
    const bLate = bk < todayKey ? 0 : 1
    return aLate - bLate || ak.localeCompare(bk) || String(b.created_at).localeCompare(String(a.created_at))
  }
}

export const PRIORITIES = ['Low', 'Normal', 'High', 'Rush'] as const
