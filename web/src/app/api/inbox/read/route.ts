export const dynamic = 'force-dynamic'
import { authed, fail, ok, readBody } from '@/lib/receptionist-api'

/** Marks received texts as read. The browser may not change messages itself, so opening a thread comes here. */
export async function POST(req: Request) {
  const a = await authed({ write: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const body = await readBody(req)
  const raw = Array.isArray(body?.ids) ? (body?.ids as unknown[]) : []
  const ids = [...new Set(raw.filter((v): v is string | number => (typeof v === 'string' && v.length > 0 && v.length <= 64) || typeof v === 'number'))].slice(0, 200)
  if (ids.length === 0) return fail('Nothing to mark.')
  // Only this shop's received texts, and only unread ones, so the change is tight and repeating it is harmless.
  const { error } = await db.from('messages').update({ read: true }).eq('shop_id', auth.shopId).eq('direction', 'inbound').eq('read', false).in('id', ids)
  if (error) return fail('Could not mark them read.', 500)
  return ok({ marked: ids.length })
}
