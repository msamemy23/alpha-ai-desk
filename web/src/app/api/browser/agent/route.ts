import { parseLiveRequest } from '@/lib/browser/actions'
import { runAgentStep } from '@/lib/browser/agent-run'
import type { AgentStepRecord } from '@/lib/browser/agent'
import { describeRefusal, LIMITS, makeCheck, makeResourceFetcher } from '@/lib/browser/guard'
import { hostMatches } from '@/lib/browser/url'
import { hasAiKey, makeAskModel } from '@/lib/browser/model'
import { authorizerFor } from '@/lib/browser/store'
import { audit, isQuickSite, loadShopRules, openRoute, problem, readJson, reply, usedToday } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function cleanSteps(input: unknown): AgentStepRecord[] {
  if (!Array.isArray(input)) return []
  return input.slice(-40).map((s, i) => {
    const r = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>
    return { n: Number.isInteger(r.n) ? Number(r.n) : i + 1, did: typeof r.did === 'string' ? r.did.slice(0, 200) : '', result: typeof r.result === 'string' ? r.result.slice(0, 200) : '' }
  })
}

/** One step of "Ask Alpha to look this up". The screen keeps the state and asks for the next step, so Stop is simply not asking. */
export async function POST(req: Request) {
  const body = await readJson(req, 256_000) as Record<string, unknown> | null
  if (!body || typeof body.goal !== 'string' || !body.goal.trim()) return problem('Tell Alpha what to look up.', 400)
  const page = parseLiveRequest({ url: body.url, prepared: body.prepared, scrollY: body.scrollY, viewport: body.viewport })
  if (!page.ok) return problem(page.error, 400)
  const gate = await openRoute(req, { scope: 'agent', need: 'act', write: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const rules = await loadShopRules(caller, req)
  if (!rules.ctx.settings.aiEnabled) return problem('Alpha is switched off for the browser in this shop. Turn it on in the browser settings.', 403, { code: 'ai_off' })
  const refusal = describeRefusal(page.req.url, rules.ctx, 'ai')
  if (refusal) {
    await audit(caller, 'browser.blocked', { url: page.req.url, actor: 'ai', detail: refusal })
    return problem(refusal, 403, { code: 'blocked' })
  }
  if (await usedToday(caller, ['browser.ai_step']) >= LIMITS.agentDaily) return problem('Alpha has used its browsing steps for today. You can still browse yourself, and this resets tomorrow.', 429, { code: 'daily_cap' })

  let settings: Record<string, unknown> | null = null
  try {
    const { data } = await caller.db.from('settings').select('ai_api_key,ai_base_url,ai_model').eq('shop_id', caller.auth.shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    settings = data
  } catch { settings = null }
  if (!hasAiKey(settings)) return problem('Add your AI key in Settings so Alpha can look things up for you.', 409, { code: 'ai_not_set_up' })

  const authorize = authorizerFor(caller.db, caller.auth.shopId, caller.auth.userId, 'ai')
  const openApproval = body.openApproval && typeof body.openApproval === 'object'
    ? { id: String((body.openApproval as Record<string, unknown>).id || ''), url: String((body.openApproval as Record<string, unknown>).url || '') } : undefined
  // The approval that lets Alpha open a new site is the person's own, so it is consumed as theirs.
  const result = await runAgentStep({
    goal: body.goal.slice(0, 1200), url: page.req.url, prepared: page.req.prepared, scrollY: page.req.scrollY, viewport: page.req.viewport, steps: cleanSteps(body.steps),
    openApproval,
  }, {
    engine: { check: makeCheck(rules.ctx, 'ai'), fetchResource: makeResourceFetcher(), authorize },
    askModel: makeAskModel(settings || {}),
    isTrusted: url => isQuickSite(rules, url) || rules.rules.some(r => r.rule === 'allow' && hostMatches(safeHost(url), r.host)),
    checkOpen: url => describeRefusal(url, rules.ctx, 'ai'),
    authorize,
  })
  const step = 'step' in result ? result.step : undefined
  await audit(caller, 'browser.ai_step', {
    url: ('snapshot' in result && result.snapshot?.url) || page.req.url, actor: 'ai',
    detail: step ? `${step.did}: ${step.result}` : result.status === 'error' ? result.message : result.status,
    meta: { status: result.status, n: step?.n },
  })
  return reply({ ok: result.status !== 'error', result }, result.status === 'error' ? 502 : 200)
}

function safeHost(url: string): string { try { return new URL(url).hostname.toLowerCase() } catch { return '' } }
