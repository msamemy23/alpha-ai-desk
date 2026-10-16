/**
 * The Group or tag choice on the Customers list. One value picks everyone, a group (new, repeat, not seen in 6 months, no
 * phone, looks like test data) or a tag. Groups use the rules in segments.ts, over numbers the list already has; this file
 * adds nothing to how a group is decided. Imports only the segment and duplicate helpers.
 */
import { SEGMENTS, inSegment } from './segments.ts'
import type { SegmentKey } from './segments.ts'
import { looksLikeTest } from './duplicates.ts'

/** The groups the list can work out honestly from what it loads. Top spenders and opted out need money and consent records it does not read. */
export const LIST_GROUPS: SegmentKey[] = ['new', 'repeat', 'lapsed', 'no_phone', 'test']

export const groupLabel = (key: SegmentKey): string => SEGMENTS.find(s => s.key === key)?.label || key

export type GroupChoice = { kind: 'all' } | { kind: 'group'; key: SegmentKey } | { kind: 'tag'; tag: string }

/** "all", "g:new" or "t:fleet" as kept in a select, read back into a choice. Anything unrecognised means everyone. */
export function parseChoice(value: string): GroupChoice {
  if (value.startsWith('g:')) {
    const key = value.slice(2) as SegmentKey
    if (LIST_GROUPS.includes(key)) return { kind: 'group', key }
  }
  if (value.startsWith('t:') && value.length > 2) return { kind: 'tag', tag: value.slice(2) }
  return { kind: 'all' }
}

export interface ListCustomer { id: string; name?: unknown; phone?: unknown; email?: unknown; created_at?: unknown }
export interface ListContext {
  /** Repair orders and the newest visit per customer id, as the list already loads them. */
  visits: Record<string, { jobs: number; last: string }>
  /** Tags per customer id. */
  tags: Record<string, string[]>
  now: number
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export function matchesChoice(choice: GroupChoice, c: ListCustomer, ctx: ListContext): boolean {
  if (choice.kind === 'all') return true
  const tags = ctx.tags[c.id] || []
  if (choice.kind === 'tag') return tags.some(t => same(t, choice.tag))
  const v = ctx.visits[c.id]
  return inSegment(choice.key, {
    createdAt: String(c.created_at ?? ''),
    visits: v ? v.jobs : 0,
    lastVisit: v ? v.last : '',
    owed: 0,
    spend: 0,
    hasPhone: String(c.phone ?? '').replace(/\D/g, '').length >= 7,
    optedOut: false,
    tags,
    accountId: '',
    looksTest: looksLikeTest({ name: c.name, email: c.email }) !== null,
  }, ctx.now, Infinity)
}

/** How many customers fall in each group, for the counts beside the names. */
export function groupCounts(list: ListCustomer[], ctx: ListContext): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of LIST_GROUPS) out[key] = list.filter(c => matchesChoice({ kind: 'group', key }, c, ctx)).length
  return out
}

/** The sentence for an empty result, so a filter that matches nobody says why. */
export function emptyChoiceTitle(choice: GroupChoice): string {
  if (choice.kind === 'tag') return `Nobody is tagged “${choice.tag}”`
  if (choice.kind === 'group') return `Nobody is in “${groupLabel(choice.key)}”`
  return 'No customers'
}
