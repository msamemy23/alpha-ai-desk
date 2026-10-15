export const dynamic = 'force-dynamic'
import { authed, fail, ok, readBody } from '@/lib/receptionist-api'
import { errKind } from '@/lib/voice/store'
import { phoneKey } from '@/lib/voice/rules'

/** Who is handling which text thread, and the people they can be given to (the shop's active team list). */
export async function GET() {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const [assigned, team] = await Promise.all([
    db.from('thread_assignments').select('contact_key,assignee_id,assignee_name,assigned_at').eq('shop_id', auth.shopId).limit(2000),
    db.from('staff').select('id,name,role').eq('shop_id', auth.shopId).eq('active', true).order('name').limit(100),
  ])
  const unavailable = Boolean(assigned.error && errKind(assigned.error) === 'missing')
  return ok({
    unavailable,
    assignments: assigned.error ? [] : assigned.data || [],
    team: team.error ? [] : ((team.data || []) as Array<{ id: number | string; name: string; role?: string }>).map(t => ({ id: String(t.id), name: String(t.name), role: t.role ? String(t.role) : '' })),
  })
}

/** Give a thread to someone, or take the assignment off (assigneeId empty). */
export async function PUT(req: Request) {
  const a = await authed({ write: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const body = await readBody(req)
  const key = phoneKey(body?.key)
  if (!body || key.length < 7) return fail('Missing number.')
  if (!body.assigneeId) {
    const { error } = await db.from('thread_assignments').delete().eq('shop_id', auth.shopId).eq('contact_key', key)
    return error ? (errKind(error) === 'missing' ? fail('Assigning needs a database update first.', 503, { unavailable: true }) : fail('Could not save.', 500)) : ok({ assignee: null })
  }
  const { data: person, error: pe } = await db.from('staff').select('id,name').eq('shop_id', auth.shopId).eq('active', true).eq('id', Number(body.assigneeId)).maybeSingle()
  if (pe || !person) return fail('That person is not on your team list.', 404)
  const row = { shop_id: auth.shopId, contact_key: key, assignee_id: String(person.id), assignee_name: String(person.name).slice(0, 80), assigned_by: auth.userId, assigned_at: new Date().toISOString() }
  const { error } = await db.from('thread_assignments').upsert(row, { onConflict: 'shop_id,contact_key' })
  if (error) return errKind(error) === 'missing' ? fail('Assigning needs a database update first.', 503, { unavailable: true }) : fail('Could not save.', 500)
  return ok({ assignee: { id: row.assignee_id, name: row.assignee_name } })
}
