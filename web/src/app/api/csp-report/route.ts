import { NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { clientIp } from '@/lib/booking'
import { CSP_MAX_BODY_BYTES, cleanCspReport } from '@/lib/csp'

export const dynamic = 'force-dynamic'

/**
 * Where a browser sends a note when a page does something the report-only security policy would not allow (see lib/csp.ts).
 *
 * - It writes one cleaned line to the log and nothing else: no database, no message, no outside service.
 * - It is open to everyone, because the browser sends it by itself, so it is strict: 8 KB at most, 20 notes a minute per address
 *   and 300 for the whole site, and every field is cut down to a site name, a rule name and a page name with the ids taken out.
 * - Notes from browser add-ons are dropped. It always answers 204 with no body, so a caller learns nothing.
 */
const NO_CONTENT = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } })

export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > CSP_MAX_BODY_BYTES) return NO_CONTENT()

  const ip = clientIp({ forwardedFor: req.headers.get('x-forwarded-for'), realIp: req.headers.get('x-real-ip') })
  if (!checkRateLimit(`csp-report:${ip}`, 20, 60_000).ok) return NO_CONTENT()
  if (!checkRateLimit('csp-report:all', 300, 60_000).ok) return NO_CONTENT()

  let text = ''
  try { text = await req.text() } catch { return NO_CONTENT() }
  // content-length can be missing or wrong; the real size is what was read.
  if (text.length > CSP_MAX_BODY_BYTES) return NO_CONTENT()

  let body: unknown = null
  try { body = JSON.parse(text) } catch { return NO_CONTENT() }

  const report = cleanCspReport(body)
  if (!report) return NO_CONTENT()

  // One line of JSON so a log search for "csp_violation" finds every one.
  console.warn(JSON.stringify({ event: 'csp_violation', ...report }))
  return NO_CONTENT()
}
