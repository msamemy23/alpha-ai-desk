import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, hasInternalApiSecret, unauthorized } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

// Pre-built system automations — these execute real actions, not just AI prompts
const SYSTEM_AUTOMATIONS = [
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
      { key: 'message_template', label: 'Message template', type: 'textarea', default: 'Hey {name}! We have a special this week at your local auto repair shop. Reply to this text or call us to schedule.' },
    ],
  },
  {
    id: 'social_posts',
    name: 'Daily Social Drafts',
    description: 'Generate a daily draft for Facebook & Instagram; publishing still requires a connected account and explicit approval',
    category: 'marketing',
    schedule: 'Daily at 8am',
    icon: '📸',
    endpoint: '/api/growth/social-post',
    endpointBody: { action: 'auto_post' },
    requires: [],
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

async function getConfig(sb: ReturnType<typeof getServiceClient>, shopId?: string) {
  let query = sb.from('settings').select('automation_config').order('updated_at', { ascending: false }).limit(1)
  if (shopId) query = query.eq('shop_id', shopId)
  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[system-automations] config lookup failed:', error.message)
    return {}
  }
  return (data?.automation_config as Record<string, AutomationState>) || {}
}

interface AutomationState {
  enabled: boolean
  config: Record<string, unknown>
  last_run: string | null
  run_count: number
  last_result: string | null
  last_status: 'ok' | 'error' | 'never'
}

async function saveConfig(sb: ReturnType<typeof getServiceClient>, config: Record<string, AutomationState>, shopId: string) {
  const { data: existing } = await sb.from('settings').select('id').eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (existing?.id) {
    const { error } = await sb.from('settings').update({ automation_config: config, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('shop_id', shopId)
    if (error) throw new Error(error.message)
  }
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const sb = getServiceClient()
  const config = await getConfig(sb, auth.shopId)

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
  const body = await req.json().catch(() => ({})) as { action?: string; id?: string; enabled?: boolean; config?: Record<string, unknown> }
  const internal = hasInternalApiSecret(req)
  const auth = await getAuthedShop()
  const { action, id } = body
  const aiSource = req.headers.get('x-ai-source') === 'ai'
  const approval = req.headers.get('x-ai-approval') === 'confirm'
  if (aiSource && ['toggle', 'configure', 'run_now'].includes(String(action)) && !approval) {
    return NextResponse.json({ ok: false, error: 'Explicit confirmation is required before changing automation state or running external actions', approvalRequired: true }, { status: 409 })
  }

  // Only the cron secret may run the all-shops worker. User actions always
  // operate on the authenticated shop and never on a caller-provided id.
  if (!auth && !(internal && action === 'run_all_due')) return unauthorized()
  if (action === 'run_all_due') {
    if (!internal) return unauthorized()
    const { data: settingsRows, error: settingsError } = await sb
      .from('settings')
      .select('id,shop_id,automation_config')
      .not('shop_id', 'is', null)
    if (settingsError) return NextResponse.json({ ok: false, error: settingsError.message }, { status: 500 })

    const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || ''
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin)
    const results: Record<string, unknown> = {}
    let allOk = true

    for (const row of settingsRows || []) {
      const shopId = String(row.shop_id)
      const shopConfig = (row.automation_config as Record<string, AutomationState>) || {}
      for (const auto of SYSTEM_AUTOMATIONS) {
        const state = shopConfig[auto.id]
        if (!state?.enabled || (state.last_run && !isScheduleDue(auto.schedule, state.last_run))) continue
        try {
          const mergedBody = { ...auto.endpointBody, ...(state.config || {}), shopId }
          const res = await fetch(`${baseUrl}${auto.endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
            body: JSON.stringify(mergedBody),
            signal: AbortSignal.timeout(30000),
          })
          const data = await res.json().catch(() => ({}))
          const success = res.ok && data?.success !== false && data?.ok !== false && !data?.error
          state.last_run = new Date().toISOString()
          state.run_count = (state.run_count || 0) + 1
          state.last_result = JSON.stringify(data).slice(0, 500)
          state.last_status = success ? 'ok' : 'error'
          if (!success) allOk = false
          results[`${shopId}:${auto.id}`] = { ok: success, result: data }
        } catch (error) {
          allOk = false
          state.last_status = 'error'
          state.last_result = error instanceof Error ? error.message : 'Unknown error'
          results[`${shopId}:${auto.id}`] = { ok: false, error: state.last_result }
        }
      }

      const { error } = await sb.from('settings').update({
        automation_config: shopConfig,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id).eq('shop_id', shopId)
      if (error) {
        allOk = false
        results[`${shopId}:config`] = { ok: false, error: error.message }
      }
    }
    return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 502 })
  }

  if (!auth || !id) return NextResponse.json({ ok: false, error: 'A shop and automation id are required' }, { status: 400 })
  const config = await getConfig(sb, auth.shopId)

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
    if (typeof body.enabled !== 'boolean') return NextResponse.json({ ok: false, error: 'enabled must be a boolean' }, { status: 400 })
    config[id].enabled = body.enabled
    await saveConfig(sb, config, auth!.shopId)
    return NextResponse.json({ ok: true, state: config[id] })
  }

  if (action === 'configure') {
    config[id].config = { ...config[id].config, ...body.config }
    await saveConfig(sb, config, auth!.shopId)
    return NextResponse.json({ ok: true, state: config[id] })
  }

  if (action === 'run_now') {
    const auto = SYSTEM_AUTOMATIONS.find(a => a.id === id)
    if (!auto) return NextResponse.json({ ok: false, error: 'Unknown automation' }, { status: 404 })

    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
      const userConfig = config[id].config || {}
      const mergedBody = { ...auto.endpointBody, ...userConfig }
      const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || ''
      const forwardedHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (secret) forwardedHeaders.Authorization = `Bearer ${secret}`
      else {
        const authorization = req.headers.get('authorization')
        const cookie = req.headers.get('cookie')
        if (authorization) forwardedHeaders.Authorization = authorization
        if (cookie) forwardedHeaders.Cookie = cookie
      }
      const res = await fetch(`${baseUrl}${auto.endpoint}`, {
        method: 'POST',
        headers: forwardedHeaders,
        body: JSON.stringify({ ...mergedBody, shopId: auth!.shopId }),
      })
      const data = await res.json()
      const resultStr = JSON.stringify(data).slice(0, 500)

      config[id].last_run = new Date().toISOString()
      config[id].run_count = (config[id].run_count || 0) + 1
      config[id].last_result = resultStr
      config[id].last_status = res.ok && data?.success !== false && data?.ok !== false && !data?.error ? 'ok' : 'error'
      await saveConfig(sb, config, auth!.shopId)

      return NextResponse.json({ ok: true, result: data, state: config[id] })
    } catch (e) {
      config[id].last_status = 'error'
      config[id].last_result = (e as Error).message
      await saveConfig(sb, config, auth!.shopId)
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
    }
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
