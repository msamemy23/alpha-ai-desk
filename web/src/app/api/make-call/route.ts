import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { createVoiceClientState } from '@/lib/voice-state'

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    const body = await req.json().catch(() => null)
    const { to, name, task, callerName } = body || {}
    if (typeof to !== 'string' || !to.trim()) return NextResponse.json({ error: 'Missing to' }, { status: 400 })

    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('telnyx_api_key,telnyx_phone_number,telnyx_connection_id').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) return NextResponse.json({ error: 'Shop calling settings could not be loaded' }, { status: 500 })
    const apiKey = String(settings?.telnyx_api_key || '')
    const shopPhone = String(settings?.telnyx_phone_number || '')
    const connectionId = String(settings?.telnyx_connection_id || '')
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin}/api/telnyx-voice-webhook`
    if (!apiKey || !shopPhone || !connectionId) return NextResponse.json({ error: 'Telnyx calling is not configured for this shop' }, { status: 503 })

    const digits = to.replace(/\D/g, '')
    if (![10, 11].includes(digits.length) || (digits.length === 11 && !digits.startsWith('1'))) return NextResponse.json({ error: 'Enter a valid US phone number' }, { status: 400 })
    const e164 = digits.length === 11 ? '+' + digits : '+1' + digits

    // Build task — use passed task as-is
    // Empty/undefined task = personal call (user just wants to talk, no AI script)
    // Non-empty task = AI call (AI follows these instructions)
    const callTask = typeof task === 'string' ? task.slice(0, 2000) : ''

    // Encode task in client_state so webhook knows what to do
    const clientState = createVoiceClientState({ shopId: auth.shopId, task: callTask, name: typeof name === 'string' ? name.slice(0, 160) : e164, callerName: typeof callerName === 'string' ? callerName.slice(0, 160) : '' })

    const res = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_id: connectionId,
        to: e164,
        from: shopPhone,
        client_state: clientState,
        webhook_url: webhookUrl,
        webhook_url_method: 'POST',
        answering_machine_detection: 'disabled',
      }),
    })

    const data = await res.json()
    if (!res.ok) throw new Error(data.errors?.[0]?.detail || JSON.stringify(data.errors) || 'Call failed')

    const callId = data.data?.call_control_id

    // Pre-create the row so the UI can follow this call in the same shop.
    const { error: callLogError } = await db.from('ai_calls').insert({
      id: callId,
      shop_id: auth.shopId,
      task: callTask,
      caller: e164,
      status: 'calling',
      greeted: false,
      processing: false,
      is_speaking: false,
      script_stage: 0,
      objection_count: 0,
      started_at: Date.now(),
    })
    if (callLogError) {
      console.error('Call started but could not be logged:', callLogError)
      return NextResponse.json({ ok: true, callId, warning: 'Call started, but the call record could not be saved' }, { status: 207 })
    }

    return NextResponse.json({ ok: true, callId })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
