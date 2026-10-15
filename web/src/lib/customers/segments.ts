/**
 * Customer groups for the Customers screen: new, repeat, lapsed, top spenders and so on. Each is a plain rule over numbers
 * the screen already has, so a group always shows its real count. Imports nothing.
 */

export type SegmentKey = 'all' | 'owes' | 'new' | 'repeat' | 'lapsed' | 'top' | 'no_phone' | 'opted_out' | 'fleet' | 'test'

export interface SegInput {
  createdAt: string
  visits: number
  lastVisit: string
  owed: number
  spend: number
  hasPhone: boolean
  optedOut: boolean
  tags: string[]
  accountId: string
  looksTest: boolean
}

export const SEGMENTS: { key: SegmentKey; label: string; help: string }[] = [
  { key: 'all', label: 'Everyone', help: 'Every customer.' },
  { key: 'owes', label: 'Owes money', help: 'Has an unpaid invoice.' },
  { key: 'new', label: 'New', help: 'Added in the last 60 days.' },
  { key: 'repeat', label: 'Repeat', help: 'Two or more repair orders.' },
  { key: 'lapsed', label: 'Not seen in 6 months', help: 'Had a visit, but none in the last 6 months.' },
  { key: 'top', label: 'Top spenders', help: 'The top tenth by money paid.' },
  { key: 'fleet', label: 'Fleet', help: 'On a fleet account or tagged fleet.' },
  { key: 'no_phone', label: 'No phone', help: 'No phone number on file.' },
  { key: 'opted_out', label: 'Opted out of texts', help: 'Replied STOP or was marked do not text.' },
  { key: 'test', label: 'Looks like test data', help: 'Names or emails that look typed in to try things out.' },
]

const DAY = 86_400_000

/** The spend a customer needs to be in the top tenth: the 90th percentile of customers who have paid anything. Needs at least 10 payers. */
export function topSpendCut(spends: number[]): number {
  const paid = spends.filter(n => n > 0).sort((a, b) => a - b)
  if (paid.length < 10) return Infinity
  return paid[Math.min(paid.length - 1, Math.floor(paid.length * 0.9))]
}

export function inSegment(key: SegmentKey, c: SegInput, nowMs: number, topCut: number): boolean {
  switch (key) {
    case 'all': return true
    case 'owes': return c.owed > 0.005
    case 'new': { const t = Date.parse(c.createdAt); return Number.isFinite(t) && nowMs - t <= 60 * DAY }
    case 'repeat': return c.visits >= 2
    case 'lapsed': { const t = Date.parse(c.lastVisit); return Number.isFinite(t) && nowMs - t > 182 * DAY }
    case 'top': return c.spend > 0 && c.spend >= topCut
    case 'fleet': return !!c.accountId || c.tags.some(t => t.toLowerCase() === 'fleet')
    case 'no_phone': return !c.hasPhone
    case 'opted_out': return c.optedOut
    case 'test': return c.looksTest
  }
}

/** Tags as typed, cleaned up: trimmed, no commas, at most 24 characters each, no repeats (case ignored), at most 12 tags. */
export function cleanTags(list: unknown): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const items = Array.isArray(list) ? list : typeof list === 'string' ? list.split(',') : []
  for (const raw of items) {
    const t = String(raw ?? '').replace(/[\u0000-\u001f\u007f,;|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24)
    const k = t.toLowerCase()
    if (!t || seen.has(k)) continue
    seen.add(k)
    out.push(t)
    if (out.length >= 12) break
  }
  return out
}
