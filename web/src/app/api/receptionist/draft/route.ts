export const dynamic = 'force-dynamic'
import { authed, fail, isUuid, ok, readBody } from '@/lib/receptionist-api'

/**
 * Drafts are replies the assistant wrote but did not send because the shop wants to approve them first.
 * The person sends the (possibly edited) text through the normal send route; this only closes the draft afterwards.
 */
export async function POST(req: Request) {
  const a = await authed({ write: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const body = await readBody(req)
  if (!body || !isUuid(body.interactionId)) return fail('Missing conversation.')
  const action = body.action === 'sent' ? 'sent' : body.action === 'dismiss' ? 'dismiss' : ''
  if (!action) return fail('Unknown action.')
  const { data: row } = await db.from('ai_interactions').select('id,detail,outcome').eq('shop_id', auth.shopId).eq('id', body.interactionId).maybeSingle()
  if (!row) return fail('Not found.', 404)
  const detail = { ...(row.detail || {}), draft: null }
  const now = new Date().toISOString()
  const { error } = await db.from('ai_interactions').update({
    detail, seen_at: now, updated_at: now, outcome: row.outcome === 'draft' ? (action === 'sent' ? 'answered' : 'silent') : row.outcome,
  }).eq('shop_id', auth.shopId).eq('id', body.interactionId)
  return error ? fail('Could not save.', 500) : ok({})
}
