// Turns raw shop records into the "Needs you" list on the Today screen.
// Pure functions only, so the rules can be tested without a database.

import { calcTotals } from '@/lib/supabase'
import { headsUp } from '@/lib/problems'

export type Lamp = 'red' | 'amber' | 'blue'

export interface FeedItem {
  id: string
  lamp: Lamp
  title: string
  detail: string
  href?: string
  /** Optional quick action shown as a button on the row. */
  call?: { number: string; name?: string }
  /** Higher sorts earlier within the same lamp. */
  weight: number
}

type Row = Record<string, unknown>

export const DAY = 86_400_000

export function money0(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

export function ageLabel(iso: string | undefined | null, now = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const days = Math.floor((now - t) / DAY)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)} year${days >= 730 ? 's' : ''} ago`
}

export function phonePretty(raw: string | undefined | null): string {
  const d = String(raw || '').replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  // Non-breaking space keeps the area code with the number when a title wraps.
  if (ten.length === 10) return `(${ten.slice(0, 3)})\u00A0${ten.slice(3, 6)}-${ten.slice(6)}`
  return String(raw || '')
}

const OPEN_ESTIMATE = new Set(['Draft', 'Sent'])
const OWED_INVOICE = new Set(['Unpaid', 'Partial', 'Sent'])

export interface TodayInput {
  docs: Row[]
  /** Unread inbound texts, newest first. */
  unreadTexts: (Row & { customer_name?: string })[]
  /** Inbound calls that were missed or very short, newest first. */
  missedCalls: Row[]
  staleJobs: Row[]
  aiAlerts: { id: string; title: string; body: string }[]
  /** Screen problems reported in the last day. Only the owner and admins are told (the server sends 0 to everyone else). */
  problems?: number
  setupIncomplete: boolean
  now?: number
}

export interface TodaySummary {
  feed: FeedItem[]
  estimatesWaiting: { count: number; total: number; oldDays: number }
  owed: { count: number; total: number }
  draftInvoices: number
}

export function summarizeToday(input: TodayInput): TodaySummary {
  const now = input.now ?? Date.now()
  const feed: FeedItem[] = []

  if (input.setupIncomplete) {
    feed.push({
      id: 'setup', lamp: 'amber', weight: 5,
      title: 'Finish setting up your shop',
      detail: 'Add your shop name and phone so estimates and texts carry your details.',
      href: '/onboarding',
    })
  }

  // Customers waiting on an answer: unread texts first.
  const seenSenders = new Set<string>()
  for (const m of input.unreadTexts) {
    const from = String(m.from_address || '')
    if (seenSenders.has(from)) continue
    seenSenders.add(from)
    const who = m.customer_name || phonePretty(from) || 'Unknown number'
    feed.push({
      id: `text-${m.id}`, lamp: 'red', weight: 100 + new Date(String(m.created_at)).getTime() / 1e13,
      title: `${who} texted you`,
      detail: `“${String(m.body || '').slice(0, 80)}”`,
      href: '/messages',
    })
  }

  const seenCallers = new Set<string>()
  for (const c of input.missedCalls) {
    const from = String(c.from_number || '')
    if (seenCallers.has(from)) continue
    seenCallers.add(from)
    feed.push({
      id: `call-${c.id}`, lamp: 'red', weight: 90 + new Date(String(c.start_time)).getTime() / 1e13,
      title: `Missed call from ${phonePretty(from) || 'an unknown number'}`,
      detail: ageLabel(String(c.start_time), now) === 'today' ? 'Today. Nobody called back yet.' : `${ageLabel(String(c.start_time), now)}. Nobody called back yet.`,
      href: '/messages',
      call: from ? { number: from } : undefined,
    })
  }

  // Money owed on invoices.
  const owedDocs = input.docs
    .filter(d => d.type === 'Invoice' && OWED_INVOICE.has(String(d.status)))
    .map(d => ({ d, due: calcTotals(d).balanceDue }))
    .filter(x => x.due > 0.005)
  const owedTotal = owedDocs.reduce((s, x) => s + x.due, 0)
  owedDocs
    .sort((a, b) => String(a.d.created_at).localeCompare(String(b.d.created_at)))
    .slice(0, 4)
    .forEach(({ d, due }) => {
      const days = Math.floor((now - new Date(String(d.created_at)).getTime()) / DAY)
      feed.push({
        id: `owed-${d.id}`, lamp: days > 14 ? 'red' : 'amber', weight: 50 + Math.min(days, 40),
        title: `${d.customer_name || 'A customer'} owes ${money0(due)}`,
        detail: `${d.doc_number || 'Invoice'} · ${String(d.status).toLowerCase()} · ${ageLabel(String(d.created_at), now)}`,
        href: `/invoices?document=${encodeURIComponent(String(d.id))}`,
      })
    })
  if (owedDocs.length > 4) {
    feed.push({
      id: 'owed-more', lamp: 'amber', weight: 49,
      title: `${owedDocs.length - 4} more unpaid invoices`,
      detail: `${money0(owedDocs.slice(4).reduce((s, x) => s + x.due, 0))} still to collect.`,
      href: '/invoices',
    })
  }

  // Estimates nobody answered.
  const open = input.docs.filter(d => d.type === 'Estimate' && OPEN_ESTIMATE.has(String(d.status)))
  const openTotal = open.reduce((s, d) => s + calcTotals(d).total, 0)
  const oldDays = open.length ? Math.max(...open.map(d => Math.floor((now - new Date(String(d.created_at)).getTime()) / DAY))) : 0
  const fresh = open
    .filter(d => now - new Date(String(d.created_at)).getTime() >= 2 * DAY && now - new Date(String(d.created_at)).getTime() < 30 * DAY)
    .sort((a, b) => calcTotals(b).total - calcTotals(a).total)
    .slice(0, 3)
  fresh.forEach(d => {
    feed.push({
      id: `est-${d.id}`, lamp: 'amber', weight: 30,
      title: `Follow up with ${d.customer_name || 'this customer'}`,
      detail: `${money0(calcTotals(d).total)} estimate, ${ageLabel(String(d.created_at), now)}. No answer yet.`,
      href: `/estimates?document=${encodeURIComponent(String(d.id))}`,
    })
  })
  const stale = open.filter(d => now - new Date(String(d.created_at)).getTime() >= 30 * DAY)
  if (stale.length > 0) {
    feed.push({
      id: 'est-stale', lamp: 'amber', weight: 20,
      title: `${stale.length} old estimate${stale.length === 1 ? '' : 's'} never got an answer`,
      detail: `${money0(stale.reduce((s, d) => s + calcTotals(d).total, 0))} in work customers did not approve. Alpha can text them for you.`,
      href: '/estimates',
    })
  }

  const draftInvoices = input.docs.filter(d => d.type === 'Invoice' && d.status === 'Draft').length

  input.staleJobs.slice(0, 3).forEach(j => {
    feed.push({
      id: `job-${j.id}`, lamp: 'amber', weight: 25,
      title: `${j.customer_name || 'A job'} has not moved in days`,
      detail: `${[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ') || 'Vehicle'} · ${String(j.status)}`,
      href: j.id ? `/jobs?job=${encodeURIComponent(String(j.id))}` : '/jobs',
    })
  })

  input.aiAlerts.slice(0, 2).forEach(a => {
    feed.push({ id: `ai-${a.id}`, lamp: 'blue', weight: 10, title: a.title, detail: a.body, href: '/ai' })
  })

  if ((input.problems ?? 0) > 0) {
    const h = headsUp(input.problems ?? 0)
    feed.push({ id: 'problems-reported', lamp: 'amber', weight: 5, title: h.title, detail: h.detail, href: '/settings#problems' })
  }

  const rank: Record<Lamp, number> = { red: 0, amber: 1, blue: 2 }
  feed.sort((a, b) => rank[a.lamp] - rank[b.lamp] || b.weight - a.weight)

  return {
    feed,
    estimatesWaiting: { count: open.length, total: openTotal, oldDays },
    owed: { count: owedDocs.length, total: owedTotal },
    draftInvoices,
  }
}
