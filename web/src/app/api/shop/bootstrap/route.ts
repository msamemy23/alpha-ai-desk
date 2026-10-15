import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getSessionUser, unauthorized } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

/**
 * Shop creation is deliberately server-mediated. The old browser-callable
 * SECURITY DEFINER RPC allowed every signed-in browser to execute the
 * bootstrap function directly. This route authenticates the session first,
 * then calls the service-role-only function with that exact user id.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return unauthorized()

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const shopName = typeof body.shop_name === 'string'
    ? body.shop_name.trim().slice(0, 120)
    : ''

  try {
    const { data, error } = await getServiceClient().rpc('bootstrap_shop_profile', {
      p_user_id: user.id,
      p_shop_name: shopName || 'My Shop',
    })
    if (error) {
      console.error('[shop/bootstrap] database bootstrap failed:', error.message)
      const status = error.code === '42501' ? 403 : 500
      return NextResponse.json({ ok: false, error: status === 403 ? error.message : 'Your shop could not be initialized.' }, { status })
    }
    if (!data || typeof data !== 'object' || typeof (data as Record<string, unknown>).id !== 'string') {
      return NextResponse.json({ ok: false, error: 'Your shop could not be initialized.' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, data })
  } catch (error) {
    console.error('[shop/bootstrap] unexpected error:', error)
    return NextResponse.json({ ok: false, error: 'Your shop could not be initialized.' }, { status: 500 })
  }
}
