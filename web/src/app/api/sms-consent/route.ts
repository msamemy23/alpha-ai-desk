export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { isSmsOptedOut } from '@/lib/sms-consent'
import { normalizePhoneDigits } from '@/lib/sms-normalize'
import { formatPhone } from '@/lib/sms'

// "Did this number ask not to get texts?" Asked by the From my phone button before it opens Messages, so a text the owner sends by hand
// follows STOP the same way a text Alpha sends does. Answers for the signed-in shop only, from the shop's own STOP list and customer flags.
// When it cannot tell, it says so and the button does not block (the owner is still the one pressing Send).
export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const limited = checkRateLimit(rateLimitKey('sms-consent', auth.userId, auth.shopId, req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'), 60, 60_000)
  if (!limited.ok) return NextResponse.json({ ok: false, error: 'Too many checks. Wait a moment.' }, { status: 429 })

  // The number travels in the request body, not the address, so it never lands in a log of web addresses.
  const body = await req.json().catch(() => null) as { phone?: unknown } | null
  const phone = typeof body?.phone === 'string' ? body.phone : ''
  const digits = normalizePhoneDigits(phone)
  if (digits.length < 10) return NextResponse.json({ ok: true, known: false, optedOut: false })

  try {
    const db = getServiceClient()
    if (await isSmsOptedOut(db, auth.shopId, formatPhone(phone))) return NextResponse.json({ ok: true, known: true, optedOut: true })
    const { data, error } = await db.from('customers').select('phone').eq('shop_id', auth.shopId).eq('sms_opted_out', true).limit(5000)
    if (error) return NextResponse.json({ ok: true, known: false, optedOut: false })
    const flagged = (data || []).some(c => normalizePhoneDigits((c as { phone?: unknown }).phone) === digits)
    return NextResponse.json({ ok: true, known: true, optedOut: flagged })
  } catch {
    return NextResponse.json({ ok: true, known: false, optedOut: false })
  }
}
