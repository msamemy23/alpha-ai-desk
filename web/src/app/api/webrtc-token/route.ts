/**
 * WebRTC Token API
 * - GET: Returns a fresh JWT token for the browser WebRTC client
 * - POST with action=setup: Creates the telephony credential (one-time)
 * Uses Telnyx Telephony Credentials API
 */
import { NextRequest, NextResponse } from 'next/server'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_CONN_ID = process.env.TELNYX_CONN_ID || '2912878759822493204'
const TELNYX_BASE = 'https://api.telnyx.com/v2'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// Get or create the credential ID from Supabase settings
async function getCredentialId(): Promise<string | null> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/settings?key=eq.webrtc_credential_id&select=value&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    )
    const rows = await r.json()
    return rows?.[0]?.value || null
  } catch { return null }
}

async function saveCredentialId(id: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/settings`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ key: 'webrtc_credential_id', value: id }),
  })
}

async function createCredential(): Promise<string> {
  const r = await fetch(`${TELNYX_BASE}/telephony_credentials`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connection_id: TELNYX_CONN_ID,
      name: 'Alpha AI Desk WebRTC',
    }),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.errors?.[0]?.detail || 'Failed to create credential')
  const credId = data.data?.id
  if (!credId) throw new Error('No credential ID returned')
  await saveCredentialId(credId)
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
  // The token endpoint returns the JWT as plain text
  const token = await r.text()
  return token.trim()
}

// GET: Get a fresh WebRTC token
export async function GET() {
  try {
    if (!TELNYX_API_KEY) {
      return NextResponse.json({ error: 'TELNYX_API_KEY not set' }, { status: 500 })
    }
    // Get existing credential or create one
    let credId = await getCredentialId()
    if (!credId) {
      credId = await createCredential()
    }
    const token = await generateToken(credId)
    return NextResponse.json({ token, credentialId: credId })
  } catch (e: any) {
    // If token gen failed, credential might be deleted - recreate
    if (e.message?.includes('404') || e.message?.includes('not found')) {
      try {
        const credId = await createCredential()
        const token = await generateToken(credId)
        return NextResponse.json({ token, credentialId: credId })
      } catch (e2: any) {
        return NextResponse.json({ error: e2.message }, { status: 500 })
      }
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST: Setup or manage credentials
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const action = body.action || 'setup'
    if (action === 'setup') {
      const credId = await createCredential()
      const token = await generateToken(credId)
      return NextResponse.json({ ok: true, credentialId: credId, token })
    }
    if (action === 'hangup' && body.callId) {
      // Hangup a call via Telnyx Call Control
      const r = await fetch(`${TELNYX_BASE}/calls/${body.callId}/actions/hangup`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TELNYX_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      return NextResponse.json({ ok: r.ok })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
