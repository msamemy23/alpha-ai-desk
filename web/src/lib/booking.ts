/**
 * Online booking: what a shop publishes, what a stranger may send, and how it is checked.
 * Nothing here trusts the browser. No imports from `@/`, so the server and `node --test` run the same code.
 */

import { DAY_KEYS, DAY_LABEL, isHm, isYmd, addDaysYmd, daysApart, time12 } from './schedule-capacity.ts'
import type { CapacitySettings, JobKind, ServiceType } from './schedule-capacity.ts'

export interface OnlineSettings {
  enabled: boolean
  slug: string
  /** review: every request waits for the shop to confirm it. auto: it is put on the calendar at once. */
  approval: 'review' | 'auto'
  /** Earliest booking, in hours from now. */
  leadHours: number
  /** How many days ahead a customer may book. */
  daysAhead: number
  /** Gap between offered start times, in minutes. */
  stepMinutes: 15 | 30 | 60
  /** A line at the top of the page. */
  intro: string
  /** What the customer is told after sending. */
  notice: string
  /** A phone number with this many no-shows in the last year always waits for the shop, even on auto. 0 turns it off. */
  holdAfterNoShows: number
  /** Visitors may also ask for a price without picking a time. Off until the shop turns it on. */
  quotes: boolean
}

export const DEFAULT_ONLINE: OnlineSettings = {
  enabled: false, slug: '', approval: 'review', leadHours: 4, daysAhead: 30, stepMinutes: 30, intro: '',
  notice: 'The shop will text you to confirm your time.', holdAfterNoShows: 2, quotes: false,
}

export const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/
export const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
const clamp = (v: unknown, lo: number, hi: number, fallback: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback }

export function cleanOnline(raw: unknown): OnlineSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const slug = String(o.slug ?? '').toLowerCase().trim()
  return {
    enabled: o.enabled === true && SLUG.test(slug),
    slug: SLUG.test(slug) ? slug : '',
    approval: o.approval === 'auto' ? 'auto' : 'review',
    leadHours: clamp(o.leadHours, 0, 72, DEFAULT_ONLINE.leadHours),
    daysAhead: clamp(o.daysAhead, 1, 90, DEFAULT_ONLINE.daysAhead),
    stepMinutes: ([15, 30, 60] as const).find(n => n === Number(o.stepMinutes)) ?? 30,
    intro: cleanText(o.intro, 240),
    notice: o.notice === undefined ? DEFAULT_ONLINE.notice : cleanText(o.notice, 240),
    holdAfterNoShows: clamp(o.holdAfterNoShows, 0, 5, DEFAULT_ONLINE.holdAfterNoShows),
    quotes: o.quotes === true,
  }
}

/** A web address for the shop: "joes-auto-3f9a". The four characters at the end make two shops with one name different. */
export function makeSlug(shopName: string, rand: () => number = Math.random): string {
  const base = String(shopName || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28).replace(/-+$/g, '')
  let tail = ''
  while (tail.length < 4) tail += Math.floor(rand() * 36).toString(36)
  return `${base || 'shop'}-${tail}`
}

/* ---------- what a visitor sees ---------- */

export interface PublicShop {
  name: string
  phone: string
  intro: string
  daysAhead: number
  hours: { day: string; label: string; open: boolean; start: string; end: string }[]
  services: { key: string; label: string; minutes: number; kind: JobKind }[]
  closedDates: string[]
  /** The page also offers "ask for a price". */
  quotes: boolean
}

/** The settings, cut down to what a stranger may read. Counts of technicians and bays, limits and names stay private. */
export function publicView(shop: { name: string; phone: string }, cap: CapacitySettings, online: OnlineSettings): PublicShop {
  return {
    name: String(shop.name || '').slice(0, 80),
    phone: String(shop.phone || '').slice(0, 30),
    intro: online.intro,
    daysAhead: online.daysAhead,
    hours: DAY_KEYS.map(k => ({ day: k, label: DAY_LABEL[k], open: cap.hours[k].open, start: cap.hours[k].start, end: cap.hours[k].end })),
    services: cap.services.filter(s => s.online).map(s => ({ key: s.key, label: s.label, minutes: s.minutes, kind: s.kind })),
    closedDates: cap.closedDates.filter(d => d >= '1970-01-01').slice(0, 120),
    quotes: online.quotes,
  }
}

/** The week as a customer reads it: "Mon to Fri, 8:00 AM to 5:00 PM", "Sat, Closed". Days in a row with the same hours are joined. */
export function hoursLines(hours: PublicShop['hours']): { days: string; text: string }[] {
  const out: { first: number; last: number; text: string }[] = []
  hours.forEach((h, i) => {
    const text = h.open ? `${time12(h.start)} to ${time12(h.end)}` : 'Closed'
    const prev = out[out.length - 1]
    if (prev && prev.text === text && prev.last === i - 1) prev.last = i
    else out.push({ first: i, last: i, text })
  })
  const short = (i: number) => String(hours[i]?.label || '').slice(0, 3)
  return out.map(g => ({ days: g.first === g.last ? String(hours[g.first]?.label || '') : g.last === g.first + 1 ? `${short(g.first)} and ${short(g.last)}` : `${short(g.first)} to ${short(g.last)}`, text: g.text }))
}

/** The dates a customer may pick: tomorrow-ish up to the limit. The first may be today when the lead time allows. */
export function bookableDates(todayYmd: string, daysAhead: number): string[] {
  return Array.from({ length: Math.max(0, daysAhead) + 1 }, (_, i) => addDaysYmd(todayYmd, i))
}

/* ---------- what a stranger sends ---------- */

export const HONEYPOT = 'company_site'
export const MAX_NOTES = 400

/** Web addresses, markup and email addresses have no business in a name, a vehicle or a note on a booking form. */
export function looksLikeSpam(text: string): boolean {
  const t = String(text || '')
  return /https?:\/\/|www\.|<[^>]*>|\[url|\bt\.me\/|[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}|\b[a-z0-9-]+\.(com|net|org|io|ru|cn|xyz|info|biz|top|shop|site|online|club|link|live)\b/i.test(t)
}

/** US numbers only. "(713) 555-0142", "713.555.0142" and "+1 713 555 0142" all become +17135550142. */
export function normalizePhone(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  if (ten.length !== 10) return null
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(ten)) return null
  if (/^(\d)\1{9}$/.test(ten)) return null
  return `+1${ten}`
}

export const phoneDisplay = (e164: string): string => {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

export interface BookingInput {
  name: string; phone: string; vehicle: string; service: string; kind: JobKind
  date: string; time: string; notes: string
}
export type Cleaned = { ok: true; value: BookingInput & { serviceLabel: string; minutes: number; phoneShown: string } } | { ok: false; error: string; field: string }

const fail = (field: string, error: string): Cleaned => ({ ok: false, field, error })

export function cleanBooking(raw: unknown, ctx: { services: ServiceType[]; todayYmd: string; daysAhead: number }): Cleaned {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  // Markup is checked on what was sent, before cleaning strips the angle brackets and hides it.
  const name = cleanText(o.name, 60)
  if (name.length < 2 || !/\p{L}/u.test(name) || !/^\p{L}[\p{L} .'’-]*$/u.test(name) || looksLikeSpam(String(o.name ?? ''))) return fail('name', 'Please enter your name.')
  const phone = normalizePhone(o.phone)
  if (!phone) return fail('phone', 'Please enter a 10-digit phone number.')
  const vehicle = cleanText(o.vehicle, 80)
  if (vehicle.length < 3 || looksLikeSpam(String(o.vehicle ?? ''))) return fail('vehicle', 'Please tell us the year, make and model.')
  const svc = ctx.services.find(s => s.key === o.service)
  if (!svc) return fail('service', 'Please pick what you need done.')
  const kind: JobKind = o.kind === 'wait' ? 'wait' : o.kind === 'dropoff' ? 'dropoff' : svc.kind
  const date = String(o.date ?? '')
  if (!isYmd(date) || date < ctx.todayYmd || daysApart(ctx.todayYmd, date) > ctx.daysAhead) return fail('date', 'Please pick a day from the list.')
  const time = String(o.time ?? '')
  if (!isHm(time)) return fail('time', 'Please pick a time from the list.')
  const notes = cleanText(o.notes, MAX_NOTES)
  if (looksLikeSpam(String(o.notes ?? ''))) return fail('notes', 'Please leave web addresses out of the note.')
  return { ok: true, value: { name, phone, vehicle, service: svc.key, serviceLabel: svc.label, minutes: svc.minutes, kind, date, time, notes, phoneShown: phoneDisplay(phone) } }
}

/** The same checks the server makes, so a mistake is caught before the trip. The server still checks everything again. */
export function checkBookingForm(f: { service: string; date: string; time: string; name: string; phone: string; vehicle: string; notes: string }): Partial<Record<'service' | 'date' | 'time' | 'name' | 'phone' | 'vehicle' | 'notes', string>> {
  const out: Partial<Record<'service' | 'date' | 'time' | 'name' | 'phone' | 'vehicle' | 'notes', string>> = {}
  const name = cleanText(f.name, 60)
  if (!f.service) out.service = 'Choose what you need done.'
  if (!f.date) out.date = 'Choose a day.'
  else if (!f.time) out.time = 'Choose a time.'
  if (name.length < 2 || !/\p{L}/u.test(name) || !/^\p{L}[\p{L} .'’-]*$/u.test(name) || looksLikeSpam(f.name)) out.name = 'Enter your name.'
  if (!normalizePhone(f.phone)) out.phone = 'Enter a 10-digit phone number.'
  if (cleanText(f.vehicle, 80).length < 3 || looksLikeSpam(f.vehicle)) out.vehicle = 'Tell us the year, make and model.'
  if (looksLikeSpam(f.notes)) out.notes = 'Leave web addresses out of the note.'
  return out
}

/* ---------- is this really our own page talking ---------- */

/**
 * A booking must come from a page on this site. Browsers always send Origin on a form post made by script;
 * a plain script on another machine rarely bothers to match it. Not a lock, one more door that is shut.
 */
export function sameOrigin(h: { origin?: string | null; referer?: string | null; host?: string | null; forwardedHost?: string | null }): boolean {
  const host = String(h.forwardedHost || h.host || '').toLowerCase().split(',')[0].trim()
  if (!host) return false
  const from = String(h.origin || h.referer || '')
  if (!from) return false
  try { return new URL(from).host.toLowerCase() === host } catch { return false }
}

export function clientIp(h: { forwardedFor?: string | null; realIp?: string | null }): string {
  const first = String(h.forwardedFor || '').split(',')[0].trim()
  return (first || String(h.realIp || '').trim() || 'unknown').slice(0, 64)
}

/* ---------- what happens to a request ---------- */

export interface Decision {
  status: 'Requested' | 'Scheduled'
  /** Why a request is waiting, for the shop's eyes only. */
  why: string
}

/** The status a new online booking starts with. A history of no-shows always waits for the shop. */
export function startStatus(online: Pick<OnlineSettings, 'approval' | 'holdAfterNoShows'>, noShowsLastYear: number): Decision {
  if (online.holdAfterNoShows > 0 && noShowsLastYear >= online.holdAfterNoShows) return { status: 'Requested', why: `This number missed ${noShowsLastYear} earlier ${noShowsLastYear === 1 ? 'booking' : 'bookings'}, so it was held for you to confirm.` }
  if (online.approval === 'auto') return { status: 'Scheduled', why: '' }
  return { status: 'Requested', why: '' }
}

export const BOOKED_NOTE = 'Booked online.'

/** The notes line saved on the calendar entry: it says where it came from, then what the customer wrote. */
export function bookingNotes(v: { notes: string; kind: JobKind; why: string }): string {
  return [BOOKED_NOTE, v.kind === 'wait' ? 'Customer will wait.' : 'Customer will drop off the car.', v.notes && `Customer note: ${v.notes}`, v.why].filter(Boolean).join(' ')
}

export const isOnlineBooking = (notes: unknown): boolean => String(notes ?? '').startsWith(BOOKED_NOTE)
