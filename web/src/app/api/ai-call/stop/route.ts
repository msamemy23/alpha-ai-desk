import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { loadCallShop } from '@/lib/ai-call-server'
import { writeAuditLog } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'

/** Hang up a call Alpha is on. Only a call that belongs to this shop can be stopped. Stopping an ended call is not an error. */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const callId = typeof body?.callId === 'string' ? body.callId.trim().slice(0, 300) : ''
    if (!callId) return NextResponse.json({ ok: false, error: 'Missing call.' }, { status: 400 })

    const db = getServiceClient()
    const { data: row, error } = await db.from('ai_calls').select('id,status').eq('id', callId).eq('shop_id', auth.shopId).maybeSingle()
    if (error) return NextResponse.json({ ok: false, error: 'The call could not be found. Try again.' }, { status: 500 })
    if (!row) return NextResponse.json({ ok: false, error: 'Call not found.' }, { status: 404 })
    if (String(row.status) === 'ended') return NextResponse.json({ ok: true, ended: true })

    const shop = await loadCallShop(db, auth.shopId)
    if (!shop.telnyxApiKey) return NextResponse.json({ ok: false, error: 'The phone line is not set up, so the call cannot be stopped from here.' }, { status: 503 })

    let response: Response
    try {
      response = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callId)}/actions/hangup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${shop.telnyxApiKey}`, 'Content-Type': 'application/json' },
        body: '{}',
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      return NextResponse.json({ ok: false, error: 'Could not reach the phone line to hang up. Try Stop again, or end the call from the phone line dashboard.' }, { status: 502 })
    }
    // Telnyx answers 404 or 422 when the call is already over. That is the result the owner wanted.
    const alreadyOver = response.status === 404 || response.status === 422
    if (!response.ok && !alreadyOver) {
      return NextResponse.json({ ok: false, error: 'The phone line did not hang up the call. Try Stop again.' }, { status: 502 })
    }
    await db.from('ai_calls').update({ status: 'ended', is_speaking: false, processing: false }).eq('id', callId).eq('shop_id', auth.shopId)
    await writeAuditLog({ shopId: auth.shopId, userId: auth.userId, action: 'call.stop', targetType: 'ai_call', targetId: callId, permission: 'external', approved: true, metadata: { by: 'owner' } }).catch(() => undefined)
    return NextResponse.json({ ok: true, ended: true })
  } catch (error) {
    console.error('[ai-call/stop] error:', error)
    return NextResponse.json({ ok: false, error: 'The call could not be stopped. Try again.' }, { status: 500 })
  }
}
