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

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_PHONE   = process.env.TELNYX_PHONE   || '+17136636979'
const TELNYX_CONN_ID = process.env.TELNYX_CONN_ID || '2912878759822493204'
const APP_URL        = 'https://alpha-ai-desk.vercel.app'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

async function dbGet(callId: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(callId)}&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  )
  const rows = await r.json()
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}

export async function POST(
  req: NextRequest,
  { params }: { params: { callId: string } }
) {
  try {
    const { ownerPhone } = await req.json()
    if (!ownerPhone) {
      return NextResponse.json({ ok: false, error: 'ownerPhone required' }, { status: 400 })
    }

    const state = await dbGet(params.callId)
    if (!state || state.status === 'ended') {
      return NextResponse.json({ ok: false, error: 'Call not active or not found' }, { status: 404 })
    }

    const digits = ownerPhone.replace(/\D/g, '')
    const e164   = digits.length === 10 ? `+1${digits}` : `+${digits}`

    // Step 1: Transfer the active call leg to a conference room named after the callId
    const confName = `conf_${params.callId.slice(0, 16)}`

    const transferRes = await fetch(
      `https://api.telnyx.com/v2/calls/${encodeURIComponent(params.callId)}/actions/transfer`,
      {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:             `conf:${confName}`,
          webhook_url:    `${APP_URL}/api/telnyx-voice-webhook`,
          client_state:   Buffer.from(JSON.stringify({ conferenceJoin: true })).toString('base64'),
        }),
      }
    )
    const transferData = await transferRes.json()

    // Step 2: Dial the owner into the same conference
    const dialRes = await fetch('https://api.telnyx.com/v2/calls', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_id:     TELNYX_CONN_ID,
        to:                e164,
        from:              TELNYX_PHONE,
        from_display_name: 'Alpha AI Call',
        webhook_url:       `${APP_URL}/api/telnyx-voice-webhook`,
        client_state:      Buffer.from(JSON.stringify({
          conferenceJoin: true,
          confName,
          isOwner: true,
        })).toString('base64'),
      }),
    })
    const dialData = await dialRes.json()

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
