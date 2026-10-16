// Calls that Alpha places for the shop: what the owner reviews first, and the rules a call must pass before it is dialled.
// Pure, with only relative imports, so the same answer is shown on the review card, enforced on the server and run in tests.
//
// In plain words (not legal advice; the owner should confirm with counsel):
//  - Alpha only calls the shop's own customers about their own car, visit or estimate. A call that sells something to a person
//    who never asked to hear from the shop needs that person's written permission, so there is no sales preset here.
//  - A person who asked not to be called, or who replied STOP to the shop, is never called.
//  - Nothing is dialled outside the shop's calling hours, counted on the shop's clock and on the customer's own clock.
//  - Alpha says it is an AI and that the call may be recorded before anything else (the call engine does this on every call).
//  - Alpha does not quote a price, promise a time or take a payment unless the owner wrote it on the review card.

import { earliestSend, hasUsablePhone, normalizeRules, phoneDigits, phoneKey, prettyPhone, timezoneForPhone, validTimezone, windowFromRules } from './automation-rules.ts'
import type { ShopRules } from './automation-rules.ts'

export type CallReasonId = 'ready' | 'appointment' | 'followup' | 'estimate' | 'due' | 'custom'

export interface CallReason {
  id: CallReasonId
  label: string
  /** One plain line under the choice. */
  hint: string
  /** Which boxes on the review card the owner fills in for this reason. */
  fields: Array<'vehicle' | 'when' | 'amount' | 'note'>
  /** Boxes that must be filled before the call can be approved. */
  required: Array<'vehicle' | 'when' | 'amount' | 'note'>
}

export const CALL_REASONS: readonly CallReason[] = [
  { id: 'ready', label: 'Your car is ready', hint: 'Let the customer know the work is done and when they can pick it up.', fields: ['vehicle', 'note'], required: ['vehicle'] },
  { id: 'appointment', label: 'Appointment reminder', hint: 'Confirm a visit that is already on the schedule.', fields: ['vehicle', 'when'], required: ['when'] },
  { id: 'followup', label: 'Check in after a repair', hint: 'Ask how the car is running since the visit. Problems go to a person.', fields: ['vehicle', 'note'], required: [] },
  { id: 'estimate', label: 'Follow up on an estimate', hint: 'Ask if they have questions about the estimate you sent.', fields: ['vehicle', 'amount', 'note'], required: ['vehicle'] },
  { id: 'due', label: 'Service is due', hint: 'Remind them a service they had before is due again.', fields: ['vehicle', 'note'], required: [] },
  { id: 'custom', label: 'Something else about their car', hint: 'Write what Alpha should say or ask. Keep it to their own car or visit.', fields: ['vehicle', 'note'], required: ['note'] },
]

export const reasonById = (id: unknown): CallReason | null => CALL_REASONS.find(r => r.id === id) || null

export interface CallRequest {
  reason: CallReasonId
  /** Year, make and model as the shop knows it. */
  vehicle?: string
  /** For a reminder: the day and time on the schedule, as the owner typed it. */
  when?: string
  /** Only ever spoken if the owner types it. Alpha never works out a price. */
  amount?: string
  /** Anything else Alpha may say, or what to ask for a custom call. */
  note?: string
}

export interface CallPlan {
  ok: boolean
  /** Things the owner must fix before the call can be approved, in plain words. */
  problems: string[]
  /** The instruction handed to the call engine. Empty when not ok. */
  task: string
  /** What the customer hears first. The engine adds its own opening sentence in the same words. */
  disclosure: string
  /** What Alpha will try to do on the call, one short line each. */
  goals: string[]
  /** What Alpha will not do, whatever the customer says. */
  limits: string[]
}

export const MAX_FIELD = 300
export const MAX_TASK = 1800

/** The sentence every assistant-placed call starts with. Kept in step with the call engine's own notice. */
export function disclosureLine(shopName: string): string {
  const name = String(shopName || '').trim()
  return `Hi, this is an AI assistant calling${name ? ` for ${name}` : ''}. This call may be recorded.`
}

/** What is said on the phone is read aloud, so quotation marks and line breaks would only confuse it. */
function spoken(v: unknown, max = MAX_FIELD): string {
  return String(v ?? '').replace(/["“”]/g, "'").replace(/\s+/g, ' ').trim().slice(0, max)
}

export const FIXED_LIMITS: readonly string[] = [
  'Say it is an AI assistant, and that the call may be recorded, before anything else.',
  'Talk only about this one reason. Nothing is sold or offered.',
  'Say a price only if you typed it above. Never work one out or promise a discount.',
  'Never promise a time, a repair result or a diagnosis. A person on your team will confirm.',
  'Never take a payment or ask for a card number.',
  'If they ask not to be called again, say it will be noted and end the call.',
  'If they are upset or ask for a person, offer a call back from the shop and end the call.',
]

/** The rules every assistant-placed call carries, whoever wrote the rest of the instruction. */
const RULES_TEXT = 'Rules: you are an AI assistant, so say so if asked. Talk only about this one reason. Say a price only if it is written in these instructions. Never promise a time, a discount, a repair result or a diagnosis; say a person on the team will confirm. Never take a payment or a card number. If they ask not to be called again, say it will be noted and end the call politely. If they are upset or ask for a person, offer a call back from the shop and end the call.'

/**
 * A call the assistant itself proposes in Ask Alpha, or one the owner typed in a line. The words are the owner's to read and
 * approve, so they are shown as written; the same rules as every other call are added after them.
 */
export function buildFreeCallPlan(input: { task: string; shopName: string; customerName?: string }): CallPlan {
  const shop = spoken(input.shopName, 120)
  const customer = spoken(input.customerName, 80)
  const words = spoken(input.task, 1200)
  const disclosure = disclosureLine(shop)
  const problems: string[] = []
  if (words.length < 8) problems.push('Say what Alpha should talk about on the call.')
  if (!shop) problems.push('Add your shop name in Settings first. Alpha says who it is calling for.')
  const ok = problems.length === 0
  const task = ok ? `Your job on this call${customer ? `, with ${customer}` : ''}: ${words} You are calling for ${shop}. ${RULES_TEXT}`.slice(0, MAX_TASK) : ''
  return { ok, problems, task, disclosure, goals: words ? [words] : [], limits: [...FIXED_LIMITS] }
}

/** Turns the owner's choices into the call engine's instruction and the review card's plain-words summary. */
export function buildCallPlan(input: { request: CallRequest; shopName: string; customerName: string }): CallPlan {
  const reason = reasonById(input.request.reason)
  const problems: string[] = []
  const shop = spoken(input.shopName, 120)
  const customer = spoken(input.customerName, 80)
  const disclosure = disclosureLine(shop)
  if (!reason) {
    return { ok: false, problems: ['Pick why Alpha is calling.'], task: '', disclosure, goals: [], limits: [...FIXED_LIMITS] }
  }
  const vehicle = spoken(input.request.vehicle, 120)
  const when = spoken(input.request.when, 120)
  const amount = spoken(input.request.amount, 60)
  const note = spoken(input.request.note)
  const value: Record<string, string> = { vehicle, when, amount, note }
  const label: Record<string, string> = { vehicle: 'the vehicle', when: 'the day and time', amount: 'the amount', note: 'what Alpha should say' }
  for (const f of reason.required) if (!value[f]) problems.push(`Add ${label[f]}.`)
  if (amount && !/\d/.test(amount)) problems.push('The amount needs a number, or leave it empty.')
  if (!shop) problems.push('Add your shop name in Settings first. Alpha says who it is calling for.')

  const car = vehicle ? `their ${vehicle}` : 'their vehicle'
  const who = customer ? `${customer}` : 'the customer'
  const goals: string[] = []
  const lines: string[] = []
  switch (reason.id) {
    case 'ready':
      goals.push(`Tell ${who} that ${car} is ready to pick up.`)
      lines.push(`Tell ${who} that ${car} is ready to pick up.`)
      if (note) { goals.push(`Pass this on: ${note}`); lines.push(`Also say: ${note}`) }
      goals.push('Ask when they can come by, and say a person will confirm the details.')
      lines.push('Ask when they plan to come by. Do not set a time yourself.')
      break
    case 'appointment':
      goals.push(`Remind ${who} of the appointment on ${when || 'the schedule'}${vehicle ? ` for ${car}` : ''}.`)
      lines.push(`Remind ${who} of their appointment on ${when || 'the schedule'}${vehicle ? ` for ${car}` : ''}.`)
      goals.push('Ask if they can still make it. If not, say a person will call to move it.')
      lines.push('Ask if they can still make it. If they cannot, say a person from the shop will call to change it. Do not book a new time yourself.')
      break
    case 'followup':
      goals.push(`Ask ${who} how ${car} has been running since the visit.`)
      lines.push(`Ask ${who} how ${car} has been running since the last visit.`)
      if (note) { goals.push(`Also: ${note}`); lines.push(`Also say: ${note}`) }
      goals.push('If anything is wrong, say a person will call them back. No advice on the cause.')
      lines.push('If they report any problem, say a person from the shop will call them back. Do not guess at causes.')
      break
    case 'estimate':
      goals.push(`Ask ${who} if they have questions about the estimate for ${car}.`)
      lines.push(`Ask ${who} if they have any questions about the estimate for ${car}.`)
      if (amount) { goals.push(`If they ask, the estimate total is ${amount}.`); lines.push(`If they ask about the total, it is ${amount}. Say no other price.`) }
      else { goals.push('If they ask about a price, say a person will go over it with them.'); lines.push('If they ask about price, say a person from the shop will go over it with them.') }
      if (note) { goals.push(`Also: ${note}`); lines.push(`Also say: ${note}`) }
      break
    case 'due':
      goals.push(`Let ${who} know a service on ${car} is due again.`)
      lines.push(`Let ${who} know a service on ${car} is due again.`)
      if (note) { goals.push(`Service: ${note}`); lines.push(`The service is: ${note}`) }
      goals.push('If they want it done, say a person will call to set a time.')
      lines.push('If they want it done, say a person from the shop will call to set a time. Do not book it yourself.')
      break
    case 'custom':
      goals.push(note)
      lines.push(`Your job on this call: ${note}`)
      if (vehicle) lines.push(`The vehicle is ${vehicle}.`)
      break
  }
  const ok = problems.length === 0
  const task = ok ? `${lines.join(' ')} You are calling for ${shop}. ${RULES_TEXT}`.slice(0, MAX_TASK) : ''
  return { ok, problems, task, disclosure, goals, limits: [...FIXED_LIMITS] }
}

// ── Can this number be called right now? ──────────────────────────────────────────────────────────────────

export type CallBlockCode = 'not_set_up' | 'no_phone' | 'bad_phone' | 'do_not_call' | 'opted_out' | 'could_not_check' | 'quiet_hours'

export interface CallCheck {
  ok: boolean
  code: '' | CallBlockCode
  /** One plain sentence for the owner. Empty when ok. */
  reason: string
  /** HTTP status a route answers with when not ok. */
  status: number
  /** For calling hours: the earliest moment the number may be called. */
  retryAt?: Date
}

export interface CallCheckInput {
  phone: unknown
  /** True when the telephone line is saved in Settings (key, number and connection). */
  configured: boolean
  /** The customer, or any customer with this number, is marked do not call. */
  doNotCall: boolean
  /** The number replied STOP to the shop. */
  optedOut: boolean
  /** True when either lookup above could not be run. Nothing is dialled on a failed check. */
  lookupFailed?: boolean
  shopTimeZone: string
  rules?: Partial<ShopRules> | null
  now?: Date
}

const ok = (): CallCheck => ({ ok: true, code: '', reason: '', status: 200 })
const no = (code: CallBlockCode, reason: string, status = 409, retryAt?: Date): CallCheck => ({ ok: false, code, reason, status, retryAt })

/** "Thursday 8:00 AM" in the zone given. */
export function whenWords(at: Date, zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: validTimezone(zone), weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(at)
}

export function checkAiCall(input: CallCheckInput): CallCheck {
  if (!input.configured) return no('not_set_up', 'The phone line is not set up yet. Add it under Settings, then try again.', 503)
  if (phoneDigits(input.phone).length === 0) return no('no_phone', 'There is no phone number to call.', 400)
  const digits = phoneDigits(input.phone)
  if (!(digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))) || !hasUsablePhone(input.phone)) {
    return no('bad_phone', 'Alpha can only call a ten digit US number. Fix the number on the customer first.', 400)
  }
  if (input.lookupFailed) return no('could_not_check', 'Alpha could not check whether this number may be called just now, so nothing is dialled. Try again in a minute.', 503)
  if (input.doNotCall) return no('do_not_call', 'This customer asked not to be called, so Alpha will not call. You can still call them yourself if they asked you to.')
  if (input.optedOut) return no('opted_out', 'This number replied STOP to your shop, so Alpha will not call. You can still call them yourself if they asked you to.')
  const now = input.now ?? new Date()
  const rules = normalizeRules(input.rules)
  const earliest = earliestSend(now, validTimezone(input.shopTimeZone), input.phone, windowFromRules(rules))
  if (earliest.getTime() - now.getTime() > 60_000) {
    const zone = timezoneForPhone(input.phone) || validTimezone(input.shopTimeZone)
    return no('quiet_hours', `It is outside your calling hours for this number. The earliest Alpha will call is ${whenWords(earliest, zone)} their time.`, 409, earliest)
  }
  return ok()
}

/** "8 AM" for hour 8, "9 PM" for hour 21. */
export function hourWords(hour: number): string {
  const h = ((Math.round(hour) % 24) + 24) % 24
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 === 0 ? 12 : h % 12} ${suffix}`
}

/** "8 AM to 9 PM, every day except Sunday" for the review card. */
export function callingHoursWords(rulesInput?: Partial<ShopRules> | null): string {
  const r = normalizeRules(rulesInput)
  return `${hourWords(r.quiet_end_hour)} to ${hourWords(r.quiet_start_hour)}${r.skip_sundays ? ', not on Sundays' : ''}`
}

// ── After the call ──────────────────────────────────────────────────────────────────────────────────

/** True when the person on the call asked not to be called again. Words said by the customer only. */
export function askedNotToBeCalled(lines: ReadonlyArray<{ speaker?: unknown; text?: unknown }>): boolean {
  const re = /\b(stop calling|don'?t call( me)?( again| anymore)?|do not call|take me off|remove me from|quit calling|never call (me )?again|no more calls)\b/i
  return lines.some(l => String(l.speaker ?? '') !== 'ai' && re.test(String(l.text ?? '')))
}

export type CallState = 'calling' | 'live' | 'ended' | 'unknown'

/** The call row's status in the owner's words. */
export function callStateWords(status: unknown): { state: CallState; label: string } {
  const s = String(status ?? '').toLowerCase()
  if (s === 'calling') return { state: 'calling', label: 'Calling now' }
  if (s === 'active') return { state: 'live', label: 'On the call' }
  if (s === 'ended') return { state: 'ended', label: 'Call ended' }
  return { state: 'unknown', label: 'Checking' }
}

export { phoneKey, prettyPhone }
