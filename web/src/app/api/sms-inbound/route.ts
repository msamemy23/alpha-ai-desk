export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { handleInboundSms } from '@/lib/sms-inbound'
import { normalizeInbound } from '@/lib/sms-normalize'

// Inbound-SMS webhook for the PHONE gateway (TextBee / httpSMS / custom).
// When SMS goes through your own phone, the gateway app forwards each received
// text here. Point the gateway's "received message" webhook at:
//   https://alpha-ai-desk.vercel.app/api/sms-inbound?secret=YOUR_SECRET
// and set SMS_INBOUND_SECRET to the same value (optional but recommended — the
// gateways don't sign their webhooks).

export async function POST(req: NextRequest) {
  // Optional shared-secret gate.
  const secret = process.env.SMS_INBOUND_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'SMS_INBOUND_SECRET not configured' }, { status: 500 })
  }
  if (secret) {
    const provided = req.nextUrl.searchParams.get('secret') || req.headers.get('x-sms-secret') || ''
    if (provided !== secret) return NextResponse.json({ ok: false }, { status: 401 })
  }

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const { from, text, messageId } = normalizeInbound(body)

    if (!from || !text) {
      return NextResponse.json({ ok: true, skipped: 'missing from/text' })
    }

    await handleInboundSms({ from, body: text, messageId })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('Phone SMS inbound error:', e)
    return NextResponse.json({ ok: true })
  }
}
