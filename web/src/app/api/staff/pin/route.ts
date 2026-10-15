import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { isMissingDbObject } from '@/lib/db-missing'
import { hashPin, validatePin } from '@/lib/pin'
import { audit } from '@/lib/people-audit'

export const dynamic = 'force-dynamic'

const CAN_MANAGE = new Set(['owner', 'admin', 'manager'])
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status })

/** Which people have a PIN. The PINs themselves are never sent anywhere. */
export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!CAN_MANAGE.has(auth.role)) return fail(403, 'Only an owner or manager can see PIN status.')
  try {
    const { data, error } = await getServiceClient().from('staff_pins').select('staff_id,locked_until').eq('shop_id', auth.shopId).limit(500)
    if (error) {
      if (isMissingDbObject(error)) return NextResponse.json({ ok: true, available: false, pins: [] })
      throw error
    }
    return NextResponse.json({ ok: true, available: true, pins: (data || []).map(r => ({ staff_id: Number(r.staff_id), locked_until: r.locked_until || null })) })
  } catch (e) {
    console.error('[staff/pin] load:', e instanceof Error ? e.message : e)
    return fail(500, 'PIN status could not be loaded.')
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  if (!CAN_MANAGE.has(auth.role)) return fail(403, 'Only an owner or manager can set PINs.')
  const raw = await req.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(400, 'Send the request as JSON.')
  const body = raw as Record<string, unknown>
  const staffId = Number(body.staff_id)
  if (!Number.isInteger(staffId) || staffId <= 0) return fail(400, 'Choose a person.')
  try {
    const sb = getServiceClient()
    const who = await sb.from('staff').select('id,name').eq('shop_id', auth.shopId).eq('id', staffId).maybeSingle()
    if (who.error) throw who.error
    if (!who.data) return fail(404, 'That person is not on your team.')
    const name = String(who.data.name)

    if (body.clear === true) {
      const { data, error } = await sb.from('staff_pins').delete().eq('shop_id', auth.shopId).eq('staff_id', staffId).select('staff_id')
      if (error) {
        if (isMissingDbObject(error)) return fail(400, 'PINs need a database update. Ask whoever set up the app to apply it.', { code: 'pins_unavailable' })
        throw error
      }
      if (!data || data.length === 0) return fail(404, `${name} does not have a PIN.`)
      await audit(auth, 'staff.pin_clear', { type: 'staff', id: staffId }, { staff: name })
      return NextResponse.json({ ok: true })
    }

    const check = validatePin(body.pin)
    if (!check.ok) return fail(400, check.error)
    const { error } = await sb.from('staff_pins').upsert({
      shop_id: auth.shopId, staff_id: staffId, pin_hash: hashPin(check.pin), failed_count: 0, locked_until: null, set_by: auth.userId, updated_at: new Date().toISOString(),
    }, { onConflict: 'shop_id,staff_id' })
    if (error) {
      if (isMissingDbObject(error)) return fail(400, 'PINs need a database update. Ask whoever set up the app to apply it.', { code: 'pins_unavailable' })
      throw error
    }
    await audit(auth, 'staff.pin_set', { type: 'staff', id: staffId }, { staff: name })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[staff/pin] save:', e instanceof Error ? e.message : e)
    return fail(500, 'The PIN could not be saved. Try again in a moment.')
  }
}
