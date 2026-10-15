/**
 * The shop's schedule as an iCalendar feed that Google Calendar, Apple Calendar and Outlook can subscribe to.
 * One way (shop to calendar). Times are written as the shop's own wall clock ("floating"), so 9:00 shows as 9:00
 * wherever the calendar is opened. The customer's phone number is deliberately left out.
 * No imports, so the server and `node --test` run the same code.
 */

export interface IcalAppt {
  id: string
  customer_name: string
  vehicle?: string | null
  service?: string | null
  tech?: string | null
  date: string
  time: string
  duration?: number | null
  status?: string | null
  notes?: string | null
}

/** Backslash, semicolon, comma and line breaks are special inside text values. */
export const escapeText = (s: string): string => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

/** Lines longer than 75 bytes are split, each continuation starting with one space. */
export function fold(line: string): string {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > (out.length === 0 ? 75 : 74)) { out.push(cur); cur = ''; bytes = 0 }
    cur += ch; bytes += n
  }
  if (cur) out.push(cur)
  return out.join('\r\n ')
}

const stamp = (ymd: string, mins: number) => {
  const d = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) + mins * 60_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`
}

const first = (name: string) => String(name || '').replace(/^\s*walk-?\s?in\s*[:-]\s*/i, '').trim().split(/\s+/)[0] || 'Customer'

export function toIcal(shopName: string, appts: IcalAppt[], generatedAt: Date = new Date()): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Shop schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`${shopName || 'Shop'} schedule`)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ]
  const dtstamp = generatedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  for (const a of appts) {
    if (['Cancelled', 'Declined'].includes(String(a.status || ''))) continue
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.date) || !/^\d{2}:\d{2}/.test(String(a.time))) continue
    const start = Number(a.time.slice(0, 2)) * 60 + Number(a.time.slice(3, 5))
    const len = Number(a.duration) > 0 ? Number(a.duration) : 60
    const desc = [a.vehicle && `Vehicle: ${a.vehicle}`, a.service && `Service: ${a.service}`, a.tech && `Technician: ${a.tech}`, a.status && `Status: ${a.status}`, a.notes && `Notes: ${a.notes}`].filter(Boolean).join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeText(a.id)}@shop-schedule`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(a.date, start)}`,
      `DTEND:${stamp(a.date, start + len)}`,
      `SUMMARY:${escapeText(`${first(a.customer_name)}${a.service ? `: ${a.service}` : ''}${a.status === 'Requested' ? ' (request)' : ''}`)}`,
      ...(desc ? [`DESCRIPTION:${escapeText(desc)}`] : []),
      `STATUS:${a.status === 'Requested' ? 'TENTATIVE' : 'CONFIRMED'}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
