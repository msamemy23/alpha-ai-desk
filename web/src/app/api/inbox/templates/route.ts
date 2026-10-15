export const dynamic = 'force-dynamic'
import { authed, fail, isUuid, ok, readBody } from '@/lib/receptionist-api'
import { errKind } from '@/lib/voice/store'
import { cleanTemplate, STARTER_TEMPLATES } from '@/lib/voice/templates'

const unavailable = () => fail('Saved replies need a database update first.', 503, { unavailable: true })

/** Saved text replies for this shop. */
export async function GET() {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const { data, error } = await db.from('message_templates').select('id,title,body').eq('shop_id', auth.shopId).order('sort_order').order('created_at').limit(100)
  if (error) return ok({ unavailable: errKind(error) === 'missing', failed: errKind(error) !== 'missing', items: [] })
  return ok({ unavailable: false, failed: false, items: data || [] })
}

/** Adds a reply, or adds the starter set when asked. */
export async function POST(req: Request) {
  const a = await authed({ write: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const body = await readBody(req)
  if (!body) return fail('Nothing to save.')
  if (body.starter === true) {
    const { data: existing, error: e1 } = await db.from('message_templates').select('id').eq('shop_id', auth.shopId).limit(1)
    if (e1) return errKind(e1) === 'missing' ? unavailable() : fail('Could not save.', 500)
    if (existing && existing.length) return fail('You already have saved replies.', 409)
    const rows = STARTER_TEMPLATES.map((t, i) => ({ shop_id: auth.shopId, title: t.title, body: t.body, sort_order: i, created_by: auth.userId }))
    const { error } = await db.from('message_templates').insert(rows)
    return error ? fail('Could not save.', 500) : ok({})
  }
  const t = cleanTemplate(body)
  if (!t.ok) return fail(t.error)
  const { count } = await db.from('message_templates').select('id', { count: 'exact', head: true }).eq('shop_id', auth.shopId)
  if ((count || 0) >= 60) return fail('You can keep up to 60 saved replies. Delete one first.', 409)
  const { data, error } = await db.from('message_templates').insert({ shop_id: auth.shopId, title: t.title, body: t.body, sort_order: count || 0, created_by: auth.userId }).select('id,title,body').maybeSingle()
  if (error) return errKind(error) === 'missing' ? unavailable() : fail('Could not save.', 500)
  return ok({ item: data })
}

export async function PUT(req: Request) {
  const a = await authed({ write: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const body = await readBody(req)
  if (!body || !isUuid(body.id)) return fail('Missing reply.')
  const t = cleanTemplate(body)
  if (!t.ok) return fail(t.error)
  const { data, error } = await db.from('message_templates').update({ title: t.title, body: t.body, updated_at: new Date().toISOString() }).eq('shop_id', auth.shopId).eq('id', body.id).select('id,title,body').maybeSingle()
  if (error) return fail('Could not save.', 500)
  return data ? ok({ item: data }) : fail('Not found.', 404)
}

export async function DELETE(req: Request) {
  const a = await authed({ write: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const id = new URL(req.url).searchParams.get('id')
  if (!isUuid(id)) return fail('Missing reply.')
  const { error } = await db.from('message_templates').delete().eq('shop_id', auth.shopId).eq('id', id)
  return error ? fail('Could not delete.', 500) : ok({})
}
