export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { verifyTelnyxSignature } from '@/lib/telnyx-verify'
import { handleInboundSms } from '@/lib/sms-inbound'
import { parseCarrierMedia } from '@/lib/voice/media'
import { waitUntil } from '@vercel/functions'

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

    const media = parseCarrierMedia(msg.media)
    // Telnyx answers STOP, START and HELP itself; we still record the choice and never send a second reply.
    const autoResponded = typeof msg.autoresponse_type === 'string' && msg.autoresponse_type.length > 0

    // Answer Telnyx right away; the reply is worked out in the background so a slow assistant never makes Telnyx retry.
    waitUntil(handleInboundSms({ from, body: text, messageId, toNumber, media, autoResponded }).catch(e => {
      console.error('SMS handler error:', e instanceof Error ? e.message : e)
    }))
    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('SMS webhook error:', e)
    return NextResponse.json({ ok: true }) // Always 200 to prevent Telnyx retries
  }
}
