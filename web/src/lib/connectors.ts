/**
 * Shared utilities for connector API routes.
 *
 * Connector rows are tenant-owned. Every helper resolves the caller's shop
 * before reading or writing a row; no service-wide fallback is allowed.
 */

import { getAuthedShop } from '@/lib/api-auth'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET_V2 || process.env.GOOGLE_CLIENT_SECRET || ''

export interface Connector {
  id: string
  service: string
  shop_id: string
  enabled: boolean
  access_token: string | null
  refresh_token: string | null
  token_expires_at: string | null
  page_id: string | null
  page_access_token: string | null
  metadata: Record<string, unknown>
}

async function resolveShopId(explicitShopId?: string): Promise<string> {
  if (explicitShopId) return explicitShopId
  const auth = await getAuthedShop()
  if (!auth) throw new Error('Unauthorized')
  return auth.shopId
}

function requireConfig() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase server environment is not configured')
}

export async function getConnector(service: string, explicitShopId?: string): Promise<Connector | null> {
  requireConfig()
  const shopId = await resolveShopId(explicitShopId)
  const params = new URLSearchParams({
    service: `eq.${service}`,
    shop_id: `eq.${shopId}`,
    limit: '1',
  })
  const r = await fetch(`${SUPABASE_URL}/rest/v1/connectors?${params.toString()}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
    cache: 'no-store',
  })
  if (!r.ok) throw new Error(`Connector lookup failed: ${r.status}`)
  const data = await r.json()
  return data?.[0] || null
}

export async function updateConnector(service: string, patch: Record<string, unknown>, explicitShopId?: string) {
  requireConfig()
  const shopId = await resolveShopId(explicitShopId)
  // Upsert is important for a newly connected shop: older deployments only
  // pre-seeded connector rows for the first shop.
  const r = await fetch(`${SUPABASE_URL}/rest/v1/connectors?on_conflict=shop_id%2Cservice`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=merge-duplicates',
    },
    body: JSON.stringify({ service, ...patch, shop_id: shopId, updated_at: new Date().toISOString() }),
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`Connector update failed: ${r.status} ${detail.slice(0, 200)}`)
  }
}

export async function disconnectConnector(service: string, explicitShopId?: string) {
  await updateConnector(service, {
    enabled: false,
    access_token: null,
    refresh_token: null,
    token_expires_at: null,
    page_id: null,
    page_access_token: null,
    metadata: {},
  }, explicitShopId)
}

/**
 * Refresh Google access token if expired.
 * The connector shop is passed explicitly so a refresh cannot update another
 * shop's row when a background request is involved.
 */
export async function getValidGoogleToken(connector: Connector): Promise<string> {
  const { access_token, refresh_token, token_expires_at } = connector

  if (access_token && token_expires_at) {
    const expiresAt = new Date(token_expires_at).getTime()
    if (expiresAt > Date.now() + 5 * 60 * 1000) return access_token
  }

  if (!refresh_token) throw new Error('No refresh token available. Please reconnect Google.')
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new Error('Google OAuth is not configured')

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

  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) throw new Error('Failed to refresh Google token. Please reconnect Google.')

  const newExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString()
  await updateConnector(connector.service, {
    access_token: data.access_token,
    token_expires_at: newExpiry,
  }, connector.shop_id)

  return data.access_token as string
}
