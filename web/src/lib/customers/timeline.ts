/**
 * One feed of everything that has happened with a customer: estimates, invoices, repair orders, appointments, texts, calls,
 * inspections and notes, newest first. The screen loads each kind separately; this puts them in order and gives each a
 * plain title, a link and a filter group. Imports nothing.
 */

export type TimelineGroup = 'paperwork' | 'work' | 'messages' | 'notes'
export type TimelineKind = 'estimate' | 'invoice' | 'receipt' | 'job' | 'appointment' | 'inspection' | 'text_in' | 'text_out' | 'call_in' | 'call_out' | 'call_missed' | 'note'

export interface TimelineItem {
  id: string
  at: string
  kind: TimelineKind
  group: TimelineGroup
  title: string
  detail: string
  amount: number | null
  href: string
  tone: 'neutral' | 'good' | 'warn' | 'bad'
}

export interface TimelineInput {
  docs: { id: string; type: string; status: string; number: string; at: string; total: number; balance: number }[]
  jobs: { id: string; ro: string; concern: string; status: string; at: string; car: string }[]
  appointments: { id: string; at: string; service: string; status: string }[]
  messages: { id: string; at: string; direction: string; body: string }[]
  calls: { id: string; at: string; direction: string; seconds: number; status: string }[]
  inspections: { id: string; at: string; title: string; status: string }[]
  notes: { id: string; at: string; body: string; author: string; pinned: boolean }[]
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)
const isMissed = (direction: string, status: string, seconds: number): boolean => {
  const incoming = direction === 'inbound' || direction === 'in'
  return incoming && (/miss|no.?answer|busy|fail|cancel/i.test(status) || seconds < 15)
}

export function buildTimeline(i: TimelineInput): TimelineItem[] {
  const out: TimelineItem[] = []
  for (const d of i.docs) {
    const t = d.type === 'Estimate' ? 'estimate' : d.type === 'Receipt' ? 'receipt' : 'invoice'
    const owes = t === 'invoice' && ['Unpaid', 'Partial', 'Sent'].includes(d.status) && d.balance > 0.005
    out.push({
      id: `doc:${d.id}`, at: d.at, kind: t, group: 'paperwork', title: `${d.type || 'Document'} ${d.number}`.trim(),
      detail: owes ? `${d.status}, balance due` : d.status, amount: d.total,
      href: t === 'estimate' ? `/estimates?document=${encodeURIComponent(d.id)}` : `/invoices?document=${encodeURIComponent(d.id)}`,
      tone: owes ? 'bad' : d.status === 'Paid' || d.status === 'Approved' ? 'good' : 'neutral',
    })
  }
  for (const j of i.jobs) {
    out.push({
      id: `job:${j.id}`, at: j.at, kind: 'job', group: 'work', title: j.concern ? clip(j.concern, 90) : `Repair order ${j.ro}`.trim(),
      detail: [j.ro ? `RO ${j.ro.replace(/^RO[-\s]*/i, '')}` : '', j.car, j.status].filter(Boolean).join(' · '), amount: null,
      href: `/jobs?job=${encodeURIComponent(j.id)}`, tone: 'neutral',
    })
  }
  for (const a of i.appointments) {
    out.push({
      id: `appt:${a.id}`, at: a.at, kind: 'appointment', group: 'work', title: a.service ? clip(a.service, 90) : 'Appointment', detail: a.status, amount: null,
      href: '/appointments', tone: /no.?show|cancel/i.test(a.status) ? 'warn' : 'neutral',
    })
  }
  for (const n of i.inspections) {
    out.push({ id: `dvi:${n.id}`, at: n.at, kind: 'inspection', group: 'work', title: n.title || 'Inspection', detail: n.status, amount: null, href: `/dvi?id=${encodeURIComponent(n.id)}`, tone: 'neutral' })
  }
  for (const m of i.messages) {
    const inbound = m.direction === 'inbound' || m.direction === 'in'
    out.push({ id: `msg:${m.id}`, at: m.at, kind: inbound ? 'text_in' : 'text_out', group: 'messages', title: inbound ? 'Text from customer' : 'Text to customer', detail: clip(m.body, 160), amount: null, href: '/messages', tone: 'neutral' })
  }
  for (const c of i.calls) {
    const missed = isMissed(c.direction, c.status, c.seconds)
    const incoming = c.direction === 'inbound' || c.direction === 'in'
    const mins = c.seconds >= 60 ? `${Math.floor(c.seconds / 60)} min` : c.seconds > 0 ? `${c.seconds} sec` : ''
    out.push({
      id: `call:${c.id}`, at: c.at, kind: missed ? 'call_missed' : incoming ? 'call_in' : 'call_out', group: 'messages',
      title: missed ? 'Missed call' : incoming ? 'Incoming call' : 'Outgoing call', detail: mins, amount: null, href: '/messages', tone: missed ? 'bad' : 'neutral',
    })
  }
  for (const n of i.notes) {
    out.push({ id: `note:${n.id}`, at: n.at, kind: 'note', group: 'notes', title: n.pinned ? 'Pinned note' : 'Note', detail: clip(n.body, 240), amount: null, href: '', tone: n.pinned ? 'warn' : 'neutral' })
  }
  return out.filter(x => x.at).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
}

export const GROUP_LABEL: Record<TimelineGroup, string> = { paperwork: 'Paperwork', work: 'Work', messages: 'Texts and calls', notes: 'Notes' }

/** "October 2026" style heading for a timestamp, so a long feed reads in months. */
export function monthHeading(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Undated'
}
