import { decideApproval } from '@/lib/browser/store'
import { audit, openRoute, problem, readJson, reply } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'

/**
 * Press Approve or Deny. This is the ONLY way an approval is granted, and it is only called by the buttons on the approval card.
 * The browsing assistant has no way to call it: nothing it writes can reach this route, and a person must be signed in on a page
 * from this site (the request has to say where it came from).
 */
export async function POST(req: Request) {
  const body = await readJson(req) as { id?: unknown; decision?: unknown } | null
  if (!body || typeof body.id !== 'string' || (body.decision !== 'approved' && body.decision !== 'denied')) return problem('That request was not understood.', 400)
  const gate = await openRoute(req, { scope: 'write', need: 'act', strictOrigin: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const result = await decideApproval(caller.db, caller.auth.shopId, caller.auth.userId, body.id, body.decision)
  if (!result.ok) {
    const text = result.reason === 'expired' ? 'That request ran out of time. Ask again.' : result.reason === 'decided' ? 'That request was already answered.' : result.reason === 'missing' ? 'Approvals need a database update.' : 'That request was not found.'
    return problem(text, result.reason === 'missing' ? 409 : 404, { reason: result.reason })
  }
  await audit(caller, 'browser.approval_decided', { url: result.approval.url, actor: result.approval.actor, detail: `${body.decision === 'approved' ? 'Approved' : 'Denied'}: ${result.approval.summary}`, approvalId: result.approval.id, meta: { kind: result.approval.kind } })
  return reply({ ok: true, approval: result.approval })
}
