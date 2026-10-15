import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { createVoiceClientState } from '@/lib/voice-state'
import { startDurableCall } from '@/lib/durable-call'
import { inQuietHours } from '@/lib/voice/hours'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const to = typeof body?.to === 'string' ? body.to.trim() : ''
    if (!to) return NextResponse.json({ ok: false, error: 'Missing to' }, { status: 400 })

    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings')
      .select('telnyx_api_key,telnyx_phone_number,telnyx_connection_id,timezone')
      .eq('shop_id', auth.shopId)
      .maybeSingle()
    if (settingsError) return NextResponse.json({ ok: false, error: 'Shop calling settings could not be loaded' }, { status: 500 })

    const apiKey = String(settings?.telnyx_api_key || '')
    const shopPhone = String(settings?.telnyx_phone_number || '')
    const connectionId = String(settings?.telnyx_connection_id || '')
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin}/api/telnyx-voice-webhook`
    if (!apiKey || !shopPhone || !connectionId) return NextResponse.json({ ok: false, error: 'Telnyx calling is not configured for this shop' }, { status: 503 })

    const digits = to.replace(/\D/g, '')
    if (![10, 11].includes(digits.length) || (digits.length === 11 && !digits.startsWith('1'))) {
      return NextResponse.json({ ok: false, error: 'Enter a valid US phone number' }, { status: 400 })
    }
    const e164 = digits.length === 11 ? `+${digits}` : `+1${digits}`
    const callTask = typeof body?.task === 'string' ? body.task.slice(0, 2000) : ''
    // A call the assistant runs follows calling hours: nothing before 8 am or after 9 pm, shop time. A personal call is the owner dialing and is not held back.
    if (callTask && inQuietHours({ enabled: true, from: '21:00', to: '08:00' }, String(settings?.timezone || 'America/Chicago'), new Date())) {
      return NextResponse.json({ ok: false, error: 'AI calls are only placed between 8 am and 9 pm, shop time. Try again in the morning, or call the customer yourself.' }, { status: 409 })
    }
    const callerName = typeof body?.callerName === 'string'
      ? body.callerName.slice(0, 160)
      : typeof body?.name === 'string' ? body.name.slice(0, 160) : e164

    const result = await startDurableCall({
      request: req,
      db,
      shopId: auth.shopId,
      userId: auth.userId,
      to: e164,
      task: callTask,
      callerName,
      start: async () => {
        const clientState = createVoiceClientState({
          shopId: auth.shopId,
          task: callTask,
          name: typeof body?.name === 'string' ? body.name.slice(0, 160) : e164,
          callerName,
        })
        let response: Response
        try {
          response = await fetch('https://api.telnyx.com/v2/calls', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connection_id: connectionId,
              to: e164,
              from: shopPhone,
              client_state: clientState,
              webhook_url: webhookUrl,
              webhook_url_method: 'POST',
              answering_machine_detection: 'disabled',
              // No recording starts here. The call webhook starts it right after the assistant says the call may be recorded;
              // a personal call is never recorded because nothing warned the other person.
            }),
            signal: AbortSignal.timeout(30_000),
          })
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Telnyx call request timed out')
        }
        const data = await response.json().catch(() => ({})) as Record<string, unknown>
        if (!response.ok) {
          const errors = Array.isArray(data.errors) ? data.errors[0] : null
          const detail = errors && typeof errors === 'object' && errors !== null && 'detail' in errors ? String(errors.detail) : 'Call failed'
          return { ok: false, status: response.status >= 400 && response.status < 500 ? response.status : 502, error: detail }
        }
        const providerCallId = data.data && typeof data.data === 'object' && data.data !== null && 'call_control_id' in data.data
          ? String(data.data.call_control_id || '')
          : ''
        return providerCallId ? { ok: true, callId: providerCallId } : { ok: true, error: 'Telnyx did not return a call id' }
      },
      record: async (callId) => {
        const existing = await db.from('ai_calls').select('id,shop_id').eq('id', callId).maybeSingle()
        if (existing.error) return { ok: false, error: existing.error.message }
        if (existing.data && String(existing.data.shop_id) !== auth.shopId) {
          return { ok: false, error: 'The provider returned a call id already owned by another shop' }
        }
        const row = {
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
        }
        const saved = existing.data
          ? await db.from('ai_calls').update(row).eq('id', callId).eq('shop_id', auth.shopId)
          : await db.from('ai_calls').insert(row)
        const error = saved.error
        return { ok: !error, error: error?.message }
      },
    })

    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, uncertain: result.uncertain === true, ...(result.callId ? { callId: result.callId } : {}) }, { status: result.status })
    return NextResponse.json({ ok: true, callId: result.callId, idempotent: result.idempotent, ...(result.auditPending ? { audit_pending: true } : {}), ...(result.auditError ? { audit_error: result.auditError } : {}) })
  } catch (error) {
    console.error('[make-call] error:', error)
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Call could not be started' }, { status: 500 })
  }
}
