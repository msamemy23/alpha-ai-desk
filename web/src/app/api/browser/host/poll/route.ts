import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { authenticateHost, nextCommand } from '@/lib/browser/host-store'
import { LIMITS } from '@/lib/browser/guard'
import { problem, reply } from '@/lib/browser/server'
import { getServiceClient } from '@/lib/supabase'
import type { Db } from '@/lib/browser/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function bearer(req: Request): string {
  const h = req.headers.get('authorization') || ''
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : ''
}

/** "Anything for me?" from a paired computer. Waits a few seconds for a command before saying no. */
export async function POST(req: Request) {
  const db = getServiceClient() as unknown as Db
  const who = await authenticateHost(db, bearer(req))
  if (!who) return problem('This computer is not connected. Pair it again in Alpha.', 401)
  const hit = checkRateLimit(rateLimitKey('browser:poll', who.hostId, who.shopId), LIMITS.host.limit * 2, LIMITS.host.windowMs)
  if (!hit.ok) return problem('Slow down.', 429)
  const until = Date.now() + 12_000
  for (;;) {
    const command = await nextCommand(db, who.shopId, who.hostId)
    if (command) return reply({ ok: true, command })
    if (Date.now() + 1500 > until) break
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  return reply({ ok: true, command: null, wait: 2 })
}
