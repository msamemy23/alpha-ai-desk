export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { sendViaShopPhone, formatPhone } from '@/lib/sms'
import { gatewayOf } from '@/lib/text-channel'
import { dialNumber } from '@/lib/own-phone'
import { isSmsOptedOut } from '@/lib/sms-consent'

// "Send a test text": the owner presses a button in Settings and one text goes through the phone they just set up, to a number they type.
// It only exists to prove the phone is connected before they turn it on. Nothing is saved, and no customer is involved.
export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()

  const limited = checkRateLimit(rateLimitKey('phone-test', auth.userId, auth.shopId, req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'), 3, 60_000)
  if (!limited.ok) return NextResponse.json({ ok: false, error: 'Wait a minute before sending another test.' }, { status: 429 })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const to = dialNumber(body?.to)
  if (!to) return NextResponse.json({ ok: false, error: 'Enter the phone number to send the test to, with its area code.' }, { status: 400 })

  const db = getServiceClient()
  const { data, error } = await db.from('settings').select('*').eq('shop_id', auth.shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return NextResponse.json({ ok: false, error: 'Your settings could not be loaded.' }, { status: 500 })
  const gateway = gatewayOf(data)
  if (!gateway) return NextResponse.json({ ok: false, error: 'Fill in the service, its key and the phone number, and save, before sending a test.' }, { status: 409 })

  try {
    if (await isSmsOptedOut(db, auth.shopId, to)) return NextResponse.json({ ok: false, error: 'That number asked not to get texts from this shop.' }, { status: 409 })
    await sendViaShopPhone(formatPhone(to), `Test from ${String(data?.shop_name || 'Alpha Desk').slice(0, 60)}: your phone is connected. You can ignore this text.`, gateway)
    return NextResponse.json({ ok: true })
  } catch (e) {
    // The service's own sentence (for example a wrong key) is what the owner needs to see.
    return NextResponse.json({ ok: false, error: e instanceof Error && e.message ? e.message : 'The phone service did not accept the test.' }, { status: 502 })
  }
}
