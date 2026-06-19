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

export async function writeAuditLog(input: AuditLogInput) {
  try {
    const db = getServiceClient()
    await db.from('audit_logs').insert({
      shop_id: input.shopId,
      user_id: input.userId || null,
      action: input.action,
      target_type: input.targetType || null,
      target_id: input.targetId || null,
      permission: input.permission || null,
      approved: input.approved ?? null,
      idempotency_key: input.idempotencyKey || null,
      metadata: input.metadata || {},
      created_at: new Date().toISOString(),
    })
  } catch {
    // Audit logging should never mask the user-facing operation. Deployments
    // without the latest migration will simply skip until the table exists.
  }
}
