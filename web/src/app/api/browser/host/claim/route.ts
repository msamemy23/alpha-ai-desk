import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { claimPairing, PROTOCOL_VERSION } from '@/lib/browser/host-store'
import { LIMITS } from '@/lib/browser/guard'
import { auditShop, problem, readJson, reply } from '@/lib/browser/server'
import { getServiceClient } from '@/lib/supabase'
import type { Db } from '@/lib/browser/store'

export const dynamic = 'force-dynamic'

/**
 * The desktop app sends the pairing code here, once. There is no signed-in person on this request: the one-time code is the
 * proof. It is rate limited by address, expires in minutes, works once, and a wrong guess says nothing about why it failed.
 */
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown').split(',')[0].trim().slice(0, 64)
  const hit = checkRateLimit(rateLimitKey('browser:claim', undefined, undefined, ip), LIMITS.hostClaim.limit, LIMITS.hostClaim.windowMs)
  if (!hit.ok) return problem('Too many tries. Wait a minute and try again.', 429)
  const body = await readJson(req, 4_000) as { code?: unknown; platform?: unknown; appVersion?: unknown } | null
  if (!body) return problem('That code did not work.', 400)
  const claimed = await claimPairing(getServiceClient() as unknown as Db, body.code, { platform: body.platform, appVersion: body.appVersion })
  if (!claimed.ok) return problem('That code did not work. Ask for a new one in Alpha.', 400)
  await auditShop(claimed.shopId, undefined, 'browser.host', { detail: 'A computer finished pairing' })
  return reply({ ok: true, token: claimed.token, hostId: claimed.hostId, protocol: PROTOCOL_VERSION, pollSeconds: 2 })
}
