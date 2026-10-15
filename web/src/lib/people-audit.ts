import { writeAuditLog } from '@/lib/audit-log'

/**
 * One line in the shop's audit log for a people-and-records change. It never throws: the change has already happened, and a
 * hiccup writing the log is logged to the server console instead of turning a success into an error.
 */
export async function audit(
  who: { shopId: string; userId: string },
  action: string,
  target: { type: string; id?: string | number },
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const r = await writeAuditLog({
      shopId: who.shopId, userId: who.userId, action, targetType: target.type, targetId: target.id === undefined ? undefined : String(target.id),
      permission: 'write', approved: true, metadata,
    })
    if (!r.ok) console.error(`[audit] ${action}: ${r.error}`)
  } catch (e) {
    console.error(`[audit] ${action}:`, e instanceof Error ? e.message : e)
  }
}
