import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { authenticateHost, submitResult } from '@/lib/browser/host-store'
import { LIMITS } from '@/lib/browser/guard'
import { problem, readJson, reply } from '@/lib/browser/server'
import { getServiceClient } from '@/lib/supabase'
import type { Db } from '@/lib/browser/store'

export const dynamic = 'force-dynamic'

/** A paired computer sends back what it did. */
export async function POST(req: Request) {
  const db = getServiceClient() as unknown as Db
  const header = req.headers.get('authorization') || ''
  const who = await authenticateHost(db, header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '')
  if (!who) return problem('This computer is not connected. Pair it again in Alpha.', 401)
  const hit = checkRateLimit(rateLimitKey('browser:result', who.hostId, who.shopId), LIMITS.host.limit, LIMITS.host.windowMs)
  if (!hit.ok) return problem('Slow down.', 429)
  const body = await readJson(req, 1_500_000) as { commandId?: unknown; result?: unknown } | null
  if (!body || typeof body.commandId !== 'string') return problem('That result was not understood.', 400)
  const stored = await submitResult(db, who.shopId, who.hostId, body.commandId, body.result)
  return stored ? reply({ ok: true }) : problem('That result was not accepted. The request may have run out of time.', 409)
}
