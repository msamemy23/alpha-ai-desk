/**
 * Tenant-scoped Telnyx WebRTC token API.
 * Provider resources are stored on the authenticated shop's settings row.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

const TELNYX_BASE = 'https://api.telnyx.com/v2'
const OUTBOUND_VOICE_PROFILE_ID = '2668698936952227186'

type ShopConfig = {
  shopId: string
  apiKey: string
  fromPhone: string
  connectionId: string
  credentialId: string
  shopName: string
}

async function getShopConfig(shopId: string): Promise<ShopConfig> {
  const db = getServiceClient()
  const { data, error } = await db
    .from('settings')
    .select('shop_id,shop_name,telnyx_api_key,telnyx_phone_number,telnyx_connection_id,webrtc_connection_id,webrtc_credential_id')
    .eq('shop_id', shopId)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error('Shop settings could not be loaded: ' + error.message)
  return {
    shopId,
    apiKey: String(data?.telnyx_api_key || ''),
    fromPhone: String(data?.telnyx_phone_number || ''),
    connectionId: String(data?.webrtc_connection_id || data?.telnyx_connection_id || ''),
    credentialId: String(data?.webrtc_credential_id || ''),
    shopName: String(data?.shop_name || 'Your Auto Shop'),
  }
}

async function saveShopConfig(shopId: string, patch: Record<string, unknown>) {
  const db = getServiceClient()
  const { data: existing, error: lookupError } = await db
    .from('settings')
    .select('id')
    .eq('shop_id', shopId)
    .limit(1)
    .maybeSingle()
  if (lookupError) throw new Error('Shop settings could not be loaded: ' + lookupError.message)
  if (existing?.id) {
    const { error } = await db.from('settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('shop_id', shopId)
    if (error) throw new Error('Shop settings could not be saved: ' + error.message)
    return
  }
  const { error } = await db.from('settings').insert({ shop_id: shopId, ...patch })
  if (error) throw new Error('Shop settings could not be saved: ' + error.message)
}

async function findConnectionByName(apiKey: string, name: string): Promise<string | null> {
  const response = await fetch(TELNYX_BASE + '/credential_connections?page[size]=250', {
    headers: { Authorization: 'Bearer ' + apiKey },
    signal: AbortSignal.timeout(15000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.errors?.[0]?.detail || ('Telnyx returned ' + response.status))
  const connection = (data.data || []).find((item: Record<string, unknown>) => item.connection_name === name)
  return typeof connection?.id === 'string' ? connection.id : null
}

async function createCredentialConnection(config: ShopConfig): Promise<string> {
  const connectionName = 'Alpha WebRTC ' + config.shopId.slice(0, 8)
  const response = await fetch(TELNYX_BASE + '/credential_connections', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      active: true,
      connection_name: connectionName,
      user_name: 'alphawebrtc' + config.shopId.slice(0, 8),
      password: 'P' + crypto.randomUUID().replace(/-/g, '') + '!',
      outbound: { outbound_voice_profile_id: OUTBOUND_VOICE_PROFILE_ID },
    }),
    signal: AbortSignal.timeout(20000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = String(data?.errors?.[0]?.detail || '')
    if (/already in use|already taken/i.test(detail)) {
      const existing = await findConnectionByName(config.apiKey, connectionName)
      if (existing) return existing
    }
    throw new Error(detail || ('Telnyx returned ' + response.status))
  }
  const id = data.data?.id
  if (typeof id !== 'string' || !id) throw new Error('Telnyx did not return a credential connection id')
  return id
}

async function ensureOutboundProfile(apiKey: string, connectionId: string): Promise<boolean> {
  const response = await fetch(TELNYX_BASE + '/credential_connections/' + encodeURIComponent(connectionId), {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ outbound: { outbound_voice_profile_id: OUTBOUND_VOICE_PROFILE_ID } }),
    signal: AbortSignal.timeout(15000),
  })
  return response.ok
}

async function createCredential(config: ShopConfig, connectionId: string): Promise<string> {
  const response = await fetch(TELNYX_BASE + '/telephony_credentials', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connection_id: connectionId,
      name: 'Alpha WebRTC Cred ' + config.shopId.slice(0, 8),
    }),
    signal: AbortSignal.timeout(20000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.errors?.[0]?.detail || ('Telnyx returned ' + response.status))
  const id = data.data?.id
  if (typeof id !== 'string' || !id) throw new Error('Telnyx did not return a telephony credential id')
  return id
}

async function generateToken(apiKey: string, credentialId: string): Promise<string> {
  const response = await fetch(TELNYX_BASE + '/telephony_credentials/' + encodeURIComponent(credentialId) + '/token', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey },
    signal: AbortSignal.timeout(15000),
  })
  const body = await response.text()
  if (!response.ok) throw new Error('Telnyx token generation failed: ' + response.status)
  const token = body.trim()
  if (!token) throw new Error('Telnyx returned an empty WebRTC token')
  return token
}

async function buildToken(config: ShopConfig) {
  if (!config.apiKey || !config.fromPhone) throw new Error('Telnyx SMS/voice settings are not configured for this shop')

  let connectionId = config.connectionId
  let credentialId = config.credentialId

  if (credentialId) {
    try {
      const token = await generateToken(config.apiKey, credentialId)
      if (connectionId && await ensureOutboundProfile(config.apiKey, connectionId)) {
        return { token, connectionId, credentialId }
      }
    } catch {
      // Rebuild the tenant-owned resource below.
    }
  }

  if (connectionId && !await ensureOutboundProfile(config.apiKey, connectionId)) {
    connectionId = ''
    credentialId = ''
  }
  if (!connectionId) connectionId = await createCredentialConnection(config)
  if (!credentialId) credentialId = await createCredential(config, connectionId)
  const token = await generateToken(config.apiKey, credentialId)
  return { token, connectionId, credentialId }
}

async function requireConfig() {
  const auth = await getAuthedShop()
  if (!auth) return { response: unauthorized() as Response }
  const config = await getShopConfig(auth.shopId)
  if (!config.apiKey || !config.fromPhone) {
    return { response: NextResponse.json({ ok: false, error: 'Telnyx is not configured for this shop' }, { status: 503 }) }
  }
  return { auth, config }
}

export async function GET() {
  try {
    const result = await requireConfig()
    if ('response' in result) return result.response
    const setup = await buildToken(result.config)
    await saveShopConfig(result.auth.shopId, {
      webrtc_connection_id: setup.connectionId,
      webrtc_credential_id: setup.credentialId,
    })
    return NextResponse.json({
      ok: true,
      token: setup.token,
      connectionId: setup.connectionId,
      credentialId: setup.credentialId,
      fromPhone: result.config.fromPhone,
      shopName: result.config.shopName,
    })
  } catch (error) {
    console.error('[webrtc-token] Error:', error)
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'WebRTC setup failed' }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await requireConfig()
    if ('response' in result) return result.response
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    if (body.action === 'setup') {
      const setup = await buildToken(result.config)
      await saveShopConfig(result.auth.shopId, {
        webrtc_connection_id: setup.connectionId,
        webrtc_credential_id: setup.credentialId,
      })
      return NextResponse.json({ ok: true, ...setup, fromPhone: result.config.fromPhone, shopName: result.config.shopName })
    }
    if (body.action === 'hangup' && typeof body.callId === 'string') {
      const db = getServiceClient()
      const { data: call, error } = await db.from('ai_calls').select('id').eq('id', body.callId).eq('shop_id', result.auth.shopId).maybeSingle()
      if (error) return NextResponse.json({ ok: false, error: 'Call could not be verified' }, { status: 500 })
      if (!call) return NextResponse.json({ ok: false, error: 'Call not found' }, { status: 404 })
      const response = await fetch(TELNYX_BASE + '/calls/' + encodeURIComponent(body.callId) + '/actions/hangup', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + result.config.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15000),
      })
      return NextResponse.json({ ok: response.ok }, { status: response.ok ? 200 : 502 })
    }
    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'WebRTC request failed' }, { status: 502 })
  }
}
