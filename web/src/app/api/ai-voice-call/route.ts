import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_PHONE   = process.env.TELNYX_PHONE   || '+17136636979'
const TELNYX_CONN_ID = process.env.TELNYX_CONN_ID || '2912878759822493204'

// Always use the stable custom domain — never the deployment-specific VERCEL_URL
const APP_URL = 'https://alpha-ai-desk.vercel.app'

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const { to, task, callerName } = await req.json()
    if (!to) return NextResponse.json({ ok: false, error: 'Missing to' }, { status: 400 })
    if (!TELNYX_API_KEY) return NextResponse.json({ ok: false, error: 'Telnyx is not configured' }, { status: 500 })

    const digits = to.replace(/\D/g, '')
    const e164   = digits.length === 10 ? `+1${digits}` : `+${digits}`

    const webhookUrl  = `${APP_URL}/api/telnyx-voice-webhook`
    const clientState = Buffer.from(JSON.stringify({
      task:       task || 'Have a helpful conversation',
      callerName: callerName || 'Alpha International Auto Center',
    })).toString('base64')

    const res = await fetch('https://api.telnyx.com/v2/calls', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_id:               TELNYX_CONN_ID,
        to:                          e164,
        from:                        TELNYX_PHONE,
        from_display_name:           'Alpha Auto Center',
        answering_machine_detection: 'disabled',
        webhook_url:                 webhookUrl,
        client_state:                clientState,
        // Record the call so the user can listen back
        record:                      'record-from-answer',
        record_channels:             'dual',
        record_format:               'mp3',
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      const err = data?.errors?.[0]?.detail || JSON.stringify(data)
      return NextResponse.json({ ok: false, error: err }, { status: 500 })
    }

    const callId = data.data.call_control_id

    await getServiceClient().from('ai_calls').insert({
      id: callId,
      shop_id: auth.shopId,
      task: task || 'Have a helpful conversation',
      status: 'dialing',
      started_at: Date.now(),
      greeted: false,
      processing: false,
    })

    return NextResponse.json({ ok: true, callId, to: e164 })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
