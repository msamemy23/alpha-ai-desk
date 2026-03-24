import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Pre-built system automations — these execute real actions, not just AI prompts
export const SYSTEM_AUTOMATIONS = [
  {
    id: 'review_requests',
    name: 'Review Requests',
    description: 'Auto-text customers after job completion asking for a Google review',
    category: 'retention',
    schedule: 'Every 2 hours',
    icon: '⭐',
    endpoint: '/api/growth/reviews',
    endpointBody: { action: 'bulk_request' },
    configFields: [
      { key: 'delay_hours', label: 'Hours after job', type: 'number', default: 2 },
      { key: 'google_review_link', label: 'Google Review URL', type: 'text', default: 'https://g.page/r/your-shop/review' },
    ],
  },
  {
    id: 'estimate_followups',
    name: 'Estimate Follow-ups',
    description: 'Text/email customers 48h after sending an estimate with no booking',
    category: 'retention',
    schedule: 'Daily at 10am',
    icon: '📋',
    endpoint: '/api/growth/estimate-followups',
    endpointBody: { action: 'run' },
    configFields: [
      { key: 'followup_hours', label: 'Hours before follow-up', type: 'number', default: 48 },
    ],
  },
  {
    id: 're_engagement',
    name: 'Win-Back Campaign',
    description: 'Text inactive customers who haven\'t visited in 90+ days',
    category: 'retention',
    schedule: 'Weekly on Monday',
    icon: '🔄',
    endpoint: '/api/growth/follow-ups',
    endpointBody: { months_threshold: 3 },
    configFields: [
      { key: 'months_threshold', label: 'Months inactive', type: 'number', default: 3 },
    ],
  },
  {
    id: 'service_reminders',
    name: 'Service Reminders',
    description: 'Text customers when oil change or inspection is coming due',
    category: 'operations',
    schedule: 'Daily at 9am',
    icon: '🔧',
    endpoint: '/api/growth/service-reminders',
    endpointBody: { action: 'run' },
    configFields: [
      { key: 'oil_change_miles', label: 'Oil change every (miles)', type: 'number', default: 3000 },
      { key: 'reminder_days_before', label: 'Remind X days before due', type: 'number', default: 7 },
    ],
  },
  {
    id: 'lead_discovery',
    name: 'Lead Discovery',
    description: 'Daily scan for new local businesses that need fleet/repair services',
    category: 'growth',
    schedule: 'Daily at 6am',
    icon: '🔍',
    endpoint: '/api/growth/ai-competitor-leads',
    endpointBody: { scan_type: 'alpha_ai', limit: 20 },
    configFields: [
      { key: 'scan_type', label: 'Scan type', type: 'select', options: ['both', 'alpha_ai', 'competitors'], default: 'alpha_ai' },
      { key: 'radius_miles', label: 'Search radius (miles)', type: 'number', default: 15 },
    ],
  },
  {
    id: 'lead_outreach',
    name: 'Auto Lead Outreach',
    description: 'Automatically email new leads that haven\'t been contacted yet',
    category: 'growth',
    schedule: 'Daily at 8am',
    icon: '📧',
    endpoint: '/api/growth/outreach',
    endpointBody: { action: 'auto_outreach', limit: 10 },
    configFields: [
      { key: 'daily_limit', label: 'Emails per day', type: 'number', default: 10 },
      { key: 'min_rating', label: 'Min Google rating', type: 'number', default: 3.5 },
    ],
  },
  {
    id: 'sms_blast',
    name: 'Promotional SMS Blast',
    description: 'Weekly SMS promotion to your customer list with a deal or reminder',
    category: 'marketing',
    schedule: 'Weekly on Friday',
    icon: '📱',
    endpoint: '/api/growth/outreach',
    endpointBody: { action: 'sms_blast' },
    configFields: [
      { key: 'message_template', label: 'Message template', type: 'textarea', default: 'Hey {name}! Alpha International has a special this week: $5 off any oil change. Call (713) 663-6979 to schedule!' },
    ],
  },
  {
    id: 'social_posts',
    name: 'Daily Social Posts',
    description: 'Auto-generate and schedule daily posts for Facebook & Instagram',
    category: 'marketing',
    schedule: 'Daily at 8am',
    icon: '📸',
    endpoint: '/api/growth/social-post',
    endpointBody: { action: 'auto_post' },
    requires: ['facebook_token'],
    configFields: [
      { key: 'post_time', label: 'Post time (CST)', type: 'text', default: '8:00am' },
      { key: 'include_specials', label: 'Include specials', type: 'boolean', default: true },
    ],
  },
  {
    id: 'review_responses',
    name: 'Auto Review Responses',
    description: 'AI generates responses for new Google reviews — you just copy and post',
    category: 'marketing',
    schedule: 'Daily at 7am',
    icon: '💬',
    endpoint: '/api/growth/reviews',
    endpointBody: { action: 'check_and_respond' },
    configFields: [],
  },
  {
    id: 'appointment_reminders',
    name: 'Appointment Reminders',
    description: 'Text customers the day before their scheduled appointment',
    category: 'operations',
    schedule: 'Daily at 5pm',
    icon: '📅',
    endpoint: '/api/growth/service-reminders',
    endpointBody: { action: 'appointment_reminders' },
    configFields: [
      { key: 'reminder_hours_before', label: 'Hours before appointment', type: 'number', default: 24 },
    ],
  },
]

async function getConfig(sb: ReturnType<typeof getServiceClient>) {
  try {
    const { data } = await sb.from('settings').select('automation_config').limit(1).single()
    return (data?.automation_config as Record<string, AutomationState>) || {}
  } catch { return {} }
}

interface AutomationState {
  enabled: boolean
  config: Record<string, unknown>
  last_run: string | null
  run_count: number
  last_result: string | null
  last_status: 'ok' | 'error' | 'never'
}

async function saveConfig(sb: ReturnType<typeof getServiceClient>, config: Record<string, AutomationState>) {
  const { data: existing } = await sb.from('settings').select('id').limit(1).single()
  if (existing?.id) {
    await sb.from('settings').update({ automation_config: config }).eq('id', existing.id)
  }
}

export async function GET() {
  const sb = getServiceClient()
  const config = await getConfig(sb)

  const result = SYSTEM_AUTOMATIONS.map(auto => ({
    ...auto,
    state: config[auto.id] || {
      enabled: false,
      config: Object.fromEntries((auto.configFields || []).map(f => [f.key, f.default])),
      last_run: null,
      run_count: 0,
      last_result: null,
      last_status: 'never',
    },
  }))

  return NextResponse.json({ ok: true, automations: result })
}

export async function POST(req: NextRequest) {
  const sb = getServiceClient()
  const body = await req.json()
  const { action, id } = body
  const config = await getConfig(sb)

  if (!config[id]) {
    const auto = SYSTEM_AUTOMATIONS.find(a => a.id === id)
    config[id] = {
      enabled: false,
      config: Object.fromEntries((auto?.configFields || []).map(f => [f.key, f.default])),
      last_run: null,
      run_count: 0,
      last_result: null,
      last_status: 'never',
    }
  }

  if (action === 'toggle') {
    config[id].enabled = body.enabled
    await saveConfig(sb, config)
    return NextResponse.json({ ok: true, state: config[id] })
  }

  if (action === 'configure') {
    config[id].config = { ...config[id].config, ...body.config }
    await saveConfig(sb, config)
    return NextResponse.json({ ok: true, state: config[id] })
  }

  if (action === 'run_now') {
    const auto = SYSTEM_AUTOMATIONS.find(a => a.id === id)
    if (!auto) return NextResponse.json({ ok: false, error: 'Unknown automation' }, { status: 404 })

    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
      const userConfig = config[id].config || {}
      const mergedBody = { ...auto.endpointBody, ...userConfig }

      const res = await fetch(`${baseUrl}${auto.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mergedBody),
      })
      const data = await res.json()
      const resultStr = JSON.stringify(data).slice(0, 500)

      config[id].last_run = new Date().toISOString()
      config[id].run_count = (config[id].run_count || 0) + 1
      config[id].last_result = resultStr
      config[id].last_status = res.ok ? 'ok' : 'error'
      await saveConfig(sb, config)

      return NextResponse.json({ ok: true, result: data, state: config[id] })
    } catch (e) {
      config[id].last_status = 'error'
      config[id].last_result = (e as Error).message
      await saveConfig(sb, config)
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
    }
  }

  // run_all_due: called by cron
  if (action === 'run_all_due') {
    const results: Record<string, unknown> = {}
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

    for (const auto of SYSTEM_AUTOMATIONS) {
      const state = config[auto.id]
      if (!state?.enabled) continue

      // Check schedule — simple approach: if enabled and last_run is null or > schedule_interval ago
      const shouldRun = !state.last_run || isScheduleDue(auto.schedule, state.last_run)
      if (!shouldRun) continue

      try {
        const userConfig = state.config || {}
        const mergedBody = { ...auto.endpointBody, ...userConfig }
        const res = await fetch(`${baseUrl}${auto.endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mergedBody),
        })
        const data = await res.json()
        config[auto.id].last_run = new Date().toISOString()
        config[auto.id].run_count = (config[auto.id].run_count || 0) + 1
        config[auto.id].last_result = JSON.stringify(data).slice(0, 300)
        config[auto.id].last_status = res.ok ? 'ok' : 'error'
        results[auto.id] = { ran: true, ok: res.ok }
      } catch (e) {
        config[auto.id].last_status = 'error'
        config[auto.id].last_result = (e as Error).message
        results[auto.id] = { ran: true, error: (e as Error).message }
      }
    }

    await saveConfig(sb, config)
    return NextResponse.json({ ok: true, results })
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}

function isScheduleDue(schedule: string, lastRun: string): boolean {
  const now = Date.now()
  const last = new Date(lastRun).getTime()
  const elapsed = now - last

  const s = schedule.toLowerCase()
  if (s.includes('every 2 hours') || s.includes('2h')) return elapsed > 2 * 3600 * 1000
  if (s.includes('daily') || s.includes('day')) return elapsed > 22 * 3600 * 1000
  if (s.includes('weekly') || s.includes('week')) return elapsed > 6 * 24 * 3600 * 1000
  if (s.includes('monthly') || s.includes('month')) return elapsed > 28 * 24 * 3600 * 1000
  return elapsed > 24 * 3600 * 1000 // default: daily
}
