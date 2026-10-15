import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, hasInternalApiSecret, unauthorized } from '@/lib/api-auth'
import { getIdempotencyKey } from '@/lib/api-response'
import { CATALOG_BY_ID, configProblems, isKnownAutomation, resolveConfig } from '@/lib/automation-catalog'
import { rulesProblem, normalizeRules } from '@/lib/automation-rules'
import { claimSystemAutomationMutation, finalizeSystemAutomationMutation, markMutationUncertain, releaseMutation } from '@/lib/automation-mutations'
import { NeedsDatabaseUpdate, loadShopInfo } from '@/lib/automation-store'
import { runContextFor, setupProblems } from '@/lib/automation-engine'
import {
  NoShopSettings,
  blankState,
  engineDeps,
  overview,
  patchAutomationConfig,
  preview,
  runOne,
  testSend,
  tick,
} from '@/lib/automation-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RULES_KEY = '_rules'

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status })

function baseUrlOf(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin)
}

function failure(error: unknown): NextResponse {
  if (error instanceof NoShopSettings) return json({ ok: false, error: error.message, needs_settings: true }, 409)
  if (error instanceof NeedsDatabaseUpdate) return json({ ok: false, error: 'This needs a database update before it can be used. Ask your developer to apply it.', needs_database_update: true }, 409)
  console.error('[system-automations]', error instanceof Error ? error.message : error)
  return json({ ok: false, error: error instanceof Error ? error.message : 'Something went wrong. Try again.' }, 500)
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  try {
    const data = await overview(getServiceClient(), auth.shopId)
    // `automations` keeps its old name so anything still reading the earlier shape keeps working.
    return json({ ok: true, automations: data.cards, rules: data.rules, shop: data.shop, scheduler: data.scheduler, needs_database_update: data.needs_database_update, attention: data.attention })
  } catch (error) {
    return failure(error)
  }
}

const AI_GATED = new Set(['toggle', 'configure', 'run_now', 'set_rules', 'pause_all', 'resume_all', 'cancel_queued', 'test_send'])
const MANAGER_ONLY = new Set(['set_rules', 'pause_all', 'resume_all'])

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof body.action === 'string' ? body.action : ''
  const id = typeof body.id === 'string' ? body.id : ''

  if (req.headers.get('x-ai-source') === 'ai' && AI_GATED.has(action) && req.headers.get('x-ai-approval') !== 'confirm') {
    return json({ ok: false, error: 'Explicit confirmation is required before changing automation state or running external actions', approvalRequired: true }, 409)
  }

  const sb = getServiceClient()
  const call = { baseUrl: baseUrlOf(req), secret: process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '' }

  try {
    // Only the cron secret may run the all-shops worker. Every other action works on the signed-in shop only.
    if (action === 'run_all_due') {
      if (!hasInternalApiSecret(req)) return unauthorized()
      const report = await tick(sb, engineDeps(sb, call.baseUrl), call)
      return json({ ok: true, ...report })
    }

    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()
    if (MANAGER_ONLY.has(action) && !['owner', 'admin', 'manager'].includes(auth.role)) return forbidden()
    const deps = engineDeps(sb, call.baseUrl)

    if (action === 'preview') {
      if (!isKnownAutomation(id)) return json({ ok: false, error: 'Unknown automation' }, 404)
      const def = CATALOG_BY_ID[id]
      if (def.kind !== 'engine') return json({ ok: true, id, name: def.name, legacy: true, note: 'This automation does not send texts to customers. There is nothing to preview.', recipients: [], skipped: [], counts: { send: 0, send_now: 0, held_for_quiet_hours: 0, later: 0, skipped: 0 }, skipped_by: [], problems: [] })
      const override = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config as Record<string, unknown> : undefined
      if (override) {
        const problems = configProblems(def, override)
        if (problems.length) return json({ ok: false, error: problems[0], errors: problems }, 400)
      }
      return json(await preview(deps, auth.shopId, id, override))
    }

    if (action === 'test_send') {
      const to = typeof body.to === 'string' ? body.to : ''
      const override = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config as Record<string, unknown> : undefined
      const out = await testSend(sb, deps, { shopId: auth.shopId, userId: auth.userId, automationId: id, to, configOverride: override })
      return out.ok ? json({ ok: true, message: out.message, text: out.text, to: out.to }) : json({ ok: false, error: out.error }, out.status)
    }

    if (action === 'set_rules' || action === 'pause_all' || action === 'resume_all') {
      const incoming = action === 'set_rules'
        ? (body.rules && typeof body.rules === 'object' && !Array.isArray(body.rules) ? body.rules as Record<string, unknown> : null)
        : { master_enabled: action === 'resume_all' }
      if (!incoming) return json({ ok: false, error: 'rules must be an object' }, 400)
      const problem = rulesProblem(incoming)
      if (problem) return json({ ok: false, error: problem }, 400)
      const claim = await claimSystemAutomationMutation(sb, auth, req, action, RULES_KEY, body)
      if (!claim.ok) return claim.response
      if (claim.replay) return json({ ok: true, data: claim.result, replayed: true })
      let rules = normalizeRules(incoming)
      try {
        await patchAutomationConfig(sb, auth.shopId, config => {
          rules = normalizeRules({ ...(config[RULES_KEY] || {}), ...incoming })
          config[RULES_KEY] = rules
        })
      } catch (error) {
        await releaseMutation(sb, auth.shopId, claim.mutation.id, error instanceof Error ? error.message : 'save failed')
        return failure(error)
      }
      const cancelled = rules.master_enabled ? 0 : await deps.store.cancelQueued(auth.shopId, null, 'master_off')
      const finalized = await finalizeSystemAutomationMutation(sb, auth, claim.mutation, { rules, cancelled }, RULES_KEY)
      if (!finalized.ok) return finalized.response
      return json({ ok: true, rules, cancelled, ...(finalized.auditPending ? { auditPending: true } : {}) })
    }

    if (!id || !isKnownAutomation(id)) return json({ ok: false, error: 'A known automation id is required' }, 400)
    const def = CATALOG_BY_ID[id]

    if (action === 'cancel_queued') {
      const claim = await claimSystemAutomationMutation(sb, auth, req, 'cancel_queued', id, body)
      if (!claim.ok) return claim.response
      if (claim.replay) return json({ ok: true, data: claim.result, replayed: true })
      let cancelled = 0
      try {
        cancelled = await deps.store.cancelQueued(auth.shopId, id, 'cancelled_by_you')
      } catch (error) {
        return markMutationUncertain(sb, auth.shopId, claim.mutation.id, error instanceof Error ? error.message : 'cancel failed')
      }
      const finalized = await finalizeSystemAutomationMutation(sb, auth, claim.mutation, { cancelled }, id)
      if (!finalized.ok) return finalized.response
      return json({ ok: true, cancelled })
    }

    if (action === 'toggle') {
      if (typeof body.enabled !== 'boolean') return json({ ok: false, error: 'enabled must be a boolean' }, 400)
      if (body.enabled) {
        // Switching on something that cannot run only creates a confusing "on but broken" card, so say what is missing first.
        const info = await loadShopInfo(sb, auth.shopId)
        if (!info.settingsId) throw new NoShopSettings()
        const cfg = resolveConfig(def, info.states[id]?.config)
        const blockers = def.kind === 'engine' ? setupProblems(info, def, cfg, runContextFor(info, def, cfg, Date.now())) : []
        if (blockers.length) return json({ ok: false, error: blockers[0], needs_setup: true }, 409)
      }
      const claim = await claimSystemAutomationMutation(sb, auth, req, 'toggle', id, body)
      if (!claim.ok) return claim.response
      if (claim.replay) return json({ ok: true, data: claim.result, replayed: true })
      let state: Record<string, any> = blankState()
      try {
        await patchAutomationConfig(sb, auth.shopId, config => {
          const prev = config[id] && typeof config[id] === 'object' ? config[id] : blankState()
          state = { ...prev, enabled: body.enabled === true, ...(body.enabled === true && prev.enabled !== true ? { enabled_at: new Date().toISOString() } : {}) }
          config[id] = state
        })
      } catch (error) {
        await releaseMutation(sb, auth.shopId, claim.mutation.id, error instanceof Error ? error.message : 'save failed')
        return failure(error)
      }
      // Pausing is a promise: nothing already waiting goes out.
      let cancelled = 0
      if (body.enabled === false) {
        try { cancelled = await deps.store.cancelQueued(auth.shopId, id, 'paused') } catch (error) {
          return markMutationUncertain(sb, auth.shopId, claim.mutation.id, error instanceof Error ? error.message : 'cancel failed')
        }
      }
      const finalized = await finalizeSystemAutomationMutation(sb, auth, claim.mutation, state, id)
      if (!finalized.ok) return finalized.response
      return json({ ok: true, state, cancelled, ...(finalized.auditPending ? { auditPending: true } : {}) })
    }

    if (action === 'configure') {
      if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) return json({ ok: false, error: 'config must be an object' }, 400)
      const incoming = body.config as Record<string, unknown>
      const problems = configProblems(def, incoming)
      if (problems.length) return json({ ok: false, error: problems[0], errors: problems }, 400)
      const claim = await claimSystemAutomationMutation(sb, auth, req, 'configure', id, body)
      if (!claim.ok) return claim.response
      if (claim.replay) return json({ ok: true, data: claim.result, replayed: true })
      let state: Record<string, any> = blankState()
      try {
        await patchAutomationConfig(sb, auth.shopId, config => {
          const prev = config[id] && typeof config[id] === 'object' ? config[id] : blankState()
          state = { ...prev, config: { ...(prev.config || {}), ...incoming } }
          config[id] = state
        })
      } catch (error) {
        await releaseMutation(sb, auth.shopId, claim.mutation.id, error instanceof Error ? error.message : 'save failed')
        return failure(error)
      }
      // Anything already waiting was written with the old wording or audience. Cancel it so the next run rebuilds it from the new settings.
      let cancelled = 0
      const changesWhatIsSent = Object.keys(incoming).some(k => k !== 'schedule' && k !== 'max_per_run')
      if (changesWhatIsSent) {
        try { cancelled = await deps.store.cancelQueued(auth.shopId, id, 'edited') } catch { /* the send-time checks still apply */ }
      }
      const finalized = await finalizeSystemAutomationMutation(sb, auth, claim.mutation, state, id)
      if (!finalized.ok) return finalized.response
      return json({ ok: true, state, cancelled, ...(finalized.auditPending ? { auditPending: true } : {}) })
    }

    if (action === 'run_now') {
      const info = await loadShopInfo(sb, auth.shopId)
      if (!info.settingsId) throw new NoShopSettings()
      if (!info.rules.master_enabled) return json({ ok: false, error: 'All automations are switched off. Switch them back on first.' }, 409)
      const cfg = resolveConfig(def, info.states[id]?.config)
      const blockers = def.kind === 'engine' ? setupProblems(info, def, cfg, runContextFor(info, def, cfg, Date.now())) : []
      if (blockers.length) return json({ ok: false, error: blockers[0], needs_setup: true }, 409)
      const windowKey = `manual:${getIdempotencyKey(req, [auth.shopId, id, new Date().toISOString().slice(0, 16)])}`
      const forwarded: Record<string, string> = {}
      if (!call.secret) {
        const authorization = req.headers.get('authorization')
        const cookie = req.headers.get('cookie')
        if (authorization) forwarded.Authorization = authorization
        if (cookie) forwarded.Cookie = cookie
      }
      const out = await runOne(sb, deps, { shopId: auth.shopId, def, windowKey, manual: true, call: { ...call, extraHeaders: forwarded } })
      if (out.status === 'unavailable') return json({ ok: false, error: 'The run could not be started. Try again.' }, 503)
      if (out.status === 'busy') return json({ ok: false, error: 'This automation is already running or just finished. Check the history.' }, 409)
      const report = out.report
      const fresh = (await loadShopInfo(sb, auth.shopId)).states[id]
      return json({ ok: report?.ok === true, success: report?.ok === true, message: report?.message, result: report?.result, state: fresh }, report?.ok ? 200 : 502)
    }

    return json({ ok: false, error: 'Unknown action' }, 400)
  } catch (error) {
    return failure(error)
  }
}
