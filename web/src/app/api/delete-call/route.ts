import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { CAN_DELETE_CALLS, deleteCallRecord } from '@/lib/call-delete'
import { writeAuditLog } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'

/** Whether this person may delete calls, so the Inbox only shows the button to people it will work for. */
export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  return NextResponse.json({ canDelete: CAN_DELETE_CALLS.includes(auth.role) })
}

/**
 * Delete one call from the Inbox call log. Owners, admins and managers only.
 * Body: { id } — the id the Inbox shows (`ai-<id>` for a call only the AI knows, or a call-log row id).
 * The call's id goes on the "do not bring back" list first, then the log row and the AI call record are removed. See lib/call-delete.ts.
 */
export async function DELETE(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!CAN_DELETE_CALLS.includes(auth.role)) return forbidden()

  const body = await req.json().catch(() => null) as { id?: unknown } | null
  const result = await deleteCallRecord(getServiceClient(), auth.shopId, auth.userId, body?.id)
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status })

  // A line in the audit trail: who, when, which call. No number, name or transcript.
  if (!result.already) {
    await writeAuditLog({
      shopId: auth.shopId, userId: auth.userId, action: 'call.delete', targetType: 'call', targetId: String(body?.id).slice(0, 200),
      approved: true, metadata: { removed: result.removed },
    }).catch(() => undefined)
  }
  return NextResponse.json({ ok: true, removed: result.removed, already: result.already })
}
