// The rules every automated message obeys, as plain functions with no database and no network.
// Who may be messaged, when, how often, and what the text says: all decided here, so one place
// can be tested and the screen can show the same answer the server will act on.
//
// Imports are relative on purpose: the tests load this file straight from disk.

import { getWallClock, zonedTimeToUtc } from './schedules.ts'

export type Channel = 'sms' | 'email'
/** service = about their own car, visit or estimate. marketing = anything that asks for something or promotes. */
export type MessageClass = 'service' | 'marketing'

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

export const DEFAULT_TIMEZONE = 'America/Chicago'

// ── Shop rules ────────────────────────────────────────────────────────────

export interface ShopRules {
  /** One switch for every automation. Off means nothing is sent and nothing waits in the queue. */
  master_enabled: boolean
  /** Quiet hours, in the recipient's local time. Nothing is sent from quiet_start until quiet_end. */
  quiet_start_hour: number
  quiet_end_hour: number
  skip_sundays: boolean
  /** Fewest days between marketing texts to one customer, across every marketing automation. */
  marketing_cap_days: number
  /** Most marketing texts to one customer in 30 days. */
  marketing_monthly_max: number
  /** Most automated service texts to one customer in 24 hours. */
  service_daily_max: number
  /** Email the shop when an automation fails. */
  alert_on_failure: boolean
}

export const DEFAULT_RULES: ShopRules = {
  master_enabled: true,
  quiet_start_hour: 21,
  quiet_end_hour: 8,
  skip_sundays: false,
  marketing_cap_days: 7,
  marketing_monthly_max: 3,
  service_daily_max: 2,
  alert_on_failure: true,
}

const wholeIn = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

/**
 * Turns whatever was saved into valid rules. Quiet hours can only get longer than the 9pm to 8am default,
 * never shorter: starting no later than 9pm and ending no earlier than 8am.
 */
export function normalizeRules(raw: unknown): ShopRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    master_enabled: r.master_enabled !== false,
    quiet_start_hour: wholeIn(r.quiet_start_hour, 15, 21, DEFAULT_RULES.quiet_start_hour),
    quiet_end_hour: wholeIn(r.quiet_end_hour, 8, 12, DEFAULT_RULES.quiet_end_hour),
    skip_sundays: r.skip_sundays === true,
    marketing_cap_days: wholeIn(r.marketing_cap_days, 1, 90, DEFAULT_RULES.marketing_cap_days),
    marketing_monthly_max: wholeIn(r.marketing_monthly_max, 1, 15, DEFAULT_RULES.marketing_monthly_max),
    service_daily_max: wholeIn(r.service_daily_max, 1, 10, DEFAULT_RULES.service_daily_max),
    alert_on_failure: r.alert_on_failure !== false,
  }
}

/** Why a rules change was refused, or null when it is fine. */
export function rulesProblem(raw: Record<string, unknown>): string | null {
  const check = (key: string, min: number, max: number, label: string): string | null => {
    if (raw[key] === undefined) return null
    return wholeIn(raw[key], min, max, -1) === -1 ? `${label} must be a whole number from ${min} to ${max}.` : null
  }
  return check('quiet_start_hour', 15, 21, 'Quiet hours start')
    || check('quiet_end_hour', 8, 12, 'Quiet hours end')
    || check('marketing_cap_days', 1, 90, 'Days between marketing texts')
    || check('marketing_monthly_max', 1, 15, 'Marketing texts per month')
    || check('service_daily_max', 1, 10, 'Service texts per day')
}

// ── Time zones ────────────────────────────────────────────────────────────

const ZONES: Record<string, string> = {
  eastern: 'America/New_York',
  central: 'America/Chicago',
  mountain: 'America/Denver',
  arizona: 'America/Phoenix',
  pacific: 'America/Los_Angeles',
  alaska: 'America/Anchorage',
  hawaii: 'Pacific/Honolulu',
}

const AREA_CODES: Record<string, string> = {}
const addCodes = (zone: string, codes: string) => { for (const c of codes.split(/\s+/)) if (c) AREA_CODES[c] = ZONES[zone] }
addCodes('eastern', '201 202 203 207 212 215 223 229 234 239 240 248 267 272 276 301 302 304 305 315 321 326 332 339 347 351 352 380 386 401 404 407 410 412 413 419 423 434 440 443 445 470 475 478 484 508 513 516 517 518 540 551 561 567 570 571 585 586 603 607 609 610 614 616 617 631 646 656 667 678 681 689 704 706 716 717 718 724 727 732 734 740 743 754 757 762 764 770 771 772 774 781 786 802 803 804 810 813 814 828 835 838 839 843 845 848 854 856 857 860 862 863 864 865 878 904 908 910 914 917 919 929 934 937 941 947 954 959 973 978 980 984')
addCodes('central', '205 210 214 217 218 224 225 228 251 254 256 262 281 309 312 314 316 318 319 320 325 331 334 337 346 361 402 405 409 414 417 430 432 464 469 479 501 504 507 512 515 531 534 539 557 563 573 580 582 601 605 608 612 618 620 630 636 641 651 659 660 662 682 708 712 713 715 726 731 737 763 769 773 779 785 806 815 816 817 830 832 847 870 872 901 903 913 918 920 931 936 938 940 952 956 972 979 985')
addCodes('mountain', '303 307 385 406 435 505 575 719 720 801 915 970 983')
addCodes('arizona', '480 520 602 623 928')
addCodes('pacific', '206 209 213 253 279 310 323 341 360 408 415 424 425 442 458 503 509 510 530 541 559 562 564 619 626 628 650 657 661 669 702 707 714 725 747 760 775 805 818 820 831 840 858 909 916 925 949 951 971')
addCodes('mountain', '208 986')
addCodes('hawaii', '808')
addCodes('alaska', '907')

/** The time zone a US or Canadian number most likely lives in, from its area code. Null when unknown. */
export function timezoneForPhone(phone: unknown): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '')
  const national = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits.length === 10 ? digits : ''
  return national ? AREA_CODES[national.slice(0, 3)] || null : null
}

export function validTimezone(tz: unknown): string {
  if (typeof tz !== 'string' || !tz) return DEFAULT_TIMEZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return tz
  } catch {
    return DEFAULT_TIMEZONE
  }
}

// ── Quiet hours ───────────────────────────────────────────────────────────

export interface SendWindow { quietStart: number; quietEnd: number; skipSundays: boolean }

export function windowFromRules(rules: ShopRules): SendWindow {
  return { quietStart: rules.quiet_start_hour, quietEnd: rules.quiet_end_hour, skipSundays: rules.skip_sundays }
}

const inQuiet = (hour: number, start: number, end: number): boolean => (
  start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end
)

/** May a message go out at this moment, in this time zone? */
export function isSendable(at: Date, timeZone: string, w: SendWindow): boolean {
  const wall = getWallClock(at, validTimezone(timeZone))
  if (w.skipSundays && wall.weekday === 0) return false
  return !inQuiet(wall.hour, w.quietStart, w.quietEnd)
}

/** The first moment at or after `at` when a message may go out in this time zone. */
export function nextSendable(at: Date, timeZone: string, w: SendWindow): Date {
  const tz = validTimezone(timeZone)
  let t = at
  for (let i = 0; i < 9; i += 1) {
    if (isSendable(t, tz, w)) return t
    const wall = getWallClock(t, tz)
    // Quiet ends at quietEnd o'clock. If that hour already passed today, it is tomorrow's.
    const sameDay = wall.hour < w.quietEnd
    const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + (sameDay && !(w.skipSundays && wall.weekday === 0) ? 0 : 1), 12, 0, 0))
    let candidate = zonedTimeToUtc({ year: day.getUTCFullYear(), month: day.getUTCMonth() + 1, day: day.getUTCDate(), hour: w.quietEnd, minute: 0 }, tz)
    if (candidate.getTime() <= t.getTime()) candidate = new Date(t.getTime() + MIN)
    t = candidate
  }
  return t
}

/** When may this person get a text? The later of the shop's clock and their own, so it is polite in both. */
export function earliestSend(at: Date, shopTimeZone: string, phone: unknown, w: SendWindow): Date {
  const zones = [validTimezone(shopTimeZone)]
  const theirs = timezoneForPhone(phone)
  if (theirs && theirs !== zones[0]) zones.push(theirs)
  let t = at
  for (let i = 0; i < 6; i += 1) {
    const next = zones.map(z => nextSendable(t, z, w))
    const latest = next.reduce((a, b) => (a.getTime() >= b.getTime() ? a : b))
    if (latest.getTime() === t.getTime()) return t
    t = latest
  }
  return t
}

// ── Words ─────────────────────────────────────────────────────────────────

export const firstName = (name: unknown): string => String(name ?? '').trim().split(/\s+/)[0] || 'there'

export const phoneDigits = (v: unknown): string => String(v ?? '').replace(/\D/g, '')
export const phoneKey = (v: unknown): string => phoneDigits(v).slice(-10)
export const hasUsablePhone = (v: unknown): boolean => phoneDigits(v).length >= 10
export const looksLikeEmail = (v: unknown): boolean => /^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}$/.test(String(v ?? '').trim())

/** (713) 555-0142 for a ten digit number; anything else as typed. */
export function prettyPhone(v: unknown): string {
  const d = phoneDigits(v)
  const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : String(v ?? '').trim()
}

export const OPT_OUT_LINE = 'Reply STOP to opt out.'

/** Marketing texts end with the opt-out line, once. Same rule as growth-text, kept here so the engine has no extra import. */
export function addOptOut(text: string): string {
  const t = text.trim()
  if (/\bSTOP\b/i.test(t)) return t
  return t ? `${t} ${OPT_OUT_LINE}` : OPT_OUT_LINE
}

export const PLACEHOLDERS = ['name', 'shop', 'shop_phone', 'contact', 'vehicle', 'service', 'date', 'amount', 'review_link', 'items'] as const
export type Placeholder = typeof PLACEHOLDERS[number]

const FALLBACKS: Record<string, string> = {
  name: 'there', shop: 'our shop', shop_phone: '', contact: 'Reply to this text', vehicle: 'vehicle', service: 'service', date: 'soon', amount: '', review_link: '', items: 'the work we recommended',
}

/** Names of {placeholders} in a template that this system does not know. */
export function unknownPlaceholders(template: string, allowed: readonly string[] = PLACEHOLDERS): string[] {
  const found = new Set<string>()
  for (const m of template.matchAll(/\{([^{}]*)\}/g)) {
    const key = m[1].trim().toLowerCase()
    if (!allowed.includes(key)) found.add(m[1].trim() || '(empty)')
  }
  return [...found]
}

/** Emoji and pictographs. They push a text from 160 characters a part down to 70, and look unprofessional. */
export const hasEmoji = (text: string): boolean => /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(text)

export interface Rendered { text: string; missing: string[] }

/** Fills a template. A value that is blank falls back to a plain word, and the blank is reported so a preview can say so. */
export function renderTemplate(template: string, vars: Record<string, string | undefined | null>): Rendered {
  const missing: string[] = []
  let text = template.replace(/\{([^{}]*)\}/g, (whole, raw: string) => {
    const key = raw.trim().toLowerCase()
    if (!(key in FALLBACKS)) return whole
    const value = String(vars[key] ?? '')
    if (value.trim()) return value
    missing.push(key)
    return FALLBACKS[key]
  })
  text = text
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([.,!?;:])/g, '$1')
    .replace(/ *\n */g, '\n')
    .trim()
  return { text, missing: [...new Set(missing)] }
}

const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/

/** How many text-message parts a body costs. */
export function smsSegments(text: string): { chars: number; parts: number } {
  const chars = [...text].length
  if (!chars) return { chars, parts: 0 }
  const plain = GSM.test(text)
  const single = plain ? 160 : 70
  const multi = plain ? 153 : 67
  return { chars, parts: chars <= single ? 1 : Math.ceil(chars / multi) }
}

/** Problems with a message template, in plain words. Empty when it is fine to use. */
export function templateProblems(template: string, opts: { klass: MessageClass; channel: Channel; required?: readonly string[] }): string[] {
  const out: string[] = []
  const t = template.trim()
  if (!t) return ['Write the message first.']
  if (t.length > 1000) out.push('Keep the message under 1,000 characters.')
  const unknown = unknownPlaceholders(t)
  if (unknown.length) out.push(`These placeholders are not known: ${unknown.map(u => `{${u}}`).join(', ')}.`)
  if (hasEmoji(t)) out.push('Remove the emoji. They make texts cost more and look less professional.')
  for (const key of opts.required || []) {
    if (!new RegExp(`\\{${key}\\}`, 'i').test(t)) out.push(`The message needs {${key}} in it.`)
  }
  if (opts.channel === 'sms') {
    const { parts } = smsSegments(addOptOut(t.replace(/\{[^{}]*\}/g, 'xxxxxxxxxxxx')))
    if (parts > 3) out.push('This is long for a text. Shorten it to three parts or fewer.')
  }
  return out
}

/**
 * Money, discounts and promises in a draft that the owner never supplied. Used on anything an AI writes:
 * it may not invent an offer, a price or a guarantee. Returns the offending phrases.
 */
export function unsupportedClaims(draft: string, ...facts: string[]): string[] {
  const allowed = facts.join(' ').toLowerCase()
  const found: string[] = []
  const rules: Array<[RegExp, string]> = [
    [/\$\s?\d[\d,.]*/g, 'a dollar amount'],
    [/\b\d{1,3}\s?%/g, 'a percentage'],
    [/\b(free|complimentary|no charge)\b/gi, 'a free offer'],
    [/\b(guarantee[ds]?|lifetime|warrant(?:y|ies)|best price|lowest price|cheapest|price match)\b/gi, 'a guarantee or price claim'],
    [/\b(same[- ]day|while you wait|open (?:24|late|sundays?))\b/gi, 'a promise about timing or hours'],
    [/\b(certified|licensed|accredited|award[- ]winning|family[- ]owned|\d+\+?\s?years?|since (?:19|20)\d{2}|number one|best in (?:town|the city|houston))\b/gi, 'a credential or experience claim'],
  ]
  for (const [re, label] of rules) {
    for (const m of draft.matchAll(re)) {
      const phrase = m[0].trim()
      if (!allowed.includes(phrase.toLowerCase())) found.push(`${label} ("${phrase}")`)
    }
  }
  return [...new Set(found)]
}

// ── Who can be messaged ───────────────────────────────────────────────────

export type SkipReason =
  | 'no_phone'
  | 'no_email'
  | 'opted_out'
  | 'email_opted_out'
  | 'email_not_set_up'
  | 'duplicate_number'
  | 'already_sent'
  | 'frequency_cap'
  | 'monthly_cap'
  | 'daily_cap'
  | 'not_ready'
  | 'run_limit'
  | 'unhappy_customer'
  | 'no_review_link'
  | 'paused'
  | 'edited'
  | 'cancelled_by_you'
  | 'master_off'
  | 'template_problem'
  | 'came_back'

const SKIP_WORDS: Record<SkipReason, string> = {
  no_phone: 'No phone number on file',
  no_email: 'No email address on file',
  opted_out: 'Replied STOP, so no texts',
  email_opted_out: 'Unsubscribed from emails',
  email_not_set_up: 'Email is not set up in Settings',
  duplicate_number: 'Shares a number with someone already on this list',
  already_sent: 'Already got this message',
  frequency_cap: 'Texted too recently',
  monthly_cap: 'Already got the most marketing texts allowed this month',
  daily_cap: 'Already got the most texts allowed today',
  not_ready: 'Not yet time to send',
  run_limit: 'Held for the next run (limit per run)',
  unhappy_customer: 'Marked unhappy, so no review request',
  no_review_link: 'No Google review link in settings',
  paused: 'Automation was paused',
  edited: 'The message was edited, so it will be rebuilt',
  cancelled_by_you: 'Cancelled by you',
  master_off: 'All automations were switched off',
  template_problem: 'The message needs fixing',
  came_back: 'Came back in before this went out, so no reminder was needed',
}

export const skipWords = (reason: string): string => SKIP_WORDS[reason as SkipReason] || 'Skipped'

export interface Candidate {
  automationId: string
  klass: MessageClass
  channel: Channel
  customerId?: string | null
  name: string
  phone?: string | null
  email?: string | null
  /** What this message is about, e.g. document / appointment / vehicle. */
  sourceType: string
  sourceId: string
  /** One message per value. Same value again means "already sent". */
  dedupeKey: string
  vars: Record<string, string>
  /** Why this person is on the list, in plain words. */
  why: string
  smsOptedOut?: boolean
  emailOptedOut?: boolean
  /** Earliest moment to send (for example, two hours after a job is paid). */
  eligibleAt?: number
  /** Skip with this reason instead of sending (decided while finding candidates). */
  blockedBy?: SkipReason
  /** Reminders tied to a time are never held back by the per-customer text limits. */
  exemptFromLimits?: boolean
}

export interface RecentSend {
  customerId?: string | null
  phone?: string | null
  email?: string | null
  automationId: string
  klass: MessageClass
  at: number
}

export interface Decision {
  candidate: Candidate
  action: 'send' | 'skip' | 'later'
  reason?: SkipReason
  /** When it will actually go out. Later than eligibleAt when quiet hours push it. */
  sendAfter: number
  /** True when quiet hours moved it. */
  heldForQuietHours: boolean
  to: string
  text: string
  subject?: string
  parts: number
  notes: string[]
}

export interface DecideContext {
  now: number
  shopTimeZone: string
  rules: ShopRules
  template: string
  subject?: string
  recent: RecentSend[]
  /** Dedupe keys that already exist for this shop (anything sent or still queued). */
  existingKeys: ReadonlySet<string>
  /** Days between messages of this one automation to the same customer. 0 means no extra limit. */
  capDays?: number
  maxPerRun?: number
  /** Do not send before this time (a scheduled promotion). Quiet hours still apply after it. */
  notBefore?: number
  /** Skip the quiet-hours delay (tests and "send now" never use this; only in-person test sends). */
  ignoreQuietHours?: boolean
}

const recentMatches = (r: RecentSend, c: Candidate): boolean => {
  if (c.customerId && r.customerId && c.customerId === r.customerId) return true
  if (c.phone && r.phone && hasUsablePhone(c.phone) && phoneKey(c.phone) === phoneKey(r.phone)) return true
  if (c.email && r.email && c.email.trim().toLowerCase() === r.email.trim().toLowerCase()) return true
  return false
}

/** Why the per-customer limits say no, or null when this message may go. */
export function limitReason(c: Candidate, recent: readonly RecentSend[], rules: ShopRules, now: number, capDays = 0): SkipReason | null {
  if (c.exemptFromLimits) return null
  const mine = recent.filter(r => recentMatches(r, c))
  if (capDays > 0 && mine.some(r => r.automationId === c.automationId && now - r.at < capDays * DAY)) return 'frequency_cap'
  if (c.klass === 'marketing') {
    const marketing = mine.filter(r => r.klass === 'marketing')
    if (marketing.some(r => now - r.at < rules.marketing_cap_days * DAY)) return 'frequency_cap'
    if (marketing.filter(r => now - r.at < 30 * DAY).length >= rules.marketing_monthly_max) return 'monthly_cap'
  } else {
    if (mine.filter(r => r.klass === 'service' && now - r.at < DAY).length >= rules.service_daily_max) return 'daily_cap'
  }
  return null
}

/**
 * The whole decision for a list of candidates: send, skip (with the reason), or leave for the next run.
 * The server uses this to queue messages and the preview screen shows the same answer, so what you see
 * is what will happen. Nothing here touches a database or sends anything.
 */
export function decide(candidates: readonly Candidate[], ctx: DecideContext): Decision[] {
  const out: Decision[] = []
  const window = windowFromRules(ctx.rules)
  const seenDest = new Set<string>()
  const seenKeys = new Set<string>()
  const sentThisBatch: RecentSend[] = []
  let queued = 0

  for (const c of candidates) {
    const base: Decision = {
      candidate: c,
      action: 'send',
      sendAfter: ctx.now,
      heldForQuietHours: false,
      to: c.channel === 'sms' ? String(c.phone ?? '') : String(c.email ?? '').trim(),
      text: '',
      parts: 0,
      notes: [],
    }
    const skip = (reason: SkipReason): void => { out.push({ ...base, action: 'skip', reason }) }

    if (c.blockedBy) { skip(c.blockedBy); continue }
    if (c.channel === 'sms') {
      if (!hasUsablePhone(c.phone)) { skip('no_phone'); continue }
      if (c.smsOptedOut) { skip('opted_out'); continue }
    } else {
      if (!looksLikeEmail(c.email)) { skip('no_email'); continue }
      if (c.emailOptedOut) { skip('email_opted_out'); continue }
    }
    if (ctx.existingKeys.has(c.dedupeKey) || seenKeys.has(c.dedupeKey)) { skip('already_sent'); continue }
    const destKey = c.channel === 'sms' ? `s:${phoneKey(c.phone)}` : `e:${String(c.email).trim().toLowerCase()}`
    if (seenDest.has(destKey)) { skip('duplicate_number'); continue }

    const eligibleAt = Math.max(ctx.now, c.eligibleAt ?? 0, ctx.notBefore ?? 0)
    if (c.eligibleAt && c.eligibleAt > ctx.now + 5 * MIN) { out.push({ ...base, action: 'later', reason: 'not_ready', sendAfter: c.eligibleAt }); continue }

    const limited = limitReason(c, [...ctx.recent, ...sentThisBatch], ctx.rules, ctx.now, ctx.capDays || 0)
    if (limited) { skip(limited); continue }

    const rendered = renderTemplate(ctx.template, c.vars)
    const text = c.klass === 'marketing' && c.channel === 'sms' ? addOptOut(rendered.text) : rendered.text
    const notes = rendered.missing.length ? [`Left blank on file: ${rendered.missing.join(', ')}`] : []

    if (ctx.maxPerRun && queued >= ctx.maxPerRun) { out.push({ ...base, action: 'later', reason: 'run_limit', text, notes }); continue }

    const when = ctx.ignoreQuietHours
      ? new Date(eligibleAt)
      : c.channel === 'sms'
        ? earliestSend(new Date(eligibleAt), ctx.shopTimeZone, c.phone, window)
        : nextSendable(new Date(eligibleAt), ctx.shopTimeZone, window)
    const held = when.getTime() - eligibleAt > MIN

    seenDest.add(destKey)
    seenKeys.add(c.dedupeKey)
    queued += 1
    sentThisBatch.push({ customerId: c.customerId, phone: c.phone, email: c.email, automationId: c.automationId, klass: c.klass, at: ctx.now })
    out.push({
      ...base,
      action: 'send',
      sendAfter: when.getTime(),
      heldForQuietHours: held,
      text,
      subject: ctx.subject ? renderTemplate(ctx.subject, c.vars).text : undefined,
      parts: c.channel === 'sms' ? smsSegments(text).parts : 0,
      notes,
    })
  }
  return out
}

/** Counts by outcome, for the preview header. */
export function summarize(decisions: readonly Decision[]): { send: number; sendNow: number; heldForQuietHours: number; later: number; skipped: number; skippedBy: Record<string, number> } {
  const s = { send: 0, sendNow: 0, heldForQuietHours: 0, later: 0, skipped: 0, skippedBy: {} as Record<string, number> }
  for (const d of decisions) {
    if (d.action === 'send') { s.send += 1; if (d.heldForQuietHours) s.heldForQuietHours += 1; else s.sendNow += 1 }
    else if (d.action === 'later') s.later += 1
    else { s.skipped += 1; s.skippedBy[d.reason || 'skipped'] = (s.skippedBy[d.reason || 'skipped'] || 0) + 1 }
  }
  return s
}

// ── Retry rules ───────────────────────────────────────────────────────────

export const MAX_ATTEMPTS = 3
const RETRY_DELAYS = [5 * MIN, 30 * MIN, 2 * HOUR]

/** How long to wait before trying again after the Nth failed attempt. */
export const retryDelayMs = (attempts: number): number => RETRY_DELAYS[Math.min(Math.max(attempts, 1), RETRY_DELAYS.length) - 1]

export type FailureKind = 'permanent' | 'setup' | 'transient'

/**
 * Sorts a send error: a bad number will never work (permanent), missing credentials or carrier registration
 * need the owner (setup), anything else is worth trying again (transient).
 */
export function classifyFailure(error: string): FailureKind {
  const e = error.toLowerCase()
  if (/not configured|credentials|api key|unauthori[sz]ed|forbidden|10dlc|not registered|unregistered|campaign|messaging profile|verification|authenticat/.test(e)) return 'setup'
  if (/invalid|not a valid|unreachable|landline|not.*mobile|blocked|opted.?out|unsubscrib|undeliverable|no longer|malformed|bad number|does not exist/.test(e)) return 'permanent'
  return 'transient'
}

/** What the owner should do about a failure, in one plain sentence. */
export function failureAdvice(error: string): string {
  switch (classifyFailure(error)) {
    case 'setup': return 'Texting is not fully set up. Check your Telnyx key, number and carrier registration in Settings.'
    case 'permanent': return 'This number or address cannot receive the message.'
    default: return 'A temporary problem. It will try again.'
  }
}

// ── Service due by date and mileage ───────────────────────────────────────

export interface ServiceRule {
  key: string
  label: string
  /** Matches the words on an invoice line. */
  pattern: string
  everyDays: number
  everyMiles: number
}

export const DEFAULT_SERVICE_RULES: ServiceRule[] = [
  { key: 'oil_change', label: 'oil change', pattern: 'oil.?change|oil (?:and|&) filter', everyDays: 90, everyMiles: 3000 },
  { key: 'tire_rotation', label: 'tire rotation', pattern: 'tire.?rotat|rotate.*tires?', everyDays: 180, everyMiles: 6000 },
]

/**
 * Other jobs a shop can ask to be reminded about, each switched on separately. The intervals are common shop schedules
 * and are only a starting point. A rule with 0 miles is by date only (a yearly inspection has no mileage).
 */
export const EXTRA_SERVICE_RULES: Array<ServiceRule & { setting: string; help: string }> = [
  { key: 'state_inspection', setting: 'svc_state_inspection', label: 'state inspection', pattern: 'state.?inspection|vehicle inspection|safety inspection|emissions? (?:test|inspection)', everyDays: 365, everyMiles: 0, help: 'Every 12 months, by date only.' },
  { key: 'brake_inspection', setting: 'svc_brake_inspection', label: 'brake inspection', pattern: 'brake (?:inspection|check|service)|brake pads?|brake rotors?', everyDays: 365, everyMiles: 12000, help: 'Every 12 months or 12,000 miles.' },
  { key: 'coolant_flush', setting: 'svc_coolant', label: 'coolant flush', pattern: 'coolant|radiator (?:flush|service)|antifreeze', everyDays: 730, everyMiles: 30000, help: 'Every 24 months or 30,000 miles.' },
  { key: 'transmission_service', setting: 'svc_transmission', label: 'transmission service', pattern: 'transmission (?:fluid|service|flush)|trans(?:mission)? filter', everyDays: 730, everyMiles: 30000, help: 'Every 24 months or 30,000 miles.' },
  { key: 'air_filter', setting: 'svc_air_filter', label: 'air filter replacement', pattern: '(?:cabin|engine|air) (?:air )?filter', everyDays: 365, everyMiles: 15000, help: 'Every 12 months or 15,000 miles.' },
  { key: 'alignment', setting: 'svc_alignment', label: 'wheel alignment', pattern: 'alignment', everyDays: 365, everyMiles: 12000, help: 'Every 12 months or 12,000 miles.' },
]

export interface ServiceDue {
  due: boolean
  daysSince: number
  milesSince: number | null
  /** The plain-words reason, e.g. "98 days since the last oil change". Empty when not due. */
  reason: string
  basis: 'date' | 'mileage' | 'both' | null
}

export const parseMiles = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** Is a vehicle due for a service? Looks at days since the last one and, when both readings are known, miles since. */
export function serviceDue(input: {
  rule: ServiceRule
  lastServiceAt: number
  lastServiceMiles: number | null
  currentMiles: number | null
  now: number
  leadDays: number
  leadMiles: number
}): ServiceDue {
  const daysSince = Math.floor((input.now - input.lastServiceAt) / DAY)
  const milesSince = input.lastServiceMiles !== null && input.currentMiles !== null && input.currentMiles >= input.lastServiceMiles
    ? input.currentMiles - input.lastServiceMiles
    : null
  const byDate = daysSince >= input.rule.everyDays - input.leadDays
  const byMiles = milesSince !== null && input.rule.everyMiles > 0 && milesSince >= input.rule.everyMiles - input.leadMiles
  const basis = byDate && byMiles ? 'both' : byDate ? 'date' : byMiles ? 'mileage' : null
  const parts: string[] = []
  if (byDate) parts.push(`${daysSince} days since the last ${input.rule.label}`)
  if (byMiles && milesSince !== null) parts.push(`${milesSince.toLocaleString('en-US')} miles since the last ${input.rule.label}`)
  return { due: basis !== null, daysSince, milesSince, reason: parts.join(' and '), basis }
}

// ── What it brought in ────────────────────────────────────────────────────

export interface SentRecord {
  id: string
  customerId?: string | null
  phone?: string | null
  email?: string | null
  automationId: string
  at: number
  /** Results are counted under this name when set (a one-off promotion), otherwise under the automation. */
  group?: string
  /** The carrier confirmed the text reached the phone. */
  delivered?: boolean
}
export interface TimedEvent { customerId?: string | null; phone?: string | null; at: number }
export interface MoneyEvent extends TimedEvent { amount: number }

export interface Outcome {
  sent: number
  /** Texts the carrier confirmed reached the phone. Zero when delivery notices are not coming in yet. */
  delivered: number
  replied: number
  booked: number
  revenue: number
}

export const emptyOutcome = (): Outcome => ({ sent: 0, delivered: 0, replied: 0, booked: 0, revenue: 0 })

/**
 * Credit what customers did after a message. Each reply, booking or payment is credited to the most recent
 * message that customer got before it, once, inside the window, so one dollar never counts for two automations.
 * `moneyFrom` lists the automations that can claim bookings and revenue; reminders and review requests do not.
 */
export function attribute(
  sent: readonly SentRecord[],
  events: { replies: readonly TimedEvent[]; bookings: readonly TimedEvent[]; payments: readonly MoneyEvent[] },
  opts: { replyDays?: number; bookDays?: number; revenueDays?: number; moneyFrom: ReadonlySet<string> },
): Record<string, Outcome> {
  const out: Record<string, Outcome> = {}
  const keyOf = (s: SentRecord): string => s.group || s.automationId
  for (const s of sent) {
    const o = (out[keyOf(s)] ||= emptyOutcome())
    o.sent += 1
    if (s.delivered) o.delivered += 1
  }
  const matches = (s: SentRecord, e: TimedEvent): boolean => {
    if (s.customerId && e.customerId && s.customerId === e.customerId) return true
    return Boolean(s.phone && e.phone && hasUsablePhone(s.phone) && phoneKey(s.phone) === phoneKey(e.phone))
  }
  const lastBefore = (e: TimedEvent, windowMs: number, only?: ReadonlySet<string>): SentRecord | null => {
    let best: SentRecord | null = null
    for (const s of sent) {
      if (only && !only.has(s.automationId)) continue
      if (s.at > e.at || e.at - s.at > windowMs || !matches(s, e)) continue
      if (!best || s.at > best.at) best = s
    }
    return best
  }
  const repliedBy = new Set<string>()
  for (const r of events.replies) {
    const s = lastBefore(r, (opts.replyDays ?? 7) * DAY)
    if (s && !repliedBy.has(s.id)) { repliedBy.add(s.id); out[keyOf(s)].replied += 1 }
  }
  const bookedBy = new Set<string>()
  for (const b of events.bookings) {
    const s = lastBefore(b, (opts.bookDays ?? 14) * DAY, opts.moneyFrom)
    if (s && !bookedBy.has(s.id)) { bookedBy.add(s.id); out[keyOf(s)].booked += 1 }
  }
  for (const p of events.payments) {
    const s = lastBefore(p, (opts.revenueDays ?? 30) * DAY, opts.moneyFrom)
    if (s) out[keyOf(s)].revenue += p.amount
  }
  for (const o of Object.values(out)) o.revenue = Math.round(o.revenue * 100) / 100
  return out
}
