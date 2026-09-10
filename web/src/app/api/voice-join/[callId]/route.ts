/**
 * Voice Join — lets the shop owner dial in and be conferenced into an active AI call.
 *
 * How it works:
 * 1. Frontend calls POST /api/voice-join/[callId] with { ownerPhone }
 * 2. We dial the owner's phone via Telnyx
 * 3. When owner answers, we transfer them into the active call via Telnyx conference
 *
 * Note: Telnyx supports bridging two call legs via `call.transfer`.
 * We transfer the ACTIVE call leg to a new conference, then dial the owner into the same conference.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { createVoiceClientState } from '@/lib/voice-state'


async function dbGet(callId: string, shopId: string) {
  const db = getServiceClient()
  const { data, error } = await db.from('ai_calls').select('*').eq('id', callId).eq('shop_id', shopId).maybeSingle()
  if (error) throw error
  return data
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  // Only a logged-in shop user may bridge calls — this dials real phone
  // numbers on the shop's Telnyx account (toll fraud risk if left open).
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  try {
    const { callId } = await params
    const body = await req.json().catch(() => null)
    const ownerPhone = typeof body?.ownerPhone === 'string' ? body.ownerPhone : ''
    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('telnyx_api_key,telnyx_phone_number,telnyx_connection_id').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) return NextResponse.json({ ok: false, error: 'Shop calling settings could not be loaded' }, { status: 500 })
    const apiKey = String(settings?.telnyx_api_key || '')
    const fromPhone = String(settings?.telnyx_phone_number || '')
    const connectionId = String(settings?.telnyx_connection_id || '')
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
    if (!apiKey || !fromPhone || !connectionId) return NextResponse.json({ ok: false, error: 'Telnyx calling is not configured for this shop' }, { status: 503 })
    if (!ownerPhone) {
      return NextResponse.json({ ok: false, error: 'ownerPhone required' }, { status: 400 })
    }

    const state = await dbGet(callId, auth.shopId)
    if (!state || state.status === 'ended') {
      return NextResponse.json({ ok: false, error: 'Call not active or not found' }, { status: 404 })
    }

    const digits = ownerPhone.replace(/\D/g, '')
    if (![10, 11].includes(digits.length) || (digits.length === 11 && !digits.startsWith('1'))) return NextResponse.json({ ok: false, error: 'Enter a valid US phone number' }, { status: 400 })
    const e164   = digits.length === 10 ? `+1${digits}` : `+${digits}`

    // Step 1: Transfer the active call leg to a conference room named after the callId
    const confName = `conf_${callId.slice(0, 16)}`

    const transferRes = await fetch(
      `https://api.telnyx.com/v2/calls/${encodeURIComponent(callId)}/actions/transfer`,
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:             `conf:${confName}`,
          webhook_url:    `${appUrl}/api/telnyx-voice-webhook`,
          client_state:   createVoiceClientState({ conferenceJoin: true, shopId: auth.shopId }),
        }),
      }
    )
    const transferData = await transferRes.json()

    // Step 2: Dial the owner into the same conference
    const dialRes = await fetch('https://api.telnyx.com/v2/calls', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_id:     connectionId,
        to:                e164,
        from:              fromPhone,
        from_display_name: 'Alpha AI Call',
        webhook_url:       `${appUrl}/api/telnyx-voice-webhook`,
        client_state:      createVoiceClientState({
          conferenceJoin: true,
          shopId: auth.shopId,
          confName,
          isOwner: true,
        }),
      }),
    })
    const dialData = await dialRes.json()

    if (!transferRes.ok) return NextResponse.json({ ok: false, error: transferData?.errors?.[0]?.detail || 'Could not transfer the active call' }, { status: 502 })
    if (!dialRes.ok) {
      return NextResponse.json({ ok: false, error: dialData?.errors?.[0]?.detail || 'Dial failed' }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      message: `Dialing ${e164} to join the call. You will be conferenced in when you answer.`,
      confName,
      transferStatus: transferData?.data?.status || 'unknown',
    })
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
