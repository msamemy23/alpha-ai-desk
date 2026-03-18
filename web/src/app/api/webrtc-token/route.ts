/**
 * WebRTC Token API v2
 * - Auto-creates a Credential Connection + Telephony Credential
 * - Returns JWT tokens for browser WebRTC client
 */
import { NextRequest, NextResponse } from 'next/server'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Supabase settings helpers
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

// Step 1: Create a Credential Connection (one-time)
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
      connection_name: 'Alpha AI Desk WebRTC',
      user_name: 'alphawebrtc' + Date.now(),
      password: 'P' + Math.random().toString(36).slice(2) + '!' + Date.now(),
    }),
  })
  const data = await r.json()
  if (!r.ok) {
    console.error('[webrtc-token] Credential Connection creation failed:', JSON.stringify(data))
    throw new Error(data.errors?.[0]?.detail || 'Failed to create credential connection')
  }
  const connId = data.data?.id
  if (!connId) throw new Error('No connection ID returned')
  console.log('[webrtc-token] Created Credential Connection:', connId)
  await saveSetting('webrtc_conn_id', connId)
  return connId
}

// Step 2: Create a Telephony Credential on the Credential Connection
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
  console.log('[webrtc-token] Created Credential:', credId)
  await saveSetting('webrtc_credential_id', credId)
  return credId
}

// Step 3: Generate JWT token
async function generateToken(credId: string): Promise<string> {
  const r = await fetch(`${TELNYX_BASE}/telephony_credentials/${credId}/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
  })
  if (!r.ok) {
    const err = await r.text()
    throw new Error(`Token generation failed: ${r.status} ${err.slice(0, 200)}`)
  }
  const token = await r.text()
  return token.trim()
}

// Full setup: connection -> credential -> token
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
        return NextResponse.json({ token, credentialId: credId })
      } catch (e: any) {
        console.log('[webrtc-token] Existing credential failed, will recreate:', e.message)
      }
    }

    // Try existing connection, create new credential
    let connId = await getSetting('webrtc_conn_id')
    if (connId) {
      try {
        credId = await createCredential(connId)
        const token = await generateToken(credId)
        return NextResponse.json({ token, credentialId: credId })
      } catch (e: any) {
        console.log('[webrtc-token] Existing connection failed, will do full setup:', e.message)
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
