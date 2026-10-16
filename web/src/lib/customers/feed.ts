/**
 * Helpers for the one-customer feed (/api/customers/feed): turning the rows the route reads into what `buildTimeline` takes,
 * keeping only rows that belong to this customer, and reading each kind so one that fails leaves the others alone.
 * Imports no framework code, so it runs anywhere.
 */

import { buildTimeline } from './timeline.ts'
import type { TimelineInput, TimelineItem } from './timeline.ts'
import { calculateDocumentTotals } from '../document-money.ts'
import { phoneDigits, phoneKey } from '../automation-rules.ts'
import { isMissingDbObject } from '../db-missing.ts'

export type FeedRow = Record<string, unknown>

/** At most this many rows of each kind are read. */
export const FEED_KIND_LIMIT = 40
/** At most this many items go back to the screen. */
export const FEED_MAX_ITEMS = 120
/** A message body is cut to this before it is even handed to the timeline, which clips it again to what the screen shows. */
const BODY_CUT = 400

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()

/** The customer's number as the feed matches it (last ten digits, the same as the customer card), or '' when it is too short to trust. */
export function feedPhoneKey(raw: unknown): string {
  const key = phoneKey(raw)
  return key.length >= 7 ? key : ''
}

/** True when a number, however it was typed or stored (+17135550142, (713) 555-0142), ends in the customer's digits. */
export function sameNumber(raw: unknown, key: string): boolean {
  return key !== '' && phoneDigits(raw).endsWith(key)
}

/** The wall-clock moment of an appointment: its date and time columns, or the day it was entered when the date is missing. */
export function appointmentAt(date: unknown, time: unknown, createdAt: unknown): string {
  const day = str(date).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return str(createdAt)
  const hm = /^(\d{1,2}):(\d{2})/.exec(str(time))
  return hm ? `${day}T${hm[1].padStart(2, '0')}:${hm[2]}:00` : `${day}T00:00:00`
}

/** The inspection's state in the words the repair order already uses for it. */
export function inspectionWord(row: FeedRow): string {
  if (row.customer_approved === true) return 'Customer approved work'
  if (row.sent_to_customer === true) return 'Waiting on customer'
  const overall = str(row.overall_status)
  return overall === '' || overall === 'pending' ? 'Not started' : 'Being checked'
}

export interface FeedRows {
  docs: FeedRow[]
  jobs: FeedRow[]
  appointments: FeedRow[]
  messages: FeedRow[]
  calls: FeedRow[]
  inspections: FeedRow[]
  notes: FeedRow[]
}

export interface FeedWho {
  /** The customer being shown. A row that names a different customer is dropped. */
  customerId: string
  /** From feedPhoneKey; '' means texts and calls cannot be matched. */
  phone: string
  /** Turns a repair order status into its plain word. The default leaves it as stored. */
  jobWord?: (status: string) => string
}

/** A row that carries a customer id belongs here only when that id is this customer's. A row with none is let through only where the caller says so. */
const mine = (row: FeedRow, customerId: string, allowBlank: boolean): boolean => {
  const owner = str(row.customer_id)
  return owner === customerId || (allowBlank && owner === '')
}

/**
 * The feed for one customer from the rows read for each kind: only rows that are this customer's, at most FEED_KIND_LIMIT of
 * each kind (rows arrive newest first), mapped, put in time order and cut to FEED_MAX_ITEMS. `total` is how many there were
 * before the cut.
 */
export function buildFeed(rows: FeedRows, who: FeedWho): { items: TimelineItem[]; total: number } {
  const word = who.jobWord || ((s: string) => s)
  const first = <T>(list: T[]): T[] => list.slice(0, FEED_KIND_LIMIT)
  // An appointment or an inspection with no customer id of its own is kept only when something else ties it to this customer
  // (the phone number, or one of this customer's repair orders, which the route already checked before reading it).
  const input: TimelineInput = {
    docs: first(rows.docs.filter(d => mine(d, who.customerId, false))).map(d => {
      let total = 0
      let balance = 0
      try {
        const t = calculateDocumentTotals(d)
        total = t.total
        balance = t.balanceDue
      } catch { /* a document with unreadable lines still shows, without an amount */ }
      return { id: str(d.id), type: str(d.type), status: str(d.status), number: str(d.doc_number), at: str(d.created_at), total, balance }
    }),
    jobs: first(rows.jobs.filter(j => mine(j, who.customerId, false))).map(j => ({
      id: str(j.id), ro: str(j.ro_number), concern: str(j.concern), status: word(str(j.status)), at: str(j.created_at),
      car: [str(j.vehicle_year), str(j.vehicle_make), str(j.vehicle_model)].filter(Boolean).join(' '),
    })),
    appointments: first(rows.appointments.filter(a => mine(a, who.customerId, true) && (str(a.customer_id) === who.customerId || sameNumber(a.phone, who.phone)))).map(a => ({
      id: str(a.id), at: appointmentAt(a.date, a.time, a.created_at), service: str(a.service), status: str(a.status),
    })),
    messages: first(rows.messages.filter(m => sameNumber(m.from_address, who.phone) || sameNumber(m.to_address, who.phone))).map(m => ({
      id: str(m.id), at: str(m.created_at), direction: str(m.direction), body: str(m.body).slice(0, BODY_CUT),
    })),
    calls: first(rows.calls.filter(c => sameNumber(c.from_number, who.phone) || sameNumber(c.to_number, who.phone))).map(c => ({
      id: str(c.id), at: str(c.start_time), direction: str(c.direction), seconds: Number(c.duration_secs) || 0, status: str(c.status),
    })),
    inspections: first(rows.inspections.filter(n => mine(n, who.customerId, true))).map(n => ({
      id: str(n.id), at: str(n.created_at), title: str(n.vehicle) ? `Inspection of ${str(n.vehicle)}` : 'Inspection', status: inspectionWord(n),
    })),
    notes: first(rows.notes.filter(n => mine(n, who.customerId, false))).map(n => ({
      id: str(n.id), at: str(n.created_at), body: str(n.body).slice(0, BODY_CUT), author: str(n.author_name), pinned: n.pinned === true,
    })),
  }
  const all = buildTimeline(input)
  return { items: all.slice(0, FEED_MAX_ITEMS), total: all.length }
}

type Read = PromiseLike<{ data: unknown; error: unknown }>

/**
 * Reads one kind. `attempts` are tried in order, and the next one only when the one before said the table or a column is not
 * there yet (a database update the shop has not had). A kind that cannot be read comes back empty with a short plain note
 * saying so, never as an error, so the rest of the feed still shows.
 */
export async function readKind(label: string, attempts: Array<() => Read>): Promise<{ rows: FeedRow[]; note: string }> {
  let missing = false
  for (const attempt of attempts) {
    try {
      const { data, error } = await attempt()
      if (!error) return { rows: Array.isArray(data) ? (data as FeedRow[]) : [], note: '' }
      missing = isMissingDbObject(error)
      if (!missing) break
    } catch {
      missing = false
      break
    }
  }
  return { rows: [], note: missing ? `${label} are not set up yet, so they are left out.` : `${label} could not be read, so they are left out.` }
}
