/**
 * "What changed" in a few plain sentences the owner can read in twenty seconds.
 * Every sentence comes from the numbers, none from a model, so it can be sent in an email and trusted.
 */
import { aging, change, collectedOn, inRange, isSale, money, money2, parseDay, partsMargin, summarize, unrecordedPaid } from './reports.ts'
import type { Range, ReportDoc, ReportPayment } from './reports.ts'
import { carCount } from './report-metrics.ts'

export type Tone = 'good' | 'watch' | 'info'
export interface Point { tone: Tone; text: string }
export interface Summary { headline: string; points: Point[] }

export interface SummaryInput {
  docs: ReportDoc[]
  payments: ReportPayment[]
  range: Range
  /** Null when nothing is being compared. */
  previous: Range | null
  todayKey: string
  /** "this week", "in the last 30 days". */
  phrase: string
  /** "last week", "the 30 days before". Empty when there is no comparison. */
  vs: string
  /** Incoming calls in the period and in the comparison period, when the call log loaded. */
  calls?: { now: number; before: number } | null
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function delta(label: string, now: number, before: number, vs: string, fmt: (n: number) => string): string {
  const c = change(now, before)
  if (c.kind === 'none' || !vs) return ''
  if (c.kind === 'same') return `${label} is the same as ${vs}.`
  return `${label} is ${c.kind === 'up' ? 'up' : 'down'} ${c.pct}% from ${vs} (${fmt(before)} before).`
}

export function whatChanged(inp: SummaryInput): Summary {
  const { docs, payments, range, previous, todayKey, phrase, vs } = inp
  const byId = new Map(docs.map(d => [d.id, d]))
  const now = summarize(docs, payments, range)
  const before = previous ? summarize(docs, payments, previous) : null
  const points: Point[] = []

  // The headline: money in, and how that compares.
  const cc = before ? change(now.collected, before.collected) : { kind: 'none' as const, pct: 0 }
  let headline = now.collected > 0 || now.invoices > 0
    ? `You collected ${money(now.collected)} ${phrase}`
    : `No money came in ${phrase}`
  if (cc.kind === 'up') headline += `, up ${cc.pct}% from ${vs}`
  else if (cc.kind === 'down') headline += `, down ${cc.pct}% from ${vs}`
  else if (cc.kind === 'same') headline += `, the same as ${vs}`
  headline += '.'

  if (now.invoices > 0) {
    const avgNote = before && before.invoices > 0 ? delta('The average invoice', now.average, before.average, vs, money) : ''
    points.push({
      tone: 'info',
      text: `You billed ${money(now.invoiced)} on ${plural(now.invoices, 'invoice')}, ${money(now.average)} each on average.${avgNote ? ` ${avgNote}` : ''}`,
    })
    const cars = carCount(docs, range)
    const carBits = [plural(cars.cars, 'car')]
    if (cars.newCustomers + cars.returningCustomers > 0) carBits.push(`${cars.newCustomers} from new customers`)
    points.push({ tone: 'info', text: `${carBits[0]} serviced${carBits[1] ? `, ${carBits[1]}` : ''}.` })
  } else if (now.collected === 0) {
    points.push({ tone: 'info', text: `Nothing was billed ${phrase}.` })
  }

  // Busiest day by money in.
  const perDay = new Map<string, number>()
  for (const p of payments) {
    const day = collectedOn(p, byId)
    if (day && inRange(day, range)) perDay.set(day, (perDay.get(day) || 0) + p.amount)
  }
  if (perDay.size > 1) {
    const [day, amt] = [...perDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    points.push({ tone: 'info', text: `Your best day was ${WEEKDAYS[parseDay(day).getDay()]}, with ${money(amt)} collected.` })
  }

  // Money still out there.
  const owed = aging(docs, todayKey)
  if (owed.open.length > 0) {
    const old = owed.open.filter(o => o.days > 30)
    const oldAmt = old.reduce((s, o) => s + o.doc.balance, 0)
    points.push({
      tone: old.length ? 'watch' : 'info',
      text: `${money(owed.total)} is still owed across ${plural(owed.open.length, 'invoice')}${old.length ? `. ${plural(old.length, 'invoice is', 'invoices are')} over 30 days old (${money(oldAmt)})` : ''}.`,
    })
  } else if (docs.some(isSale)) {
    points.push({ tone: 'good', text: 'Every invoice is paid. Nothing is owed.' })
  }

  // Things the paperwork does not say, which change how far a number can be trusted.
  const unrec = unrecordedPaid(docs.filter(d => inRange(d.date, range)), payments)
  if (unrec.count > 0) {
    points.push({ tone: 'watch', text: `${plural(unrec.count, 'invoice is', 'invoices are')} marked Paid with no payment recorded (${money2(unrec.amount)}). They are not counted as collected.` })
  }
  const margin = partsMargin(docs, range)
  if (margin.lines > 0 && margin.costed < margin.lines) {
    points.push({ tone: 'watch', text: `${plural(margin.lines - margin.costed, 'part line has', 'part lines have')} no cost written down, so your parts profit only counts the rest.` })
  }

  if (inp.calls && (inp.calls.now > 0 || inp.calls.before > 0)) {
    const c = change(inp.calls.now, inp.calls.before)
    const how = vs && (c.kind === 'up' || c.kind === 'down') ? `, ${c.kind} ${c.pct}% from ${vs} (${inp.calls.before} before)` : vs && c.kind === 'same' ? `, the same as ${vs}` : ''
    points.push({ tone: 'info', text: `${plural(inp.calls.now, 'incoming call')}${how}.` })
  }

  // The few that matter most first: things to watch, then the rest in the order they were found.
  const rank = (p: Point) => (p.tone === 'watch' ? 0 : 1)
  const ordered = points.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(x => x.p)
  return { headline, points: ordered.slice(0, 7) }
}
