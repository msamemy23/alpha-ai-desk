import type { Db, DbError } from './db-types.ts'
import { cleanDigest } from './client-errors.ts'
import type { ErrorReport } from './client-errors.ts'
import { isMissingSchemaError } from './report-docs.ts'
import { KEEP_DAYS, LIST_DAYS, MAX_PROBLEMS_PER_DAY, groupProblems, totalCount } from './problems.ts'
import type { Problem, ProblemRow } from './problems.ts'

/**
 * Keeps and reads the daily counts of reported screen problems. Server only; the database is passed in so tests can stand in for it.
 *
 * Nothing here throws. A report that cannot be counted (the database update not applied yet, the database busy) is dropped
 * and the caller still answers 204: losing one count must never break the reporter or show an error to a customer.
 */

/** The count table or its function is not in the database yet (the update has not been applied). */
function missing(error: DbError | null): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  return isMissingSchemaError(error) || code === '42883' || code === 'PGRST202'
}

export type RecordOutcome = 'recorded' | 'counted' | 'capped' | 'skipped'

/** The day a count belongs to, as year-month-day in UTC. */
export function dayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** Counts one cleaned report for this shop. Returns what happened; never throws. */
export async function recordProblem(db: Db, shopId: string, report: ErrorReport, now: Date = new Date()): Promise<RecordOutcome> {
  try {
    const { data, error } = await db.rpc('record_client_error', {
      p_shop: shopId,
      p_day: dayKey(now),
      p_kind: report.kind,
      p_path: report.path,
      p_reference: cleanDigest(report.digest),
      p_message: report.message,
      p_max_rows: MAX_PROBLEMS_PER_DAY,
      p_keep_days: KEEP_DAYS,
    })
    if (error) return 'skipped'
    return data === 'recorded' || data === 'counted' || data === 'capped' ? data : 'skipped'
  } catch {
    return 'skipped'
  }
}

export type ProblemList = { state: 'ok'; problems: Problem[] } | { state: 'needs-update'; problems: [] } | { state: 'failed'; problems: [] }

const sinceOf = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString()

async function rowsSince(db: Db, shopId: string, since: string): Promise<{ rows: ProblemRow[]; state: 'ok' | 'needs-update' | 'failed' }> {
  try {
    const { data, error } = await db.from('client_error_counts')
      .select('day,kind,path,reference,message,count,first_seen,last_seen')
      .eq('shop_id', shopId).gte('last_seen', since).order('last_seen', { ascending: false }).limit(300)
    if (error) return { rows: [], state: missing(error) ? 'needs-update' : 'failed' }
    return { rows: (data || []) as unknown as ProblemRow[], state: 'ok' }
  } catch {
    return { rows: [], state: 'failed' }
  }
}

/** The list for the Settings screen: the last 7 days, one entry per distinct problem, most recent first. */
export async function listProblems(db: Db, shopId: string, now: Date = new Date()): Promise<ProblemList> {
  const r = await rowsSince(db, shopId, sinceOf(now, LIST_DAYS))
  if (r.state === 'needs-update') return { state: 'needs-update', problems: [] }
  if (r.state === 'failed') return { state: 'failed', problems: [] }
  return { state: 'ok', problems: groupProblems(r.rows) }
}

/** How many times something broke in the last day, for the heads-up on Today. Zero when it cannot be read. */
export async function problemsLastDay(db: Db, shopId: string, now: Date = new Date()): Promise<number> {
  const r = await rowsSince(db, shopId, sinceOf(now, 1))
  return r.state === 'ok' ? totalCount(groupProblems(r.rows)) : 0
}
