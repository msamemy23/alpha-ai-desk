import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }) }

// Automations CRUD + execution
// Table: automations { id, name, description, schedule, task_prompt, enabled, last_run, next_run, run_count, status, created_at }
// schedule examples: '05:00' (daily at 5am), 'mon 09:00' (mondays at 9am), 'every 2h'

function parseNextRun(schedule: string): string {
  const now = new Date()
  const tz = 'America/Chicago' // Houston CST/CDT
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
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('automations')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return fail(error.message)
  return ok(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, unknown>
  const { action } = body
  const sb = getServiceClient()

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
    const next_run = parseNextRun(schedule)
    const { data, error } = await sb.from('automations').insert({
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
      updates.next_run = parseNextRun(updates.schedule as string)
    }
    const { data, error } = await sb.from('automations').update({
      ...updates,
      updated_at: new Date().toISOString()
    }).eq('id', id).select().single()
    if (error) return fail(error.message)
    return ok(data)
  }

  if (action === 'delete') {
    const { id } = body as { id: string }
    if (!id) return fail('id required')
    const { error } = await sb.from('automations').delete().eq('id', id)
    if (error) return fail(error.message)
    return ok({ deleted: true })
  }

  if (action === 'toggle') {
    const { id, enabled } = body as { id: string; enabled: boolean }
    if (!id) return fail('id required')
    const updates: Record<string, unknown> = { enabled }
    if (enabled) {
      // Re-calculate next_run when re-enabling
      const { data: existing } = await sb.from('automations').select('schedule').eq('id', id).single()
      if (existing?.schedule) updates.next_run = parseNextRun(existing.schedule)
    }
    const { data, error } = await sb.from('automations').update(updates).eq('id', id).select().single()
    if (error) return fail(error.message)
    return ok(data)
  }

  if (action === 'run_now') {
    // Trigger an automation immediately
    const { id } = body as { id: string }
    if (!id) return fail('id required')
    const { data: automation } = await sb.from('automations').select('*').eq('id', id).single()
    if (!automation) return fail('Automation not found')

    // Execute via the AI
    try {
      const { data: settings } = await sb.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1).single()
      const apiKey = settings?.ai_api_key
      if (!apiKey) return fail('No AI API key configured')

      const res = await fetch(`${settings?.ai_base_url || 'https://openrouter.ai/api/v1'}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings?.ai_model || 'deepseek/deepseek-v3.2',
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

      await sb.from('automations').update({
        last_run: new Date().toISOString(),
        run_count: (automation.run_count || 0) + 1,
        last_result: result.slice(0, 500),
        next_run: parseNextRun(automation.schedule),
        status: 'completed',
      }).eq('id', id)

      return ok({ executed: true, result })
    } catch (err) {
      await sb.from('automations').update({ status: 'error', last_result: String(err) }).eq('id', id)
      return fail(err instanceof Error ? err.message : 'Execution failed')
    }
  }

  // Auto-run check: called by a cron or polling — runs all due automations
  if (action === 'check_due') {
    const now = new Date().toISOString()
    const { data: dueItems } = await sb
      .from('automations')
      .select('*')
      .eq('enabled', true)
      .lte('next_run', now)
      .limit(10)

    if (!dueItems?.length) return ok({ ran: 0 })

    const { data: settings } = await sb.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1).single()
    const apiKey = settings?.ai_api_key
    if (!apiKey) return fail('No AI API key')

    let ran = 0
    for (const automation of dueItems) {
      try {
        const res = await fetch(`${settings?.ai_base_url || 'https://openrouter.ai/api/v1'}/chat/completions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: settings?.ai_model || 'deepseek/deepseek-v3.2',
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
        await sb.from('automations').update({
          last_run: new Date().toISOString(),
          run_count: (automation.run_count || 0) + 1,
          last_result: result.slice(0, 500),
          next_run: parseNextRun(automation.schedule),
          status: 'completed',
        }).eq('id', automation.id)
        ran++
      } catch (err) {
        await sb.from('automations').update({ status: 'error', last_result: String(err) }).eq('id', automation.id)
      }
    }

    return ok({ ran, total: dueItems.length })
  }

  return fail(`Unknown action: ${action}`)
}
