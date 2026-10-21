// The automation library: what each automation is, what the owner can set, and how it finds the people to message.
// Pure. Each automation looks at rows the server already loaded and returns candidates; automation-rules.ts
// decides which of them actually get a message. Nothing here reads a database or sends anything.

import {
  DEFAULT_SERVICE_RULES,
  EXTRA_SERVICE_RULES,
  firstName,
  hasUsablePhone,
  looksLikeEmail,
  parseMiles,
  prettyPhone,
  serviceDue,
  type Candidate,
  type Channel,
  type MessageClass,
  type ServiceRule,
} from './automation-rules.ts'
import { getWallClock, isValidSchedule, zonedTimeToUtc } from './schedules.ts'
import { buildPeople, matchAudience, normalizeFilters } from './growth-audience.ts'

export type Row = Record<string, any>

const HOUR = 3_600_000
const DAY = 86_400_000

export type Category = 'reminders' | 'followups' | 'reviews' | 'marketing' | 'leads'

export const CATEGORY_WORDS: Record<Category, string> = {
  reminders: 'Reminders',
  followups: 'Follow-ups',
  reviews: 'Reviews',
  marketing: 'Marketing',
  leads: 'Finding new customers',
}

export interface FieldSpec {
  key: string
  label: string
  type: 'number' | 'text' | 'textarea' | 'boolean' | 'select'
  default: unknown
  min?: number
  max?: number
  unit?: string
  help?: string
  options?: string[]
}

export type DataNeed = 'customers' | 'documents' | 'jobs' | 'appointments' | 'vehicles' | 'dvi' | 'growth_leads' | 'leads'
export type Raw = Record<DataNeed, Row[]>

export interface RunContext {
  now: number
  timeZone: string
  shopName: string
  shopPhone: string
  reviewUrl: string
  emailReady: boolean
  /** When the automation was switched on. Messages about things older than this are left alone where it matters. */
  enabledAt: number | null
  /** Different for every scheduled run; used to let a recurring promotion go to the same person each run. */
  windowKey: string
}

export interface AutomationDef {
  id: string
  name: string
  /** One plain sentence for the card. */
  blurb: string
  /** "When" the automation acts, for the card. */
  trigger: string
  category: Category
  icon: string
  kind: 'engine' | 'legacy'
  klass: MessageClass
  channel: Channel
  /** May fall back to email when there is no phone number. */
  emailFallback?: boolean
  /** Default schedule text. */
  schedule: string
  /** May claim bookings and revenue in the results. */
  claimsRevenue: boolean
  /** Not held back by per-customer text limits (they are tied to a time). */
  exemptFromLimits?: boolean
  /** The message the owner starts from. The owner must write one when this is empty. */
  template: string
  emailSubject?: string
  /** Placeholders that make sense for this automation, shown as chips in the editor. */
  placeholders: string[]
  fields: FieldSpec[]
  needs: DataNeed[]
  /** Days between messages of this automation to one customer. */
  capDays: number
  /** Most people per run to start with. 50 when not set. */
  defaultMaxPerRun?: number
  /** What each person gets, in plain words, for the card. */
  detail: string[]
  find?: (raw: Raw, cfg: Record<string, any>, ctx: RunContext) => Candidate[]
  legacy?: { endpoint: string; body: Record<string, unknown> }
  /** Anything stopping this from running at all, in words. Null when ready. */
  setupProblem?: (ctx: RunContext, cfg: Record<string, any>) => string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────

const ts = (v: unknown): number | null => {
  if (!v) return null
  const t = new Date(String(v)).getTime()
  return Number.isFinite(t) ? t : null
}

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback
}

const byId = (rows: readonly Row[]): Map<string, Row> => new Map(rows.map(r => [String(r.id), r]))

const vehicleOf = (r: Row): string => [r.vehicle_year ?? r.year, r.vehicle_make ?? r.make, r.vehicle_model ?? r.model]
  .map(v => String(v ?? '').trim()).filter(Boolean).join(' ')

const contactLine = (shopPhone: string, channel: Channel): string => {
  const how = channel === 'email' ? 'reply to this email' : 'reply to this text'
  return shopPhone.trim() ? `Call ${prettyPhone(shopPhone)} or ${how}` : `${how.charAt(0).toUpperCase()}${how.slice(1)}`
}

const money = (v: unknown): string => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''
}

const listWords = (items: string[]): string => (
  items.length <= 1 ? items.join('') : items.length === 2 ? `${items[0]} and ${items[1]}` : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
)

interface Contact { id: string | null; name: string; phone: string; email: string; smsOptedOut: boolean; unhappy: boolean }

function contactFor(customer: Row | undefined, doc?: Row): Contact {
  const sentiment = String(customer?.sentiment ?? '').toLowerCase()
  return {
    id: customer ? String(customer.id) : doc?.customer_id ? String(doc.customer_id) : null,
    name: String(customer?.name || doc?.customer_name || 'there'),
    phone: String(customer?.phone || doc?.customer_phone || ''),
    email: String(customer?.email || doc?.customer_email || ''),
    smsOptedOut: customer?.sms_opted_out === true,
    unhappy: sentiment === 'unhappy' || sentiment === 'at-risk',
  }
}

function pickChannel(def: AutomationDef, who: Contact): Channel {
  if (def.emailFallback && !hasUsablePhone(who.phone) && looksLikeEmail(who.email)) return 'email'
  return def.channel
}

function candidate(def: AutomationDef, ctx: RunContext, who: Contact, extra: {
  sourceType: string
  sourceId: string
  dedupeKey: string
  why: string
  vars?: Record<string, string>
  eligibleAt?: number
  blockedBy?: Candidate['blockedBy']
}): Candidate {
  const channel = pickChannel(def, who)
  const blocked = extra.blockedBy || (channel === 'email' && !ctx.emailReady ? 'email_not_set_up' : undefined)
  return {
    automationId: def.id,
    klass: def.klass,
    channel,
    customerId: who.id,
    name: who.name,
    phone: who.phone || null,
    email: who.email || null,
    sourceType: extra.sourceType,
    sourceId: extra.sourceId,
    dedupeKey: extra.dedupeKey,
    why: extra.why,
    smsOptedOut: who.smsOptedOut,
    eligibleAt: extra.eligibleAt,
    blockedBy: blocked,
    exemptFromLimits: def.exemptFromLimits,
    vars: {
      name: firstName(who.name),
      shop: ctx.shopName,
      shop_phone: ctx.shopPhone ? prettyPhone(ctx.shopPhone) : '',
      contact: contactLine(ctx.shopPhone, channel),
      review_link: ctx.reviewUrl,
      ...extra.vars,
    },
  }
}

/** "tomorrow at 9:30 AM", "today at 2:00 PM", or "Thursday, Oct 16 at 9:30 AM", in the shop's own clock. */
export function whenWords(startMs: number, nowMs: number, timeZone: string): string {
  const day = (ms: number) => { const w = getWallClock(new Date(ms), timeZone); return Date.UTC(w.year, w.month - 1, w.day) }
  const diff = Math.round((day(startMs) - day(nowMs)) / DAY)
  const clock = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(startMs))
  if (diff === 0) return `today at ${clock}`
  if (diff === 1) return `tomorrow at ${clock}`
  const date = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(startMs))
  return `${date} at ${clock}`
}

/** When an appointment starts, from the date and the time typed on it. No time means 9:00 in the morning. */
export function appointmentStart(date: unknown, time: unknown, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date ?? ''))
  if (!m) return null
  let hour = 9
  let minute = 0
  const t = String(time ?? '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i)
  if (t) {
    hour = Number(t[1])
    minute = Number(t[2] || 0)
    const ap = t[3]?.toLowerCase()
    if (ap === 'pm' && hour < 12) hour += 12
    else if (ap === 'am' && hour === 12) hour = 0
    else if (!ap && hour >= 1 && hour <= 6) hour += 12
    if (hour > 23 || minute > 59) return null
  }
  return zonedTimeToUtc({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour, minute }, timeZone).getTime()
}

const isInvoiceLike = (d: Row): boolean => (d.type === 'Invoice' || d.type === 'Receipt') && d.status !== 'Void'

const lineNames = (d: Row): string[] => {
  const lines = [
    ...(Array.isArray(d.labors) ? d.labors : []),
    ...(Array.isArray(d.line_items) ? d.line_items : []),
  ]
  return lines.map((l: Row) => String(l?.operation || l?.description || l?.name || '').trim()).filter(Boolean)
}

const invoicedJobs = (docs: readonly Row[]): Set<string> => new Set(docs.filter(d => isInvoiceLike(d) && d.job_id).map(d => String(d.job_id)))

const todayIn = (ms: number, tz: string): string => {
  const w = getWallClock(new Date(ms), tz)
  return `${w.year}-${String(w.month).padStart(2, '0')}-${String(w.day).padStart(2, '0')}`
}

const vehicleKey = (customerId: unknown, vin: unknown, y: unknown, mk: unknown, md: unknown): string => (
  [customerId, vin, y, mk, md].map(v => String(v ?? '').trim().toLowerCase()).join('|')
)

// ── Finders ───────────────────────────────────────────────────────────────

function findReviewRequests(raw: Raw, cfg: Record<string, any>, ctx: RunContext): Candidate[] {
  const def = CATALOG_BY_ID.review_requests
  const lookback = num(cfg.lookback_days, 3) * DAY
  const delay = num(cfg.delay_hours, 2) * HOUR
  const customers = byId(raw.customers)
  const out: Candidate[] = []
  for (const d of raw.documents) {
    if (!isInvoiceLike(d)) continue
    if (!(d.status === 'Paid' || d.type === 'Receipt')) continue
    const paidAt = ts(d.updated_at) ?? ts(d.created_at)
    if (paidAt === null || paidAt < ctx.now - lookback) continue
    const who = contactFor(d.customer_id ? customers.get(String(d.customer_id)) : undefined, d)
    out.push(candidate(def, ctx, who, {
      sourceType: 'document',
      sourceId: String(d.id),
      dedupeKey: `review_requests:${d.id}`,
      why: `Paid ${d.doc_number ? `${d.type.toLowerCase()} ${d.doc_number}` : 'invoice'} on ${todayIn(paidAt, ctx.timeZone)}`,
      eligibleAt: paidAt + delay,
      blockedBy: !ctx.reviewUrl ? 'no_review_link' : who.unhappy ? 'unhappy_customer' : undefined,
      vars: { vehicle: vehicleOf(d) },
    }))
  }
  return out.sort((a, b) => (a.eligibleAt ?? 0) - (b.eligibleAt ?? 0))
}

function findEstimateFollowups(raw: Raw, cfg: Record<string, any>, ctx: RunContext): Candidate[] {
  const def = CATALOG_BY_ID.estimate_followups
  const wait = num(cfg.followup_hours, 48) * HOUR
  const maxAge = num(cfg.max_age_days, 14) * DAY
  const customers = byId(raw.customers)
  const done = invoicedJobs(raw.documents)
  const today = todayIn(ctx.now, ctx.timeZone)
  const out: Candidate[] = []
  for (const d of raw.documents) {
    if (d.type !== 'Estimate' || d.status !== 'Sent') continue
    if (d.job_id && done.has(String(d.job_id))) continue
    if (d.expires_date && String(d.expires_date).slice(0, 10) < today) continue
    const sentAt = ts(d.sent_at) ?? ts(d.created_at)
    if (sentAt === null || sentAt < ctx.now - maxAge) continue
    const who = contactFor(d.customer_id ? customers.get(String(d.customer_id)) : undefined, d)
    out.push(candidate(def, ctx, who, {
      sourceType: 'document',
      sourceId: String(d.id),
      dedupeKey: `estimate_followups:${d.id}`,
      why: `Estimate ${d.doc_number || ''} sent ${todayIn(sentAt, ctx.timeZone)}, not answered yet`.replace('  ', ' '),
      eligibleAt: sentAt + wait,
      vars: { vehicle: vehicleOf(d), amount: money(d.__total) },
    }))
  }
  return out.sort((a, b) => (a.eligibleAt ?? 0) - (b.eligibleAt ?? 0))
}

function findDeclinedWork(raw: Raw, cfg: Record<string, any>, ctx: RunContext): Candidate[] {
  const def = CATALOG_BY_ID.declined_work
  const after = num(cfg.after_days, 30) * DAY
  const maxAge = num(cfg.max_age_days, 180) * DAY
  const customers = byId(raw.customers)
  const done = invoicedJobs(raw.documents)
  const out: Candidate[] = []
  for (const d of raw.documents) {
    if (d.type !== 'Estimate' || d.status !== 'Sent') continue
    if (d.job_id && done.has(String(d.job_id))) continue
    const sentAt = ts(d.sent_at) ?? ts(d.created_at)
    if (sentAt === null || sentAt > ctx.now - after || sentAt < ctx.now - maxAge) continue
    const who = contactFor(d.customer_id ? customers.get(String(d.customer_id)) : undefined, d)
    const names = [...new Set(lineNames(d))].slice(0, 3)
    out.push(candidate(def, ctx, who, {
      sourceType: 'document',
      sourceId: String(d.id),
      dedupeKey: `declined_work:est:${d.id}`,
      why: `Estimate ${d.doc_number || ''} was never approved (${Math.floor((ctx.now - sentAt) / DAY)} days ago)`.replace('  ', ' '),
      vars: { vehicle: vehicleOf(d), items: listWords(names), amount: money(d.__total) },
    }))
  }
  for (const i of raw.dvi) {
    const names: string[] = Array.isArray(i.declinedNames) ? i.declinedNames.map((n: unknown) => String(n)).filter(Boolean) : []
    const decidedAt = ts(i.customer_decided_at) ?? ts(i.updated_at) ?? ts(i.created_at)
    if (!names.length || decidedAt === null || decidedAt > ctx.now - after || decidedAt < ctx.now - maxAge) continue
    const who = contactFor(i.customer_id ? customers.get(String(i.customer_id)) : undefined, { customer_name: i.customer_name })
    out.push(candidate(def, ctx, who, {
      sourceType: 'inspection',
      sourceId: String(i.id),
      dedupeKey: `declined_work:dvi:${i.id}`,
      why: `Said no to ${listWords(names.slice(0, 3))} on the inspection`,
      vars: { vehicle: String(i.vehicle || ''), items: listWords(names.slice(0, 3)) },
    }))
  }
  return out
}

function findServiceReminders(raw: Raw, cfg: Record<string, any>, ctx: RunContext): Candidate[] {
  const def = CATALOG_BY_ID.service_reminders
  const rules: ServiceRule[] = [
    ...DEFAULT_SERVICE_RULES
      .filter(r => r.key === 'oil_change' || cfg.tire_rotation === true)
      .map(r => r.key === 'oil_change'
        ? { ...r, everyDays: num(cfg.interval_days, r.everyDays), everyMiles: num(cfg.interval_miles, r.everyMiles) }
        : { ...r, everyDays: num(cfg.tire_interval_days, r.everyDays), everyMiles: num(cfg.tire_interval_miles, r.everyMiles) }),
    ...EXTRA_SERVICE_RULES.filter(r => cfg[r.setting] === true),
  ]
  const leadDays = num(cfg.lead_days, 7)
  const leadMiles = num(cfg.lead_miles, 300)
  const maxOverdue = num(cfg.max_overdue_days, 365)
  const customers = byId(raw.customers)

  // Newest invoice that mentions each service, per vehicle and per customer.
  const lastBy = new Map<string, Map<string, { at: number; miles: number | null }>>()
  const newestMiles = new Map<string, { at: number; miles: number }>()
  const docs = raw.documents.filter(isInvoiceLike)
    .map(d => ({ d, at: ts(d.doc_date) ?? ts(d.created_at) }))
    .filter((x): x is { d: Row; at: number } => x.at !== null)
    .sort((a, b) => b.at - a.at)
  for (const { d, at } of docs) {
    if (!d.customer_id) continue
    const keys = [vehicleKey(d.customer_id, d.vehicle_vin, d.vehicle_year, d.vehicle_make, d.vehicle_model), vehicleKey(d.customer_id, '', '', '', '')]
    const miles = parseMiles(d.vehicle_mileage)
    const text = [...lineNames(d), ...(Array.isArray(d.parts) ? d.parts : []).map((p: Row) => String(p?.name || p?.description || ''))].join(' | ')
    for (const key of keys) {
      if (miles !== null && !newestMiles.has(key)) newestMiles.set(key, { at, miles })
      for (const rule of rules) {
        if (!new RegExp(rule.pattern, 'i').test(text)) continue
        const map = lastBy.get(key) || new Map()
        if (!map.has(rule.key)) map.set(rule.key, { at, miles })
        lastBy.set(key, map)
      }
    }
  }

  const out: Candidate[] = []
  for (const v of raw.vehicles) {
    const customer = v.customer_id ? customers.get(String(v.customer_id)) : undefined
    if (!customer) continue
    const keys = [vehicleKey(v.customer_id, v.vin, v.year, v.make, v.model), vehicleKey(v.customer_id, '', '', '', '')]
    const key = keys.find(k => lastBy.has(k))
    if (!key) continue
    const history = lastBy.get(key) as Map<string, { at: number; miles: number | null }>
    const currentMiles = Math.max(parseMiles(v.current_mileage) ?? 0, newestMiles.get(key)?.miles ?? 0) || null
    let best: { rule: ServiceRule; at: number; due: ReturnType<typeof serviceDue>; overdue: number } | null = null
    for (const rule of rules) {
      const last = history.get(rule.key)
      if (!last) continue
      const lastMiles = last.miles ?? (rule.key === 'oil_change' ? parseMiles(v.last_oil_change_mileage) : null)
      const due = serviceDue({ rule, lastServiceAt: last.at, lastServiceMiles: lastMiles, currentMiles, now: ctx.now, leadDays, leadMiles })
      if (!due.due || due.daysSince > maxOverdue) continue
      const overdue = due.daysSince / rule.everyDays
      if (!best || overdue > best.overdue) best = { rule, at: last.at, due, overdue }
    }
    if (!best) continue
    const who = contactFor(customer)
    out.push(candidate(def, ctx, who, {
      sourceType: 'vehicle',
      sourceId: String(v.id),
      dedupeKey: `service_reminders:${v.id}:${best.rule.key}:${todayIn(best.at, ctx.timeZone)}`,
      why: best.due.reason.charAt(0).toUpperCase() + best.due.reason.slice(1),
      vars: { vehicle: vehicleOf(v), service: best.rule.label },
    }))
  }
  return out
}

function findCarReady(raw: Raw, cfg: Record<string, any>, ctx: RunContext): Candidate[] {
  const def = CATALOG_BY_ID.car_ready
  const lookback = num(cfg.lookback_hours, 48) * HOUR
  const since = Math.max(ctx.now - lookback, ctx.enabledAt ?? 0)
  const customers = byId(raw.customers)
  const out: Candidate[] = []
  for (const j of raw.jobs) {
    if (j.status !== 'Ready for Pickup') continue
    const readyAt = ts(j.updated_at)
    if (readyAt === null || readyAt < since) continue
    const who = contactFor(j.customer_id ? customers.get(String(j.customer_id)) : undefined, j)
    out.push(candidate(def, ctx, who, {
      sourceType: 'job',
      sourceId: String(j.id),
      dedupeKey: `car_ready:${j.id}`,
      why: 'Job moved to Ready for pickup',
      vars: { vehicle: vehicleOf(j) },
    }))
  }
  return out
}

function findAppointmentReminders(raw: Raw, cfg: Record<string, any>, ctx: RunContext): Candidate[] {
  const def = CATALOG_BY_ID.appointment_reminders
  const before = num(cfg.reminder_hours_before, 24) * HOUR
  const customers = byId(raw.customers)
  const out: Candidate[] = []
  for (const a of raw.appointments) {
    if (!['Scheduled', 'Confirmed'].includes(String(a.status)) || a.reminder_sent_at) continue
    const start = appointmentStart(a.date, a.time, ctx.timeZone)
    if (start === null || start < ctx.now + 90 * 60_000 || start > ctx.now + before) continue
    const customer = a.customer_id ? customers.get(String(a.customer_id)) : undefined
    const who = contactFor(customer, { customer_name: a.customer_name, customer_phone: a.phone })
    if (!who.phone && a.phone) who.phone = String(a.phone)
    out.push(candidate(def, ctx, who, {
      sourceType: 'appointment',
      sourceId: String(a.id),
      dedupeKey: `appointment_reminders:${a.id}`,
      why: `Appointment ${whenWords(start, ctx.now, ctx.timeZone)}`,
      eligibleAt: Math.max(ctx.now, start - before),
      vars: { date: whenWords(start, ctx.now, ctx.timeZone), service: String(a.service || ''), vehicle: String(a.vehicle || '') },
    }))
  }
  return out.sort((a, b) => (a.eligibleAt ?? 0) - (b.eligibleAt ?? 0))
}

function lastVisits(docs: readonly Row[]): Map<string, number> {
  const last = new Map<string, number>()
  for (const d of docs) {
    if (!isInvoiceLike(d) || !d.customer_id) continue
    const t = ts(d.doc_date) ?? ts(d.created_at)
    if (t !== null && (last.get(String(d.customer_id)) ?? 0) < t) last.set(String(d.customer_id), t)
  }
  return last
}

function findWinBack(raw: Raw, cfg: Record<string, any>, ctx: RunContext): Candidate[] {
  const def = CATALOG_BY_ID.re_engagement
  const months = num(cfg.months_threshold, 3)
  const maxMonths = num(cfg.max_months, 24)
  const oldest = new Date(ctx.now); oldest.setMonth(oldest.getMonth() - maxMonths)
  const newest = new Date(ctx.now); newest.setMonth(newest.getMonth() - months)
  const last = lastVisits(raw.documents)
  const out: Candidate[] = []
  for (const c of raw.customers) {
    const visit = last.get(String(c.id))
    if (visit === undefined || visit > newest.getTime() || visit < oldest.getTime()) continue
    const who = contactFor(c)
    const away = Math.max(1, Math.floor((ctx.now - visit) / (30 * DAY)))
    out.push(candidate(def, ctx, who, {
      sourceType: 'customer',
      sourceId: String(c.id),
      dedupeKey: `re_engagement:${c.id}:${todayIn(visit, ctx.timeZone)}`,
      why: `Last visit ${away} ${away === 1 ? 'month' : 'months'} ago`,
      vars: { vehicle: vehicleOf({ vehicle_year: c.vehicle_year, vehicle_make: c.vehicle_make, vehicle_model: c.vehicle_model }) },
    }))
  }
  return out.sort((a, b) => (last.get(String(a.customerId)) ?? 0) - (last.get(String(b.customerId)) ?? 0))
}

/** People who called or walked in and have not booked. Texted a couple of times, spaced out, then left alone. */
function findLeadFollowups(raw: Raw, cfg: Record<string, any>, ctx: RunContext): Candidate[] {
  const def = CATALOG_BY_ID.lead_followup
  const maxFollowUps = num(cfg.max_followups, 2)
  const gap = num(cfg.days_between, 2) * DAY
  const out: Candidate[] = []
  for (const lead of raw.growth_leads) {
    if (lead.converted === true || lead.needs_followup === false) continue
    if (['converted', 'not_interested', 'lost', 'do_not_contact'].includes(String(lead.status || '').toLowerCase())) continue
    const touches = Math.max(1, Math.floor(num(lead.touch_count, 1)))
    const doneSoFar = touches - 1
    if (doneSoFar >= maxFollowUps) continue
    const last = ts(lead.last_contact) ?? ts(lead.created_at)
    if (last === null) continue
    const who: Contact = { id: null, name: String(lead.name || 'there'), phone: String(lead.phone || ''), email: String(lead.email || ''), smsOptedOut: false, unhappy: false }
    out.push(candidate(def, ctx, who, {
      sourceType: 'growth_lead',
      sourceId: String(lead.id),
      dedupeKey: `lead_followup:${lead.id}:${touches}`,
      why: `Follow-up ${doneSoFar + 1} of ${maxFollowUps}; last contact ${todayIn(last, ctx.timeZone)}`,
      eligibleAt: last + gap,
    }))
  }
  return out.sort((a, b) => (a.eligibleAt ?? 0) - (b.eligibleAt ?? 0))
}

/** Leads Alpha found (or the shop added) that have an email address and have not been contacted yet. */
function findLeadOutreach(raw: Raw, _cfg: Record<string, any>, ctx: RunContext): Candidate[] {
  const def = CATALOG_BY_ID.lead_outreach
  const out: Candidate[] = []
  for (const lead of raw.leads) {
    const status = String(lead.status || 'new').toLowerCase()
    if (status !== 'new' || !looksLikeEmail(lead.email)) continue
    // A person's first name, or "there" for a business with no named owner. "Hi ABC," would read as a mistake.
    const person = String(lead.owner_name || (String(lead.source || '') === 'ai-social-scan' ? lead.name : '') || '').trim()
    const who: Contact = { id: null, name: person || 'there', phone: '', email: String(lead.email), smsOptedOut: false, unhappy: false }
    const found = String(lead.source || '').includes('scan') || String(lead.source || '').startsWith('ai-')
    out.push(candidate(def, ctx, who, {
      sourceType: 'lead',
      sourceId: String(lead.id),
      dedupeKey: `lead_outreach:${lead.id}`,
      why: `${lead.name ? String(lead.name) : 'A lead'}${found ? ' (found by Alpha)' : ''}`,
      vars: { service: String(lead.service_needed || '') },
    }))
  }
  return out
}

function findPromotion(raw: Raw, cfg: Record<string, any>, ctx: RunContext): Candidate[] {
  const def = CATALOG_BY_ID.sms_blast
  // A one-off promotion brings its own audience; the recurring one uses the filters saved on the card.
  const filters = normalizeFilters(cfg.audience && typeof cfg.audience === 'object' ? cfg.audience : {
    lastVisitMinDays: cfg.last_visit_min_days,
    lastVisitMaxDays: cfg.last_visit_max_days,
    minSpend: cfg.min_spend,
    tags: cfg.tags,
    tagMode: 'any',
    makes: cfg.makes,
  })
  const docs = raw.documents.filter(isInvoiceLike)
  const people = buildPeople(raw.customers, docs, raw.vehicles)
  const matched = matchAudience(people, filters, ctx.now, { consent: false }).matched
  const customers = byId(raw.customers)
  const out: Candidate[] = []
  for (const p of matched) {
    const who = contactFor(customers.get(p.id))
    out.push(candidate(def, ctx, who, {
      sourceType: 'customer',
      sourceId: p.id,
      dedupeKey: `sms_blast:${p.id}:${ctx.windowKey}`,
      why: 'On your promotion list',
    }))
  }
  return out
}

// ── The library ───────────────────────────────────────────────────────────

const COMMON_NOTE = 'Texts are never sent between your quiet hours, and anyone who replied STOP is always left out.'

const ENGINE_DEFS: AutomationDef[] = [
  {
    id: 'appointment_reminders',
    name: 'Appointment reminders',
    blurb: 'Texts customers a reminder before their booked appointment.',
    trigger: 'Before each appointment on your calendar',
    category: 'reminders',
    icon: 'calendar',
    kind: 'engine',
    klass: 'service',
    channel: 'sms',
    schedule: 'every 1 hour',
    claimsRevenue: false,
    exemptFromLimits: true,
    template: 'Hi {name}, this is a reminder from {shop} about your appointment {date}. {contact} if you need to change it.',
    placeholders: ['name', 'shop', 'date', 'service', 'contact'],
    fields: [{ key: 'reminder_hours_before', label: 'Remind them this long before', type: 'number', default: 24, min: 2, max: 72, unit: 'hours' }],
    needs: ['appointments', 'customers'],
    capDays: 0,
    detail: ['Each appointment gets one reminder, never two.', 'Not sent for appointments less than 90 minutes away.', COMMON_NOTE],
    find: findAppointmentReminders,
  },
  {
    id: 'service_reminders',
    name: 'Service due reminders',
    blurb: 'Reminds customers when an oil change or tire rotation is due by date or by miles.',
    trigger: 'When a vehicle reaches its service interval',
    category: 'reminders',
    icon: 'wrench',
    kind: 'engine',
    klass: 'service',
    channel: 'sms',
    schedule: 'Daily at 9am',
    claimsRevenue: true,
    template: 'Hi {name}, this is {shop}. Your {vehicle} is due for its {service}. {contact} to schedule.',
    placeholders: ['name', 'shop', 'vehicle', 'service', 'contact'],
    fields: [
      { key: 'interval_days', label: 'Oil change every', type: 'number', default: 90, min: 30, max: 400, unit: 'days' },
      { key: 'interval_miles', label: 'or every', type: 'number', default: 3000, min: 1000, max: 20000, unit: 'miles' },
      { key: 'tire_rotation', label: 'Also remind about tire rotations', type: 'boolean', default: false },
      { key: 'tire_interval_days', label: 'Tire rotation every', type: 'number', default: 180, min: 60, max: 730, unit: 'days' },
      { key: 'tire_interval_miles', label: 'or every', type: 'number', default: 6000, min: 2000, max: 30000, unit: 'miles' },
      ...EXTRA_SERVICE_RULES.map(r => ({ key: r.setting, label: `Also remind about ${r.label}${/(?:sh|ch|s|x)$/.test(r.label) ? 'es' : 's'}`, type: 'boolean' as const, default: false, help: r.help })),
      { key: 'lead_days', label: 'Remind this many days early', type: 'number', default: 7, min: 0, max: 60, unit: 'days' },
      { key: 'lead_miles', label: 'or this many miles early', type: 'number', default: 300, min: 0, max: 3000, unit: 'miles' },
      { key: 'max_overdue_days', label: 'Stop reminding after', type: 'number', default: 365, min: 90, max: 1500, unit: 'days since the service', help: 'After this long, win-back messages take over.' },
    ],
    needs: ['customers', 'vehicles', 'documents'],
    capDays: 30,
    detail: ['Looks at your invoices for the last oil change (and tire rotation if on), then the miles on file.', 'One reminder per vehicle per service cycle.', COMMON_NOTE],
    find: findServiceReminders,
  },
  {
    id: 'car_ready',
    name: 'Car is ready',
    blurb: 'Texts the customer when their job moves to Ready for pickup.',
    trigger: 'When a job is marked Ready for pickup',
    category: 'reminders',
    icon: 'check-circle',
    kind: 'engine',
    klass: 'service',
    channel: 'sms',
    schedule: 'every 15 minutes',
    claimsRevenue: false,
    template: 'Hi {name}, your {vehicle} is ready for pickup at {shop}. {contact} with any questions.',
    placeholders: ['name', 'shop', 'vehicle', 'contact'],
    fields: [],
    needs: ['jobs', 'customers'],
    capDays: 0,
    detail: ['One text per job. Jobs that were already ready before you switched this on are left alone.', COMMON_NOTE],
    find: findCarReady,
  },
  {
    id: 'estimate_followups',
    name: 'Estimate follow-up',
    blurb: 'Checks in on an estimate the customer has not answered.',
    trigger: 'A set time after an estimate is sent and not approved',
    category: 'followups',
    icon: 'doc',
    kind: 'engine',
    klass: 'service',
    channel: 'sms',
    emailFallback: true,
    schedule: 'Daily at 10am',
    claimsRevenue: true,
    template: 'Hi {name}, this is {shop}. Just checking in on the estimate we sent for your {vehicle}. {contact} if you have questions or want to go ahead.',
    emailSubject: 'Following up on your estimate from {shop}',
    placeholders: ['name', 'shop', 'vehicle', 'amount', 'contact'],
    fields: [
      { key: 'followup_hours', label: 'Follow up after', type: 'number', default: 48, min: 4, max: 336, unit: 'hours' },
      { key: 'max_age_days', label: 'Stop after', type: 'number', default: 14, min: 3, max: 60, unit: 'days' },
    ],
    needs: ['documents', 'customers'],
    capDays: 0,
    detail: ['Only estimates marked Sent and not approved. One follow-up per estimate.', 'Skipped if the job already has an invoice.', 'Uses email when there is no phone number and email is set up.', COMMON_NOTE],
    find: findEstimateFollowups,
  },
  {
    id: 'declined_work',
    name: 'Declined work follow-up',
    blurb: 'Circles back on work the customer did not approve, using the items on their estimate or inspection.',
    trigger: 'A month after an estimate or inspection item was not approved',
    category: 'followups',
    icon: 'alert',
    kind: 'engine',
    klass: 'marketing',
    channel: 'sms',
    emailFallback: true,
    schedule: 'Weekly on Tuesday at 10am',
    claimsRevenue: true,
    template: 'Hi {name}, this is {shop}. When you were in, we talked about {items} for your {vehicle}. It is still worth taking care of. {contact} when you are ready.',
    emailSubject: 'About the work we recommended on your {vehicle}',
    placeholders: ['name', 'shop', 'vehicle', 'items', 'amount', 'contact'],
    fields: [
      { key: 'after_days', label: 'Follow up after', type: 'number', default: 30, min: 14, max: 120, unit: 'days' },
      { key: 'max_age_days', label: 'Stop after', type: 'number', default: 180, min: 30, max: 365, unit: 'days' },
    ],
    needs: ['documents', 'customers', 'dvi'],
    capDays: 60,
    detail: ['Names only the work that is on their own estimate or inspection. It never invents a price or an offer.', 'One message per estimate or inspection.', COMMON_NOTE],
    find: findDeclinedWork,
  },
  {
    id: 'review_requests',
    name: 'Review requests',
    blurb: 'Asks for a Google review a couple of hours after a customer pays.',
    trigger: 'A set time after an invoice is paid',
    category: 'reviews',
    icon: 'star',
    kind: 'engine',
    klass: 'marketing',
    channel: 'sms',
    schedule: 'Daily at 6pm',
    claimsRevenue: false,
    template: 'Hi {name}, thank you for choosing {shop}. If we earned it, would you leave us a quick review? {review_link}',
    placeholders: ['name', 'shop', 'vehicle', 'review_link'],
    fields: [
      { key: 'delay_hours', label: 'Wait after payment', type: 'number', default: 2, min: 0, max: 72, unit: 'hours' },
      { key: 'lookback_days', label: 'Only for invoices paid in the last', type: 'number', default: 3, min: 1, max: 14, unit: 'days' },
    ],
    needs: ['documents', 'customers'],
    capDays: 90,
    detail: ['Customers marked unhappy are never asked.', 'Nobody is asked more than once in 90 days.', 'Uses the review link in Settings.', COMMON_NOTE],
    find: findReviewRequests,
    setupProblem: ctx => (ctx.reviewUrl ? null : 'Add your Google review link in Settings first.'),
  },
  {
    id: 're_engagement',
    name: 'Win-back',
    blurb: 'Texts customers who have not been in for a while.',
    trigger: 'When a customer has not visited for a set number of months',
    category: 'marketing',
    icon: 'repeat',
    kind: 'engine',
    klass: 'marketing',
    channel: 'sms',
    emailFallback: true,
    schedule: 'Weekly on Monday at 10am',
    claimsRevenue: true,
    template: 'Hi {name}, it has been a while since we saw you at {shop}. We would love to take care of your {vehicle} again. {contact}.',
    emailSubject: 'It has been a while, from {shop}',
    placeholders: ['name', 'shop', 'vehicle', 'contact'],
    fields: [
      { key: 'months_threshold', label: 'Not in for', type: 'number', default: 3, min: 1, max: 36, unit: 'months' },
      { key: 'max_months', label: 'Ignore anyone gone longer than', type: 'number', default: 24, min: 6, max: 120, unit: 'months' },
    ],
    needs: ['documents', 'customers'],
    capDays: 90,
    detail: ['One win-back message per customer per absence.', 'Goes to the longest-gone customers first, a few each run.', COMMON_NOTE],
    find: findWinBack,
  },
  {
    id: 'lead_followup',
    name: 'New lead follow-up',
    blurb: 'Follows up with people who called or walked in but have not booked yet.',
    trigger: 'A couple of days after someone contacts you',
    category: 'followups',
    icon: 'message',
    kind: 'engine',
    klass: 'marketing',
    channel: 'sms',
    schedule: 'Daily at 11am',
    claimsRevenue: false,
    template: 'Hi {name}, this is {shop}. Thanks for getting in touch. Would you like us to set up a time to look at your vehicle? {contact}.',
    placeholders: ['name', 'shop', 'shop_phone', 'contact'],
    fields: [
      { key: 'days_between', label: 'Wait between follow-ups', type: 'number', default: 2, min: 1, max: 14, unit: 'days' },
      { key: 'max_followups', label: 'Follow-ups per person', type: 'number', default: 2, min: 1, max: 5, unit: 'texts', help: 'After this many, the person is left alone.' },
    ],
    needs: ['growth_leads'],
    capDays: 2,
    detail: ['Each person gets a small, fixed number of follow-ups, never an endless stream.', 'Stops as soon as the lead is marked as booked or not interested.', COMMON_NOTE],
    find: findLeadFollowups,
  },
  {
    id: 'lead_outreach',
    name: 'Lead outreach emails',
    blurb: 'Emails new leads once, in words you approve, with your name, address and a way to unsubscribe.',
    trigger: 'Once a day, to leads that have not been contacted yet',
    category: 'leads',
    icon: 'mail',
    kind: 'engine',
    klass: 'marketing',
    channel: 'email',
    schedule: 'Daily at 8am',
    claimsRevenue: false,
    template: 'Hi {name}, this is {shop}, an independent auto repair shop nearby. We help local drivers and businesses keep their vehicles running. If you ever need a hand, reply to this email or call {shop_phone}.',
    emailSubject: 'A note from {shop}',
    placeholders: ['name', 'shop', 'shop_phone', 'service'],
    fields: [{ key: 'email_subject', label: 'Email subject', type: 'text', default: 'A note from {shop}' }],
    needs: ['leads'],
    capDays: 0,
    defaultMaxPerRun: 10,
    detail: ['Every lead is emailed once, in your own words. Alpha does not write or change this email.', 'Every email names your shop, shows your mailing address and has an unsubscribe link. People who unsubscribe are never emailed again.', 'Emails only. Alpha does not text or call people who have not asked to hear from you.'],
    find: findLeadOutreach,
    setupProblem: ctx => (ctx.emailReady ? null : 'Email is not set up yet. Add your email key, from address and shop address in Settings.'),
  },
  {
    id: 'sms_blast',
    name: 'Recurring promotion',
    blurb: 'Sends a message you write to a list you choose, on a schedule.',
    trigger: 'On the schedule you set, to the customers who match your filters',
    category: 'marketing',
    icon: 'send',
    kind: 'engine',
    klass: 'marketing',
    channel: 'sms',
    emailFallback: true,
    schedule: 'Weekly on Friday at 10am',
    claimsRevenue: true,
    template: '',
    emailSubject: 'A message from {shop}',
    placeholders: ['name', 'shop', 'contact'],
    fields: [
      { key: 'last_visit_min_days', label: 'Not in for at least', type: 'number', default: 0, min: 0, max: 3650, unit: 'days', help: '0 means everyone.' },
      { key: 'last_visit_max_days', label: 'Last in within', type: 'number', default: 0, min: 0, max: 3650, unit: 'days', help: '0 means no limit.' },
      { key: 'min_spend', label: 'Spent at least', type: 'number', default: 0, min: 0, max: 100000, unit: 'dollars' },
      { key: 'tags', label: 'Tagged (comma separated)', type: 'text', default: '' },
    ],
    needs: ['customers', 'documents', 'vehicles'],
    capDays: 0,
    detail: ['You write the message. Nothing is invented for you.', 'The marketing limits apply: no customer gets more than one marketing text a week.', COMMON_NOTE],
    find: findPromotion,
    setupProblem: (_ctx, cfg) => (String(cfg.message || '').trim() ? null : 'Write the message first. This automation never makes up an offer for you.'),
  },
]

const LEGACY_DEFS: AutomationDef[] = [
  {
    id: 'lead_discovery',
    name: 'Find local business leads',
    blurb: 'Searches near your shop for businesses that may need repair or fleet service.',
    trigger: 'Once a day',
    category: 'leads',
    icon: 'search',
    kind: 'legacy',
    klass: 'marketing',
    channel: 'email',
    schedule: 'Daily at 6am',
    claimsRevenue: false,
    template: '',
    placeholders: [],
    fields: [
      { key: 'scan_type', label: 'What to look for', type: 'select', default: 'alpha_ai', options: ['both', 'alpha_ai', 'competitors'] },
      { key: 'radius_miles', label: 'Search radius', type: 'number', default: 15, min: 1, max: 50, unit: 'miles' },
    ],
    needs: [],
    capDays: 0,
    detail: ['Searches near the city in your shop profile.', 'Only saves leads for you to review. Nothing is sent.'],
    legacy: { endpoint: '/api/growth/ai-competitor-leads', body: { scan_type: 'alpha_ai', limit: 20 } },
    setupProblem: () => null,
  },
  {
    id: 'social_posts',
    name: 'Daily post drafts',
    blurb: 'Writes a draft post for you to look over. Nothing is posted by itself.',
    trigger: 'Once a day',
    category: 'marketing',
    icon: 'edit',
    kind: 'legacy',
    klass: 'marketing',
    channel: 'email',
    schedule: 'Daily at 8am',
    claimsRevenue: false,
    template: '',
    placeholders: [],
    fields: [{ key: 'include_specials', label: 'Mention specials you have entered', type: 'boolean', default: false }],
    needs: [],
    capDays: 0,
    detail: ['Drafts wait on the Get more customers screen for your approval.', 'Drafts never include a price or an offer you did not type in.'],
    legacy: { endpoint: '/api/growth/social-post', body: { action: 'auto_post' } },
  },
  {
    id: 'review_responses',
    name: 'Review reply drafts',
    blurb: 'Drafts replies to Google reviews you paste in. You approve every reply.',
    trigger: 'When you add a review',
    category: 'reviews',
    icon: 'message',
    kind: 'legacy',
    klass: 'marketing',
    channel: 'email',
    schedule: 'Daily at 7am',
    claimsRevenue: false,
    template: '',
    placeholders: [],
    fields: [],
    needs: [],
    capDays: 0,
    detail: ['Reviews are not fetched from Google until your Google Business Profile is connected.', 'Replies are never posted for you.'],
    legacy: { endpoint: '/api/growth/reviews', body: { action: 'check_and_respond' } },
  },
]

export const CATALOG: AutomationDef[] = [...ENGINE_DEFS, ...LEGACY_DEFS]
export const CATALOG_BY_ID: Record<string, AutomationDef> = Object.fromEntries(CATALOG.map(d => [d.id, d]))
export const isKnownAutomation = (id: string): boolean => Object.prototype.hasOwnProperty.call(CATALOG_BY_ID, id)

// ── Settings per automation ───────────────────────────────────────────────

/** Fields every engine automation has on top of its own. */
export function commonFields(def: AutomationDef): FieldSpec[] {
  if (def.kind !== 'engine') return [{ key: 'schedule', label: 'When it runs', type: 'text', default: def.schedule }]
  const f: FieldSpec[] = [
    { key: 'schedule', label: 'When it runs', type: 'text', default: def.schedule },
    { key: 'message', label: 'Message', type: 'textarea', default: def.template },
  ]
  if (def.emailFallback) f.push({ key: 'email_subject', label: 'Email subject', type: 'text', default: def.emailSubject || '' })
  f.push(
    { key: 'cap_days', label: 'Days between this message to one customer', type: 'number', default: def.capDays, min: 0, max: 365, unit: 'days', help: '0 means no extra limit beyond your shop rules.' },
    { key: 'max_per_run', label: 'Most people per run', type: 'number', default: def.defaultMaxPerRun ?? 50, min: 1, max: 500, unit: 'people', help: 'Extra people wait for the next run.' },
  )
  return f
}

export const allFields = (def: AutomationDef): FieldSpec[] => [...commonFields(def), ...def.fields]

/** The settings an automation runs with: defaults, then what was saved, each checked against its limits. */
export function resolveConfig(def: AutomationDef, saved: unknown): Record<string, any> {
  const raw = (saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}) as Record<string, unknown>
  const out: Record<string, any> = {}
  for (const f of allFields(def)) {
    const v = raw[f.key]
    if (v === undefined || v === null) { out[f.key] = f.default; continue }
    // A saved blank message falls back to the default wording, except where the owner must write it.
    if (f.key === 'message' && typeof v === 'string' && !v.trim() && f.default) { out[f.key] = f.default; continue }
    if (f.type === 'number') {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
      out[f.key] = typeof n === 'number' && Number.isFinite(n) && n >= (f.min ?? -Infinity) && n <= (f.max ?? Infinity) ? n : f.default
    } else if (f.type === 'boolean') out[f.key] = v === true
    else if (f.type === 'select') out[f.key] = f.options?.includes(String(v)) ? String(v) : f.default
    else if (f.key === 'schedule') out[f.key] = typeof v === 'string' && isValidSchedule(v) ? v.trim() : f.default
    else out[f.key] = typeof v === 'string' ? v.slice(0, f.type === 'textarea' ? 1000 : 200) : f.default
  }
  return out
}

/** Why a settings change cannot be saved, in plain words. Empty when it can. */
export function configProblems(def: AutomationDef, input: Record<string, unknown>): string[] {
  const out: string[] = []
  const fields = new Map(allFields(def).map(f => [f.key, f]))
  for (const [key, v] of Object.entries(input)) {
    const f = fields.get(key)
    if (!f) { out.push(`"${key}" is not a setting for this automation.`); continue }
    if (f.type === 'number') {
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
      if (typeof n !== 'number' || !Number.isFinite(n) || n < (f.min ?? -Infinity) || n > (f.max ?? Infinity)) {
        out.push(`${f.label} must be a number from ${f.min ?? 0} to ${f.max ?? 9999}.`)
      }
    } else if (f.type === 'boolean') {
      if (typeof v !== 'boolean') out.push(`${f.label} must be on or off.`)
    } else if (f.type === 'select') {
      if (!f.options?.includes(String(v))) out.push(`${f.label} has to be one of the choices.`)
    } else if (typeof v !== 'string') out.push(`${f.label} must be text.`)
    else if (key === 'schedule' && !isValidSchedule(v)) out.push('The schedule is not one I understand. Try "Daily at 9am" or "Weekly on Monday at 10am".')
  }
  return out
}

/** Effective schedule text for an automation. */
export const scheduleOf = (def: AutomationDef, cfg: Record<string, any>): string => (
  typeof cfg.schedule === 'string' && isValidSchedule(cfg.schedule) ? cfg.schedule : def.schedule
)
