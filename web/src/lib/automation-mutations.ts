// Safe, repeatable changes to automation settings: every change needs an Idempotency-Key, is recorded once,
// and leaves an audit entry. Used by the system-automations route for switching on and off, editing and shop rules.

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getIdempotencyKey } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'

type Sb = SupabaseClient

export type SystemMutationClaim = {
  claimed?: boolean
  status?: string
  id?: string
  result?: unknown
  error?: string
  audit_status?: string
  audit_target_type?: string | null
  audit_target_id?: string | null
  audit_permission?: string | null
  audit_approved?: boolean
  audit_metadata?: Record<string, unknown> | null
}

async function repairSystemAutomationAudit(
  sb: Sb,
  auth: { userId: string; shopId: string },
  claim: SystemMutationClaim,
  idempotencyKey: string,
  action: string,
) {
  if (claim.audit_status === 'delivered') return { ok: true as const }
  const audit = await writeAuditLog({
    shopId: auth.shopId,
    userId: auth.userId,
    action: `system_automation.${action}`,
    targetType: claim.audit_target_type || 'system_automation',
    targetId: claim.audit_target_id || undefined,
    permission: claim.audit_permission || 'write',
    approved: claim.audit_approved ?? true,
    idempotencyKey,
    metadata: claim.audit_metadata || { systemAutomationAction: action },
  })
  if (!audit.ok) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'The previous automation setting changed, but its audit record still needs repair' }, { status: 502 }) }
  if (!claim.id) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'The previous automation setting has no durable operation id' }, { status: 502 }) }
  const { error } = await sb.from('ai_action_operations').update({
    audit_status: audit.pending ? 'queued' : 'delivered',
    audit_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', claim.id).eq('shop_id', auth.shopId).eq('status', 'succeeded')
  if (error) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'The previous automation setting changed, but its audit state could not be repaired' }, { status: 502 }) }
  return { ok: true as const }
}

export async function claimSystemAutomationMutation(
  sb: Sb,
  auth: { userId: string; shopId: string },
  req: NextRequest,
  action: string,
  id: string,
  body: Record<string, unknown>,
) {
  const suppliedKey = getIdempotencyKey(req, [])
  if (!suppliedKey) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Idempotency-Key is required for automation setting changes' }, { status: 400 }) }
  const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const durableKey = `${auth.shopId}:system-automation:${action}:${id}:${createHash('sha256').update(suppliedKey).digest('hex')}`.slice(0, 160)
  const { data, error } = await sb.rpc('claim_ai_action_operation', {
    p_shop_id: auth.shopId,
    p_user_id: auth.userId,
    p_action: `system_automation.${action}`,
    p_idempotency_key: durableKey,
    p_payload_hash: payloadHash,
  })
  if (error) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Automation setting change could not be safely started' }, { status: 503 }) }
  const claim = (data || {}) as SystemMutationClaim
  if (claim.status === 'conflict') return { ok: false as const, response: NextResponse.json({ ok: false, error: claim.error || 'Automation setting idempotency key conflict' }, { status: 409 }) }
  if (claim.status === 'succeeded') {
    const repaired = await repairSystemAutomationAudit(sb, auth, claim, durableKey, action)
    if (!repaired.ok) return repaired
    return { ok: true as const, replay: true as const, result: claim.result }
  }
  if (claim.status === 'failed' || claim.status === 'unknown') return { ok: false as const, response: NextResponse.json({ ok: false, error: claim.error || 'The previous automation setting change needs reconciliation' }, { status: 409 }) }
  if (claim.claimed !== true || claim.status !== 'running' || !claim.id) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'This automation setting change is already in progress' }, { status: 409 }) }
  return { ok: true as const, replay: false as const, mutation: { id: String(claim.id), action, idempotencyKey: durableKey } }
}

export async function finalizeSystemAutomationMutation(
  sb: Sb,
  auth: { userId: string; shopId: string },
  mutation: { id: string; action: string; idempotencyKey: string },
  result: unknown,
  targetId: string,
) {
  const { data, error } = await sb.from('ai_action_operations').update({
    status: 'succeeded',
    result,
    error: null,
    audit_status: 'pending',
    audit_error: null,
    audit_target_type: 'system_automation',
    audit_target_id: targetId,
    audit_permission: 'write',
    audit_approved: true,
    audit_metadata: { systemAutomationAction: mutation.action, systemAutomationId: targetId },
    updated_at: new Date().toISOString(),
  }).eq('id', mutation.id).eq('shop_id', auth.shopId).eq('status', 'running').select('id').maybeSingle()
  if (error || !data) {
    await sb.from('ai_action_operations').update({
      status: 'unknown',
      error: 'Automation setting changed, but its durable result is uncertain; reconcile before retrying',
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', mutation.id).eq('shop_id', auth.shopId).eq('status', 'running')
    return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Automation setting changed, but its durable result is uncertain; reconcile before retrying' }, { status: 502 }) }
  }
  const audit = await writeAuditLog({
    shopId: auth.shopId,
    userId: auth.userId,
    action: `system_automation.${mutation.action}`,
    targetType: 'system_automation',
    targetId,
    permission: 'write',
    approved: true,
    idempotencyKey: mutation.idempotencyKey,
    metadata: { systemAutomationAction: mutation.action, systemAutomationId: targetId },
  })
  if (!audit.ok) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Automation setting changed, but its audit record could not be saved' }, { status: 502 }) }
  const { error: auditStateError } = await sb.from('ai_action_operations').update({
    audit_status: audit.pending ? 'queued' : 'delivered', audit_error: null, updated_at: new Date().toISOString(),
  }).eq('id', mutation.id).eq('shop_id', auth.shopId).eq('status', 'succeeded')
  if (auditStateError) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Automation setting changed, but its audit state could not be saved' }, { status: 502 }) }
  return { ok: true as const, auditPending: Boolean(audit.pending) }
}


/** Mark a change whose result is uncertain so nobody replays it blindly. */
export async function markMutationUncertain(sb: Sb, shopId: string, mutationId: string, detail: string) {
  const message = 'Automation setting result is uncertain; reconcile before retrying'
  await sb.from('ai_action_operations').update({ status: 'unknown', error: `${message}: ${detail}`, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('id', mutationId).eq('shop_id', shopId).eq('status', 'running')
  return NextResponse.json({ ok: false, error: message }, { status: 502 })
}

/** A change that failed before anything was saved: release the claim so the same request can be tried again. */
export async function releaseMutation(sb: Sb, shopId: string, mutationId: string, error: string) {
  await sb.from('ai_action_operations').update({ status: 'failed', error, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('id', mutationId).eq('shop_id', shopId).eq('status', 'running')
}

export type { NextRequest }
