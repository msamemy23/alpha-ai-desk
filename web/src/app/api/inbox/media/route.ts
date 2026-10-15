export const dynamic = 'force-dynamic'
export const maxDuration = 20
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { authed, fail, ok, readBody } from '@/lib/receptionist-api'
import { mediaForMessages, storeOutgoing } from '@/lib/voice/media-store'
import { phoneKey } from '@/lib/voice/rules'

/** Which of these texts have pictures or video. `ids` is a comma-separated list of message ids. */
export async function GET(req: Request) {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const ids = (new URL(req.url).searchParams.get('ids') || '').split(',').map(s => s.trim()).filter(Boolean)
  const found = await mediaForMessages(db, auth.shopId, ids)
  return ok({ items: found.items, unavailable: found.unavailable })
}

/** Stores one picture (already shrunk by the browser) so it can be attached to the next text. */
export async function POST(req: Request) {
  const a = await authed({ write: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const limited = checkRateLimit(rateLimitKey('inbox-media', auth.userId, auth.shopId, ''), 30, 60_000)
  if (!limited.ok) return fail('Too many pictures at once. Wait a minute.', 429)
  const body = await readBody(req)
  if (!body) return fail('Nothing to upload.')
  const stored = await storeOutgoing(db, auth.shopId, { contentType: String(body.contentType || ''), base64: String(body.data || ''), contactKey: phoneKey(body.to) })
  if (!stored.ok) return fail(stored.error, stored.unavailable ? 503 : 400, { unavailable: stored.unavailable === true })
  return ok({ id: stored.id, bytes: stored.bytes })
}
