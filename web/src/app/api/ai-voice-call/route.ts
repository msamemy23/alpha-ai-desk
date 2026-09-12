import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { createVoiceClientState } from '@/lib/voice-state'


export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const body = await req.json().catch(() => null)
    const { to, task, callerName } = body || {}
    if (typeof to !== 'string' || !to.trim()) return NextResponse.json({ ok: false, error: 'Missing to' }, { status: 400 })
    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('telnyx_api_key,telnyx_phone_number,telnyx_connection_id').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) return NextResponse.json({ ok: false, error: 'Shop calling settings could not be loaded' }, { status: 500 })
    const apiKey = String(settings?.telnyx_api_key || '')
    const fromPhone = String(settings?.telnyx_phone_number || '')
    const connectionId = String(settings?.telnyx_connection_id || '')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
    if (!apiKey || !fromPhone || !connectionId) return NextResponse.json({ ok: false, error: 'Telnyx calling is not configured for this shop' }, { status: 503 })

    const digits = to.replace(/\D/g, '')
    if (![10, 11].includes(digits.length) || (digits.length === 11 && !digits.startsWith('1'))) return NextResponse.json({ ok: false, error: 'Enter a valid US phone number' }, { status: 400 })
    const e164   = digits.length === 10 ? `+1${digits}` : `+${digits}`

    const webhookUrl  = `${appUrl}/api/telnyx-voice-webhook`
    const safeTask = typeof task === 'string' ? task.slice(0, 2000) : 'Have a helpful conversation'
    const clientState = createVoiceClientState({
      shopId: auth.shopId,
      task: safeTask,
      callerName: typeof callerName === 'string' ? callerName.slice(0, 160) : fromPhone,
    })

    const res = await fetch('https://api.telnyx.com/v2/calls', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_id:               connectionId,
        to:                          e164,
        from:                        fromPhone,
        from_display_name:           'AI Call',
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

    const { error: callLogError } = await db.from('ai_calls').insert({
      id: callId,
      shop_id: auth.shopId,
      task: task || 'Have a helpful conversation',
      status: 'dialing',
      started_at: Date.now(),
      greeted: false,
      processing: false,
    })
    if (callLogError) return NextResponse.json({ ok: true, callId, warning: 'Call started but could not be logged' }, { status: 207 })

    return NextResponse.json({ ok: true, callId, to: e164 })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
