import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { isMissingDbObject } from '@/lib/db-missing'

export const dynamic = 'force-dynamic'

const CAN_SEE = new Set(['owner', 'admin', 'manager'])
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status })

/** Who changed which punch, when, and why, newest first. A removed punch says whether it can still be put back. */
export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!CAN_SEE.has(auth.role)) return fail(403, 'Only an owner or manager can see the change history.')
  const params = new URL(req.url).searchParams
  const from = Date.parse(params.get('from') || '')
  const to = Date.parse(params.get('to') || '')
  const staffId = Number(params.get('staff_id'))
  try {
    const sb = getServiceClient()
    let q = sb.from('time_entry_changes').select('id,entry_id,staff_id,staff_name,action,before_row,after_row,reason,changed_by,changed_at').eq('shop_id', auth.shopId).order('changed_at', { ascending: false }).limit(300)
    if (!isNaN(from)) q = q.gte('changed_at', new Date(from).toISOString())
    if (!isNaN(to)) q = q.lt('changed_at', new Date(to).toISOString())
    if (Number.isInteger(staffId) && staffId > 0) q = q.eq('staff_id', staffId)
    const { data, error } = await q
    if (error) {
      if (isMissingDbObject(error)) return NextResponse.json({ ok: true, available: false, changes: [] })
      throw error
    }
    const rows = (data || []) as Record<string, unknown>[]
    const restored = rows.filter(r => r.action === 'restore')
    const changes = rows.map(r => ({
      ...r,
      restorable: r.action === 'delete' && !restored.some(x => x.entry_id === r.entry_id && String(x.changed_at) > String(r.changed_at)),
    }))
    return NextResponse.json({ ok: true, available: true, changes })
  } catch (e) {
    console.error('[timeclock/changes] load:', e instanceof Error ? e.message : e)
    return fail(500, 'The change history could not be loaded.')
  }
}
