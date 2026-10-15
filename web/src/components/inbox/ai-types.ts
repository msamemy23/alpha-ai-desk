// Shapes returned by the receptionist routes, and the plain words for outcomes. Pure.
import { OUTCOME_LABELS } from '@/lib/voice/engine'
import type { Outcome } from '@/lib/voice/engine'
import { RULE_LABELS } from '@/lib/voice/rules'

export interface Interaction {
  id: string
  channel: 'call' | 'sms'
  ref_id: string
  contact_key: string
  contact_phone: string | null
  contact_name: string | null
  customer_id: string | null
  started_at: string
  ended_at: string | null
  outcome: Outcome
  needs_person: boolean
  needs_reason: string | null
  needs_resolved_at: string | null
  summary: string | null
  captured: { name?: string; vehicle?: string; problem?: string; callback?: string; preferred?: string }
  rules_fired: string[]
  review: 'good' | 'bad' | null
  review_note?: string | null
  seen_at: string | null
  draft: { text: string; at: string } | null
  last_inbound: string
}

export interface BookingRow {
  id: string
  interaction_id: string | null
  channel: 'call' | 'sms'
  kind: 'request' | 'booked'
  status: 'pending' | 'approved' | 'declined' | 'booked' | 'cancelled'
  customer_id: string | null
  customer_name: string | null
  phone: string | null
  vehicle: string | null
  problem: string | null
  preferred_text: string | null
  slot_date: string | null
  slot_time: string | null
  appointment_id: string | null
  created_at: string
}

export const outcomeLabel = (o: string): string => OUTCOME_LABELS[o as Outcome] || 'Answered'

/** A lamp colour for an outcome. The word always goes with it. */
export function outcomeLamp(o: string, needsPerson = false): 'green' | 'amber' | 'red' | 'blue' | 'off' {
  if (needsPerson) return 'red'
  if (o === 'booked' || o === 'transferred') return 'green'
  if (o === 'booking_requested' || o === 'message_taken' || o === 'after_hours' || o === 'draft' || o === 'needs_person') return 'amber'
  if (o === 'missed') return 'red'
  if (o === 'spam' || o === 'silent' || o === 'opt_out') return 'off'
  return 'blue'
}

/** Rule names in the shop's own language, skipping ones that are not worth showing. */
export function firedLabels(fired: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of fired || []) {
    const label = RULE_LABELS[f]
    if (label && !seen.has(label)) { seen.add(label); out.push(label) }
  }
  return out
}

export function sinceLabel(iso: string, now = new Date()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const mins = Math.round((now.getTime() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.round(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
