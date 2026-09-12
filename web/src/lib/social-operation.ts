import { createHash } from 'node:crypto'
import { getServiceClient } from '@/lib/supabase'

type SocialOperationInput = {
  shopId: string
  userId?: string
  platform: string
  action: string
  idempotencyKey: string
  payload: unknown
}

type SocialOperationRow = {
  id: string
  payload_hash: string
  status: 'running' | 'succeeded' | 'failed' | 'unknown'
  result?: unknown
  error?: string | null
  lease_expires_at?: string | null
}

export type SocialOperationClaim =
  | { state: 'claimed'; id: string }
  | { state: 'succeeded'; id: string; result: unknown }
  | { state: 'running' | 'failed' | 'unknown'; id: string; error?: string | null; result?: unknown }
  | { state: 'conflict' | 'error'; error: string }

export type SocialOperationStart =
  | { state: 'claimed'; id: string }
  | { state: 'replay'; result: unknown }
  | { state: 'blocked'; status: number; error: string }

export type SocialOperationPeek =
  | { state: 'none' }
  | { state: 'replay'; result: unknown }
  | { state: 'blocked'; status: number; error: string }

function hashPayload(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function requestKey(request: Request, body: Record<string, unknown>) {
  const header = request.headers.get('idempotency-key') || request.headers.get('x-idempotency-key')
  const bodyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : ''
  return (header?.trim() || bodyKey.trim()).slice(0, 160)
}

/**
 * Resolve an already-recorded provider operation without creating a claim or
 * calling the provider. This lets recovery rebuild a missing local record
 * before any AI generation or external side effect is attempted.
 */
export async function peekSocialPublishingOperation(input: {
  request: Request
  body: Record<string, unknown>
  shopId: string
  platform: string
  action: string
}): Promise<SocialOperationPeek> {
  const idempotencyKey = requestKey(input.request, input.body)
  if (!idempotencyKey) return { state: 'blocked', status: 400, error: 'Idempotency-Key is required for publishing actions' }
  const db = getServiceClient()
  const payloadHash = hashPayload(input.body)
  const { data: existing, error: lookupError } = await db
    .from('social_publishing_operations')
    .select('id,payload_hash,status,result,error,lease_expires_at')
    .eq('shop_id', input.shopId)
    .eq('platform', input.platform)
    .eq('action', input.action)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()
  if (lookupError) return { state: 'blocked', status: 503, error: 'Publishing operation could not be loaded safely' }
  if (!existing) return { state: 'none' }

  const operation = existing as SocialOperationRow
  if (operation.payload_hash !== payloadHash) return { state: 'blocked', status: 409, error: 'Idempotency key was used for different publish content' }
  if (operation.status === 'running' && (!operation.lease_expires_at || new Date(operation.lease_expires_at).getTime() <= Date.now())) {
    const { data: expired, error: expireError } = await db.from('social_publishing_operations')
      .update({
        status: 'unknown',
        error: 'Social provider operation lease expired; reconcile the provider before retrying',
        finished_at: new Date().toISOString(),
        lease_expires_at: null,
        heartbeat_at: new Date().toISOString(),
      })
      .eq('id', operation.id)
      .eq('status', 'running')
      .select('id')
      .maybeSingle()
    if (expireError || !expired) return { state: 'blocked', status: 503, error: expireError?.message || 'Publishing operation lease could not be closed' }
    operation.status = 'unknown'
    operation.error = 'Social provider operation lease expired; reconcile the provider before retrying'
  }
  if (operation.status === 'succeeded') return { state: 'replay', result: operation.result }
  return { state: 'blocked', status: 409, error: operation.error || 'The previous publishing outcome needs reconciliation' }
}

/**
 * Claims a durable provider operation before any external publish/send call.
 * A retry with the same key either replays a confirmed result or returns the
 * recorded in-progress/uncertain state; it never starts a second provider call.
 */
export async function startSocialPublishingOperation(input: {
  request: Request
  body: Record<string, unknown>
  shopId: string
  userId?: string
  platform: string
  action: string
}): Promise<SocialOperationStart> {
  const idempotencyKey = requestKey(input.request, input.body)
  if (!idempotencyKey) {
    return { state: 'blocked', status: 400, error: 'Idempotency-Key is required for publishing actions' }
  }
  const claim = await claimSocialPublishingOperation({
    shopId: input.shopId,
    userId: input.userId,
    platform: input.platform,
    action: input.action,
    idempotencyKey,
    payload: input.body,
  })
  if (claim.state === 'claimed') return claim
  if (claim.state === 'succeeded') return { state: 'replay', result: claim.result }
  if (claim.state === 'running') return { state: 'blocked', status: 409, error: 'This publishing action is already in progress' }
  if (claim.state === 'unknown') return { state: 'blocked', status: 409, error: claim.error || 'The previous publishing outcome is uncertain; reconcile it before retrying' }
  if (claim.state === 'failed') return { state: 'blocked', status: 409, error: claim.error || 'The previous publishing attempt failed; retry with a new idempotency key' }
  return { state: 'blocked', status: 409, error: claim.error || 'Publishing action could not be claimed' }
}

export async function claimSocialPublishingOperation(input: SocialOperationInput): Promise<SocialOperationClaim> {
  const db = getServiceClient()
  const payloadHash = hashPayload(input.payload)
  const row = {
    shop_id: input.shopId,
    user_id: input.userId || null,
    platform: input.platform,
    action: input.action,
    idempotency_key: input.idempotencyKey.slice(0, 160),
    payload_hash: payloadHash,
    status: 'running',
    lease_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    heartbeat_at: new Date().toISOString(),
  }
  const { data: inserted, error: insertError } = await db
    .from('social_publishing_operations')
    .insert(row)
    .select('id,payload_hash,status,result,error,lease_expires_at')
    .maybeSingle()
  if (!insertError && inserted?.id) return { state: 'claimed', id: String(inserted.id) }
  if (insertError?.code !== '23505') return { state: 'error', error: insertError?.message || 'Publish operation could not be claimed' }

  const { data: existing, error: lookupError } = await db
    .from('social_publishing_operations')
    .select('id,payload_hash,status,result,error,lease_expires_at')
    .eq('shop_id', input.shopId)
    .eq('platform', input.platform)
    .eq('action', input.action)
    .eq('idempotency_key', input.idempotencyKey.slice(0, 160))
    .maybeSingle()
  if (lookupError || !existing) return { state: 'error', error: lookupError?.message || 'Publish operation could not be loaded' }
  const operation = existing as SocialOperationRow
  if (operation.payload_hash !== payloadHash) return { state: 'conflict', error: 'Idempotency key was used for different publish content' }
  if (operation.status === 'running' && (!operation.lease_expires_at || new Date(operation.lease_expires_at).getTime() <= Date.now())) {
    const { data: expired, error: expireError } = await db.from('social_publishing_operations')
      .update({
        status: 'unknown',
        error: 'Social provider operation lease expired; reconcile the provider before retrying',
        finished_at: new Date().toISOString(),
        lease_expires_at: null,
        heartbeat_at: new Date().toISOString(),
      })
      .eq('id', operation.id)
      .eq('status', 'running')
      .select('id')
      .maybeSingle()
    if (expireError || !expired) return { state: 'error', error: expireError?.message || 'Publish operation lease could not be closed' }
    operation.status = 'unknown'
    operation.error = 'Social provider operation lease expired; reconcile the provider before retrying'
  }
  if (operation.status === 'succeeded') return { state: 'succeeded', id: operation.id, result: operation.result }
  return { state: operation.status, id: operation.id, error: operation.error, result: operation.result }
}

export async function finishSocialPublishingOperation(
  id: string,
  status: 'succeeded' | 'failed' | 'unknown',
  result?: unknown,
  error?: string,
) {
  const db = getServiceClient()
  const { data, error: updateError } = await db
    .from('social_publishing_operations')
    .update({
      status,
      result: result === undefined ? null : result,
      error: error ? error.slice(0, 1000) : null,
      finished_at: new Date().toISOString(),
      lease_expires_at: null,
      heartbeat_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'running')
    .select('id')
    .maybeSingle()
  if (updateError || !data) return { ok: false as const, error: updateError?.message || 'Publish operation state could not be saved' }
  return { ok: true as const }
}
