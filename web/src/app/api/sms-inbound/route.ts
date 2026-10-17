export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { handleInboundSms } from '@/lib/sms-inbound'
import { isArrivingText, normalizeInbound } from '@/lib/sms-normalize'
import { getServiceClient } from '@/lib/supabase'
import { inboundAccess, looksLikeShopId } from '@/lib/phone-inbound'

// Inbound-SMS webhook for the PHONE gateway (TextBee / httpSMS / custom).
// When SMS goes through your own phone, the gateway app forwards each received text here.
//
// A shop's own address (Settings, Communications, "Text with my own phone") carries the shop and a code only that shop knows:
//   https://YOUR-APP-ADDRESS/api/sms-inbound?shop=SHOP_ID&secret=SHOP_CODE
// The older deployment-wide form still works for a single-shop setup: set SMS_INBOUND_SECRET and use ?secret=THAT_VALUE. It finds
// the shop from the number the text was sent to, which the gateways do not always include, so the per-shop address is the one to use.
// The gateways don't sign their webhooks, so the code is the only thing standing between this endpoint and fake customer texts.

export async function POST(req: NextRequest) {
  const provided = req.nextUrl.searchParams.get('secret') || req.headers.get('x-sms-secret') || ''
  const shopParam = req.nextUrl.searchParams.get('shop') || ''

  // With a shop in the address, that shop's saved choice is read (only for a well-formed id) and the code must match its own.
  let saved: Record<string, unknown> | null = null
  if (shopParam && looksLikeShopId(shopParam) && provided) {
    const { data, error } = await getServiceClient().from('settings').select('shop_id,sms_channel,phone_gateway_secret').eq('shop_id', shopParam).limit(1).maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: 'Inbound SMS could not be checked' }, { status: 503 })
    saved = (data as Record<string, unknown> | null) ?? null
  }
  const access = inboundAccess({ shopParam, provided, saved, envSecret: process.env.SMS_INBOUND_SECRET })
  if (!access.ok) {
    if ('skipped' in access) return NextResponse.json({ ok: true, skipped: access.skipped })
    return NextResponse.json(access.error ? { ok: false, error: access.error } : { ok: false }, { status: access.status })
  }
  const ownerShopId = access.shopId || ''

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    if (!isArrivingText(body)) return NextResponse.json({ ok: true, skipped: 'not an arriving text' })
    const { from, text, messageId, toNumber } = normalizeInbound(body)

    if (!from || !text) {
      return NextResponse.json({ ok: true, skipped: 'missing from/text' })
    }

    await handleInboundSms({ from, body: text, messageId, toNumber, ...(ownerShopId ? { shopId: ownerShopId } : {}) })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('Phone SMS inbound error:', e)
    return NextResponse.json({ ok: false, error: 'Inbound SMS could not be processed' }, { status: 500 })
  }
}
