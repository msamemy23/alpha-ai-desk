import { NextRequest, NextResponse } from 'next/server'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_PHONE   = process.env.TELNYX_PHONE   || '+17136636979'
const TELNYX_CONN_ID = process.env.TELNYX_CONN_ID || '2912878759822493204'
const PUBLIC_URL     = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : (process.env.NEXT_PUBLIC_APP_URL || 'https://alpha-ai-desk.vercel.app')

export async function POST(req: NextRequest) {
  try {
    const { to, task, callerName } = await req.json()
    if (!to) return NextResponse.json({ ok: false, error: 'Missing to' }, { status: 400 })

    const digits = to.replace(/\D/g, '')
    const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`

    const webhookUrl = `${PUBLIC_URL}/api/telnyx-voice-webhook`
    const clientState = Buffer.from(JSON.stringify({
      task: task || 'Have a helpful conversation',
      callerName: callerName || 'Alpha International Auto Center',
    })).toString('base64')

    const res = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        connection_id:              TELNYX_CONN_ID,
        to:                         e164,
        from:                       TELNYX_PHONE,
        from_display_name:          'Alpha Auto Center',
        answering_machine_detection:'disabled',
        webhook_url:                webhookUrl,
        client_state:               clientState,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      const err = data?.errors?.[0]?.detail || JSON.stringify(data)
      return NextResponse.json({ ok: false, error: err }, { status: 500 })
    }

    const callId = data.data.call_control_id
    return NextResponse.json({ ok: true, callId, to: e164 })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
