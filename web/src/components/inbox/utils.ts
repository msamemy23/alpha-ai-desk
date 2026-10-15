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
