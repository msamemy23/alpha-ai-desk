/**
 * Following up on an inspection the customer has not acted on: work they said no to, or an inspection they never answered.
 * Pure rules, no imports from the app, so the screen and `node --test` run the same code.
 *
 * Kind rules for the text: it is a service message about their own car, it never scares ("unsafe" is for the tech to say in person),
 * it always ends with the opt-out line, and it is never sent between 9 pm and 8 am.
 */

import { withOptOut } from './growth-text.ts'

export const UNANSWERED_AFTER_DAYS = 2
export const REPEAT_AFTER_DAYS = 7
/** After three follow-ups the shop stops being reminded: the customer has heard enough. */
export const MAX_FOLLOWUPS = 3
const DAY = 86_400_000

export type FollowKind = 'declined' | 'unanswered'

export interface FollowInput {
  sent_to_customer: boolean
  sent_at: string | null
  customer_approved: boolean
  customer_decisions: Record<string, string>
  customer_decided_at: string | null
  /** The saved counts of the inspection: how many lines needed work or were worth watching. */
  summary: { red?: number; yellow?: number } | null
  followup_sent_at?: string | null
  followup_count?: number
}

export interface FollowState {
  kind: FollowKind
  /** Whole days since the customer said no, or since the inspection was sent. */
  days: number
  followedUp: string | null
  /** True when a follow-up is worth sending now (never followed up, or the last one was a week ago, and fewer than three so far). */
  due: boolean
}

const daysSince = (iso: string | null | undefined, now: number): number | null => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / DAY)) : null
}

export function followUpState(row: FollowInput, now: number = Date.now()): FollowState | null {
  if (!row.sent_to_customer) return null
  const work = row.summary ? (Number(row.summary.red) || 0) + (Number(row.summary.yellow) || 0) : null
  if (work === 0) return null
  const answers = Object.values(row.customer_decisions || {})
  const declined = answers.filter(v => v === 'declined').length
  let kind: FollowKind | null = null
  let days = 0
  if (declined > 0) {
    kind = 'declined'
    days = daysSince(row.customer_decided_at, now) ?? daysSince(row.sent_at, now) ?? 0
  } else if (answers.length === 0 && !row.customer_approved && work !== null) {
    const d = daysSince(row.sent_at, now)
    if (d !== null && d >= UNANSWERED_AFTER_DAYS) { kind = 'unanswered'; days = d }
  }
  if (!kind) return null
  const since = daysSince(row.followup_sent_at, now)
  const count = Number(row.followup_count) || 0
  return { kind, days, followedUp: row.followup_sent_at || null, due: count < MAX_FOLLOWUPS && (since === null || since >= REPEAT_AFTER_DAYS) }
}

/** "3 days ago", "today", "yesterday". */
export function agoWords(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  return `${Math.round(days / 30)} months ago`
}

/** "Front brake pads", "Front brake pads and Cabin air filter", "Front brake pads, Cabin air filter and 2 more". */
export function listWords(names: string[], max = 3): string {
  const n = names.map(x => String(x).trim()).filter(Boolean)
  if (n.length === 0) return ''
  if (n.length <= max) return n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
  const rest = n.length - max
  return `${n.slice(0, max).join(', ')} and ${rest} more`
}

const firstName = (name: string): string => String(name || '').replace(/^\s*walk-?\s?in\s*[:-]\s*/i, '').trim().split(/\s+/)[0] || ''

export interface FollowTextInput {
  kind: FollowKind
  customer: string
  vehicle: string
  shop: string
  phone: string
  /** The lines the customer said no to (or has not answered), by name. */
  items: string[]
  /** Where to book, with the inspection attached; null when online booking is off. */
  bookUrl: string | null
  /** Where the customer opens their inspection; null when there is no link. */
  inspectionUrl: string | null
}

/** The follow-up text, ready to send. Always ends with the opt-out line. */
export function followUpText(o: FollowTextInput): string {
  const hi = firstName(o.customer) ? `Hi ${firstName(o.customer)}, this is ${o.shop || 'your shop'}.` : `This is ${o.shop || 'your shop'}.`
  const car = o.vehicle ? `your ${o.vehicle}` : 'your vehicle'
  const reach = o.phone ? `Call ${o.phone} with any questions.` : 'Reply to this text with any questions.'
  const parts: string[] = [hi]
  if (o.kind === 'declined') {
    const what = listWords(o.items)
    parts.push(what ? `${car[0].toUpperCase()}${car.slice(1)} still needs ${what}, which we found at the inspection.` : `We found a few things on ${car} at the inspection that are still open.`)
    parts.push(o.bookUrl ? `When you are ready, pick a time here: ${o.bookUrl}` : reach)
  } else {
    parts.push(`Have you had a chance to look at the inspection on ${car}?`)
    parts.push(o.inspectionUrl ? `See the photos and tell us what to go ahead with: ${o.inspectionUrl}` : reach)
    if (o.bookUrl) parts.push(`Or book a time here: ${o.bookUrl}`)
  }
  if (o.kind === 'declined' && o.bookUrl) parts.push(reach)
  return withOptOut(parts.join(' '))
}

/** Texts to customers go out between 8 am and 9 pm, shop time. `minutes` is minutes after midnight in the shop's time zone. */
export const QUIET_FROM = 21 * 60
export const QUIET_UNTIL = 8 * 60
export const inQuietHours = (minutes: number): boolean => minutes >= QUIET_FROM || minutes < QUIET_UNTIL
export const QUIET_WORDS = 'Texts to customers go out between 8 am and 9 pm. Try again in the morning.'
