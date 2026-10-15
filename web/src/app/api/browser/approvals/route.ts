import { listPendingApprovals } from '@/lib/browser/store'
import { openRoute, reply } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'

/** The approvals this person has waiting. */
export async function GET(req: Request) {
  const gate = await openRoute(req, { scope: 'read', need: 'browse' })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const { items, missing } = await listPendingApprovals(caller.db, caller.auth.shopId, caller.auth.userId)
  return reply({ ok: true, items, missing })
}
