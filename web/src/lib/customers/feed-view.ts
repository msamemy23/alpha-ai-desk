/**
 * What the customer card does with the feed the route sends: check its shape, count it by filter, narrow it to one filter,
 * and say in words what a row's colour means. Imports only the timeline's names, so it runs anywhere.
 */

import { GROUP_LABEL } from './timeline.ts'
import type { TimelineGroup, TimelineItem, TimelineKind } from './timeline.ts'

export type FeedFilter = 'all' | TimelineGroup

export const FEED_FILTERS: readonly FeedFilter[] = ['all', 'paperwork', 'work', 'messages', 'notes']
/** How many rows show first, and how many more each "Show more" adds. */
export const FEED_PAGE = 20

export const filterLabel = (f: FeedFilter): string => (f === 'all' ? 'All' : GROUP_LABEL[f])

const GROUPS: readonly TimelineGroup[] = ['paperwork', 'work', 'messages', 'notes']
const KINDS: readonly TimelineKind[] = ['estimate', 'invoice', 'receipt', 'job', 'appointment', 'inspection', 'text_in', 'text_out', 'call_in', 'call_out', 'call_missed', 'note']
const TONES = ['neutral', 'good', 'warn', 'bad'] as const

const asText = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The rows from the route, keeping only well-formed ones, so a bad row never breaks the screen. Order is kept. */
export function readFeedItems(raw: unknown): TimelineItem[] {
  if (!Array.isArray(raw)) return []
  const out: TimelineItem[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const group = GROUPS.find(g => g === o.group)
    const kind = KINDS.find(k => k === o.kind)
    const tone = TONES.find(t => t === o.tone)
    const id = asText(o.id)
    if (!id || !group || !kind || !tone) continue
    out.push({
      id, at: asText(o.at), kind, group, title: asText(o.title), detail: asText(o.detail),
      amount: typeof o.amount === 'number' && Number.isFinite(o.amount) ? o.amount : null,
      href: asText(o.href).startsWith('/') ? asText(o.href) : '', tone,
    })
  }
  return out
}

export function countByFilter(items: readonly TimelineItem[]): Record<FeedFilter, number> {
  const counts: Record<FeedFilter, number> = { all: items.length, paperwork: 0, work: 0, messages: 0, notes: 0 }
  for (const i of items) counts[i.group] += 1
  return counts
}

export const itemsFor = (items: readonly TimelineItem[], filter: FeedFilter): TimelineItem[] =>
  filter === 'all' ? [...items] : items.filter(i => i.group === filter)

export type FeedLamp = 'red' | 'amber' | 'green'

/** The lamp and the words beside it for a row that is not plain: money owed, a missed call, something done, something to look at. */
export function toneMark(item: Pick<TimelineItem, 'tone' | 'kind' | 'detail'>): { lamp: FeedLamp; word: string } | null {
  if (item.tone === 'bad') return { lamp: 'red', word: item.kind === 'call_missed' ? 'Missed' : 'Owes money' }
  if (item.tone === 'good') return { lamp: 'green', word: item.detail || 'Done' }
  if (item.tone === 'warn') return { lamp: 'amber', word: item.kind === 'note' ? 'Pinned' : item.detail || 'Needs a look' }
  return null
}

/** Texts, calls and appointments are shown with the time of day; the rest with the day only. */
export const showsTime = (kind: TimelineKind): boolean =>
  kind === 'text_in' || kind === 'text_out' || kind === 'call_in' || kind === 'call_out' || kind === 'call_missed' || kind === 'appointment'

/** The icon name (from components/Icon) for each kind of row. */
export const KIND_ICON: Record<TimelineKind, string> = {
  estimate: 'doc', invoice: 'invoice', receipt: 'invoice', job: 'wrench', appointment: 'calendar', inspection: 'inspect',
  text_in: 'inbox', text_out: 'inbox', call_in: 'phone', call_out: 'phone', call_missed: 'phone', note: 'edit',
}
