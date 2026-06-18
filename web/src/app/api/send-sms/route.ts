import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { sendSMS, formatPhone } from '@/lib/telnyx'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true, route: 'send-sms' })
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const body = await req.json()
    const to = body.to
    const text = body.message || body.body || ''
    const customerId = body.customer_id || body.customerId || null

    if (!to || !text) {
      return NextResponse.json({ error: 'Missing to or message' }, { status: 400 })
    }

    const db = getServiceClient()
    const { data: settings } = await db.from('settings').select('telnyx_phone_number').eq('shop_id', auth.shopId).limit(1).single()
    const fromNum = settings?.telnyx_phone_number || process.env.TELNYX_PHONE_NUMBER || '+17136636979'

    if (customerId) {
      const { data: customer } = await db.from('customers').select('id').eq('id', customerId).eq('shop_id', auth.shopId).maybeSingle()
      if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const formatted = formatPhone(to)
    const result = await sendSMS(formatted, text) as Record<string,unknown>

    try {
      await db.from('messages').insert({
        shop_id: auth.shopId,
        direction: 'outbound',
        channel: 'sms',
        from_address: fromNum,
        to_address: formatted,
        body: text,
        status: 'sent',
        customer_id: customerId,
        read: true,
        telnyx_message_id: (result?.id as string) || null,
        ai_handled: false,
      })
    } catch { /* logging should not mask a successful provider send */ }

    return NextResponse.json({ success: true, message_id: result?.id })
  } catch (e) {
    console.error('send-sms error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
