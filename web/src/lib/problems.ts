/**
 * "Problems reported": the plain-words list of screens that broke for someone in the shop.
 *
 * When a screen breaks for a signed-in person, the browser already sends a cleaned report (lib/client-errors.ts). The server keeps a
 * COUNT of each distinct problem per day for that shop: which screen, what kind, the short reference and the cleaned message.
 * It keeps no name, no phone number, no email address and nothing anyone typed, because the report never had them.
 *
 * Nothing in this file imports anything, so the screens, the routes and the tests use the same rules.
 */

/** Only the owner and admins see this list and the heads-up on the Today screen. */
export const PROBLEM_ROLES = ['owner', 'admin'] as const

/** Distinct problems kept for one shop on one day. The rest are dropped, so a loop that throws all day cannot fill the table. */
export const MAX_PROBLEMS_PER_DAY = 200
/** How many days a count is kept. */
export const KEEP_DAYS = 30
/** How many days the list looks back. */
export const LIST_DAYS = 7

export interface ProblemRow {
  day: string
  kind: string
  path: string
  reference: string
  message: string
  count: number
  first_seen: string
  last_seen: string
}

export interface Problem {
  /** Same screen, kind, reference and message, added up across days. */
  key: string
  kind: string
  path: string
  reference: string
  message: string
  count: number
  first_seen: string
  last_seen: string
}

const KIND_WORDS: Record<string, string> = {
  screen: 'A screen stopped working',
  script: 'A script error',
  promise: 'Something failed in the background',
  app: 'The whole app stopped working',
  page: 'A page failed to load',
}

export function kindWords(kind: string): string {
  return KIND_WORDS[kind] ?? 'Something went wrong'
}

/** "/inventory" becomes "Inventory"; "/jobs/:id" becomes "Jobs"; an unknown or empty path says so. */
export function screenName(path: string): string {
  const parts = String(path || '').split('/').filter(p => p && !p.startsWith(':'))
  if (parts.length === 0) return path === '/' ? 'Today' : 'An unknown screen'
  const first = parts[0].replace(/-/g, ' ')
  return first.charAt(0).toUpperCase() + first.slice(1)
}

/** Merges the day-by-day rows into one entry per distinct problem, most recent first. */
export function groupProblems(rows: ProblemRow[]): Problem[] {
  const by = new Map<string, Problem>()
  for (const r of rows) {
    const key = [r.kind, r.path, r.reference, r.message].join('|')
    const count = Number.isFinite(Number(r.count)) && Number(r.count) > 0 ? Math.floor(Number(r.count)) : 1
    const found = by.get(key)
    if (!found) {
      by.set(key, { key, kind: r.kind, path: r.path, reference: r.reference, message: r.message, count, first_seen: r.first_seen, last_seen: r.last_seen })
    } else {
      found.count += count
      if (r.first_seen && (!found.first_seen || r.first_seen < found.first_seen)) found.first_seen = r.first_seen
      if (r.last_seen && r.last_seen > found.last_seen) found.last_seen = r.last_seen
    }
  }
  return [...by.values()].sort((a, b) => (a.last_seen < b.last_seen ? 1 : a.last_seen > b.last_seen ? -1 : b.count - a.count))
}

export function totalCount(problems: Pick<Problem, 'count'>[]): number {
  return problems.reduce((n, p) => n + p.count, 0)
}

/** "3 problems, 17 times in the last 7 days" or the all-clear. */
export function summaryWords(problems: Pick<Problem, 'count'>[], days = LIST_DAYS): string {
  if (problems.length === 0) return `No problems reported in the last ${days} days.`
  const times = totalCount(problems)
  return `${problems.length} ${problems.length === 1 ? 'problem' : 'problems'}, ${times} ${times === 1 ? 'time' : 'times'} in the last ${days} days.`
}

export function timesWords(count: number): string {
  return count === 1 ? 'Happened once' : `Happened ${count} times`
}

/** The heads-up on the Today screen: how many broke in the last day, and what to do about it. */
export function headsUp(count: number): { title: string; detail: string } {
  return {
    title: `${count} screen ${count === 1 ? 'problem was' : 'problems were'} reported in the last day`,
    detail: 'Open Settings, then Problems reported, to see which screens.',
  }
}

/** The role may see the list. */
export function mayViewProblems(role: unknown): boolean {
  return PROBLEM_ROLES.some(r => r === role)
}
