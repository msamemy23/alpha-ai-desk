/**
 * WebRTC Token API v3
 * - Creates a Credential Connection with outbound_voice_profile_id set
 * - Patches existing connections if they're missing the outbound profile
 * - Returns JWT token for browser WebRTC client
 */
import { NextRequest, NextResponse } from 'next/server'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// The one outbound voice profile on this account — required for PSTN routing
const OUTBOUND_VOICE_PROFILE_ID = '2668698936952227186'

async function getSetting(key: string): Promise<string | null> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?key=eq.${key}&select=value&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    )
    const rows = await r.json()
    return rows?.[0]?.value || null
  } catch { return null }
}

async function saveSetting(key: string, value: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ key, value }),
  })
}

// Find an existing Credential Connection by name (fallback when name already in use)
async function findConnectionByName(name: string): Promise<string | null> {
  try {
    const r = await fetch(`${TELNYX_BASE}/credential_connections`, {
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
    })
    const data = await r.json()
    const conn = (data.data || []).find((c: Record<string, unknown>) => c.connection_name === name)
    return (conn?.id as string) || null
  } catch { return null }
}

// Create a Credential Connection with outbound voice profile attached
async function createCredentialConnection(): Promise<string> {
  console.log('[webrtc-token] Creating Credential Connection...')
  const r = await fetch(`${TELNYX_BASE}/credential_connections`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      active: true,
      connection_name: 'Alpha WebRTC Stable',
      user_name: 'alphawebrtcstable',
      password: 'P' + Math.random().toString(36).slice(2) + '!' + Date.now(),
      outbound: {
        outbound_voice_profile_id: OUTBOUND_VOICE_PROFILE_ID,
      },
    }),
  })
  const data = await r.json()
  if (!r.ok) {
    const errDetail: string = (data.errors?.[0]?.detail || '').toString()
    if (errDetail.toLowerCase().includes('already in use') || errDetail.toLowerCase().includes('already taken')) {
      console.log('[webrtc-token] Name already in use, finding existing connection...')
      const existingId = await findConnectionByName('Alpha WebRTC Stable')
      if (existingId) {
        console.log('[webrtc-token] Reusing existing connection:', existingId)
        await saveSetting('webrtc_conn_id', existingId)
        return existingId
      }
    }
    console.error('[webrtc-token] Connection creation failed:', JSON.stringify(data))
    throw new Error(data.errors?.[0]?.detail || 'Failed to create credential connection')
  }
  const connId = data.data?.id
  if (!connId) throw new Error('No connection ID returned')
  console.log('[webrtc-token] Created connection:', connId)
  await saveSetting('webrtc_conn_id', connId)
  return connId
}

// Patch an existing connection to add the outbound voice profile if missing
async function ensureOutboundProfile(connId: string): Promise<void> {
  try {
    const r = await fetch(`${TELNYX_BASE}/credential_connections/${connId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        outbound: {
          outbound_voice_profile_id: OUTBOUND_VOICE_PROFILE_ID,
        },
      }),
    })
    if (r.ok) {
      console.log('[webrtc-token] Patched connection with outbound profile:', connId)
    } else {
      const err = await r.text()
      console.warn('[webrtc-token] Patch warning:', err.slice(0, 200))
    }
  } catch (e) {
    console.warn('[webrtc-token] Could not patch connection:', e)
  }
}

async function createCredential(connId: string): Promise<string> {
  console.log('[webrtc-token] Creating Telephony Credential on connection:', connId)
  const r = await fetch(`${TELNYX_BASE}/telephony_credentials`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connection_id: connId,
      name: 'Alpha WebRTC Cred',
    }),
  })
  const data = await r.json()
  if (!r.ok) {
    console.error('[webrtc-token] Credential creation failed:', JSON.stringify(data))
    throw new Error(data.errors?.[0]?.detail || 'Failed to create telephony credential')
  }
  const credId = data.data?.id
  if (!credId) throw new Error('No credential ID returned')
  console.log('[webrtc-token] Created credential:', credId)
  await saveSetting('webrtc_credential_id', credId)
  return credId
}

async function generateToken(credId: string): Promise<string> {
  const r = await fetch(`${TELNYX_BASE}/telephony_credentials/${credId}/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`Token generation failed: ${r.status} ${err.slice(0, 200)}`)
  }
  return (await r.text()).trim()
}

async function fullSetup(): Promise<{ token: string; credentialId: string; connectionId: string }> {
  const connId = await createCredentialConnection()
  const credId = await createCredential(connId)
  const token = await generateToken(credId)
  return { token, credentialId: credId, connectionId: connId }
}

export async function GET() {
  try {
    if (!TELNYX_API_KEY) {
      return NextResponse.json({ error: 'TELNYX_API_KEY not set' }, { status: 500 })
    }

    // Try existing credential first
    let credId = await getSetting('webrtc_credential_id')
    if (credId) {
      try {
        const token = await generateToken(credId)
        // Ensure outbound profile is set BEFORE returning token (synchronous - required for PSTN calls)
        const connId = await getSetting('webrtc_conn_id')
        if (connId) await ensureOutboundProfile(connId)
        return NextResponse.json({ token, credentialId: credId })
      } catch (e: any) {
        console.log('[webrtc-token] Existing credential failed, will recreate:', e.message)
      }
    }

    // Try existing connection, create new credential
    let connId = await getSetting('webrtc_conn_id')
    if (connId) {
      try {
        await ensureOutboundProfile(connId)
        credId = await createCredential(connId)
        const token = await generateToken(credId)
        return NextResponse.json({ token, credentialId: credId })
      } catch (e: any) {
        console.log('[webrtc-token] Existing connection failed, doing full setup:', e.message)
      }
    }

    // Full setup from scratch
    const result = await fullSetup()
    return NextResponse.json(result)
  } catch (e: any) {
    console.error('[webrtc-token] Error:', e.message)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    if (body.action === 'setup') {
      const result = await fullSetup()
      return NextResponse.json({ ok: true, ...result })
    }
    if (body.action === 'hangup' && body.callId) {
      const r = await fetch(`${TELNYX_BASE}/calls/${body.callId}/actions/hangup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      return NextResponse.json({ ok: r.ok })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
