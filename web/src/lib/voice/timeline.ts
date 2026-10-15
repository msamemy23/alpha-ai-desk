/**
 * Puts estimates, invoices and the customer's answers into the same list as the texts, in time order.
 * Pure: the route finds the events, the Inbox draws the result.
 */

export interface DocEvent {
  id: string
  document_id: string
  doc_number: string
  doc_type: string
  kind: string
  summary: string
  created_at: string
}

export interface TimelineMessage { id: string; created_at: string }

export type TimelineItem<M extends TimelineMessage> =
  | { type: 'message'; at: string; message: M }
  | { type: 'event'; at: string; event: DocEvent }

/** The moments in a document's life that belong in a conversation. Edits and link housekeeping stay on the document itself. */
const SHOWN = new Set(['sent', 'viewed', 'approved', 'declined', 'partial', 'signed', 'payment', 'converted', 'note', 'supplement', 'void'])

const TITLES: Record<string, string> = {
  sent: 'was sent', viewed: 'was opened by the customer', approved: 'was approved', declined: 'was declined',
  partial: 'was partly approved', signed: 'was signed', payment: 'got a payment', converted: 'became an invoice',
  note: 'got a note from the customer', supplement: 'got more work added', void: 'was voided',
}

export function isThreadEvent(kind: string): boolean { return SHOWN.has(kind) }

/** "Estimate 1042 was approved". */
export function eventHeadline(e: Pick<DocEvent, 'doc_type' | 'doc_number' | 'kind'>): string {
  const type = e.doc_type === 'Estimate' ? 'Estimate' : e.doc_type === 'Receipt' ? 'Receipt' : 'Invoice'
  const what = TITLES[e.kind] || 'was updated'
  return `${type}${e.doc_number ? ` ${e.doc_number}` : ''} ${what}`
}

/** A lamp for the moment: answers that need no work are green, a decline is red, the rest are plain. */
export function eventLamp(kind: string): 'green' | 'amber' | 'red' | 'blue' | 'off' {
  if (kind === 'approved' || kind === 'signed' || kind === 'payment') return 'green'
  if (kind === 'partial' || kind === 'note' || kind === 'supplement') return 'amber'
  if (kind === 'declined' || kind === 'void') return 'red'
  if (kind === 'sent' || kind === 'viewed' || kind === 'converted') return 'blue'
  return 'off'
}

/** Keeps one "opened" moment per document per day, so a customer who reloads the link ten times does not fill the thread. */
export function tidyEvents(events: DocEvent[]): DocEvent[] {
  const seen = new Set<string>()
  const out: DocEvent[] = []
  const sorted = [...events].filter(e => isThreadEvent(e.kind) && Number.isFinite(Date.parse(e.created_at)))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
  for (const e of sorted) {
    if (e.kind === 'viewed') {
      const k = `${e.document_id}|viewed|${e.created_at.slice(0, 10)}`
      if (seen.has(k)) continue
      seen.add(k)
    }
    out.push(e)
  }
  return out
}

export function buildTimeline<M extends TimelineMessage>(messages: M[], events: DocEvent[]): Array<TimelineItem<M>> {
  const items: Array<TimelineItem<M>> = [
    ...messages.map(message => ({ type: 'message' as const, at: message.created_at, message })),
    ...tidyEvents(events).map(event => ({ type: 'event' as const, at: event.created_at, event })),
  ]
  // Stable: when a text and an event share a moment, the text comes first.
  return items
    .map((item, i) => ({ item, i, t: Date.parse(item.at) || 0 }))
    .sort((a, b) => a.t - b.t || (a.item.type === b.item.type ? a.i - b.i : a.item.type === 'message' ? -1 : 1))
    .map(x => x.item)
}
