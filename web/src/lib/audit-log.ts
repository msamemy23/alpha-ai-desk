import { getServiceClient } from '@/lib/supabase'

export interface AuditLogInput {
  shopId: string
  userId?: string
  action: string
  targetType?: string
  targetId?: string
  permission?: string
  approved?: boolean
  idempotencyKey?: string
  metadata?: Record<string, unknown>
}

export type AuditLogResult =
  | { ok: true; pending?: boolean }
  | { ok: false; error: string }

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[redacted-depth]'
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redact(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    if (/(?:password|secret|token|api[_-]?key|authorization|cookie|(?:^|_)pin(?:_|$))/i.test(key)) {
      result[key] = '[redacted]'
    } else {
      result[key] = redact(child, depth + 1)
    }
  }
  return result
}

function auditRow(input: AuditLogInput) {
  return {
    shop_id: input.shopId,
    user_id: input.userId || null,
    action: input.action,
    target_type: input.targetType || null,
    target_id: input.targetId || null,
    permission: input.permission || null,
    approved: input.approved ?? false,
    idempotency_key: input.idempotencyKey || null,
    metadata: redact(input.metadata || {}),
  }
}

export async function writeAuditLog(input: AuditLogInput): Promise<AuditLogResult> {
  const db = getServiceClient()
  const row = auditRow(input)

  try {
    if (input.idempotencyKey) {
      const { data: existing, error: lookupError } = await db
        .from('audit_logs')
        .select('id')
        .eq('shop_id', input.shopId)
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle()
      if (!lookupError && existing?.id) {
        await db.from('audit_log_outbox')
          .delete()
          .eq('shop_id', input.shopId)
          .eq('idempotency_key', input.idempotencyKey)
        return { ok: true }
      }
    }

    const { error } = await db.from('audit_logs').insert({
      ...row,
      created_at: new Date().toISOString(),
    })
    if (!error) {
      if (input.idempotencyKey) {
        await db.from('audit_log_outbox')
          .delete()
          .eq('shop_id', input.shopId)
          .eq('idempotency_key', input.idempotencyKey)
      }
      return { ok: true }
    }

    console.error('[audit-log] insert failed:', error.message)
    const outboxRow = {
      ...row,
      attempts: 1,
      last_error: error.message.slice(0, 1000),
      created_at: new Date().toISOString(),
    }
    const outbox = input.idempotencyKey
      ? await db.from('audit_log_outbox').upsert(outboxRow, { onConflict: 'shop_id,idempotency_key' })
      : await db.from('audit_log_outbox').insert(outboxRow)
    if (!outbox.error) return { ok: true, pending: true }
    return { ok: false, error: `${error.message}; audit outbox failed: ${outbox.error.message}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Audit log insert failed'
    console.error('[audit-log] insert failed:', message)
    try {
      const outbox = input.idempotencyKey
        ? await db.from('audit_log_outbox').upsert({
          ...row,
          attempts: 1,
          last_error: message.slice(0, 1000),
          created_at: new Date().toISOString(),
        }, { onConflict: 'shop_id,idempotency_key' })
        : await db.from('audit_log_outbox').insert({
          ...row,
          attempts: 1,
          last_error: message.slice(0, 1000),
          created_at: new Date().toISOString(),
        })
      if (!outbox.error) return { ok: true, pending: true }
      return { ok: false, error: `${message}; audit outbox failed: ${outbox.error.message}` }
    } catch (outboxError) {
      const outboxMessage = outboxError instanceof Error ? outboxError.message : 'Audit outbox insert failed'
      return { ok: false, error: `${message}; ${outboxMessage}` }
    }
  }
}

export async function requireAuditLog(input: AuditLogInput): Promise<AuditLogResult> {
  const result = await writeAuditLog(input)
  if (!result.ok) throw new Error(result.error)
  return result
}

type AuditOutboxRow = {
  id: string
  shop_id: string
  user_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  permission: string | null
  approved: boolean
  idempotency_key: string | null
  metadata: Record<string, unknown>
  attempts: number
  created_at: string
}

/**
 * Deliver audit records that were queued after a transient audit_logs failure.
 * The outbox row id is used as a stable fallback key for legacy rows that did
 * not carry an idempotency key, so a retry cannot create a duplicate audit.
 */
export async function flushAuditLogOutbox(limit = 100) {
  const db = getServiceClient()
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 500))
  const { data: rows, error: loadError } = await db
    .from('audit_log_outbox')
    .select('id,shop_id,user_id,action,target_type,target_id,permission,approved,idempotency_key,metadata,attempts,created_at')
    .is('delivered_at', null)
    .order('created_at', { ascending: true })
    .limit(boundedLimit)

  if (loadError) {
    return { ok: false, attempted: 0, delivered: 0, failed: 0, error: loadError.message }
  }

  let delivered = 0
  let failed = 0
  for (const row of (rows || []) as AuditOutboxRow[]) {
    const stableKey = row.idempotency_key || `audit-outbox:${row.id}`
    let deliveryError: string | null = null

    try {
      const { data: existing, error: lookupError } = await db
        .from('audit_logs')
        .select('id')
        .eq('shop_id', row.shop_id)
        .eq('idempotency_key', stableKey)
        .maybeSingle()
      if (lookupError) {
        deliveryError = lookupError.message
      } else if (!existing?.id) {
        const { error: insertError } = await db.from('audit_logs').insert({
          shop_id: row.shop_id,
          user_id: row.user_id,
          action: row.action,
          target_type: row.target_type,
          target_id: row.target_id,
          permission: row.permission,
          approved: row.approved,
          idempotency_key: stableKey,
          metadata: redact(row.metadata || {}),
          created_at: row.created_at || new Date().toISOString(),
        })
        if (insertError && insertError.code !== '23505') deliveryError = insertError.message
      }
    } catch (error) {
      deliveryError = error instanceof Error ? error.message : 'Audit delivery failed'
    }

    if (!deliveryError) {
      const { data: marked, error: markError } = await db
        .from('audit_log_outbox')
        .update({ delivered_at: new Date().toISOString(), last_error: null })
        .eq('id', row.id)
        .is('delivered_at', null)
        .select('id')
        .maybeSingle()
      if (markError || !marked) deliveryError = markError?.message || 'Audit outbox row could not be marked delivered'
    }

    if (deliveryError) {
      failed += 1
      await db.from('audit_log_outbox').update({
        attempts: (row.attempts || 0) + 1,
        last_error: deliveryError.slice(0, 1000),
      }).eq('id', row.id).is('delivered_at', null)
    } else {
      delivered += 1
    }
  }

  return { ok: failed === 0, attempted: (rows || []).length, delivered, failed }
}
