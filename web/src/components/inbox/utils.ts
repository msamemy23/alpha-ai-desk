// Types and helpers for the Inbox (texts and calls). Everything here is pure.

export interface CallRecord {
  id: string
  call_id: string
  direction: string
  from_number: string
  to_number: string
  duration_secs: number
  status: string
  start_time: string
  end_time: string
  matched_customer_name: string | null
  transcript: string | null
  lead_score: string | null
  lead_reasoning: string | null
  service_needed: string | null
  caller_sentiment: string | null
  key_quotes: string | null
  call_count_from_number: number | null
  raw_data: any
  /** True when the AI assistant handled this call (it comes from ai_calls). */
  viaAi?: boolean
}

export interface Message {
  id: string
  direction: string
  channel: string
  from_address: string
  to_address: string
  body: string
  status: string
  read: boolean
  created_at: string
  customer_id?: string | null
  customer?: { name: string; phone: string; email: string } | null
  subject?: string
  /** True for texts the AI assistant wrote and sent. */
  ai_handled?: boolean
}

export interface Thread {
  /** Stable key: last ten digits of the number. Used in the URL. */
  key: string
  /** The address texts are sent to. */
  contact: string
  name: string
  customerId: string | null
  /** Oldest first. */
  messages: Message[]
  unread: number
  last: Message
}

export interface ContactRef { id: string; name: string; phone: string; email: string }

export const digitsOnly = (v: unknown) => String(v ?? '').replace(/\D/g, '')
export const digits10 = (v: unknown) => digitsOnly(v).slice(-10)

/** Key used to group a phone number. Short or odd values keep their own text. */
export function contactKey(v: unknown): string {
  const d = digitsOnly(v)
  return d.length >= 10 ? d.slice(-10) : String(v ?? '').trim().toLowerCase()
}

export function formatDuration(s: number | null | undefined): string {
  if (!s || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
const dayDiff = (a: Date, b: Date) => {
  const x = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const y = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((x - y) / 86_400_000)
}

export function clock(iso: string): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/** Time for the right edge of a list row: clock today, then Yesterday, weekday, date. */
export function listTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  if (sameDay(d, now)) return clock(iso)
  const diff = dayDiff(now, d)
  if (diff === 1) return 'Yesterday'
  if (diff > 1 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

/** "Today, 9:14 AM", "Yesterday, 4:02 PM", "Mon, 8:10 AM" or "Oct 3, 8:10 AM". */
export function stamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const diff = dayDiff(now, d)
  const t = clock(iso)
  if (diff === 0) return `Today, ${t}`
  if (diff === 1) return `Yesterday, ${t}`
  if (diff > 1 && diff < 7) return `${d.toLocaleDateString('en-US', { weekday: 'short' })}, ${t}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })}, ${t}`
}

/** Heading between days in a thread. */
export function dayHeading(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  const diff = dayDiff(now, d)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

export type DeliveryTone = 'ok' | 'wait' | 'fail'

/** Plain words for how an outgoing text went. */
export function deliveryOf(m: Pick<Message, 'direction' | 'status'>): { label: string; tone: DeliveryTone } | null {
  if (m.direction === 'inbound') return null
  const s = String(m.status || '').toLowerCase()
  if (['failed', 'undelivered', 'delivery_failed', 'delivery_unconfirmed', 'error', 'rejected', 'blocked'].includes(s)) return { label: 'Not delivered', tone: 'fail' }
  if (['queued', 'sending', 'pending', 'accepted', 'scheduled'].includes(s)) return { label: 'Sending', tone: 'wait' }
  if (s === 'delivered') return { label: 'Delivered', tone: 'ok' }
  if (s === 'read') return { label: 'Read', tone: 'ok' }
  return { label: 'Sent', tone: 'ok' }
}

export type CallKind = 'missed' | 'incoming' | 'outgoing'

const MISSED_WORDS = /miss|no.?answer|unanswer|busy|cancel|fail|abandon|voicemail/i

/** Missed means nobody talked: a missed status, or an incoming call under 15 seconds. */
export function callKind(direction: string, status: string | null | undefined, durationSecs: number | null | undefined, viaAi = false): CallKind {
  const incoming = direction === 'inbound' || direction === 'in'
  if (!incoming) return 'outgoing'
  if (viaAi) return 'incoming'
  if (MISSED_WORDS.test(String(status || ''))) return 'missed'
  if ((Number(durationSecs) || 0) < 15) return 'missed'
  return 'incoming'
}

/* ---------- how much phone time the shop used ---------- */

export interface CallTime {
  calls: number
  incoming: number
  outgoing: number
  missed: number
  /** Seconds on the phone, added up from the length each call record carries. */
  seconds: number
  /** Calls the assistant handled that carry no length, so they are not in `seconds`. */
  unmeasuredAi: number
}

/** First moment of the month `now` is in, and of the month before and the month after (the browser's own calendar). */
export function monthBounds(now: Date): { prev: Date; start: Date; next: Date } {
  const y = now.getFullYear()
  const m = now.getMonth()
  return { prev: new Date(y, m - 1, 1), start: new Date(y, m, 1), next: new Date(y, m + 1, 1) }
}

/** Calls that started in [from, to): how many, which way, and how many seconds they lasted. A bad time or length counts as nothing. */
export function callTimeIn(
  calls: Pick<CallRecord, 'direction' | 'status' | 'duration_secs' | 'start_time' | 'viaAi'>[],
  from: Date,
  to: Date,
): CallTime {
  const out: CallTime = { calls: 0, incoming: 0, outgoing: 0, missed: 0, seconds: 0, unmeasuredAi: 0 }
  const a = from.getTime()
  const b = to.getTime()
  for (const c of calls) {
    const t = new Date(c.start_time).getTime()
    if (!Number.isFinite(t) || t < a || t >= b) continue
    const secs = Math.max(0, Math.floor(Number(c.duration_secs) || 0))
    out.calls += 1
    out.seconds += secs
    const kind = callKind(c.direction, c.status, secs, c.viaAi === true)
    out[kind] += 1
    if (c.viaAi === true && secs === 0) out.unmeasuredAi += 1
  }
  return out
}

/** How many call records the Inbox asks for. If it gets this many, older calls may be missing. */
export const CALL_LOAD_LIMIT = 1500

/** True when the list may be missing calls from the month that starts at `start`: it is full and even its oldest call is inside that month. */
export function mayMissCalls(calls: Pick<CallRecord, 'start_time'>[], start: Date): boolean {
  if (calls.length < CALL_LOAD_LIMIT) return false
  let oldest = Infinity
  for (const c of calls) {
    const t = new Date(c.start_time).getTime()
    if (Number.isFinite(t) && t < oldest) oldest = t
  }
  return oldest >= start.getTime()
}

/** "42 min", "4 h 12 min". Under a minute is "under a minute" so a tiny total is not shown as zero. */
export function formatTalkTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0))
  if (s === 0) return '0 min'
  const min = Math.floor(s / 60)
  if (min === 0) return 'under a minute'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const r = min % 60
  return r === 0 ? `${h} h` : `${h} h ${r} min`
}

export const CALL_KIND_LABEL: Record<CallKind, string> = { missed: 'Missed', incoming: 'Incoming', outgoing: 'Outgoing' }
export const CALL_KIND_LAMP: Record<CallKind, string> = { missed: 'lamp-red', incoming: 'lamp-green', outgoing: 'lamp-blue' }
export const CALL_KIND_TEXT: Record<CallKind, string> = { missed: 'text-red', incoming: 'text-green', outgoing: 'text-blue' }

/** Where the recording for a call can be played from, if there is one. */
export function recordingUrl(call: { raw_data?: any }): string | null {
  const rd = call.raw_data
  if (!rd) return null
  if (rd.download_urls?.mp3) return `/api/recording-proxy?url=${encodeURIComponent(rd.download_urls.mp3)}`
  if (rd.download_urls?.wav) return `/api/recording-proxy?url=${encodeURIComponent(rd.download_urls.wav)}`
  if (rd.recording_id) return `/api/recording-proxy?id=${rd.recording_id}`
  if (rd.recording_url) return `/api/recording-proxy?url=${encodeURIComponent(rd.recording_url)}`
  return null
}

export function otherNumber(c: Pick<CallRecord, 'direction' | 'from_number' | 'to_number'>): string {
  return c.direction === 'inbound' || c.direction === 'in' ? c.from_number : c.to_number
}

export function dialNumber(number: string, name?: string) {
  if (!number) return
  window.dispatchEvent(new CustomEvent('phone:call', { detail: { number, name } }))
}
