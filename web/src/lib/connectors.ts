/**
 * Shared utilities for connector API routes
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '1736123851-r05fmhp9eb9pv7cn3t7joihcdjf1tl0m.apps.googleusercontent.com'
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'G0CSPX-2soFaZ6hikFNv6HVB2RZ7Tx2cFRO'

export interface Connector {
  id: string
  service: string
  enabled: boolean
  access_token: string | null
  refresh_token: string | null
  token_expires_at: string | null
  page_id: string | null
  page_access_token: string | null
  metadata: Record<string, unknown>
}

export async function getConnector(service: string): Promise<Connector | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/connectors?service=eq.${service}&limit=1`,
    {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    }
  )
  const data = await r.json()
  return data?.[0] || null
}

export async function updateConnector(service: string, patch: Record<string, unknown>) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/connectors?service=eq.${service}`,
    {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    }
  )
}

export async function disconnectConnector(service: string) {
  await updateConnector(service, {
    enabled: false,
    access_token: null,
    refresh_token: null,
    token_expires_at: null,
    page_id: null,
    page_access_token: null,
    metadata: {},
  })
}

/**
 * Refresh Google access token if expired
 * Returns the current valid access token
 */
export async function getValidGoogleToken(connector: Connector): Promise<string> {
  const { access_token, refresh_token, token_expires_at } = connector

  // Check if still valid (with 5-minute buffer)
  if (access_token && token_expires_at) {
    const expiresAt = new Date(token_expires_at).getTime()
    if (expiresAt > Date.now() + 5 * 60 * 1000) {
      return access_token
    }
  }

  if (!refresh_token) {
    throw new Error('No refresh token available. Please reconnect Google.')
  }

  // Refresh the token
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  const data = await res.json()
  if (!data.access_token) {
    throw new Error('Failed to refresh Google token. Please reconnect Google.')
  }

  const newExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  await updateConnector(connector.service, {
    access_token: data.access_token,
    token_expires_at: newExpiry,
  })

  return data.access_token as string
}
