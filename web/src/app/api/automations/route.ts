import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { nextScheduledRun, scheduleWindowKey } from '@/lib/schedules'
import { getIdempotencyKey } from '@/lib/api-response'

export const dynamic = 'force-dynamic'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

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
    if (error) return fail(error.message)
    return ok(data)
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
    const { data, error } = await sb.from('automations').update({
      ...allowedUpdates,
      updated_at: new Date().toISOString()
    }).eq('id', id).eq('shop_id', shopId).select().single()
    if (error) return fail(error.message)
    return ok(data)
  }

  if (action === 'delete') {
    const { id } = body as { id: string }
    if (!id) return fail('id required')
    const { error } = await sb.from('automations').delete().eq('id', id).eq('shop_id', shopId)
    if (error) return fail(error.message)
    return ok({ deleted: true })
  }

  if (action === 'toggle') {
    const { id, enabled } = body as { id: string; enabled: boolean }
    if (!id) return fail('id required')
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
    if (error) return fail(error.message)
    return ok(data)
  }

  if (action === 'run_now') {
    // Trigger an automation immediately
    const { id } = body as { id: string }
    if (!id) return fail('id required')
    const { data: automation, error: automationError } = await sb.from('automations').select('*').eq('id', id).eq('shop_id', shopId).maybeSingle()
    if (automationError) return fail(automationError.message)
    if (!automation) return fail('Automation not found')

    const manualWindowKey = `manual:${getIdempotencyKey(req, [shopId, id, new Date().toISOString().slice(0, 16)])}`
    const { data: claimed, error: claimError } = await sb.rpc('claim_automation_run', {
      p_shop_id: shopId,
      p_automation_id: id,
      p_window_key: manualWindowKey,
    })
    if (claimError) return fail('Automation run could not be claimed', 503)
    if (claimed !== true) return fail('This automation run is already in progress or already completed', 409)

    // Execute via the AI
    try {
      const { data: settings } = await sb.from('settings').select('ai_api_key,ai_model,ai_base_url,shop_name').eq('shop_id', shopId).limit(1).single()
      const apiKey = settings?.ai_api_key
      if (!apiKey) return fail('No AI API key configured')
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
      if (!res.ok) return fail(`AI provider returned ${res.status}`, 502)
      const result = aiData.choices?.[0]?.message?.content || ''
      if (!result) return fail('AI did not return a proposal', 502)

      const tz = await getTimezone(shopId)
      const { error: proposalError } = await sb.from('automations').update({
        last_result: result.slice(0, 500),
        next_run: parseNextRun(automation.schedule, tz),
        status: 'awaiting_approval',
      }).eq('id', id).eq('shop_id', shopId)
      if (proposalError) {
        await sb.from('automation_runs').update({
          status: 'failed', finished_at: new Date().toISOString(),
          next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), error: proposalError.message,
        }).eq('shop_id', shopId).eq('automation_id', id).eq('window_key', manualWindowKey).eq('status', 'running')
        return fail(proposalError.message, 500)
      }
      const { error: runUpdateError } = await sb.from('automation_runs').update({
        status: 'succeeded', finished_at: new Date().toISOString(), next_attempt_at: null,
        result: { proposal: result.slice(0, 500) }, error: null,
      }).eq('shop_id', shopId).eq('automation_id', id).eq('window_key', manualWindowKey).eq('status', 'running')
      if (runUpdateError) {
        await sb.from('automation_runs').update({
          status: 'unknown', finished_at: new Date().toISOString(), next_attempt_at: null,
          error: 'Proposal was saved, but its durable run state could not be saved',
        }).eq('shop_id', shopId).eq('automation_id', id).eq('window_key', manualWindowKey).eq('status', 'running')
        return fail('Proposal was saved, but the durable run state could not be saved', 502)
      }

      return ok({ executed: false, proposal: result, approvalRequired: true, message: 'The AI generated a proposal; no external action was executed.' })
    } catch (err) {
      await sb.from('automations').update({ status: 'error', last_result: String(err) }).eq('id', id).eq('shop_id', shopId)
      await sb.from('automation_runs').update({
        status: 'failed', finished_at: new Date().toISOString(),
        next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), error: String(err),
      }).eq('shop_id', shopId).eq('automation_id', id).eq('window_key', manualWindowKey).eq('status', 'running')
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
    for (const automation of dueItems) {
      const targetShopId = automation.shop_id || shopId
      if (!targetShopId) continue
      let runWindowKey: string | null = null
      try {
        let settingsQuery = sb.from('settings').select('ai_api_key,ai_model,ai_base_url,shop_name,timezone').eq('shop_id', targetShopId).limit(1)
        const { data: settings } = await settingsQuery.single()
        const timezone = typeof settings?.timezone === 'string' && settings.timezone ? settings.timezone : 'America/Chicago'
        const windowKey = scheduleWindowKey(automation.schedule, timezone)
        runWindowKey = windowKey
        const { data: claimed, error: claimError } = await sb.rpc('claim_automation_run', {
          p_shop_id: targetShopId,
          p_automation_id: String(automation.id),
          p_window_key: windowKey,
        })
        if (claimError) throw new Error('Automation run could not be claimed')
        if (claimed !== true) continue

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
        }).eq('id', automation.id)
        if (targetShopId) updateQuery = updateQuery.eq('shop_id', targetShopId)
        const { error: proposalError } = await updateQuery
        if (proposalError) throw proposalError
        const { error: runUpdateError } = await sb.from('automation_runs').update({
          status: 'succeeded', finished_at: new Date().toISOString(), next_attempt_at: null,
          result: { proposal: result.slice(0, 500) }, error: null,
        }).eq('shop_id', targetShopId).eq('automation_id', String(automation.id)).eq('window_key', windowKey).eq('status', 'running')
        if (runUpdateError) throw runUpdateError
        ran++
      } catch (err) {
        let updateQuery = sb.from('automations').update({ status: 'error', last_result: String(err) }).eq('id', automation.id)
        if (targetShopId) updateQuery = updateQuery.eq('shop_id', targetShopId)
        const { error: stateError } = await updateQuery
        if (stateError) console.error('[automations] could not save error state:', stateError.message)
        if (runWindowKey) {
          await sb.from('automation_runs').update({
            status: 'failed', finished_at: new Date().toISOString(),
            next_attempt_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), error: String(err),
          }).eq('shop_id', targetShopId).eq('automation_id', String(automation.id)).eq('window_key', runWindowKey).eq('status', 'running')
        }
      }
    }

    return ok({ ran, total: dueItems.length, executed: false, approvalRequired: true, message: 'Due automations now produce proposals for approval; no external actions were executed.' })
  }

  return fail(`Unknown action: ${action}`)
}
