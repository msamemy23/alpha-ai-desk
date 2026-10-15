/**
 * Counts for the results screen: what the assistant did over a period, as plain numbers.
 * Pure: it only reads rows that were already loaded.
 */
import type { Outcome } from './engine.ts'

export interface ResultRow {
  channel: 'call' | 'sms'
  outcome: Outcome
  needs_person?: boolean | null
  needs_resolved_at?: string | null
  review?: 'good' | 'bad' | null
  started_at: string
}

export interface ResultCounts {
  total: number
  /** The assistant took the call or text and dealt with it (not spam, not missed, not silent). */
  answered: number
  booked: number
  bookingRequests: number
  transferred: number
  missed: number
  afterHours: number
  messagesTaken: number
  spamBlocked: number
  needsPerson: number
  stillNeedsPerson: number
  good: number
  bad: number
  calls: number
  texts: number
}

export function emptyCounts(): ResultCounts {
  return { total: 0, answered: 0, booked: 0, bookingRequests: 0, transferred: 0, missed: 0, afterHours: 0, messagesTaken: 0, spamBlocked: 0, needsPerson: 0, stillNeedsPerson: 0, good: 0, bad: 0, calls: 0, texts: 0 }
}

const NOT_ANSWERED = new Set<Outcome>(['missed', 'silent', 'spam', 'opt_out', 'draft'])

export function summarizeResults(rows: ResultRow[]): ResultCounts {
  const c = emptyCounts()
  for (const r of rows) {
    c.total += 1
    if (r.channel === 'call') c.calls += 1; else c.texts += 1
    if (!NOT_ANSWERED.has(r.outcome)) c.answered += 1
    if (r.outcome === 'booked') c.booked += 1
    if (r.outcome === 'booking_requested') c.bookingRequests += 1
    if (r.outcome === 'transferred') c.transferred += 1
    if (r.outcome === 'missed') c.missed += 1
    if (r.outcome === 'after_hours') c.afterHours += 1
    if (r.outcome === 'message_taken') c.messagesTaken += 1
    if (r.outcome === 'spam') c.spamBlocked += 1
    if (r.needs_person) { c.needsPerson += 1; if (!r.needs_resolved_at) c.stillNeedsPerson += 1 }
    if (r.review === 'good') c.good += 1
    if (r.review === 'bad') c.bad += 1
  }
  return c
}

/** Start of the period as an ISO string. Days is clamped to 1..90. */
export function sinceIso(now: Date, days: number): string {
  const d = Math.min(90, Math.max(1, Math.round(Number(days) || 7)))
  return new Date(now.getTime() - d * 86_400_000).toISOString()
}
