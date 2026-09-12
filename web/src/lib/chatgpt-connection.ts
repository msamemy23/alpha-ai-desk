import { createOpenAIOAuthTransport, DEFAULT_OPENAI_OAUTH_CLIENT_ID, deriveAccountId, exchangeOpenAIOAuthCode, refreshOpenAIOAuthTokens, type OpenAIOAuthSession, type OpenAIOAuthTokenResponse } from '@openai-oauth/core'
import { randomUUID } from 'node:crypto'
import { getServiceClient } from '@/lib/supabase'
import { openPrivateState, sealPrivateState } from '@/lib/private-state'
import type { AuthenticatedShop } from '@/lib/api-auth'

const issuer = 'https://auth.openai.com'
const table = 'private_chatgpt_connections'
type DeviceState = { kind: 'device'; deviceId: string; code: string; interval: number }
type SessionState = { kind: 'session'; session: OpenAIOAuthSession }
type State = DeviceState | SessionState
type Row = { user_id: string; shop_id: string; revision: string; encrypted_state: string; expires_at: string; next_poll_at: string }
const owner = (auth: AuthenticatedShop) => `chatgpt:${auth.shopId}:${auth.userId}`
const query = (auth: AuthenticatedShop) => getServiceClient().from(table).select('*').eq('user_id', auth.userId).eq('shop_id', auth.shopId)

async function read(auth: AuthenticatedShop): Promise<Row | null> {
  const { data, error } = await query(auth).maybeSingle()
  if (error) throw new Error('ChatGPT connection storage is unavailable')
  return data as Row | null
}

export async function disconnectChatGpt(auth: AuthenticatedShop) {
  const { error } = await getServiceClient().from(table).delete().eq('user_id', auth.userId).eq('shop_id', auth.shopId)
  if (error) throw new Error('Could not disconnect ChatGPT')
}

function view(row: Row | null, auth: AuthenticatedShop) {
  if (!row) return { status: 'disconnected' }
  if (Date.parse(row.expires_at) <= Date.now()) return { status: 'expired' }
  const state = openPrivateState<State>(row.encrypted_state, owner(auth))
  return state.kind === 'session' ? { status: 'connected' } : {
    status: 'pending', code: state.code, verificationUrl: `${issuer}/codex/device`,
    interval: state.interval, expiresAt: row.expires_at,
  }
}

export async function chatGptConnectionStatus(auth: AuthenticatedShop) { return view(await read(auth), auth) }

export async function startChatGptConnection(auth: AuthenticatedShop) {
  const existing = await read(auth)
  if (existing && Date.parse(existing.expires_at) > Date.now()) return view(existing, auth)
  const response = await fetch(`${issuer}/api/accounts/deviceauth/usercode`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: DEFAULT_OPENAI_OAUTH_CLIENT_ID }), signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`OpenAI device sign-in is unavailable (${response.status}). Your existing AI provider has not been changed.`)
  const data = await response.json()
  const code = data.user_code || data.usercode
  if (typeof data.device_auth_id !== 'string' || typeof code !== 'string' || code.length > 32) throw new Error('OpenAI returned an invalid sign-in response')
  const state: DeviceState = { kind: 'device', deviceId: data.device_auth_id, code, interval: Math.min(60, Math.max(5, Number(data.interval) || 5)) }
  const row: Row = {
    user_id: auth.userId, shop_id: auth.shopId, revision: randomUUID(),
    encrypted_state: sealPrivateState(state, owner(auth)), expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    next_poll_at: new Date(Date.now() + state.interval * 1000).toISOString(),
  }
  // Do not replace a different, still-live attempt in a concurrent request.
  if (existing) {
    const { data: updated, error } = await getServiceClient().from(table).update(row).eq('user_id', auth.userId).eq('shop_id', auth.shopId).eq('revision', existing.revision).select('revision').maybeSingle()
    if (error || !updated) throw new Error('Connection changed. Reload and try again.')
  } else {
    const { error } = await getServiceClient().from(table).insert(row)
    if (error) return chatGptConnectionStatus(auth)
  }
  return view(row, auth)
}

function sessionFromTokens(tokens: OpenAIOAuthTokenResponse, previous?: OpenAIOAuthSession): OpenAIOAuthSession {
  const accountId = tokens.accountId || deriveAccountId(tokens.idToken) || previous?.accountId
  if (!accountId || !tokens.accessToken) throw new Error('OpenAI did not return an eligible ChatGPT account')
  return {
    accessToken: tokens.accessToken, accountId, refreshToken: tokens.refreshToken || previous?.refreshToken,
    idToken: tokens.idToken || previous?.idToken, isFedRamp: tokens.isFedRamp || false,
    expiresAt: new Date(Date.now() + (tokens.expiresIn || 3600) * 1000).toISOString(), lastRefresh: new Date().toISOString(),
  }
}

async function claim(auth: AuthenticatedShop, row: Row, seconds: number) {
  const revision = randomUUID()
  const { data, error } = await getServiceClient().from(table).update({ revision, next_poll_at: new Date(Date.now() + seconds * 1000).toISOString() })
    .eq('user_id', auth.userId).eq('shop_id', auth.shopId).eq('revision', row.revision).lte('next_poll_at', new Date().toISOString()).select('revision').maybeSingle()
  if (error) throw new Error('Connection could not be locked')
  return data ? revision : null
}

async function saveSession(auth: AuthenticatedShop, revision: string, session: OpenAIOAuthSession) {
  const { data, error } = await getServiceClient().from(table).update({
    encrypted_state: sealPrivateState({ kind: 'session', session }, owner(auth)), revision: randomUUID(),
    expires_at: new Date(Date.now() + 30 * 86400_000).toISOString(), next_poll_at: new Date().toISOString(),
  }).eq('user_id', auth.userId).eq('shop_id', auth.shopId).eq('revision', revision).select('revision').maybeSingle()
  if (error || !data) throw new Error('The connection was cancelled or changed. Reconnect ChatGPT.')
}

export async function pollChatGptConnection(auth: AuthenticatedShop) {
  const row = await read(auth)
  if (!row || Date.parse(row.expires_at) <= Date.now()) return view(row, auth)
  const state = openPrivateState<State>(row.encrypted_state, owner(auth))
  if (state.kind !== 'device') return view(row, auth)
  const revision = await claim(auth, row, Math.max(35, state.interval))
  if (!revision) return view(row, auth)
  const release = async () => {
    const { error } = await getServiceClient().from(table).update({ next_poll_at: new Date(Date.now() + state.interval * 1000).toISOString() }).eq('user_id', auth.userId).eq('shop_id', auth.shopId).eq('revision', revision)
    if (error) throw new Error('Connection polling is temporarily unavailable')
  }
  const response = await fetch(`${issuer}/api/accounts/deviceauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_auth_id: state.deviceId, user_code: state.code }), signal: AbortSignal.timeout(15000),
  })
  if ([403, 404, 429].includes(response.status)) { await release(); return view(row, auth) }
  if (!response.ok) throw new Error(`OpenAI could not complete sign-in (${response.status}). Try again.`)
  const code = await response.json()
  if (typeof code.authorization_code !== 'string' || typeof code.code_verifier !== 'string') throw new Error('Invalid device authorization response')
  const tokens = await exchangeOpenAIOAuthCode({ code: code.authorization_code, codeVerifier: code.code_verifier, redirectUri: `${issuer}/deviceauth/callback`, signal: AbortSignal.timeout(15000) })
  await saveSession(auth, revision, sessionFromTokens(tokens))
  return { status: 'connected' }
}

export async function getUserChatGptTransport(auth: AuthenticatedShop) {
  const row = await read(auth)
  if (!row) return null
  const state = openPrivateState<State>(row.encrypted_state, owner(auth))
  if (state.kind !== 'session') return null
  if (Date.parse(row.expires_at) <= Date.now()) throw new Error('Your ChatGPT connection expired. Reconnect in Settings; no fallback provider was charged.')
  let session = state.session
  if (!session.expiresAt || Date.parse(session.expiresAt) <= Date.now() + 60_000) {
    if (!session.refreshToken) throw new Error('Reconnect ChatGPT in Settings')
    const revision = await claim(auth, row, 30)
    if (!revision) throw new Error('ChatGPT is refreshing its connection. Try again in a moment.')
    const tokens = await refreshOpenAIOAuthTokens({ refreshToken: session.refreshToken, signal: AbortSignal.timeout(15000) })
    session = sessionFromTokens(tokens, session)
    await saveSession(auth, revision, session)
  }
  return createOpenAIOAuthTransport({ auth: session })
}
