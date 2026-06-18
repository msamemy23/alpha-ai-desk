import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'

export const dynamic = 'force-dynamic'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

// Automations CRUD + execution
// Table: automations { id, name, description, schedule, task_prompt, enabled, last_run, next_run, run_count, status, created_at }
// schedule examples: '05:00' (daily at 5am), 'mon 09:00' (mondays at 9am), 'every 2h'

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
  const now = new Date()
  const nowCT = new Date(now.toLocaleString('en-US', { timeZone: tz }))

  // Daily time: '05:00', '7:30pm', '14:30'
  const timeMatch = schedule.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (timeMatch) {
    let hour = parseInt(timeMatch[1])
    const min = parseInt(timeMatch[2])
    const ampm = timeMatch[3]?.toLowerCase()
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    const next = new Date(nowCT)
    next.setHours(hour, min, 0, 0)
    if (next <= nowCT) next.setDate(next.getDate() + 1)
    return next.toISOString()
  }

  // Day of week + time: 'mon 09:00', 'monday 9am'
  const dayMatch = schedule.match(/^(sun|mon|tue|wed|thu|fri|sat|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
  if (dayMatch) {
    const days = ['sun','mon','tue','wed','thu','fri','sat']
    const dayName = dayMatch[1].slice(0,3).toLowerCase()
    const targetDay = days.indexOf(dayName)
    let hour = parseInt(dayMatch[2])
    const min = parseInt(dayMatch[3])
    const ampm = dayMatch[4]?.toLowerCase()
    if (ampm === 'pm' && hour < 12) hour += 12
    if (ampm === 'am' && hour === 12) hour = 0
    const next = new Date(nowCT)
    const currentDay = next.getDay()
    let daysUntil = (targetDay - currentDay + 7) % 7
    if (daysUntil === 0) {
      next.setHours(hour, min, 0, 0)
      if (next <= nowCT) daysUntil = 7
      else daysUntil = 0
    }
    next.setDate(next.getDate() + daysUntil)
    next.setHours(hour, min, 0, 0)
    return next.toISOString()
  }

  // Every X minutes/hours: 'every 30m', 'every 2h', 'every 1h'
  const intervalMatch = schedule.match(/^every\s+(\d+)\s*(m|min|h|hr|hour|hours|minute|minutes)?$/i)
  if (intervalMatch) {
    const num = parseInt(intervalMatch[1])
    const unit = intervalMatch[2]?.toLowerCase() || 'h'
    const ms = unit.startsWith('m') ? num * 60 * 1000 : num * 3600 * 1000
    return new Date(Date.now() + ms).toISOString()
  }

  // Default: 24 hours from now
  return new Date(Date.now() + 86400000).toISOString()
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
    if (!name || !schedule || !task_prompt) {
      return fail('name, schedule, and task_prompt are required')
    }
    const tz = await getTimezone(shopId)
    const next_run = parseNextRun(schedule, tz)
    const { data, error } = await sb.from('automations').insert({
      shop_id: shopId,
      name,
      description: description || '',
      schedule,
      task_prompt,
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
    const { id, ...updates } = body as Record<string, unknown>
    if (!id) return fail('id required')
    if (updates.schedule) {
      const tz = await getTimezone(shopId)
      updates.next_run = parseNextRun(updates.schedule as string, tz)
    }
    const { data, error } = await sb.from('automations').update({
      ...updates,
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
    const { data: automation } = await sb.from('automations').select('*').eq('id', id).eq('shop_id', shopId).single()
    if (!automation) return fail('Automation not found')

    // Execute via the AI
    try {
      const { data: settings } = await sb.from('settings').select('ai_api_key,ai_model,ai_base_url').eq('shop_id', shopId).limit(1).single()
      const apiKey = settings?.ai_api_key
      if (!apiKey) return fail('No AI API key configured')
      const aiBaseUrl = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
      const aiModel = normalizeAiModel(settings?.ai_model, aiBaseUrl)

      const res = await fetch(`${aiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: aiModel,
          messages: [
            { role: 'system', content: 'You are Alpha AI for Alpha International Auto Center. Execute the requested automation task. Be concise in your response.' },
            { role: 'user', content: automation.task_prompt }
          ],
          max_tokens: 1000,
          temperature: 0.3,
        })
      })
      const aiData = await res.json()
      const result = aiData.choices?.[0]?.message?.content || 'Automation executed'

      const tz = await getTimezone(shopId)
      await sb.from('automations').update({
        last_run: new Date().toISOString(),
        run_count: (automation.run_count || 0) + 1,
        last_result: result.slice(0, 500),
        next_run: parseNextRun(automation.schedule, tz),
        status: 'completed',
      }).eq('id', id).eq('shop_id', shopId)

      return ok({ executed: true, result })
    } catch (err) {
      await sb.from('automations').update({ status: 'error', last_result: String(err) }).eq('id', id).eq('shop_id', shopId)
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
    const { data: dueItems } = await dueQuery

    if (!dueItems?.length) return ok({ ran: 0 })

    let ran = 0
    for (const automation of dueItems) {
      try {
        const targetShopId = automation.shop_id || shopId
        let settingsQuery = sb.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1)
        if (targetShopId) settingsQuery = settingsQuery.eq('shop_id', targetShopId)
        const { data: settings } = await settingsQuery.single()
        const apiKey = settings?.ai_api_key
        if (!apiKey) throw new Error('No AI API key')
        const aiBaseUrl = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
        const aiModel = normalizeAiModel(settings?.ai_model, aiBaseUrl)

        const res = await fetch(`${aiBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: aiModel,
            messages: [
              { role: 'system', content: 'You are Alpha AI for Alpha International Auto Center. Execute the scheduled automation task concisely.' },
              { role: 'user', content: automation.task_prompt }
            ],
            max_tokens: 1000,
            temperature: 0.3,
          })
        })
        const aiData = await res.json()
        const result = aiData.choices?.[0]?.message?.content || 'Done'
        const tz = await getTimezone(targetShopId)
        let updateQuery = sb.from('automations').update({
          last_run: new Date().toISOString(),
          run_count: (automation.run_count || 0) + 1,
          last_result: result.slice(0, 500),
          next_run: parseNextRun(automation.schedule, tz),
          status: 'completed',
        }).eq('id', automation.id)
        if (targetShopId) updateQuery = updateQuery.eq('shop_id', targetShopId)
        await updateQuery
        ran++
      } catch (err) {
        const targetShopId = automation.shop_id || shopId
        let updateQuery = sb.from('automations').update({ status: 'error', last_result: String(err) }).eq('id', automation.id)
        if (targetShopId) updateQuery = updateQuery.eq('shop_id', targetShopId)
        await updateQuery
      }
    }

    return ok({ ran, total: dueItems.length })
  }

  return fail(`Unknown action: ${action}`)
}
