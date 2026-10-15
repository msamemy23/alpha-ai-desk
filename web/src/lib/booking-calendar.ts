/**
 * A single appointment as a calendar file the customer can add to their own phone calendar.
 * The time is the shop's wall clock ("floating"), so 9:00 shows as 9:00. No phone number or personal detail goes in.
 * No imports from `@/`, so the browser and `node --test` run the same code.
 */

import { escapeText, fold } from './schedule-ical.ts'

const stamp = (ymd: string, mins: number): string => {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + mins * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`
}

export function bookingIcs(e: { shop: string; phone?: string; service: string; date: string; time: string; minutes: number; uid: string }, at: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !/^\d{2}:\d{2}/.test(e.time)) return null
  const start = Number(e.time.slice(0, 2)) * 60 + Number(e.time.slice(3, 5))
  const len = e.minutes > 0 ? Math.round(e.minutes) : 60
  const stampNow = at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shop booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeText(e.uid)}@shop-booking`,
    `DTSTAMP:${stampNow}`,
    `DTSTART:${stamp(e.date, start)}`,
    `DTEND:${stamp(e.date, start + len)}`,
    `SUMMARY:${escapeText(`${e.service} at ${e.shop || 'the shop'}`)}`,
    ...(e.phone ? [`DESCRIPTION:${escapeText(`To change this, call ${e.phone}.`)}`] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}
