import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIp } from '@/lib/booking'
import { DB_TIMEOUT_MS, healthBody, healthStatus, withTimeout } from '@/lib/health'

export const dynamic = 'force-dynamic'

/**
 * "Is Alpha Desk up?" for an uptime monitor. Open to anyone, so it is small and strict:
 *
 * - It asks the database for one row id (never a name, number or message) and gives up after 4 seconds.
 * - It answers 200 with `{ ok: true, database: "up" }`, or 503 when the database does not answer. A monitor reads the status code.
 * - It says nothing about what is configured, no table names and no error text. The reason goes to the server log only.
 * - One address may ask 60 times a minute and the whole site 600; past that it answers 429 and does no work.
 * - The answer is never cached. GET and HEAD both work, because many monitors use HEAD.
 */
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, max-age=0' }

async function check(req: NextRequest, head: boolean) {
  const ip = clientIp({ forwardedFor: req.headers.get('x-forwarded-for'), realIp: req.headers.get('x-real-ip') })
  if (!checkRateLimit(`health:${ip}`, 60, 60_000).ok || !checkRateLimit('health:all', 600, 60_000).ok) {
    return new Response(head ? null : JSON.stringify({ ok: false, error: 'Too many checks. Try again in a minute.' }), {
      status: 429, headers: { ...HEADERS, 'retry-after': '60' },
    })
  }

  let up = false
  let reason = ''
  try {
    const db = getServiceClient()
    const answer = await withTimeout(db.from('shop_profiles').select('id').limit(1), DB_TIMEOUT_MS)
    if (answer.timedOut) reason = 'timeout'
    else if (answer.value.error) reason = String(answer.value.error.message || 'error').slice(0, 120)
    else up = true
  } catch (e) {
    reason = e instanceof Error ? e.message.slice(0, 120) : 'error'
  }
  // The reason stays in the log. A caller only ever learns up or down.
  if (!up) console.error(JSON.stringify({ event: 'health_check_failed', reason }))

  const body = healthBody(up, new Date(), process.env.VERCEL_GIT_COMMIT_SHA)
  return new Response(head ? null : JSON.stringify(body), { status: healthStatus(body), headers: HEADERS })
}

export async function GET(req: NextRequest) { return check(req, false) }
export async function HEAD(req: NextRequest) { return check(req, true) }
