import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendSMS, formatPhone } from '@/lib/telnyx'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ ok: true, route: 'send-sms' })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const to = body.to
    const text = body.message || body.body || ''
    const customerId = body.customer_id || body.customerId || null

    if (!to || !text) {
      return NextResponse.json({ error: 'Missing to or message' }, { status: 400 })
    }

    const formatted = formatPhone(to)
    const result = await sendSMS(formatted, text) as Record<string,unknown>

    const db = getServiceClient()
    const fromNum = process.env.TELNYX_PHONE_NUMBER || '+17136636979'

    await db.from('messages').insert({
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
    }).catch(() => {})

    return NextResponse.json({ success: true, message_id: result?.id })
  } catch (e) {
    console.error('send-sms error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}