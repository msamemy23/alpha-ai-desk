import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { normalizeRole } from '@/lib/timeclock'

export const dynamic = 'force-dynamic'

type Db = ReturnType<typeof getServiceClient>
type Row = Record<string, unknown>

/** Changing who is on the team is for owners and managers. Everyone signed in can read the list. */
const CAN_MANAGE = new Set(['owner', 'admin', 'manager'])
const COLUMNS = 'id,name,role,active,created_at'

const fail = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status })

function problem(e: unknown, what: string) {
  console.error(`[staff] ${what}:`, e instanceof Error ? e.message : e)
  return fail(500, 'The team list could not be saved. Try again in a moment.')
}

const cleanName = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const params = new URL(req.url).searchParams
  const role = params.get('role') // "technician" and so on, or none for everyone
  const everyone = params.get('include_inactive') === '1'

  try {
    const sb = getServiceClient()
    let query = sb.from('staff').select(COLUMNS).eq('shop_id', auth.shopId).order('name')
    if (!everyone) query = query.eq('active', true)
    const { data, error } = await query
    if (error) throw error
    let staff = (data || []) as Row[]
    // Older rows say "service_advisor" or "advisor". Filtering after the read keeps both.
    if (role) staff = staff.filter(s => normalizeRole(s.role) === normalizeRole(role) || String(s.role) === role)
    return NextResponse.json({ ok: true, staff })
  } catch (e) {
    // A failed read is an error, not an empty team: the screens show a "try again" instead of "no one yet".
    console.error('[staff] load:', e instanceof Error ? e.message : e)
    return fail(500, 'The team list could not be loaded.')
  }
}

async function activeNames(sb: Db, shopId: string): Promise<{ id: number; name: string }[]> {
  const { data, error } = await sb.from('staff').select('id,name').eq('shop_id', shopId).eq('active', true)
  if (error) throw error
  return (data || []).map(r => ({ id: Number(r.id), name: String(r.name) }))
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  if (!CAN_MANAGE.has(auth.role)) return fail(403, 'Only an owner or manager can change the team.')

  const raw = await req.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(400, 'Send the request as JSON.')
  const body = raw as Row
  const action = String(body.action || '')
  const shopId = auth.shopId

  try {
    const sb = getServiceClient()

    if (action === 'add') {
      const name = cleanName(body.name)
      if (!name) return fail(400, 'Enter a name.')
      if (name.length > 60) return fail(400, 'Keep the name under 60 letters.')
      const role = body.role === undefined || body.role === '' ? 'technician' : normalizeRole(body.role)
      if (!role) return fail(400, 'Choose a role from the list.')
      const taken = (await activeNames(sb, shopId)).some(s => s.name.toLowerCase() === name.toLowerCase())
      if (taken) return fail(409, `${name} is already on the team.`)
      const { data, error } = await sb.from('staff').insert({ shop_id: shopId, name, role, active: true }).select(COLUMNS).single()
      if (error) throw error
      return NextResponse.json({ ok: true, staff: data })
    }

    if (action === 'update' || action === 'deactivate') {
      const id = Number(body.id)
      if (!Number.isInteger(id) || id <= 0) return fail(400, 'Choose a person.')
      const { data: before, error: readError } = await sb.from('staff').select('id,name,role,active').eq('shop_id', shopId).eq('id', id).maybeSingle()
      if (readError) throw readError
      if (!before) return fail(404, 'That person is not on your team.')

      const updates: Row = {}
      let newName = String(before.name)
      if (action === 'deactivate') updates.active = false
      else {
        if (body.name !== undefined) {
          newName = cleanName(body.name)
          if (!newName) return fail(400, 'Enter a name.')
          if (newName.length > 60) return fail(400, 'Keep the name under 60 letters.')
          updates.name = newName
        }
        if (body.role !== undefined) {
          const role = normalizeRole(body.role)
          if (!role) return fail(400, 'Choose a role from the list.')
          updates.role = role
        }
        if (body.active !== undefined) updates.active = body.active === true
      }
      if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true, staff: before })

      const willBeActive = updates.active === undefined ? before.active !== false : updates.active === true
      if (willBeActive && (updates.name !== undefined || updates.active === true)) {
        const clash = (await activeNames(sb, shopId)).some(s => s.id !== id && s.name.toLowerCase() === newName.toLowerCase())
        if (clash) return fail(409, `${newName} is already on the team.`)
      }

      // Someone still on the clock cannot be removed: their hours would be left running.
      if (updates.active === false && before.active !== false) {
        const running = await sb.from('timeclock').select('id').eq('shop_id', shopId).is('clock_out', null).eq('staff_id', id).limit(1)
        if (running.error) throw running.error
        const byName = await sb.from('timeclock').select('id').eq('shop_id', shopId).is('clock_out', null).is('staff_id', null).eq('staff_name', String(before.name)).limit(1)
        if (byName.error) throw byName.error
        if ((running.data && running.data.length) || (byName.data && byName.data.length)) {
          return fail(409, `${before.name} is still clocked in. Clock them out first.`)
        }
      }

      const { data, error } = await sb.from('staff').update(updates).eq('id', id).eq('shop_id', shopId).select(COLUMNS).single()
      if (error) throw error

      // Jobs, appointments and punches store the person's name. A rename follows them so nothing is orphaned.
      let warning = ''
      const oldName = String(before.name)
      if (updates.name !== undefined && newName !== oldName) {
        const failed: string[] = []
        for (const [table, column] of [['jobs', 'tech'], ['appointments', 'tech']] as const) {
          const r = await sb.from(table).update({ [column]: newName }).eq('shop_id', shopId).eq(column, oldName)
          if (r.error) failed.push(table)
        }
        const byId = await sb.from('timeclock').update({ staff_name: newName }).eq('shop_id', shopId).eq('staff_id', id)
        const legacy = await sb.from('timeclock').update({ staff_name: newName, staff_id: id }).eq('shop_id', shopId).is('staff_id', null).eq('staff_name', oldName)
        if (byId.error || legacy.error) failed.push('time clock')
        if (failed.length) warning = `Renamed, but the name could not be updated on: ${failed.join(', ')}.`
      }
      return NextResponse.json({ ok: true, staff: data, ...(warning ? { warning } : {}) })
    }

    return fail(400, 'Unknown action.')
  } catch (e) {
    return problem(e, action || 'post')
  }
}
