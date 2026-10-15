import { parseLiveRequest } from '@/lib/browser/actions'
import { runLive } from '@/lib/browser/engine'
import { describeRefusal, LIMITS, makeCheck, makeResourceFetcher } from '@/lib/browser/guard'
import { authorizerFor } from '@/lib/browser/store'
import { audit, loadShopRules, openRoute, problem, readJson, reply, usedToday } from '@/lib/browser/server'
import type { BrowserAudit } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const LIVE_EVENTS: BrowserAudit[] = ['browser.visit', 'browser.fill', 'browser.click', 'browser.sent', 'browser.approval_asked', 'browser.handoff']

/** Live view: open the page in the locked browser, put back what was filled in, do one action, and show the result. */
export async function POST(req: Request) {
  const parsed = parseLiveRequest(await readJson(req, 256_000))
  if (!parsed.ok) return problem(parsed.error, 400)
  const live = parsed.req
  const acting = !!live.action && live.action.kind !== 'scroll'
  const gate = await openRoute(req, { scope: 'live', need: acting ? 'act' : 'browse', write: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const rules = await loadShopRules(caller, req)

  const refusal = describeRefusal(live.url, rules.ctx, live.actor)
  if (refusal) {
    await audit(caller, 'browser.blocked', { url: live.url, actor: live.actor, detail: refusal })
    return problem(refusal, 403, { code: 'blocked' })
  }
  if (await usedToday(caller, LIVE_EVENTS) >= LIMITS.liveDaily) {
    return problem('This shop has used its live browsing for today. Reader view still works, and live browsing resets tomorrow.', 429, { code: 'daily_cap' })
  }

  const outcome = await runLive(live, {
    check: makeCheck(rules.ctx, live.actor),
    fetchResource: makeResourceFetcher(),
    authorize: authorizerFor(caller.db, caller.auth.shopId, caller.auth.userId, live.actor),
  })

  // One line in the audit log for every call. Typed values are never written down here.
  const where = outcome.status === 'error' ? live.url : outcome.snapshot?.url || live.url
  if (outcome.status === 'ok') {
    const kind: BrowserAudit = !live.action ? 'browser.visit' : outcome.did?.startsWith('Approved') ? 'browser.sent'
      : live.action.kind === 'fill' || live.action.kind === 'select' || live.action.kind === 'check' ? 'browser.fill' : 'browser.click'
    await audit(caller, kind, { url: where, actor: live.actor, detail: outcome.did || 'Opened the page', approvalId: kind === 'browser.sent' ? live.approvalId : undefined })
  } else if (outcome.status === 'approval') {
    await audit(caller, 'browser.approval_asked', { url: where, actor: live.actor, detail: outcome.approval.summary, approvalId: outcome.approvalId })
  } else if (outcome.status === 'handoff') {
    await audit(caller, 'browser.handoff', { url: where, actor: live.actor, detail: outcome.message })
  } else if (outcome.status === 'refused') {
    await audit(caller, 'browser.click', { url: where, actor: live.actor, detail: `Stopped: ${outcome.message}` })
  } else if (outcome.status === 'error' && outcome.code === 'blocked') {
    await audit(caller, 'browser.blocked', { url: where, actor: live.actor, detail: outcome.message })
  }
  return reply({ ok: outcome.status !== 'error', outcome }, outcome.status === 'error' ? (outcome.code === 'blocked' ? 403 : outcome.code === 'needs_update' ? 409 : 502) : 200)
}
