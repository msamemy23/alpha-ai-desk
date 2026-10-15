import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getIdempotencyKey } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'

type ProviderCallResult = {
  ok: boolean
  callId?: string
  error?: string
  status?: number
}

type DurableCallInput = {
  request: Request
  db: SupabaseClient
  shopId: string
  userId: string
  to: string
  task: string
  callerName: string
  start: () => Promise<ProviderCallResult>
  record: (callId: string) => Promise<{ ok: boolean; error?: string }>
}

export type DurableCallResult =
  | { ok: true; callId: string; idempotent: boolean; auditPending?: boolean; auditError?: string }
  | { ok: false; status: number; error: string; uncertain?: boolean; callId?: string }

function failure(error: string, status = 502, uncertain = false, callId?: string): DurableCallResult {
  return { ok: false, status, error, ...(uncertain ? { uncertain: true } : {}), ...(callId ? { callId } : {}) }
}

function operationKey(input: DurableCallInput, suppliedKey: string) {
  return `call:${createHash('sha256').update(JSON.stringify({ suppliedKey, to: input.to, task: input.task, callerName: input.callerName })).digest('hex')}`
}

async function updateOperation(
  db: SupabaseClient,
  shopId: string,
  id: string,
  values: Record<string, unknown>,
) {
  await db.from('ai_action_operations')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('shop_id', shopId)
}

async function saveAuditState(db: SupabaseClient, shopId: string, id: string, pending: boolean, error?: string) {
  await db.from('ai_action_operations').update({
    audit_status: pending ? 'queued' : 'delivered',
    audit_error: error || null,
    updated_at: new Date().toISOString(),
  }).eq('id', id).eq('shop_id', shopId).eq('status', 'succeeded')
}

/**
 * Start a Telnyx call behind the same durable operation ledger used by shop
 * mutations. A provider call is an external side effect: if the response or
 * local logging fails, the operation becomes uncertain and the caller is
 * prevented from dialing a second time with the same request key.
 */
export async function startDurableCall(input: DurableCallInput): Promise<DurableCallResult> {
  const suppliedKey = getIdempotencyKey(input.request, [])
  if (!suppliedKey) return failure('Idempotency-Key is required to start a call', 400)

  const key = operationKey(input, suppliedKey)
  const payloadHash = createHash('sha256').update(JSON.stringify({
    to: input.to,
    task: input.task,
    callerName: input.callerName,
  })).digest('hex')

  const { data: claimData, error: claimError } = await input.db.rpc('claim_ai_action_operation', {
    p_shop_id: input.shopId,
    p_user_id: input.userId,
    p_action: 'makeCall',
    p_idempotency_key: key,
    p_payload_hash: payloadHash,
  })
  if (claimError) return failure('Call could not be safely started. Retry with the same request key.', 503, true)

  const claim = (claimData || {}) as {
    claimed?: boolean
    status?: string
    id?: string
    result?: unknown
    error?: string
    audit_status?: string
  }

  if (claim.status === 'conflict') return failure(claim.error || 'Call request key was used for different call details', 409)
  if (claim.status === 'succeeded') {
    const result = claim.result && typeof claim.result === 'object' ? claim.result as Record<string, unknown> : {}
    const callId = typeof result.callId === 'string' ? result.callId : ''
    if (!callId) return failure('The call was recorded without a call id; reconcile it before retrying', 502, true)
    if (claim.audit_status !== 'delivered' && claim.id) {
      const audit = await writeAuditLog({
        shopId: input.shopId,
        userId: input.userId,
        action: 'call.start',
        targetType: 'ai_call',
        targetId: callId,
        permission: 'external',
        approved: true,
        idempotencyKey: key,
        metadata: { to: input.to, task: input.task },
      })
      if (!audit.ok) {
        await saveAuditState(input.db, input.shopId, claim.id, false, audit.error)
        return failure('Call already started, but its audit record still needs repair', 502, true, callId)
      }
      await saveAuditState(input.db, input.shopId, claim.id, Boolean(audit.pending), undefined)
      if (audit.pending) return { ok: true, callId, idempotent: true, auditPending: true }
    }
    return { ok: true, callId, idempotent: true }
  }
  if (claim.status === 'failed') return failure(claim.error || 'The call failed before it was started', 409)
  if (claim.status === 'unknown') return failure(claim.error || 'The previous call outcome is uncertain; reconcile it before retrying', 409, true)
  if (claim.status !== 'running' || claim.claimed !== true || !claim.id) return failure('This call request is already in progress', 409, true)

  const operationId = claim.id
  try {
    let provider: ProviderCallResult
    try {
      provider = await input.start()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Call provider result is uncertain'
      await updateOperation(input.db, input.shopId, operationId, {
        status: 'unknown',
        error: message.slice(0, 1000),
        lease_expires_at: null,
      })
      return failure(`${message}. Do not retry automatically; check the call history first.`, 502, true)
    }

    if (!provider.ok) {
      await updateOperation(input.db, input.shopId, operationId, {
        status: 'failed',
        error: (provider.error || 'Call provider rejected the request').slice(0, 1000),
        lease_expires_at: null,
      })
      return failure(provider.error || 'Call provider rejected the request', provider.status || 502)
    }

    const callId = provider.callId
    if (!callId) {
      await updateOperation(input.db, input.shopId, operationId, {
        status: 'unknown',
        error: 'Call provider accepted the request without a call id',
        lease_expires_at: null,
      })
      return failure('Call provider accepted the request without a call id; do not retry automatically', 502, true)
    }

    const recorded = await input.record(callId)
    if (!recorded.ok) {
      await updateOperation(input.db, input.shopId, operationId, {
        status: 'unknown',
        error: `Call started but its local record could not be saved: ${recorded.error || 'database error'}`.slice(0, 1000),
        lease_expires_at: null,
      })
      return failure('Call started, but its local record could not be saved; do not retry automatically', 502, true, callId)
    }

    const { data: finalized, error: finalizeError } = await input.db.from('ai_action_operations').update({
      status: 'succeeded',
      result: { callId, to: input.to },
      error: null,
      audit_status: 'pending',
      audit_error: null,
      audit_target_type: 'ai_call',
      audit_target_id: callId,
      audit_permission: 'external',
      audit_approved: true,
      audit_metadata: { to: input.to, task: input.task },
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', operationId).eq('shop_id', input.shopId).eq('status', 'running').select('id').maybeSingle()
    if (finalizeError || !finalized) {
      await updateOperation(input.db, input.shopId, operationId, {
        status: 'unknown',
        error: 'Call started, but its durable result could not be recorded',
        lease_expires_at: null,
      })
      return failure('Call started, but its durable result could not be recorded; do not retry automatically', 502, true, callId)
    }

    const audit = await writeAuditLog({
      shopId: input.shopId,
      userId: input.userId,
      action: 'call.start',
      targetType: 'ai_call',
      targetId: callId,
      permission: 'external',
      approved: true,
      idempotencyKey: key,
      metadata: { to: input.to, task: input.task },
    })
    if (!audit.ok) {
      await saveAuditState(input.db, input.shopId, operationId, false, audit.error)
      return failure('Call started, but its audit record could not be saved; do not retry automatically', 502, true, callId)
    }
    await saveAuditState(input.db, input.shopId, operationId, Boolean(audit.pending), undefined)
    return { ok: true, callId, idempotent: false, ...(audit.pending ? { auditPending: true } : {}) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Call start failed'
    await updateOperation(input.db, input.shopId, operationId, {
      status: 'unknown',
      error: message.slice(0, 1000),
      lease_expires_at: null,
    })
    return failure(`${message}; do not retry automatically`, 502, true)
  }
}
