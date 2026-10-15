/**
 * Plain "what the assistant did this month" numbers for the owner.
 * The counts come from the audit log (every assistant action is already
 * recorded there), so there is no separate counter to keep in step.
 *
 * Pure module: no imports from '@/'.
 */

export type UsageCounts = { changes: number; messages: number; lookups: number }

/** First instant of the month containing `now`, and of the next month (UTC). */
export function monthRange(now: Date = new Date()): { from: string; to: string; label: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start)
  return { from: start.toISOString(), to: end.toISOString(), label }
}

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

/** "12 changes, 3 messages and 40 look-ups" - skips the parts that are zero. */
export function describeUsage(counts: UsageCounts): { total: number; headline: string; breakdown: string } {
  const total = counts.changes + counts.messages + counts.lookups
  const parts = [
    counts.changes ? plural(counts.changes, 'change', 'changes') : '',
    counts.messages ? plural(counts.messages, 'message', 'messages') : '',
    counts.lookups ? plural(counts.lookups, 'look-up', 'look-ups') : '',
  ].filter(Boolean)
  const breakdown = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || 'Nothing yet'
  return { total, headline: plural(total, 'assistant action', 'assistant actions'), breakdown }
}
