/**
 * Stop that really stops the server.
 *
 * Pressing Stop records a request for one conversation turn. The server asks
 * "was I told to stop?" between steps: before each model call and before each
 * look-up. It never asks in the middle of an approved change, so a Stop cannot
 * leave a change half done: either the change had not started (and does not
 * start) or it had started (and finishes and is reported).
 *
 * Stored in ai_run_cancels (migration 044). If that table is not there yet, the
 * request is kept in this server instance's memory, which still stops work that
 * is running here. The client's own abort covers the rest.
 *
 * The database client is passed in so this is tested without a database.
 */

type Db = { from: (table: string) => any }
export type CancelScope = { shopId: string; userId: string; sessionId: string; turnId: string }

/** Requests older than this are ignored, so a stale Stop can never stop a later turn. */
export const CANCEL_WINDOW_MS = 15 * 60_000
// Shared through globalThis so the cancel route and the workflow route see the same requests
// even when the framework bundles them separately.
const holder = globalThis as unknown as { __aiRunCancels?: Map<string, number> }
const local: Map<string, number> = holder.__aiRunCancels || (holder.__aiRunCancels = new Map<string, number>())

const keyOf = (scope: CancelScope) => [scope.shopId, scope.userId, scope.sessionId, scope.turnId].join('|')
const tableMissing = (error: { code?: string; message?: string } | null) => Boolean(error) && (error?.code === '42P01' || error?.code === 'PGRST205' || /schema cache|does not exist/i.test(error?.message || ''))

function pruneLocal(now: number) {
  for (const [key, at] of local) if (now - at > CANCEL_WINDOW_MS) local.delete(key)
}

export async function requestCancel(db: Db, scope: CancelScope, now = Date.now()): Promise<{ stored: 'database' | 'memory' }> {
  pruneLocal(now)
  local.set(keyOf(scope), now)
  try {
    const { error } = await db.from('ai_run_cancels').upsert({
      shop_id: scope.shopId, user_id: scope.userId, session_id: scope.sessionId, turn_id: scope.turnId, requested_at: new Date(now).toISOString(),
    }, { onConflict: 'shop_id,user_id,session_id,turn_id' })
    if (!error) return { stored: 'database' }
    if (!tableMissing(error)) console.error('[ai-run-control] cancel could not be stored:', error.message)
  } catch (error) {
    console.error('[ai-run-control] cancel could not be stored:', error instanceof Error ? error.message : 'unknown')
  }
  return { stored: 'memory' }
}

/**
 * Returns a function the engine calls between steps. True means: stop planning now.
 * The database is asked at most once per `pollMs`; the browser's own abort signal
 * and this instance's memory are checked every time.
 */
export function makeStopCheck(db: Db, scope: CancelScope, options: { signal?: AbortSignal; pollMs?: number; now?: () => number } = {}): () => Promise<boolean> {
  const pollMs = options.pollMs ?? 600
  const clock = options.now ?? Date.now
  let lastPoll = -Infinity
  let stopped = false
  return async () => {
    if (stopped) return true
    if (options.signal?.aborted) return (stopped = true)
    const now = clock()
    const at = local.get(keyOf(scope))
    if (at !== undefined && now - at <= CANCEL_WINDOW_MS) return (stopped = true)
    if (now - lastPoll < pollMs) return false
    lastPoll = now
    try {
      const since = new Date(now - CANCEL_WINDOW_MS).toISOString()
      const { data, error } = await db.from('ai_run_cancels').select('requested_at')
        .eq('shop_id', scope.shopId).eq('user_id', scope.userId).eq('session_id', scope.sessionId).eq('turn_id', scope.turnId)
        .gte('requested_at', since).limit(1).maybeSingle()
      if (!error && data) return (stopped = true)
    } catch { /* a failed check never stops work by itself */ }
    return false
  }
}

/** Test helper: forget in-memory requests. */
export function clearLocalCancels() {
  local.clear()
}
