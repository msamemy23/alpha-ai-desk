import { NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIp, sameOrigin } from '@/lib/booking'
import { MAX_BODY_BYTES, cleanReport } from '@/lib/client-errors'

export const dynamic = 'force-dynamic'

/**
 * A screen broke in someone's browser and tells us, so it shows up in the server log next to the matching server error.
 *
 * - It writes one line to the log. It does not touch the database, send a message or call any other service.
 * - It is open to people who are not signed in, because the sign-in page can break too. So it is strict:
 *   the request must come from a page on this site, the body is at most 4 KB, each visitor gets 10 reports a minute
 *   and the whole site 120 a minute, and every field is cut down again here (no emails, phone numbers, tokens or
 *   query strings) even though the browser already did it.
 * - It always answers 204 with no body. A caller learns nothing about why a report was dropped.
 */
const NO_CONTENT = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })

export async function POST(req: NextRequest) {
  const host = {
    origin: req.headers.get('origin'),
    referer: req.headers.get('referer'),
    host: req.headers.get('host'),
    forwardedHost: req.headers.get('x-forwarded-host'),
  }
  if (!sameOrigin(host)) return NO_CONTENT()

  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > MAX_BODY_BYTES) return NO_CONTENT()

  const ip = clientIp({ forwardedFor: req.headers.get('x-forwarded-for'), realIp: req.headers.get('x-real-ip') })
  if (!checkRateLimit(`client-error:${ip}`, 10, 60_000).ok) return NO_CONTENT()
  if (!checkRateLimit('client-error:all', 120, 60_000).ok) return NO_CONTENT()

  let text = ''
  try { text = await req.text() } catch { return NO_CONTENT() }
  // content-length can be missing or wrong; the real size is what was read.
  if (text.length > MAX_BODY_BYTES) return NO_CONTENT()

  let body: unknown = null
  try { body = JSON.parse(text) } catch { return NO_CONTENT() }

  const report = cleanReport(body)
  if (!report) return NO_CONTENT()

  // One line of JSON so a log search for "client_error" finds every one.
  console.error(JSON.stringify({ event: 'client_error', ...report }))
  return NO_CONTENT()
}
