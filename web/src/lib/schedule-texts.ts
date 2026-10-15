/**
 * The words the shop sends about a booking: reminders, answers to an online request, a car that is late, a missed visit.
 * Pure functions with no imports from the app, so the Schedule screen and `node --test` use the same text.
 *
 * Every message names the shop and says how to reach it, never blames the customer, and is short enough for one or two texts.
 */

import { addDaysYmd, daysApart, freeSlots, openHours, time12 } from './schedule-capacity.ts'
import type { CapacitySettings, JobKind, ShopNow, Slot } from './schedule-capacity.ts'

export const firstNameOf = (name: string): string => String(name || '').replace(/^\s*walk-?\s?in\s*[:-]\s*/i, '').trim().split(/\s+/)[0] || ''

const whoOf = (name: string): string => (firstNameOf(name) ? `Hi ${firstNameOf(name)}, this is` : 'This is')
const shopOf = (shop: string): string => shop.trim() || 'the shop'
const callLine = (phone: string): string => (phone.trim() ? `call ${phone.trim()}` : 'reply to this text')
const whatOf = (service: string): string => (service.trim() ? `your ${service.trim().toLowerCase()}` : 'your visit')

/** "tomorrow", "today", or "Thursday, Oct 16". */
export function dayWords(ymd: string, todayYmd: string): string {
  const d = daysApart(todayYmd, ymd)
  if (d === 0) return 'today'
  if (d === 1) return 'tomorrow'
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export interface TextShop { name: string; phone: string }
export interface TextAppt { customer_name: string; service: string; vehicle?: string; date: string; time: string }

/** The first open day after `fromYmd`, within two weeks. Used to pick the day to remind. */
export function nextOpenDay(cap: CapacitySettings, fromYmd: string): string {
  for (let i = 1; i <= 14; i++) {
    const d = addDaysYmd(fromYmd, i)
    if (openHours(cap, d).open) return d
  }
  return addDaysYmd(fromYmd, 1)
}

export function reminderText(a: TextAppt, shop: TextShop, todayYmd: string): string {
  return `${whoOf(a.customer_name)} ${shopOf(shop.name)} with a reminder: ${whatOf(a.service)} is ${dayWords(a.date, todayYmd)} at ${time12(a.time)}. Reply here if something has changed, or ${callLine(shop.phone)}.`
}

export function acceptText(a: TextAppt, shop: TextShop, todayYmd: string): string {
  return `${whoOf(a.customer_name)} ${shopOf(shop.name)}. You are booked for ${whatOf(a.service)} ${dayWords(a.date, todayYmd)} at ${time12(a.time)}. Reply here if you need to change it, or ${callLine(shop.phone)}.`
}

export function declineText(a: TextAppt, shop: TextShop, todayYmd: string): string {
  return `${whoOf(a.customer_name)} ${shopOf(shop.name)}. Sorry, we cannot fit ${whatOf(a.service)} ${dayWords(a.date, todayYmd)} at ${time12(a.time)}. Please ${callLine(shop.phone)} and we will find a time that works.`
}

/** `options` are times like "Thursday, Oct 16 at 9:00 AM". */
export function suggestText(a: TextAppt, shop: TextShop, todayYmd: string, options: string[]): string {
  const alt = options.length === 0 ? '' : options.length === 1 ? ` Would ${options[0]} work instead?` : ` Would one of these work instead: ${options.join(', or ')}?`
  return `${whoOf(a.customer_name)} ${shopOf(shop.name)}. We cannot fit ${whatOf(a.service)} ${dayWords(a.date, todayYmd)} at ${time12(a.time)}.${alt} Reply here or ${callLine(shop.phone)}.`
}

export function lateText(a: TextAppt, shop: TextShop, todayYmd: string): string {
  const when = a.date === todayYmd ? `${time12(a.time)} today` : `${dayWords(a.date, todayYmd)} at ${time12(a.time)}`
  return `${whoOf(a.customer_name)} ${shopOf(shop.name)}. We have you down for ${when}. Are you still coming? Reply here or ${callLine(shop.phone)}.`
}

export function noShowText(a: TextAppt, shop: TextShop, bookUrl: string | null): string {
  const rebook = bookUrl ? `pick a new time here: ${bookUrl}` : `${callLine(shop.phone)} to pick a new time`
  return `${whoOf(a.customer_name)} ${shopOf(shop.name)}. We missed you for ${whatOf(a.service)}. If you still need it, ${rebook}.`
}

/** The next few open times for a request, spread over different days, as words. */
export function alternativeTimes(
  cap: CapacitySettings, appts: Slot[],
  q: { date: string; minutes: number; kind: JobKind; now: ShopNow; leadMinutes: number; step: number }, limit = 3,
): { ymd: string; time: string; words: string }[] {
  const out: { ymd: string; time: string; words: string }[] = []
  for (let i = 0; i <= 14 && out.length < limit; i++) {
    const ymd = addDaysYmd(q.date, i)
    const slots = freeSlots(cap, appts, { ...q, date: ymd })
    if (slots.length === 0) continue
    // The morning start, then (on a later day) a midday one: a customer who cannot do 9 may still do 1.
    const picks = i === 0 ? slots.slice(0, 2) : [slots[0]]
    for (const t of picks) {
      if (out.length >= limit) break
      if (ymd === q.date && t === q.date) continue
      out.push({ ymd, time: t, words: `${dayWords(ymd, q.now.ymd)} at ${time12(t)}` })
    }
  }
  return out
}

/* ---------- who gets a reminder ---------- */

export interface ReminderAppt extends TextAppt {
  id: string
  phone: string
  status: string
  reminder_sent_at?: string | null
}

/**
 * Bookings on `ymd` that should get a reminder, and the ones left out with the reason in words.
 * Left out: no phone number, replied STOP, already reminded, or not booked (cancelled, done, still only a request).
 */
export function reminderCandidates<T extends ReminderAppt>(appts: T[], ymd: string, stopped: (a: T) => boolean): { send: T[]; skipped: { appt: T; why: string }[] } {
  const send: T[] = []
  const skipped: { appt: T; why: string }[] = []
  for (const a of appts.filter(x => x.date === ymd).sort((x, y) => x.time.localeCompare(y.time))) {
    if (!['Scheduled', 'Confirmed'].includes(a.status)) { if (a.status === 'Requested') skipped.push({ appt: a, why: 'Not accepted yet' }); continue }
    if (a.reminder_sent_at) { skipped.push({ appt: a, why: 'Already reminded' }); continue }
    if (stopped(a)) { skipped.push({ appt: a, why: 'Replied STOP' }); continue }
    if (String(a.phone || '').replace(/\D/g, '').length < 10) { skipped.push({ appt: a, why: 'No phone number' }); continue }
    send.push(a)
  }
  return { send, skipped }
}
