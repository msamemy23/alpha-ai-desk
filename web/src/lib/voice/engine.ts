/**
 * The one decision engine behind live calls, text auto-replies and the test screen.
 *
 * Order of work for every customer turn:
 *   1. deterministic checks that do not depend on a model (spam, opt-out, safety, "are you a robot?", hours, booking picks)
 *   2. the language model, only for ordinary conversation, asked for a small JSON answer
 *   3. a policy filter on whatever the model said (no prices, no timing promises, no claiming to be a person ...)
 *   4. a plain script when the model is not available
 *
 * It never sends, speaks or saves anything. It returns what to say and what to do, and the caller (webhook, text handler or
 * test screen) decides what to do with that. That is what lets the test screen show exactly what would happen.
 */
import type { VoiceRules } from './rules.ts'
import { phoneKey } from './rules.ts'
import { classify, cleanModelText, enforceReplyPolicy, personTopics, TOPIC_REASON } from './guardrails.ts'
import type { PersonTopic, Signals } from './guardrails.ts'
import { findOpenSlots, isSlotOpen, openState, slotLabel } from './hours.ts'
import type { BookedAppointment, OpenSlot, OpenState } from './hours.ts'
import { buildSystemPrompt, hoursForCustomers, honestAiReply, prettyPhone, shopWord, speakPhone } from './prompt.ts'
import type { ShopProfile } from './prompt.ts'

export interface Captured { name: string; vehicle: string; problem: string; callback: string; preferred: string }
export type PersonReason = PersonTopic | 'unsure' | 'limit'
export type AskedField = '' | 'name' | 'vehicle' | 'problem' | 'callback' | 'callback_confirm' | 'preferred' | 'pick'
export type Outcome =
  | 'answered' | 'message_taken' | 'booked' | 'booking_requested' | 'transferred' | 'needs_person'
  | 'spam' | 'after_hours' | 'missed' | 'silent' | 'draft' | 'opt_out'

export interface ConvState {
  v: 1
  captured: Captured
  customerTurns: number
  aiTurns: number
  offered: OpenSlot[]
  asked: AskedField
  flagged: PersonReason | ''
  transferred: boolean
  closing: boolean
  closingLoops: number
  wantsBooking: boolean
  done: boolean
  booking: { kind: 'request' | 'booked'; date: string; time: string; label: string; preferred: string } | null
  unclear: number
  noModelNoted: boolean
}

export function emptyState(): ConvState {
  return {
    v: 1,
    captured: { name: '', vehicle: '', problem: '', callback: '', preferred: '' },
    customerTurns: 0, aiTurns: 0, offered: [], asked: '', flagged: '', transferred: false,
    closing: false, closingLoops: 0, wantsBooking: false, done: false, booking: null, unclear: 0, noModelNoted: false,
  }
}

/** Reads a stored state back safely. Anything unexpected becomes a fresh state. */
export function readState(raw: unknown): ConvState {
  const base = emptyState()
  if (!raw || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const c = (r.captured && typeof r.captured === 'object' ? r.captured : {}) as Record<string, unknown>
  const s = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : '')
  const asked: AskedField[] = ['', 'name', 'vehicle', 'problem', 'callback', 'callback_confirm', 'preferred', 'pick']
  return {
    v: 1,
    captured: { name: s(c.name, 60), vehicle: s(c.vehicle, 80), problem: s(c.problem, 400), callback: s(c.callback, 30), preferred: s(c.preferred, 120) },
    customerTurns: Number(r.customerTurns) > 0 ? Math.min(100, Number(r.customerTurns)) : 0,
    aiTurns: Number(r.aiTurns) > 0 ? Math.min(100, Number(r.aiTurns)) : 0,
    offered: Array.isArray(r.offered) ? (r.offered as unknown[]).filter((o): o is OpenSlot => !!o && typeof o === 'object' && typeof (o as OpenSlot).date === 'string' && typeof (o as OpenSlot).time === 'string').slice(0, 5).map(o => ({ date: o.date, time: o.time, label: String(o.label || slotLabel(o.date, o.time)) })) : [],
    asked: asked.includes(r.asked as AskedField) ? (r.asked as AskedField) : '',
    flagged: typeof r.flagged === 'string' ? (r.flagged as PersonReason | '') : '',
    transferred: r.transferred === true,
    closing: r.closing === true,
    closingLoops: Number(r.closingLoops) > 0 ? Math.min(10, Number(r.closingLoops)) : 0,
    wantsBooking: r.wantsBooking === true,
    done: r.done === true,
    booking: r.booking && typeof r.booking === 'object' ? (r.booking as ConvState['booking']) : null,
    unclear: Number(r.unclear) > 0 ? Math.min(20, Number(r.unclear)) : 0,
    noModelNoted: r.noModelNoted === true,
  }
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
/** Returns the model's raw text, or an empty string when it is not available. Must never throw. */
export type ModelFn = (messages: ChatMessage[], opts: { maxTokens: number; json: boolean }) => Promise<string>

export interface TurnInput {
  channel: 'call' | 'sms'
  text: string
  rules: VoiceRules
  shop: ShopProfile
  now: Date
  state: ConvState
  history: ChatMessage[]
  context?: {
    customerName?: string
    openJobs?: string[]
    appointments?: BookedAppointment[]
    /** The number the person is calling or texting from. */
    fromNumber?: string
  }
  model?: ModelFn | null
  /** Calls only: a person is reachable right now (open hours, transfer switched on, a handoff number exists). */
  canTransfer?: boolean
}

export interface BookingAction { kind: 'request' | 'book'; date: string; time: string; label: string; preferred: string }

export interface Decision {
  say: string
  end: boolean
  transfer: boolean
  silent: boolean
  optOut: boolean
  flag: { reason: PersonReason; label: string } | null
  booking: BookingAction | null
  state: ConvState
  rulesFired: string[]
  outcome: Outcome
  usedModel: boolean
  signals: Signals
}

/* ---------------- reading what the person said ---------------- */

const NUMBER_WORDS: Record<string, string> = { zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' }

/** "seven one three five five five zero one four two" becomes "7135550142". Leaves everything else alone. */
export function spokenDigits(text: string): string {
  const tokens = String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  return tokens.map(t => (NUMBER_WORDS[t] !== undefined ? NUMBER_WORDS[t] : t)).join(' ')
}

export function findPhone(text: string): string {
  const candidates = [text, spokenDigits(text)]
  for (const t of candidates) {
    const compact = t.replace(/(\d)[\s.\-)(]+(?=\d)/g, '$1')
    const m = compact.match(/(?:\+?1)?(\d{10})(?!\d)/)
    if (m) return prettyPhone(m[1])
  }
  return ''
}

const NOT_NAMES = new Set(['about', 'calling', 'having', 'looking', 'trying', 'wondering', 'not', 'just', 'here', 'in', 'on', 'at', 'regarding', 'a', 'an', 'the', 'my', 'your', 'with', 'for', 'from', 'to', 'and', 'but', 'so', 'really', 'very', 'getting', 'going', 'ok', 'okay', 'yes', 'no', 'yeah', 'sorry', 'good', 'fine', 'great', 'interested', 'bringing', 'needing', 'wanting', 'also', 'still', 'afraid', 'worried', 'concerned', 'curious', 'confused', 'unsure'])

function titleCase(s: string): string {
  return s.split(/\s+/).map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ')
}

function cleanName(raw: string): string {
  const words = raw.replace(/[^A-Za-z'’\- ]/g, ' ').split(/\s+/).filter(Boolean)
  const kept: string[] = []
  for (const w of words) {
    if (NOT_NAMES.has(w.toLowerCase())) break
    kept.push(w)
    if (kept.length >= 3) break
  }
  return kept.length ? titleCase(kept.join(' ')) : ''
}

const FILLER = new Set(['i', 'you', 'we', 'he', 'she', 'they', 'it', 'its', "it's", 'this', 'that', 'what', 'why', 'how', 'who', 'when', 'where', 'will', 'would', 'could', 'should', 'think', 'maybe', 'know', 'dunno', 'idk', 'sure', 'hmm', 'well', 'then', 'um', 'uh', 'because', 'about', 'ok', 'okay', 'yes', 'no', 'yeah', 'yep', 'nope', 'thanks', 'thank', 'hello', 'hi', 'hey', 'please', 'sorry', 'not', 'just', 'so', 'anyway', 'like', 'is', 'are', 'was', 'do', 'does', 'did', 'can', 'have', 'has', 'need', 'want', 'wait', 'hold', 'one', 'moment', 'second', 'minute', 'both', 'either', 'neither', 'also', 'the', 'my', 'me', 'your', 'our', 'there', 'here', 'now', 'later', 'today', 'tomorrow'])
const hasFiller = (s: string) => s.toLowerCase().replace(/[^a-z'\s]/g, ' ').split(/\s+/).filter(Boolean).some(w => FILLER.has(w))

export function findName(text: string, asked: AskedField): string {
  const m = text.match(/\b(?:my name is|my name's|name is|this is|it'?s|it is|i am|i'?m|call me|name'?s)\s+([A-Za-z][A-Za-z'’\-]+(?:\s+[A-Za-z][A-Za-z'’\-]+){0,2})/i)
  if (m) {
    const n = cleanName(m[1])
    if (n) return n
  }
  if (asked === 'name') {
    const stripped = text.replace(/^(yeah|yes|yep|sure|ok|okay|um|uh|so|well)[,.\s]+/i, '').replace(/[.!?]+$/g, '').trim()
    if (/^[A-Za-z'’\- ]{2,40}$/.test(stripped) && stripped.split(/\s+/).length <= 3 && !hasFiller(stripped)) {
      const n = cleanName(stripped)
      if (n) return n
    }
  }
  return ''
}

const MAKES = 'acura|alfa romeo|audi|bmw|buick|cadillac|chevrolet|chevy|chrysler|dodge|fiat|ford|genesis|gmc|honda|hyundai|infiniti|jaguar|jeep|kia|land rover|lexus|lincoln|mazda|mercedes|mercedes-benz|mini|mitsubishi|nissan|pontiac|porsche|ram|saturn|scion|subaru|suzuki|tesla|toyota|volkswagen|vw|volvo'

export function findVehicle(text: string, asked: AskedField): string {
  const yearMake = text.match(new RegExp(`\\b((?:19[89]\\d|20[0-3]\\d))\\s+((?:${MAKES}))\\b(?:\\s+([A-Za-z0-9\\-]+(?:\\s+[A-Za-z0-9\\-]+)?))?`, 'i'))
  if (yearMake) return titleVehicle(`${yearMake[1]} ${yearMake[2]} ${trimModel(yearMake[3] || '')}`)
  const makeOnly = text.match(new RegExp(`\\b((?:${MAKES}))\\b(?:\\s+([A-Za-z0-9\\-]+))?`, 'i'))
  if (makeOnly) {
    const year = text.match(/\b(19[89]\d|20[0-3]\d)\b/)
    return titleVehicle(`${year ? year[1] + ' ' : ''}${makeOnly[1]} ${trimModel(makeOnly[2] || '')}`)
  }
  if (asked === 'vehicle') {
    const t = text.replace(/[.!?]+$/g, '').replace(/^(it'?s|it is|its|a|an|the|my|i have|i drive)\s+/i, '').trim()
    if (t && t.split(/\s+/).length <= 5 && /[A-Za-z0-9]/.test(t) && !hasFiller(t)) return titleVehicle(t)
  }
  return ''
}

function trimModel(m: string): string {
  const stop = new Set(['and', 'is', 'has', 'it', 'the', 'that', 'with', 'for', 'makes', 'won', 'wont', "won't", 'was', 'needs', 'need', 'i', 'my', 'to', 'in', 'on', 'at', 'when', 'but', 'so', 'a'])
  const words = m.trim().split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (const w of words) { if (stop.has(w.toLowerCase())) break; out.push(w) }
  return out.slice(0, 2).join(' ')
}

function titleVehicle(v: string): string {
  return v.replace(/\s+/g, ' ').trim().split(' ').map(w => (/^\d/.test(w) ? w : w.length <= 3 && /^[a-z]+$/i.test(w) && /^(bmw|gmc|vw|ram|kia|mini)$/i.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(' ')
}

const PROBLEM_WORDS = /\b(brake|brakes|oil|noise|noises|sound|grind\w*|squeal\w*|squeak\w*|clunk\w*|knock\w*|engine|check engine|light|a\/?c|air conditioning|heat|tire|tires|flat|battery|dead|start|starting|won'?t|wont|leak\w*|smell|vibrat\w*|shak\w*|transmission|shift\w*|stall\w*|overheat\w*|alignment|inspection|tune[- ]?up|diagnos\w*|estimate|repair|fix|broken|not working|trouble|problem|issue|service|maintenance|rotate|rotation|coolant|radiator|suspension|steering|exhaust|muffler|belt|hose|spark|window|door|lock|wiper|headlight|taillight|bulb|fluid|flush|recall|emissions|smog|safety)\b/i

function findProblem(text: string, st: ConvState, asked: AskedField, pieces: { name: string; vehicle: string; phone: string }): string {
  const t = text.trim()
  if (!t) return ''
  const words = t.split(/\s+/).length
  if (asked === 'problem') return t.slice(0, 240)
  if (st.captured.problem) return ''
  const onlyBits = (pieces.name || pieces.vehicle || pieces.phone) && words <= 5
  if (onlyBits) return ''
  if (PROBLEM_WORDS.test(t) || words >= 6) return t.slice(0, 240)
  return ''
}

const YES = /^(yes|yeah|yep|yup|sure|correct|right|that'?s right|that is right|that'?s correct|that works|it is|it'?s fine|okay|ok|please do|go ahead|uh huh|mm hmm|absolutely|definitely|of course)\b/i
const NO = /^(no|nope|nah|not really|that'?s all|that is all|nothing|nothing else|i'?m good|i'?m all set|we'?re good|no thanks|no thank you|all set)\b/i

const ORDINALS: [RegExp, number][] = [
  [/\b(first|1st|number one|option one|the one)\b/i, 0],
  [/\b(second|2nd|number two|option two)\b/i, 1],
  [/\b(third|3rd|number three|option three)\b/i, 2],
]
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** Which of the offered times did the person pick? Returns null when it is not clear, so the assistant asks again. */
export function pickSlot(text: string, offered: OpenSlot[]): OpenSlot | null {
  if (!offered.length) return null
  const t = String(text || '').toLowerCase()
  const bare = t.replace(/[^a-z0-9: ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^[1-9]$/.test(bare) && Number(bare) <= offered.length) return offered[Number(bare) - 1]
  for (const [re, idx] of ORDINALS) if (re.test(t) && offered[idx]) return offered[idx]
  if (/\b(last one|the last)\b/.test(t)) return offered[offered.length - 1]
  const dayHit = WEEKDAYS.findIndex(d => t.includes(d) || t.includes(d.slice(0, 3) + ' ') || t.endsWith(' ' + d.slice(0, 3)))
  let pool = offered
  if (dayHit >= 0) {
    pool = offered.filter(o => new Date(o.date + 'T12:00:00Z').getUTCDay() === dayHit)
    if (!pool.length) return null
  }
  const tm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/)
  if (tm) {
    const h = Number(tm[1])
    const min = tm[2] ? Number(tm[2]) : 0
    const mer = tm[3] ? tm[3][0] : ''
    if (h >= 1 && h <= 12 && (mer || dayHit >= 0 || bare.split(' ').length <= 4)) {
      const matches = pool.filter(o => {
        const [oh, om] = o.time.split(':').map(Number)
        if (om !== min) return false
        if (mer === 'a') return oh === (h === 12 ? 0 : h)
        if (mer === 'p') return oh === (h === 12 ? 12 : h + 12)
        return oh % 12 === h % 12
      })
      if (matches.length === 1) return matches[0]
      if (matches.length > 1) return null
    }
  }
  if (dayHit >= 0 && pool.length === 1) return pool[0]
  return null
}

const HAS_WHEN = /\b(today|tomorrow|tonight|this (morning|afternoon|evening|week)|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thurs|fri|sat|sun|morning|afternoon|noon|\d{1,2}(:\d{2})?\s?(am|pm)|after work|first thing)\b/i
const WANTS_OTHER_TIME = /\b(none of (those|them)|neither|something else|different (day|time)|another (day|time)|other (day|time)|later|earlier|next week|none work)\b/i

/* ---------------- fixed wording ---------------- */

function firstName(name: string): string { return name.split(' ')[0] || '' }

function fallbacks(rules: VoiceRules, shop: ShopProfile, channel: 'call' | 'sms') {
  return {
    prices: 'Our team gives quotes after they have looked at the vehicle.',
    timing: 'Our team will follow up with you.',
    diagnosis: 'Our team will need to look at it to say for sure.',
    human: honestAiReply(rules, shop, channel),
    generic: 'Let me pass that along to our team.',
  }
}

export function nextQuestion(c: Captured, channel: 'call' | 'sms', suggestedCallback: string): { text: string; asked: AskedField } | null {
  if (!c.problem) return { text: channel === 'call' ? 'What can we help you with today?' : 'What can we help you with?', asked: 'problem' }
  if (!c.name) return { text: 'Can I get your name?', asked: 'name' }
  if (!c.vehicle) return { text: 'What year, make and model is the vehicle?', asked: 'vehicle' }
  if (!c.callback && channel === 'call') {
    const last4 = suggestedCallback ? suggestedCallback.replace(/\D/g, '').slice(-4) : ''
    if (last4) return { text: `Is the number you're calling from, ending in ${last4.split('').join(' ')}, the best one to reach you?`, asked: 'callback_confirm' }
    return { text: 'What is the best phone number to reach you?', asked: 'callback' }
  }
  return null
}

function closingLine(c: Captured, channel: 'call' | 'sms'): string {
  const who = firstName(c.name)
  const car = c.vehicle ? `your ${c.vehicle}` : 'your vehicle'
  // A request like "I need an appointment" is not worth reading back; a description of the problem is.
  const echo = c.problem && !/^(i|we)\s+(need|want|would like|'d like|wanna|am looking|was hoping)\b|^(can|could|do)\s+(i|you|we)\b/i.test(c.problem.trim())
  const about = echo ? ` You said, ${trimProblem(c.problem)}.` : ''
  const call = c.callback && channel === 'call' ? ` We have ${speakPhone(c.callback)} as the number to reach you.` : ''
  return `Thanks${who ? ', ' + who : ''}. I have ${car}.${about}${call} I'll pass this to our team and they'll follow up with you. Is there anything else?`
}

function trimProblem(p: string): string {
  const one = p.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/g, '')
  const cut = one.length > 90 ? one.slice(0, 90).replace(/\s+\S*$/, '') : one
  return cut.charAt(0).toLowerCase() + cut.slice(1)
}

const GOODBYE_CALL = (shop: ShopProfile) => `Thanks for calling ${shopWord(shop)}. Goodbye.`

/* ---------------- the decision ---------------- */

function newDecision(st: ConvState, signals: Signals): Decision {
  return { say: '', end: false, transfer: false, silent: false, optOut: false, flag: null, booking: null, state: st, rulesFired: [], outcome: 'answered', usedModel: false, signals }
}

function merge(st: ConvState, patch: Partial<Captured>) {
  for (const k of Object.keys(patch) as (keyof Captured)[]) {
    const v = patch[k]
    if (typeof v === 'string' && v.trim()) st.captured[k] = v.trim()
  }
}

const topicLabel = (t: PersonReason): string => (t === 'unsure' ? 'Not sure how to help' : t === 'limit' ? 'Long conversation' : TOPIC_REASON[t])

export function flagReasonLabel(reason: string): string {
  return topicLabel(reason as PersonReason)
}

export async function decideTurn(input: TurnInput): Promise<Decision> {
  const { channel, rules, shop } = input
  const st: ConvState = readState(JSON.parse(JSON.stringify(input.state)))
  const text = String(input.text || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
  const signals = classify(text, { channel, customKeywords: rules.custom_keywords })
  const d = newDecision(st, signals)
  const open: OpenState = openState(rules.hours, rules.closed_dates, shop.timezone, input.now)
  const fromNumber = input.context?.fromNumber || ''
  const suggestedCallback = fromNumber && phoneKey(fromNumber).length === 10 ? prettyPhone(fromNumber) : ''
  const asked = st.asked
  st.customerTurns += 1
  st.asked = ''

  const finish = (say: string, patch?: Partial<Decision>): Decision => {
    Object.assign(d, patch || {})
    d.say = say
    if (say) st.aiTurns += 1
    d.state = st
    if (!d.outcome || d.outcome === 'answered') d.outcome = deriveOutcome(st, open, d)
    return d
  }

  // Nothing to react to.
  if (!text) return finish('', { silent: true, outcome: st.flagged ? 'needs_person' : 'silent' })

  /* 1. Natural-language "stop contacting me". */
  if (signals.optOutNatural) {
    d.rulesFired.push('opt_out')
    if (channel === 'sms') return finish('', { silent: true, optOut: true, outcome: 'opt_out' })
    return finish(`Understood. We won't contact you again. Goodbye.`, { end: true, optOut: true, outcome: 'opt_out' })
  }

  /* 2. Spam and sales calls. */
  if (rules.spam_filter && signals.spam && !st.captured.problem) {
    d.rulesFired.push('spam')
    if (channel === 'sms') return finish('', { silent: true, outcome: 'spam' })
    return finish(`Thanks, but we're not interested. Goodbye.`, { end: true, outcome: 'spam' })
  }

  /* 3. Read what was said into the notes. */
  const phone = findPhone(text)
  const nameFound = findName(text, asked)
  const vehicleFound = findVehicle(text, asked)
  const patch: Partial<Captured> = {}
  if (phone && (asked === 'callback' || asked === 'callback_confirm' || !st.captured.callback || channel === 'call')) patch.callback = phone
  else if (asked === 'callback_confirm' && YES.test(text) && suggestedCallback) patch.callback = suggestedCallback
  if (nameFound) patch.name = nameFound
  if (vehicleFound) patch.vehicle = vehicleFound
  const isPureAnswer = (asked === 'name' && nameFound) || (asked === 'vehicle' && vehicleFound) || (asked === 'callback' && phone) || (asked === 'callback_confirm' && (phone || YES.test(text)))
  if (!isPureAnswer && asked !== 'pick' && asked !== 'preferred') {
    const prob = findProblem(text, st, asked, { name: nameFound, vehicle: vehicleFound, phone })
    if (prob) patch.problem = st.captured.problem && asked === 'problem' ? `${st.captured.problem} ${prob}`.slice(0, 400) : prob
  }
  if (channel === 'sms' && suggestedCallback && !st.captured.callback && !patch.callback) patch.callback = suggestedCallback
  merge(st, patch)
  if (asked === 'callback_confirm' && NO.test(text) && !phone) { st.asked = 'callback'; return finish('No problem. What number should we use?') }

  /* 4. People who need a person. */
  const topics = st.flagged ? [] : personTopics(signals, rules.topics)
  if (topics.length) {
    const reason = topics[0]
    st.flagged = reason
    d.flag = { reason, label: topicLabel(reason) }
    d.rulesFired.push(reason === 'keyword' ? 'needs_person_keyword' : `needs_person_${reason}`)
    const danger = signals.emergency || signals.safety
    const prefix = signals.askedIfAi ? 'Yes, I\'m an AI assistant. ' : ''
    const urgent = danger ? ' If anyone is hurt or in danger, please hang up and call 911.' : ''
    const sorry = reason === 'angry' || reason === 'legal' ? `I'm sorry about the trouble. ` : ''
    if (signals.askedIfAi) d.rulesFired.push('honest_ai')
    if (channel === 'call') {
      if (input.canTransfer) {
        st.transferred = true
        d.rulesFired.push('transfer')
        return finish(`${prefix}${sorry}I'm connecting you with someone on our team now. One moment.${urgent}`, { transfer: true, outcome: 'transferred' })
      }
      const gap = !st.captured.callback && !suggestedCallback
      d.rulesFired.push('transfer_unavailable')
      if (gap) { st.asked = 'callback'; return finish(`${prefix}${sorry}I've marked this as urgent for our team. What is the best number to reach you?${urgent}`, { outcome: 'needs_person' }) }
      if (!st.captured.callback && suggestedCallback) st.captured.callback = suggestedCallback
      st.done = true
      return finish(`${prefix}${sorry}I've marked this as urgent for our team, and a person will follow up with you.${urgent} Goodbye.`, { end: true, outcome: 'needs_person' })
    }
    const asking = reason === 'asked'
    return finish(`${prefix}${asking ? 'Sure, I\'ll ask a person on our team to take over this conversation.' : `${sorry}I've passed this to our team so a person can follow up with you.`}${urgent}`.replace(/\s+/g, ' ').trim(), { outcome: 'needs_person' })
  }
  if (st.flagged) {
    // A person has already been asked. Calls collect a number then close. Texts stay quiet.
    d.flag = null
    if (channel === 'sms') return finish('', { silent: true, outcome: 'needs_person', rulesFired: [...d.rulesFired, 'paused_thread'] })
    if (asked === 'callback' && phone) { st.done = true; return finish(`Thanks. A person will follow up with you on ${speakPhone(phone)}. Goodbye.`, { end: true, outcome: 'needs_person' }) }
    if (st.customerTurns >= 4 || signals.goodbye) { st.done = true; return finish(`A person on our team will follow up with you. Goodbye.`, { end: true, outcome: 'needs_person' }) }
    return finish('Our team has been told, and a person will follow up with you. Is there anything else I should pass along?', { outcome: 'needs_person' })
  }

  /* 5. Honest about being an AI. */
  if (signals.askedIfAi) {
    d.rulesFired.push('honest_ai')
    const base = honestAiReply(rules, shop, channel)
    const q = nextQuestion(st.captured, channel, suggestedCallback)
    if (q) st.asked = q.asked
    return finish(base)
  }

  /* 6. Goodbyes and "that's all". */
  if (st.closing || st.done) {
    if (signals.goodbye || signals.ack || NO.test(text) || (channel === 'call' && st.closingLoops >= 2)) {
      if (channel === 'sms') return finish('', { silent: true, outcome: deriveOutcome(st, open, d), rulesFired: [...d.rulesFired, 'no_reply_needed'] })
      return finish(GOODBYE_CALL(shop), { end: true })
    }
    if (st.closingLoops >= 2 && channel === 'sms') return finish('', { silent: true, rulesFired: [...d.rulesFired, 'no_reply_needed'] })
    st.closingLoops += 1
    if (!patch.problem && !phone && text.split(/\s+/).length >= 3 && !st.captured.problem.includes(text.slice(0, 40))) st.captured.problem = `${st.captured.problem} Also: ${text}`.slice(0, 400)
    return finish(channel === 'call' ? 'Got it, I added that for our team. Anything else?' : 'Got it, I added that for our team.')
  }
  if (channel === 'sms' && (signals.ack || signals.goodbye) && st.aiTurns > 0) {
    return finish('', { silent: true, rulesFired: [...d.rulesFired, 'no_reply_needed'] })
  }
  if (channel === 'call' && signals.goodbye && st.aiTurns > 0 && !signals.booking) {
    return finish(GOODBYE_CALL(shop), { end: true })
  }

  /* 7. Too long a conversation. */
  const cap = channel === 'call' ? 16 : 12
  if (st.customerTurns > cap) {
    st.flagged = 'limit'
    d.flag = { reason: 'limit', label: topicLabel('limit') }
    d.rulesFired.push('needs_person_limit')
    st.done = true
    return finish(channel === 'call' ? `I'll have a person from our team follow up with you. Goodbye.` : `I'll have a person from our team follow up with you.`, { end: channel === 'call', outcome: 'needs_person' })
  }

  /* 8. Booking. */
  const appointments = input.context?.appointments || []
  if (asked === 'pick' && st.offered.length) {
    const picked = pickSlot(text, st.offered)
    const slotOpts = { rules, tz: shop.timezone, now: input.now, appointments }
    if (picked) {
      if (isSlotOpen(slotOpts, picked.date, picked.time)) {
        st.offered = []
        st.booking = { kind: 'booked', date: picked.date, time: picked.time, label: picked.label, preferred: picked.label }
        st.captured.preferred = picked.label
        d.booking = { kind: 'book', date: picked.date, time: picked.time, label: picked.label, preferred: picked.label }
        d.rulesFired.push('booking_made')
        const q = nextQuestion(st.captured, channel, suggestedCallback)
        if (q) { st.asked = q.asked; return finish(`You're booked for ${picked.label}. ${q.text}`, { outcome: 'booked' }) }
        st.closing = true
        st.done = true
        return finish(`You're booked for ${picked.label}. ${closingLine(st.captured, channel)}`, { outcome: 'booked' })
      }
      const fresh = findOpenSlots({ ...slotOpts, limit: 3 })
      st.offered = fresh
      st.asked = fresh.length ? 'pick' : ''
      d.rulesFired.push('booking_offer')
      return finish(fresh.length ? `Sorry, that time was just taken. ${offerLine(fresh)}` : 'Sorry, that time was just taken. I will pass your request to our team to find another.')
    }
    if (WANTS_OTHER_TIME.test(text)) {
      st.offered = []
      st.asked = 'preferred'
      return finish('No problem. What day and time would work best for you? I will pass it to our team to confirm.')
    }
    st.unclear += 1
    st.asked = 'pick'
    return finish(`Sorry, which one works best? ${offerLine(st.offered)}`)
  }
  const recordRequest = (preferred: string): Decision => {
    st.captured.preferred = preferred.slice(0, 120)
    st.wantsBooking = false
    st.booking = { kind: 'request', date: '', time: '', label: st.captured.preferred, preferred: st.captured.preferred }
    d.booking = { kind: 'request', date: '', time: '', label: st.captured.preferred, preferred: st.captured.preferred }
    d.rulesFired.push('booking_request')
    const q = nextQuestion(st.captured, channel, suggestedCallback)
    if (q) { st.asked = q.asked; return finish(`Thanks, I've sent that request to our team to confirm. ${q.text}`, { outcome: 'booking_requested' }) }
    st.closing = true
    st.done = true
    return finish(`Thanks, I've sent that request to our team to confirm. ${closingLine(st.captured, channel)}`, { outcome: 'booking_requested' })
  }
  if (asked === 'preferred') return recordRequest(text)
  if ((signals.booking || st.wantsBooking) && !st.booking && rules.booking_mode !== 'off') {
    st.wantsBooking = true
    if (rules.booking_mode === 'book' && rules.hours) {
      const slots = findOpenSlots({ rules, tz: shop.timezone, now: input.now, appointments, limit: 3 })
      if (slots.length) {
        if (!st.captured.name) {
          st.asked = 'name'
          return finish('Happy to set that up. Can I get your name first?')
        }
        st.offered = slots
        st.asked = 'pick'
        d.rulesFired.push('booking_offer')
        return finish(offerLine(slots))
      }
    }
    if (HAS_WHEN.test(text)) return recordRequest(text)
    st.asked = 'preferred'
    return finish('Happy to set that up. What day and time would work best for you? I will send it to our team to confirm.')
  }
  if (signals.booking && rules.booking_mode === 'off' && !st.captured.problem) {
    d.rulesFired.push('booking_off')
  }

  /* 9. Questions with fixed, safe answers. */
  const q0 = () => nextQuestion(st.captured, channel, suggestedCallback)
  const withNext = (answer: string): Decision => {
    const q = q0()
    if (q) { st.asked = q.asked; return finish(`${answer} ${q.text}`) }
    st.closing = true
    st.done = true
    return finish(`${answer} ${closingLine(st.captured, channel)}`)
  }
  if (signals.price) {
    d.rulesFired.push('price_deflect')
    return withNext(`I can't give prices, but our team will give you a quote once they've looked at the vehicle.`)
  }
  if (signals.hours && !signals.booking) {
    const hours = hoursForCustomers(rules)
    if (hours) {
      const now = open.known ? (open.open ? ` We're open now until ${open.closesAt}.` : ` We're closed right now.${open.nextOpen ? ` We open ${open.nextOpen}.` : ''}`) : ''
      return withNext(`Our hours are ${hours}.${now}`)
    }
    return withNext(`I don't have our hours in front of me, but our team can confirm them.`)
  }
  if (signals.address && !signals.booking) {
    if (rules.may_share_address && shop.address) return withNext(`We're at ${shop.address}.`)
    return withNext(`Our team can share directions. I'll make a note.`)
  }

  /* 10. Everything else: the model, or the plain script. */
  let usedModel = false
  let modelReply = ''
  let modelDone = false
  let modelPerson = false
  if (input.model) {
    const prompt = buildSystemPrompt({
      channel, rules, shop, open, captured: st.captured, offered: st.offered,
      customerName: input.context?.customerName, openJobs: input.context?.openJobs,
    })
    const messages: ChatMessage[] = [{ role: 'system', content: prompt }, ...input.history.filter(m => m.role !== 'system').slice(-8), { role: 'user', content: text }]
    let raw = ''
    try { raw = await input.model(messages, { maxTokens: channel === 'call' ? 220 : 260, json: true }) } catch { raw = '' }
    const parsed = parseModelJson(raw)
    if (parsed) {
      usedModel = true
      const c = parsed.captured
      const mp: Partial<Captured> = {}
      if (c.name && !st.captured.name && /^[A-Za-z][A-Za-z'’\- ]{1,40}$/.test(c.name) && text.toLowerCase().includes(c.name.split(' ')[0].toLowerCase())) mp.name = titleCase(c.name)
      if (c.vehicle && !st.captured.vehicle && c.vehicle.length <= 60) mp.vehicle = c.vehicle
      if (c.problem && !st.captured.problem) mp.problem = c.problem.slice(0, 240)
      const cp = c.callback ? findPhone(c.callback) : ''
      if (cp && !st.captured.callback) mp.callback = cp
      merge(st, mp)
      modelReply = cleanModelText(parsed.reply)
      modelDone = parsed.done
      modelPerson = parsed.wants_person
    }
  }
  if (modelPerson) {
    st.flagged = 'unsure'
    d.flag = { reason: 'unsure', label: topicLabel('unsure') }
    d.rulesFired.push('needs_person_unsure')
    if (channel === 'call' && input.canTransfer) {
      st.transferred = true
      d.rulesFired.push('transfer')
      return finish(`I'm connecting you with someone on our team now. One moment.`, { transfer: true, usedModel, outcome: 'transferred' })
    }
    if (channel === 'call') { st.done = true; return finish(`I'll have a person on our team follow up with you. Goodbye.`, { end: true, usedModel, outcome: 'needs_person' }) }
    return finish(`I've passed this to our team so a person can follow up with you.`, { usedModel, outcome: 'needs_person' })
  }

  let say = ''
  if (modelReply) {
    const policy = enforceReplyPolicy(modelReply, { channel, blockedPhrases: rules.blocked_phrases, fallback: fallbacks(rules, shop, channel) })
    for (const v of policy.violations) d.rulesFired.push(v)
    say = policy.text
    if (policy.changed && policy.violations.length && !say) say = ''
  } else if (input.model) {
    d.rulesFired.push('no_model')
  } else if (!st.noModelNoted) {
    st.noModelNoted = true
    d.rulesFired.push('no_model')
  }

  const next = nextQuestion(st.captured, channel, suggestedCallback)
  if (!next) {
    // Everything we need is in hand.
    if (!st.closing) {
      st.closing = true
      st.done = true
      const closing = closingLine(st.captured, channel)
      return finish(modelDone && say && !/\?$/.test(say) ? `${say} ${closing}`.slice(0, 520) : closing, { usedModel })
    }
    return finish(say || 'Got it. Anything else?', { usedModel })
  }
  if (usedModel && say) {
    // Keep the model's wording but make sure the next needed question is the one asked.
    const askedByModel = /\?\s*$/.test(say)
    if (!askedByModel) { st.asked = next.asked; say = `${say} ${next.text}` }
    else st.asked = guessAsked(say, next.asked)
    st.unclear = 0
    return finish(say, { usedModel })
  }
  // Plain script.
  const gotSomething = Object.keys(patch).length > 0
  st.unclear = gotSomething ? 0 : st.unclear + 1
  if (st.unclear >= 3) {
    st.flagged = 'unsure'
    d.flag = { reason: 'unsure', label: topicLabel('unsure') }
    d.rulesFired.push('needs_person_unsure')
    if (channel === 'call' && input.canTransfer) { st.transferred = true; d.rulesFired.push('transfer'); return finish(`Let me get someone from our team on the line. One moment.`, { transfer: true, outcome: 'transferred' }) }
    st.done = true
    return finish(channel === 'call' ? `I'm having trouble understanding. A person on our team will follow up with you. Goodbye.` : `I'll have a person on our team follow up with you.`, { end: channel === 'call', outcome: 'needs_person' })
  }
  st.asked = next.asked
  const lead = st.aiTurns === 0 ? '' : gotSomething ? 'Thanks. ' : `Sorry, I didn't catch that. `
  return finish(`${lead}${next.text}`)
}

function guessAsked(sentence: string, fallback: AskedField): AskedField {
  const s = sentence.toLowerCase()
  if (/\bname\b/.test(s)) return 'name'
  if (/\b(year|make|model|vehicle|car|truck)\b/.test(s)) return 'vehicle'
  if (/\b(number|phone|reach)\b/.test(s)) return 'callback'
  if (/\b(what|how)\b.*\b(help|wrong|doing|issue|problem|need)\b/.test(s)) return 'problem'
  return fallback
}

function offerLine(slots: OpenSlot[]): string {
  const list = slots.map((s, i) => `${i + 1}. ${s.label}`).join('. ')
  return `I have these open times: ${list}. Which one works best?`
}

interface ParsedModel { reply: string; captured: Captured; wants_booking: boolean; wants_person: boolean; done: boolean }

export function parseModelJson(raw: string): ParsedModel | null {
  const text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  let obj: Record<string, unknown> | null = null
  if (start >= 0 && end > start) {
    try { obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown> } catch { obj = null }
  }
  const s = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')
  if (!obj) {
    // The model ignored the format. Treat plain words as the reply.
    const plain = cleanModelText(text)
    if (!plain || plain.startsWith('{')) return null
    return { reply: plain, captured: { name: '', vehicle: '', problem: '', callback: '', preferred: '' }, wants_booking: false, wants_person: false, done: false }
  }
  const c = (obj.captured && typeof obj.captured === 'object' ? obj.captured : {}) as Record<string, unknown>
  return {
    reply: s(obj.reply, 700),
    captured: { name: s(c.name, 60), vehicle: s(c.vehicle, 80), problem: s(c.problem, 240), callback: s(c.callback, 30), preferred: '' },
    wants_booking: obj.wants_booking === true,
    wants_person: obj.wants_person === true,
    done: obj.done === true,
  }
}

/* ---------------- outcomes and summaries ---------------- */

export function deriveOutcome(st: ConvState, open: OpenState, d?: Pick<Decision, 'transfer' | 'rulesFired'>): Outcome {
  if (st.transferred || d?.transfer) return 'transferred'
  if (st.booking?.kind === 'booked') return 'booked'
  if (st.booking?.kind === 'request') return 'booking_requested'
  if (st.flagged) return 'needs_person'
  const hasDetails = !!(st.captured.problem || st.captured.name || st.captured.vehicle)
  if (hasDetails && open.known && !open.open) return 'after_hours'
  if (hasDetails) return 'message_taken'
  return st.customerTurns > 0 ? 'answered' : 'missed'
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  answered: 'Answered',
  message_taken: 'Took a message',
  booked: 'Booked an appointment',
  booking_requested: 'Appointment request waiting for you',
  transferred: 'Transferred to a person',
  needs_person: 'Needs a person',
  spam: 'Spam or sales call',
  after_hours: 'After hours, took a message',
  missed: 'Missed',
  silent: 'No reply sent',
  draft: 'Draft waiting for you',
  opt_out: 'Asked to stop',
}

export function outcomeText(o: Outcome): string { return OUTCOME_LABELS[o] || 'Answered' }
