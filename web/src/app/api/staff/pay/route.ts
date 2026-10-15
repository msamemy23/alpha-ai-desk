import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { isMissingDbObject } from '@/lib/db-missing'
import { normalizePay } from '@/lib/jobtime'
import { audit } from '@/lib/people-audit'

export const dynamic = 'force-dynamic'

/** What people are paid is private: only an owner or admin can see or change it. */
const CAN_SEE_PAY = new Set(['owner', 'admin'])
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status })

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!CAN_SEE_PAY.has(auth.role)) return NextResponse.json({ ok: true, allowed: false, available: true, rates: [] })
  try {
    const { data, error } = await getServiceClient().from('staff_pay').select('staff_id,method,hourly_rate,flat_rate,commission_pct').eq('shop_id', auth.shopId).limit(500)
    if (error) {
      if (isMissingDbObject(error)) return NextResponse.json({ ok: true, allowed: true, available: false, rates: [] })
      throw error
    }
    return NextResponse.json({ ok: true, allowed: true, available: true, rates: data || [] })
  } catch (e) {
    console.error('[staff/pay] load:', e instanceof Error ? e.message : e)
    return fail(500, 'Pay rates could not be loaded.')
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  if (!CAN_SEE_PAY.has(auth.role)) return fail(403, 'Only an owner or admin can change pay rates.')
  const raw = await req.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(400, 'Send the request as JSON.')
  const body = raw as Record<string, unknown>
  const staffId = Number(body.staff_id)
  if (!Number.isInteger(staffId) || staffId <= 0) return fail(400, 'Choose a person.')
  const pay = normalizePay(body)
  const needed = pay.method === 'hourly' ? pay.hourly : pay.method === 'flat' ? pay.flat : pay.commissionPct
  if (needed === null) return fail(400, pay.method === 'commission' ? 'Enter a commission between 0 and 100 percent.' : 'Enter a rate between 0 and 1,000 dollars an hour.')
  try {
    const sb = getServiceClient()
    const who = await sb.from('staff').select('id,name').eq('shop_id', auth.shopId).eq('id', staffId).maybeSingle()
    if (who.error) throw who.error
    if (!who.data) return fail(404, 'That person is not on your team.')
    const { error } = await sb.from('staff_pay').upsert({
      shop_id: auth.shopId, staff_id: staffId, method: pay.method, hourly_rate: pay.hourly, flat_rate: pay.flat, commission_pct: pay.commissionPct,
      updated_by: auth.userId, updated_at: new Date().toISOString(),
    }, { onConflict: 'shop_id,staff_id' })
    if (error) {
      if (isMissingDbObject(error)) return fail(400, 'Pay rates need a database update. Ask whoever set up the app to apply it.', { code: 'pay_unavailable' })
      throw error
    }
    await audit(auth, 'staff.pay', { type: 'staff', id: staffId }, { staff: String(who.data.name), method: pay.method })
    return NextResponse.json({ ok: true, rate: pay })
  } catch (e) {
    console.error('[staff/pay] save:', e instanceof Error ? e.message : e)
    return fail(500, 'The pay rate could not be saved. Try again in a moment.')
  }
}
