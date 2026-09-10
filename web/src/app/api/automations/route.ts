import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { nextScheduledRun, scheduleWindowKey } from '@/lib/schedules'
import { getIdempotencyKey } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

type AutomationClaim = { claimed?: boolean; fencing_token?: number | string | null }

type AutomationMutation = {
  id: string
  action: string
  idempotencyKey: string
}

type AutomationMutationClaim = {
  claimed?: boolean
  status?: string
  id?: string
  result?: unknown
  error?: string
  audit_status?: string
  audit_error?: string | null
  audit_target_type?: string | null
  audit_target_id?: string | null
  audit_permission?: string | null
  audit_approved?: boolean
  audit_metadata?: Record<string, unknown> | null
}

async function repairAutomationAudit(
  sb: ReturnType<typeof getServiceClient>,
  auth: { userId: string; shopId: string },
  claim: AutomationMutationClaim,
  idempotencyKey: string,
  action: string,
) {
  if (claim.audit_status === 'delivered') return { ok: true as const }
  const audit = await writeAuditLog({
    shopId: auth.shopId,
    userId: auth.userId,
    action: `automation.${action}`,
    targetType: claim.audit_target_type || 'automation',
    targetId: claim.audit_target_id || undefined,
    permission: claim.audit_permission || (action === 'delete' ? 'destructive' : 'write'),
    approved: claim.audit_approved ?? true,
    idempotencyKey,
    metadata: claim.audit_metadata || { automationAction: action },
  })
  if (!audit.ok) return { ok: false as const, response: fail('The previous automation change completed, but its audit record still needs repair', 502) }
  if (!claim.id) return { ok: false as const, response: fail('The previous automation change has no durable operation id', 502) }
  const { error } = await sb.from('ai_action_operations').update({
    audit_status: audit.pending ? 'queued' : 'delivered',
    audit_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', claim.id).eq('shop_id', auth.shopId).eq('status', 'succeeded')
  if (error) return { ok: false as const, response: fail('The previous automation change completed, but its audit state could not be repaired', 502) }
  return { ok: true as const }
}

async function claimAutomationMutation(
  sb: ReturnType<typeof getServiceClient>,
  auth: { userId: string; shopId: string },
  req: NextRequest,
  action: string,
  body: Record<string, unknown>,
) {
  const suppliedKey = getIdempotencyKey(req, [])
  if (!suppliedKey) return { ok: false as const, response: fail('Idempotency-Key is required for automation mutations', 400) }
  const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const durableKey = `${auth.shopId}:automation:${action}:${createHash('sha256').update(suppliedKey).digest('hex')}`.slice(0, 160)
  const { data, error } = await sb.rpc('claim_ai_action_operation', {
    p_shop_id: auth.shopId,
    p_user_id: auth.userId,
    p_action: `automation.${action}`,
    p_idempotency_key: durableKey,
    p_payload_hash: payloadHash,
  })
  if (error) return { ok: false as const, response: fail('Automation change could not be safely started', 503) }
  const claim = (data || {}) as AutomationMutationClaim
  if (claim.status === 'conflict') return { ok: false as const, response: fail(claim.error || 'Automation idempotency key conflict', 409) }
  if (claim.status === 'succeeded') {
    const repaired = await repairAutomationAudit(sb, auth, claim, durableKey, action)
    if (!repaired.ok) return repaired
    return { ok: true as const, replay: true as const, result: claim.result }
  }
  if (claim.status === 'failed' || claim.status === 'unknown') return { ok: false as const, response: fail(claim.error || 'The previous automation change needs reconciliation', 409) }
  if (claim.claimed !== true || claim.status !== 'running' || !claim.id) return { ok: false as const, response: fail('This automation change is already in progress', 409) }
  return { ok: true as const, replay: false as const, mutation: { id: claim.id, action, idempotencyKey: durableKey } satisfies AutomationMutation }
}

async function finalizeAutomationMutation(
  sb: ReturnType<typeof getServiceClient>,
  auth: { userId: string; shopId: string },
  mutation: AutomationMutation,
  result: unknown,
  targetId?: string,
) {
  const { data: finalized, error: finalizeError } = await sb.from('ai_action_operations').update({
    status: 'succeeded',
    result,
    error: null,
    audit_status: 'pending',
    audit_error: null,
    audit_target_type: 'automation',
    audit_target_id: targetId || null,
    audit_permission: mutation.action === 'delete' ? 'destructive' : 'write',
    audit_approved: true,
    audit_metadata: { automationAction: mutation.action },
    updated_at: new Date().toISOString(),
  }).eq('id', mutation.id).eq('shop_id', auth.shopId).eq('status', 'running').select('id').maybeSingle()
  if (finalizeError || !finalized) {
    await sb.from('ai_action_operations').update({
      status: 'unknown',
      error: 'Automation changed, but its durable result is uncertain; reconcile before retrying',
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', mutation.id).eq('shop_id', auth.shopId).eq('status', 'running')
    return { ok: false as const, response: fail('Automation changed, but its durable result is uncertain; reconcile before retrying', 502) }
  }

  const audit = await writeAuditLog({
    shopId: auth.shopId,
    userId: auth.userId,
    action: `automation.${mutation.action}`,
    targetType: 'automation',
    targetId,
    permission: mutation.action === 'delete' ? 'destructive' : 'write',
    approved: true,
    idempotencyKey: mutation.idempotencyKey,
    metadata: { automationAction: mutation.action },
  })
  if (!audit.ok) return { ok: false as const, response: fail('Automation changed, but its audit record could not be saved', 502) }
  const { error: auditStateError } = await sb.from('ai_action_operations').update({
    audit_status: audit.pending ? 'queued' : 'delivered',
    audit_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', mutation.id).eq('shop_id', auth.shopId).eq('status', 'succeeded')
  if (auditStateError) return { ok: false as const, response: fail('Automation changed, but its audit state could not be recorded', 502) }
  return { ok: true as const, auditPending: Boolean(audit.pending) }
}

async function failAutomationMutation(
  sb: ReturnType<typeof getServiceClient>,
  shopId: string,
  mutation: AutomationMutation,
  error: string,
) {
  await sb.from('ai_action_operations').update({
    status: 'failed',
    error: error.slice(0, 1000),
    updated_at: new Date().toISOString(),
  }).eq('id', mutation.id).eq('shop_id', shopId).eq('status', 'running')
}

function getAutomationClaim(data: unknown): AutomationClaim | null {
  if (!data || typeof data !== 'object') return null
  return data as AutomationClaim
}

function fencingTokenOf(claim: AutomationClaim | null): number | null {
  const token = Number(claim?.fencing_token)
  return Number.isSafeInteger(token) && token >= 0 ? token : null
}

async function renewAutomationLease(
  sb: ReturnType<typeof getServiceClient>,
  shopId: string,
  automationId: string,
  windowKey: string,
  fencingToken: number,
) {
  const now = new Date()
  const { data, error } = await sb.from('automation_runs').update({
    heartbeat_at: now.toISOString(),
    lease_expires_at: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
  }).eq('shop_id', shopId)
    .eq('automation_id', automationId)
    .eq('window_key', windowKey)
    .eq('fencing_token', fencingToken)
    .eq('status', 'running')
    .select('id')
    .maybeSingle()
  if (error || !data) throw new Error('Automation lease was lost before execution')
}

// Automations CRUD + execution
// Table: automations { id, name, description, schedule, task_prompt, enabled, last_run, next_run, run_count, status, created_at }
// schedule examples: '05:00' (daily at 5am) and 'mon 09:00' (mondays at 9am).
// The deployed Vercel Hobby scheduler invokes the worker once per day; manual
// Run Now remains available for immediate execution.

function hasInternalSecret(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

async function getTimezone(shopId?: string): Promise<string> {
  try {
    const sb = getServiceClient()
    let query = sb.from('settings').select('timezone').limit(1)
    if (shopId) query = query.eq('shop_id', shopId)
    const { data } = await query.single()
    return data?.timezone || 'America/Chicago'
  } catch { return 'America/Chicago' }
}

function parseNextRun(schedule: string, tz: string = 'America/Chicago'): string {
  return nextScheduledRun(schedule, tz).toISOString()
}

function isUnsupportedFrequentSchedule(schedule: string): boolean {
  const match = schedule.trim().match(/^every\s+(\d+)\s*(m|min|h|hr|hour|hours|minute|minutes)?$/i)
  if (!match) return false
  const amount = Number(match[1])
  const unit = (match[2] || 'h').toLowerCase()
  const minutes = amount * (unit.startsWith('m') ? 1 : 60)
  return Number.isFinite(minutes) && minutes < 24 * 60
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const sb = getServiceClient()
  const { data, error } = await sb
    .from('automations')
    .select('*')
    .eq('shop_id', auth.shopId)
    .order('created_at', { ascending: false })
  if (error) return fail(error.message)
  return ok(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const { action } = body
  const aiSource = req.headers.get('x-ai-source') === 'ai'
  const approval = req.headers.get('x-ai-approval') === 'confirm'
  if (aiSource && ['create', 'update', 'delete', 'toggle', 'run_now'].includes(String(action)) && !approval) {
    return fail('This automation action requires explicit approval', 409)
  }
  const sb = getServiceClient()
  const internal = hasInternalSecret(req)
  const auth = internal && action === 'check_due' ? null : await getAuthedShop()
  if (!internal && !auth) return unauthorized()
  if (action !== 'check_due' && !auth) return unauthorized()
  if (auth && auth.role === 'viewer' && action !== 'check_due') return forbidden()
  const shopId = auth?.shopId

  if (!action || action === 'create') {
    // Create new automation
    const { name, description, schedule, task_prompt } = body as {
      name: string
      description?: string
      schedule: string
      task_prompt: string
    }
    if (typeof name !== 'string' || !name.trim() || typeof schedule !== 'string' || !schedule.trim() || typeof task_prompt !== 'string' || !task_prompt.trim()) {
      return fail('name, schedule, and task_prompt are required')
    }
    if (isUnsupportedFrequentSchedule(schedule)) return fail('Repeating intervals shorter than one day are not available on this deployment; choose a daily or weekly schedule, or use Run Now.')
    if (!auth || !shopId) return unauthorized()
    const mutationClaim = await claimAutomationMutation(sb, auth, req, 'create', body)
    if (!mutationClaim.ok) return mutationClaim.response
    if (mutationClaim.replay) return ok(mutationClaim.result)
    const tz = await getTimezone(shopId)
    const next_run = parseNextRun(schedule, tz)
    const { data, error } = await sb.from('automations').insert({
      shop_id: shopId,
      name: name.trim().slice(0, 160),
      description: typeof description === 'string' ? description.slice(0, 1000) : '',
      schedule: schedule.trim().slice(0, 100),
      task_prompt: task_prompt.trim().slice(0, 4000),
      enabled: true,
      next_run,
      run_count: 0,
      status: 'pending',
      created_at: new Date().toISOString(),
    }).select().single()
    if (error) {
      await failAutomationMutation(sb, shopId, mutationClaim.mutation, error.message)
      return fail(error.message)
    }
    const finalized = await finalizeAutomationMutation(sb, auth, mutationClaim.mutation, data, data?.id)
    if (!finalized.ok) return finalized.response
    return NextResponse.json({ ok: true, data, ...(finalized.auditPending ? { auditPending: true } : {}) })
  }

  if (action === 'update') {
    const { id } = body as Record<string, unknown>
    if (typeof id !== 'string' || !id) return fail('id required')
    const allowedUpdates: Record<string, unknown> = {}
    for (const key of ['name', 'description', 'schedule', 'task_prompt']) {
      if (Object.prototype.hasOwnProperty.call(body, key)) allowedUpdates[key] = body[key]
    }
    if (Object.prototype.hasOwnProperty.call(body, 'name') && (typeof body.name !== 'string' || !body.name.trim())) return fail('name must be a non-empty string')
    if (Object.prototype.hasOwnProperty.call(body, 'schedule') && (typeof body.schedule !== 'string' || !body.schedule.trim())) return fail('schedule must be a non-empty string')
    if (typeof body.schedule === 'string' && isUnsupportedFrequentSchedule(body.schedule)) return fail('Repeating intervals shorter than one day are not available on this deployment; choose a daily or weekly schedule, or use Run Now.')
    if (Object.prototype.hasOwnProperty.call(body, 'task_prompt') && (typeof body.task_prompt !== 'string' || !body.task_prompt.trim())) return fail('task_prompt must be a non-empty string')
    if (typeof allowedUpdates.name === 'string') allowedUpdates.name = allowedUpdates.name.trim().slice(0, 160)
    if (typeof allowedUpdates.description === 'string') allowedUpdates.description = allowedUpdates.description.slice(0, 1000)
    if (typeof allowedUpdates.schedule === 'string') allowedUpdates.schedule = allowedUpdates.schedule.trim().slice(0, 100)
    if (typeof allowedUpdates.task_prompt === 'string') allowedUpdates.task_prompt = allowedUpdates.task_prompt.trim().slice(0, 4000)
    if (typeof allowedUpdates.schedule === 'string') {
      const tz = await getTimezone(shopId)
      allowedUpdates.next_run = parseNextRun(allowedUpdates.schedule, tz)
    }
    if (!Object.keys(allowedUpdates).length) return fail('No editable fields supplied')
    if (!auth || !shopId) return unauthorized()
    const mutationClaim = await claimAutomationMutation(sb, auth, req, 'update', body)
    if (!mutationClaim.ok) return mutationClaim.response
    if (mutationClaim.replay) return ok(mutationClaim.result)
    const { data, error } = await sb.from('automations').update({
      ...allowedUpdates,
      updated_at: new Date().toISOString()
    }).eq('id', id).eq('shop_id', shopId).select().single()
    if (error) {
      await failAutomationMutation(sb, shopId, mutationClaim.mutation, error.message)
      return fail(error.message)
    }
    const finalized = await finalizeAutomationMutation(sb, auth, mutationClaim.mutation, data, data?.id)
    if (!finalized.ok) return finalized.response
    return NextResponse.json({ ok: true, data, ...(finalized.auditPending ? { auditPending: true } : {}) })
  }

  if (action === 'delete') {
    const { id } = body as { id: string }
    if (!id) return fail('id required')
    if (!auth || !shopId) return unauthorized()
    const mutationClaim = await claimAutomationMutation(sb, auth, req, 'delete', body)
    if (!mutationClaim.ok) return mutationClaim.response
    if (mutationClaim.replay) return ok(mutationClaim.result)
    const { error } = await sb.from('automations').delete().eq('id', id).eq('shop_id', shopId)
    if (error) {
      await failAutomationMutation(sb, shopId, mutationClaim.mutation, error.message)
      return fail(error.message)
    }
    const result = { deleted: true, id }
    const finalized = await finalizeAutomationMutation(sb, auth, mutationClaim.mutation, result, id)
    if (!finalized.ok) return finalized.response
    return NextResponse.json({ ok: true, data: result, ...(finalized.auditPending ? { auditPending: true } : {}) })
  }

  if (action === 'toggle') {
    const { id, enabled } = body as { id: string; enabled: boolean }
    if (!id) return fail('id required')
    if (!auth || !shopId) return unauthorized()
    const mutationClaim = await claimAutomationMutation(sb, auth, req, 'toggle', body)
    if (!mutationClaim.ok) return mutationClaim.response
    if (mutationClaim.replay) return ok(mutationClaim.result)
    const updates: Record<string, unknown> = { enabled }
    if (enabled) {
      // Re-calculate next_run when re-enabling
      const { data: existing } = await sb.from('automations').select('schedule').eq('id', id).eq('shop_id', shopId).single()
      if (existing?.schedule) {
        const tz = await getTimezone(shopId)
        updates.next_run = parseNextRun(existing.schedule, tz)
      }
    }
    const { data, error } = await sb.from('automations').update(updates).eq('id', id).eq('shop_id', shopId).select().single()
    if (error) {
      await failAutomationMutation(sb, shopId, mutationClaim.mutation, error.message)
      return fail(error.message)
    }
    const finalized = await finalizeAutomationMutation(sb, auth, mutationClaim.mutation, data, data?.id)
    if (!finalized.ok) return finalized.response
    return NextResponse.json({ ok: true, data, ...(finalized.auditPending ? { auditPending: true } : {}) })
  }

  if (action === 'run_now') {
    // Trigger an automation immediately
    const { id } = body as { id: string }
    if (!id) return fail('id required')
    const { data: automation, error: automationError } = await sb.from('automations').select('*').eq('id', id).eq('shop_id', shopId).maybeSingle()
    if (automationError) return fail(automationError.message)
    if (!automation) return fail('Automation not found')

    const manualWindowKey = `manual:${getIdempotencyKey(req, [shopId, id, new Date().toISOString().slice(0, 16)])}`
    const { data: claim, error: claimError } = await sb.rpc('claim_automation_run_v2', {
      p_shop_id: shopId,
      p_automation_id: id,
      p_window_key: manualWindowKey,
      p_lease_seconds: 300,
    })
    if (claimError) return fail('Automation run could not be claimed', 503)
    const automationClaim = getAutomationClaim(claim)
    const fencingToken = fencingTokenOf(automationClaim)
    if (automationClaim?.claimed !== true || fencingToken === null) return fail('This automation run is already in progress or already completed', 409)

    // Execute via the AI
    try {
      await renewAutomationLease(sb, shopId as string, id, manualWindowKey, fencingToken)
      const { data: settings } = await sb.from('settings').select('ai_api_key,ai_model,ai_base_url,shop_name').eq('shop_id', shopId).limit(1).single()
      const apiKey = settings?.ai_api_key
      if (!apiKey) throw new Error('No AI API key configured')
      const aiBaseUrl = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
      const aiModel = normalizeAiModel(settings?.ai_model, aiBaseUrl)
      const shopName = String(settings?.shop_name || 'this auto repair shop').slice(0, 120)

      const res = await fetch(`${aiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: aiModel,
          messages: [
            { role: 'system', content: `You are the AI assistant for ${shopName}. Generate a proposal for the requested automation task. Do not claim that an external action was executed; be concise.` },
            { role: 'user', content: automation.task_prompt }
          ],
          max_tokens: 1000,
          temperature: 0.3,
        })
      })
      const aiData = await res.json()
      if (!res.ok) throw new Error(`AI provider returned ${res.status}`)
      const result = aiData.choices?.[0]?.message?.content || ''
      if (!result) throw new Error('AI did not return a proposal')

      const tz = await getTimezone(shopId)
      const { data: proposal, error: proposalError } = await sb.from('automations').update({
        last_result: result.slice(0, 500),
        next_run: parseNextRun(automation.schedule, tz),
        status: 'awaiting_approval',
      }).eq('id', id).eq('shop_id', shopId).eq('active_fencing_token', fencingToken).select('id').maybeSingle()
      if (proposalError || !proposal) {
        await sb.from('automation_runs').update({
          status: 'failed', finished_at: new Date().toISOString(),
          next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), error: proposalError?.message || 'Automation lease was lost before saving the proposal',
        }).eq('shop_id', shopId).eq('automation_id', id).eq('window_key', manualWindowKey).eq('fencing_token', fencingToken).eq('status', 'running')
        return fail(proposalError?.message || 'Automation proposal could not be saved', 500)
      }
      const { data: completedRun, error: runUpdateError } = await sb.from('automation_runs').update({
        status: 'succeeded', finished_at: new Date().toISOString(), next_attempt_at: null,
        result: { proposal: result.slice(0, 500) }, error: null,
      }).eq('shop_id', shopId).eq('automation_id', id).eq('window_key', manualWindowKey).eq('fencing_token', fencingToken).eq('status', 'running').select('id').maybeSingle()
      if (runUpdateError || !completedRun) {
        await sb.from('automation_runs').update({
          status: 'unknown', finished_at: new Date().toISOString(), next_attempt_at: null,
          error: 'Proposal was saved, but its durable run state could not be saved',
        }).eq('shop_id', shopId).eq('automation_id', id).eq('window_key', manualWindowKey).eq('fencing_token', fencingToken).eq('status', 'running')
        return fail('Proposal was saved, but the durable run state could not be saved', 502)
      }

      await sb.from('automations').update({ active_fencing_token: null })
        .eq('id', id).eq('shop_id', shopId).eq('active_fencing_token', fencingToken)

      return ok({ executed: false, proposal: result, approvalRequired: true, message: 'The AI generated a proposal; no external action was executed.' })
    } catch (err) {
      await sb.from('automations').update({ status: 'error', last_result: String(err) })
        .eq('id', id).eq('shop_id', shopId).eq('active_fencing_token', fencingToken)
      await sb.from('automation_runs').update({
        status: 'failed', finished_at: new Date().toISOString(),
        next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), error: String(err),
      }).eq('shop_id', shopId).eq('automation_id', id).eq('window_key', manualWindowKey).eq('fencing_token', fencingToken).eq('status', 'running')
      return fail(err instanceof Error ? err.message : 'Execution failed')
    }
  }

  // Auto-run check: called by a cron or polling — runs all due automations
  if (action === 'check_due') {
    const now = new Date().toISOString()
    let dueQuery = sb
      .from('automations')
      .select('*')
      .eq('enabled', true)
      .lte('next_run', now)
      .limit(10)
    if (shopId) dueQuery = dueQuery.eq('shop_id', shopId)
    const { data: dueItems, error: dueError } = await dueQuery
    if (dueError) return fail('Unable to load due automations', 500)

    if (!dueItems?.length) return ok({ ran: 0 })

    let ran = 0
    let failed = 0
    for (const automation of dueItems) {
      const targetShopId = automation.shop_id || shopId
      if (!targetShopId) continue
      let runWindowKey: string | null = null
      let runFencingToken: number | null = null
      try {
        let settingsQuery = sb.from('settings').select('ai_api_key,ai_model,ai_base_url,shop_name,timezone').eq('shop_id', targetShopId).limit(1)
        const { data: settings } = await settingsQuery.single()
        const timezone = typeof settings?.timezone === 'string' && settings.timezone ? settings.timezone : 'America/Chicago'
        const windowKey = scheduleWindowKey(automation.schedule, timezone)
        runWindowKey = windowKey
        const { data: claim, error: claimError } = await sb.rpc('claim_automation_run_v2', {
          p_shop_id: targetShopId,
          p_automation_id: String(automation.id),
          p_window_key: windowKey,
          p_lease_seconds: 300,
        })
        if (claimError) throw new Error('Automation run could not be claimed')
        const automationClaim = getAutomationClaim(claim)
        runFencingToken = fencingTokenOf(automationClaim)
        if (automationClaim?.claimed !== true || runFencingToken === null) continue
        await renewAutomationLease(sb, targetShopId, String(automation.id), windowKey, runFencingToken)

        const apiKey = settings?.ai_api_key
        if (!apiKey) throw new Error('No AI API key')
        const aiBaseUrl = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
        const aiModel = normalizeAiModel(settings?.ai_model, aiBaseUrl)
        const shopName = String(settings?.shop_name || 'this auto repair shop').slice(0, 120)

        const res = await fetch(`${aiBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: aiModel,
            messages: [
              { role: 'system', content: `You are the AI assistant for ${shopName}. Generate a concise proposal for the scheduled automation task. Do not claim that an external action was executed.` },
              { role: 'user', content: automation.task_prompt }
            ],
            max_tokens: 1000,
            temperature: 0.3,
          })
        })
        if (!res.ok) throw new Error(`AI provider returned ${res.status}`)
        const aiData = await res.json()
        const result = aiData.choices?.[0]?.message?.content || ''
        if (!result) throw new Error('AI did not return a proposal')
        const tz = timezone
        let updateQuery = sb.from('automations').update({
          last_result: result.slice(0, 500),
          next_run: parseNextRun(automation.schedule, tz),
          status: 'awaiting_approval',
        }).eq('id', automation.id).eq('active_fencing_token', runFencingToken)
        if (targetShopId) updateQuery = updateQuery.eq('shop_id', targetShopId)
        const { data: proposal, error: proposalError } = await updateQuery.select('id').maybeSingle()
        if (proposalError || !proposal) throw proposalError || new Error('Automation lease was lost before saving the proposal')
        const { data: completedRun, error: runUpdateError } = await sb.from('automation_runs').update({
          status: 'succeeded', finished_at: new Date().toISOString(), next_attempt_at: null,
          result: { proposal: result.slice(0, 500) }, error: null,
        }).eq('shop_id', targetShopId).eq('automation_id', String(automation.id)).eq('window_key', windowKey).eq('fencing_token', runFencingToken).eq('status', 'running').select('id').maybeSingle()
        if (runUpdateError || !completedRun) throw runUpdateError || new Error('Automation run was reclaimed before completion')
        await sb.from('automations').update({ active_fencing_token: null })
          .eq('id', automation.id).eq('shop_id', targetShopId).eq('active_fencing_token', runFencingToken)
        ran++
      } catch (err) {
        failed++
        let updateQuery = sb.from('automations').update({ status: 'error', last_result: String(err) }).eq('id', automation.id)
        if (runFencingToken !== null) updateQuery = updateQuery.eq('active_fencing_token', runFencingToken)
        if (targetShopId) updateQuery = updateQuery.eq('shop_id', targetShopId)
        const { error: stateError } = await updateQuery
        if (stateError) console.error('[automations] could not save error state:', stateError.message)
        if (runWindowKey && runFencingToken !== null) {
          await sb.from('automation_runs').update({
            status: 'failed', finished_at: new Date().toISOString(),
            next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), error: String(err),
          }).eq('shop_id', targetShopId).eq('automation_id', String(automation.id)).eq('window_key', runWindowKey).eq('fencing_token', runFencingToken).eq('status', 'running')
        }
      }
    }

    const response = { ran, failed, total: dueItems.length, executed: false, approvalRequired: true, message: 'Due automations now produce proposals for approval; no external actions were executed.' }
    return NextResponse.json({ ok: failed === 0, data: response }, { status: failed === 0 ? 200 : 502 })
  }

  return fail(`Unknown action: ${action}`)
}
