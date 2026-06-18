export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { verifyTelnyxSignature } from '@/lib/telnyx-verify'
import { handleInboundSms } from '@/lib/sms-inbound'

// Telnyx inbound-SMS webhook. (Kept for when SMS_PROVIDER=telnyx. When SMS goes
// through your phone instead, replies arrive at /api/sms-inbound.)
export async function POST(req: NextRequest) {
  try {
    // Verify the request really came from Telnyx before acting on it.
    const rawBody = await req.text()
    const sig = req.headers.get('telnyx-signature-ed25519')
    const ts = req.headers.get('telnyx-timestamp')
    if (!verifyTelnyxSignature(rawBody, sig, ts)) {
      return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
    }

    const body = JSON.parse(rawBody)
    const event = body?.data as Record<string, unknown> | undefined

    // Only handle inbound SMS — ignore delivery receipts, status updates, etc.
    if (!event || event.event_type !== 'message.received') {
      return NextResponse.json({ ok: true })
    }

    const msg = event.payload as Record<string, unknown>
    const from = (msg.from as Record<string, unknown>)?.phone_number as string || (msg.from as string) || ''
    const text = (msg.text as string) || ''
    const messageId = (msg.id as string) || ''
    const toNumber = (msg.to as Record<string, unknown>[])?.[0]?.phone_number as string || ''

    await handleInboundSms({ from, body: text, messageId, toNumber })
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('SMS webhook error:', e)
    return NextResponse.json({ ok: true }) // Always 200 to prevent Telnyx retries
  }
}
