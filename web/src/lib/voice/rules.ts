/**
 * The rules a shop sets for its AI receptionist (calls) and text auto-reply.
 *
 * Pure TypeScript with no imports, so the same code runs in the browser, on the server
 * and under `node --test`. Keep it to plain TypeScript (no enums, no parameter properties).
 *
 * Nothing here names a specific shop: every default is generic. The shop's own name, phone
 * and address always come from its settings.
 */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DayKey = (typeof DAY_KEYS)[number]

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
}

export type TextMode = 'off' | 'draft' | 'auto'
export type BookingMode = 'off' | 'request' | 'book'
export type Tone = 'friendly' | 'professional' | 'brief'
export type SummaryEmail = 'follow_up' | 'every_call' | 'never'

export interface DayHours { open: boolean; from: string; to: string }
export type WeekHours = Record<DayKey, DayHours>
export interface HandoffPerson { name: string; phone: string }

export interface VoiceRules {
  version: number
  /** False until the owner has saved the rules at least once. The app nudges until then. */
  reviewed: boolean
  /** Master switch for answering calls. When off, calls are forwarded to the first handoff person, or go to a recorded message. */
  calls_enabled: boolean
  /** Master switch for text replies: off, draft (a person approves each reply) or auto. */
  texts_mode: TextMode
  tone: Tone
  /** Optional first name the assistant goes by. Empty means it just says it is the shop's virtual assistant. */
  assistant_name: string
  greeting_call: string
  greeting_text: string
  recording_notice: boolean
  recording_notice_text: string
  /** Null means the shop has not set its hours yet. The assistant then never states hours. */
  hours: WeekHours | null
  closed_dates: string[]
  text_back_after_calls: boolean
  handoff: HandoffPerson[]
  transfer_when_open: boolean
  /** Text the person who takes a transferred call a short briefing (who, vehicle, what they need). */
  transfer_briefing: boolean
  topics: { angry: boolean; safety: boolean; towing: boolean; accident: boolean; insurance: boolean; legal: boolean }
  custom_keywords: string[]
  may_share_hours: boolean
  may_share_address: boolean
  may_share_job_status: boolean
  never_lines: string[]
  blocked_phrases: string[]
  spam_filter: boolean
  booking_mode: BookingMode
  booking_slot_minutes: number
  booking_capacity: number
  booking_lead_hours: number
  quiet_hours: { enabled: boolean; from: string; to: string }
  max_replies: { count: number; window_hours: number }
  takeover_hours: number
  summary_email: SummaryEmail
  notify_email: string
  /** Email the notify address when a customer texts and the assistant did not answer on its own. */
  email_new_texts: boolean
}

export const TEXT_MODES: { value: TextMode; label: string; hint: string }[] = [
  { value: 'auto', label: 'Reply on its own', hint: 'Replies right away, inside your rules.' },
  { value: 'draft', label: 'Write a draft for me to send', hint: 'Nothing goes out until a person taps Send.' },
  { value: 'off', label: 'Off', hint: 'No automatic replies. Texts wait for your team.' },
]

export const BOOKING_MODES: { value: BookingMode; label: string; hint: string }[] = [
  { value: 'request', label: 'Ask the team to confirm', hint: 'Saves the time the customer wants. You approve it before it reaches the schedule.' },
  { value: 'book', label: 'Book open times itself', hint: 'Offers only open times from your hours and schedule, then books the one the customer picks.' },
  { value: 'off', label: 'Do not book', hint: 'Takes a message and your team schedules it.' },
]

export const TONES: { value: Tone; label: string }[] = [
  { value: 'friendly', label: 'Friendly and relaxed' },
  { value: 'professional', label: 'Polite and professional' },
  { value: 'brief', label: 'Short and to the point' },
]

export function defaultWeekHours(): WeekHours {
  const day = (open: boolean): DayHours => ({ open, from: '08:00', to: '17:00' })
  return { mon: day(true), tue: day(true), wed: day(true), thu: day(true), fri: day(true), sat: { open: false, from: '09:00', to: '13:00' }, sun: { open: false, from: '09:00', to: '13:00' } }
}

export const DEFAULT_RULES: VoiceRules = {
  version: 1,
  reviewed: false,
  calls_enabled: true,
  texts_mode: 'auto',
  tone: 'friendly',
  assistant_name: '',
  greeting_call: '',
  greeting_text: '',
  recording_notice: true,
  recording_notice_text: 'This call may be recorded so our team can follow up.',
  hours: null,
  closed_dates: [],
  text_back_after_calls: true,
  handoff: [],
  transfer_when_open: true,
  transfer_briefing: true,
  topics: { angry: true, safety: true, towing: true, accident: true, insurance: true, legal: true },
  custom_keywords: [],
  may_share_hours: true,
  may_share_address: true,
  may_share_job_status: true,
  never_lines: [],
  blocked_phrases: [],
  spam_filter: true,
  booking_mode: 'request',
  booking_slot_minutes: 60,
  booking_capacity: 2,
  booking_lead_hours: 2,
  quiet_hours: { enabled: true, from: '21:00', to: '08:00' },
  max_replies: { count: 6, window_hours: 24 },
  takeover_hours: 24,
  summary_email: 'follow_up',
  notify_email: '',
  email_new_texts: false,
}

/** Ways the assistant visibly applies a rule. Shown to the owner in test mode and in the review list. */
export const RULE_LABELS: Record<string, string> = {
  ai_disclosure: 'Said it is an AI',
  recording_notice: 'Gave the recording notice',
  no_prices: 'Held back a price',
  no_time_promises: 'Held back a promise about timing',
  no_diagnosis: 'Held back a guess about the problem',
  no_reply_needed: 'No reply needed',
  booking_off: 'Appointments are switched off, took a message',
  loop_guard: 'Hung up on a call from the shop\'s own number',
  forwarded: 'Forwarded to a person (assistant is switched off)',
  voicemail: 'Took a voicemail (assistant is switched off)',
  email_alert: 'Emailed your team',
  textback: 'Texted the caller back',
  no_human_claim: 'Would not claim to be a person',
  blocked_phrase: 'Removed a phrase you blocked',
  too_long: 'Shortened the reply',
  spam: 'Treated as spam or a sales call',
  automated_sender: 'Ignored an automated sender',
  opt_out: 'Recorded an opt-out',
  help: 'Answered HELP',
  start: 'Recorded an opt-in',
  needs_person_angry: 'Flagged an upset customer for a person',
  needs_person_safety: 'Flagged a safety problem for a person',
  needs_person_towing: 'Flagged a towing request for a person',
  needs_person_accident: 'Flagged an accident for a person',
  needs_person_insurance: 'Flagged an insurance question for a person',
  needs_person_legal: 'Flagged a legal matter for a person',
  needs_person_keyword: 'Flagged one of your keywords for a person',
  needs_person_asked: 'Customer asked for a person',
  needs_person_limit: 'Passed to a person after too many back-and-forth turns',
  needs_person_unsure: 'Passed to a person because it was not sure',
  transfer: 'Transferred to a person',
  transfer_unavailable: 'Could not transfer, took a message',
  after_hours: 'Shop closed, took a message',
  quiet_hours: 'Stayed quiet during quiet hours',
  paused_thread: 'Stayed quiet because a person took over',
  rate_limit: 'Stopped replying to this number for now',
  texts_off: 'Text replies are switched off',
  calls_off: 'Call answering is switched off',
  draft_only: 'Wrote a draft for a person to send',
  booking_request: 'Saved a booking request for approval',
  booking_made: 'Booked an open time',
  booking_offer: 'Offered open times from the schedule',
  price_deflect: 'Answered a price question without a price',
  honest_ai: 'Confirmed it is an AI',
  ended_call: 'Ended the call politely',
  no_model: 'AI model was not available, used the standard script',
  first_reply: 'Sent the first message with the AI notice',
  media_only: 'Received a picture and left it for a person',
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isTime(v: unknown): v is string { return typeof v === 'string' && TIME_RE.test(v) }

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const multiline = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\r/g, '').trim().slice(0, max) : '')
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback)

function lines(v: unknown, maxItems: number, maxLen: number): string[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : []
  const out: string[] = []
  for (const item of raw) {
    const t = str(item, maxLen)
    if (t && !out.some(o => o.toLowerCase() === t.toLowerCase())) out.push(t)
    if (out.length >= maxItems) break
  }
  return out
}

/** A US phone number as +1XXXXXXXXXX, or null when it cannot be one. */
export function toE164US(raw: unknown): string | null {
  const digits = typeof raw === 'string' || typeof raw === 'number' ? String(raw).replace(/\D/g, '') : ''
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

/** The last ten digits, so "(713) 555-0142" and "+17135550142" compare equal. */
export function phoneKey(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '').slice(-10)
}

/** A SQL LIKE pattern that matches one number however it was typed: "(713) 555-0142", "713-555-0142" or "+17135550142". */
export function phoneLikePattern(raw: unknown): string {
  const key = phoneKey(raw)
  return key.length === 10 ? `%${key.slice(0, 3)}%${key.slice(3, 6)}%${key.slice(6)}%` : `%${key}%`
}

function normalizeHours(v: unknown): WeekHours | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const src = v as Record<string, unknown>
  const base = defaultWeekHours()
  let any = false
  const out = { ...base }
  for (const key of DAY_KEYS) {
    const d = src[key]
    if (!d || typeof d !== 'object') continue
    any = true
    const day = d as Record<string, unknown>
    const from = isTime(day.from) ? day.from : base[key].from
    const to = isTime(day.to) ? day.to : base[key].to
    out[key] = { open: bool(day.open, false), from, to }
  }
  return any ? out : null
}

function normalizeHandoff(v: unknown): HandoffPerson[] {
  if (!Array.isArray(v)) return []
  const out: HandoffPerson[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    const phone = toE164US(p.phone)
    if (!phone) continue
    out.push({ name: str(p.name, 60) || 'Our team', phone })
    if (out.length >= 5) break
  }
  return out
}

/** Turns anything stored (or typed) into a complete, valid set of rules. Never throws. */
export function normalizeRules(raw: unknown): VoiceRules {
  const d = DEFAULT_RULES
  const r: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const topics = r.topics && typeof r.topics === 'object' ? (r.topics as Record<string, unknown>) : {}
  const quiet = r.quiet_hours && typeof r.quiet_hours === 'object' ? (r.quiet_hours as Record<string, unknown>) : {}
  const max = r.max_replies && typeof r.max_replies === 'object' ? (r.max_replies as Record<string, unknown>) : {}
  const closed = (Array.isArray(r.closed_dates) ? r.closed_dates : []).filter((x): x is string => typeof x === 'string' && DATE_RE.test(x))
  return {
    version: 1,
    reviewed: bool(r.reviewed, d.reviewed),
    calls_enabled: bool(r.calls_enabled, d.calls_enabled),
    texts_mode: oneOf(r.texts_mode, ['off', 'draft', 'auto'] as const, d.texts_mode),
    tone: oneOf(r.tone, ['friendly', 'professional', 'brief'] as const, d.tone),
    assistant_name: str(r.assistant_name, 30).replace(/[^\p{L}\p{N} .'-]/gu, '').trim(),
    greeting_call: multiline(r.greeting_call, 400),
    greeting_text: multiline(r.greeting_text, 320),
    recording_notice: bool(r.recording_notice, d.recording_notice),
    recording_notice_text: str(r.recording_notice_text, 200) || d.recording_notice_text,
    hours: normalizeHours(r.hours),
    closed_dates: Array.from(new Set(closed)).sort().slice(0, 60),
    text_back_after_calls: bool(r.text_back_after_calls, d.text_back_after_calls),
    handoff: normalizeHandoff(r.handoff),
    transfer_when_open: bool(r.transfer_when_open, d.transfer_when_open),
    transfer_briefing: bool(r.transfer_briefing, d.transfer_briefing),
    topics: {
      angry: bool(topics.angry, true), safety: bool(topics.safety, true), towing: bool(topics.towing, true),
      accident: bool(topics.accident, true), insurance: bool(topics.insurance, true), legal: bool(topics.legal, true),
    },
    custom_keywords: lines(r.custom_keywords, 20, 40),
    may_share_hours: bool(r.may_share_hours, d.may_share_hours),
    may_share_address: bool(r.may_share_address, d.may_share_address),
    may_share_job_status: bool(r.may_share_job_status, d.may_share_job_status),
    never_lines: lines(r.never_lines, 10, 200),
    blocked_phrases: lines(r.blocked_phrases, 20, 60),
    spam_filter: bool(r.spam_filter, d.spam_filter),
    booking_mode: oneOf(r.booking_mode, ['off', 'request', 'book'] as const, d.booking_mode),
    booking_slot_minutes: nearestSlot(num(r.booking_slot_minutes, d.booking_slot_minutes, 15, 480)),
    booking_capacity: num(r.booking_capacity, d.booking_capacity, 1, 10),
    booking_lead_hours: num(r.booking_lead_hours, d.booking_lead_hours, 0, 72),
    quiet_hours: {
      enabled: bool(quiet.enabled, d.quiet_hours.enabled),
      from: isTime(quiet.from) ? quiet.from : d.quiet_hours.from,
      to: isTime(quiet.to) ? quiet.to : d.quiet_hours.to,
    },
    max_replies: { count: num(max.count, d.max_replies.count, 1, 20), window_hours: num(max.window_hours, d.max_replies.window_hours, 1, 72) },
    takeover_hours: num(r.takeover_hours, d.takeover_hours, 1, 168),
    summary_email: oneOf(r.summary_email, ['follow_up', 'every_call', 'never'] as const, d.summary_email),
    notify_email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(r.notify_email ?? '').trim()) ? String(r.notify_email).trim().slice(0, 200) : '',
    email_new_texts: bool(r.email_new_texts, d.email_new_texts),
  }
}

function nearestSlot(n: number): number {
  const options = [15, 30, 45, 60, 90, 120, 180, 240, 480]
  return options.reduce((best, o) => (Math.abs(o - n) < Math.abs(best - n) ? o : best), 60)
}

export interface RuleProblem { field: string; message: string }

/** Plain-words problems that stop the rules from being saved. Empty means they are fine to save. */
export function validateRules(r: VoiceRules, input?: unknown): RuleProblem[] {
  const out: RuleProblem[] = []
  const src: Record<string, unknown> = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  if (Array.isArray(src.handoff)) {
    const typed = (src.handoff as unknown[]).filter(p => p && typeof p === 'object' && String((p as Record<string, unknown>).phone ?? '').trim() !== '')
    if (typed.length !== r.handoff.length) out.push({ field: 'handoff', message: 'One of the handoff numbers is not a full 10-digit phone number.' })
  }
  if (r.hours) {
    for (const k of DAY_KEYS) {
      const h = r.hours[k]
      if (h.open && h.from >= h.to) out.push({ field: `hours.${k}`, message: `${DAY_LABELS[k]}: the closing time must be after the opening time.` })
    }
  }
  if (r.booking_mode === 'book' && !r.hours) out.push({ field: 'booking_mode', message: 'Set your shop hours before the assistant can book times by itself.' })
  if (r.booking_mode === 'book' && r.hours && !DAY_KEYS.some(k => r.hours![k].open)) out.push({ field: 'booking_mode', message: 'Mark at least one day open before the assistant can book times by itself.' })
  if (src.notify_email && String(src.notify_email).trim() && !r.notify_email) out.push({ field: 'notify_email', message: 'That email address does not look right.' })
  if (r.quiet_hours.enabled && r.quiet_hours.from === r.quiet_hours.to) out.push({ field: 'quiet_hours', message: 'Quiet hours start and end at the same time. Pick different times or turn them off.' })
  return out
}

/** True when no rule changes the shop's wording yet, which is what a brand new shop sees. */
export function isStandardRules(r: VoiceRules): boolean {
  return !r.reviewed
}

export function openDayCount(hours: WeekHours | null): number {
  return hours ? DAY_KEYS.filter(k => hours[k].open).length : 0
}
