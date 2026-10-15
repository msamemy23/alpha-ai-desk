/**
 * Which texts count as "new" for an alert, and the words for it. Pure.
 * The first load never alerts (everything on screen is already there); later loads alert once per text.
 */

export interface AlertMessage {
  id: string
  direction: string
  body: string
  created_at: string
  read: boolean
  from_address: string
}

/** Incoming texts nobody has read and that were not on screen before. `seen` is the set of ids from earlier loads. */
export function freshInbound<M extends AlertMessage>(seen: Set<string> | null, messages: M[], now = Date.now(), maxAgeMs = 10 * 60_000): M[] {
  if (seen === null) return []
  return messages.filter(m => m.direction === 'inbound' && !m.read && !seen.has(m.id) && now - Date.parse(m.created_at) < maxAgeMs)
}

/** One notification for a batch: who texted and the start of what they said. Never longer than a phone shows. */
export function alertWords(fresh: AlertMessage[], nameFor: (m: AlertMessage) => string): { title: string; body: string } | null {
  if (fresh.length === 0) return null
  const last = fresh[fresh.length - 1]
  const names = [...new Set(fresh.map(nameFor))]
  const who = names.length === 1 ? names[0] : `${names.length} people`
  const title = fresh.length === 1 ? `${who} texted you` : `${fresh.length} new texts from ${who}`
  const text = String(last.body || '').replace(/\s+/g, ' ').trim()
  const body = text ? (text.length > 120 ? `${text.slice(0, 117)}...` : text) : 'Sent a picture'
  return { title, body }
}

/** The browser tab title with the unread count in front, so a shop with the Inbox open in another tab sees it. */
export function tabTitle(base: string, unread: number): string {
  const clean = base.replace(/^\(\d+\)\s*/, '')
  return unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${clean}` : clean
}
