import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, hasInternalApiSecret, unauthorized } from '@/lib/api-auth'
import { isScheduleDue, scheduleWindowKey } from '@/lib/schedules'
import { getIdempotencyKey } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'

type AutomationClaim = { claimed?: boolean; fencing_token?: number | string | null }

type SystemMutationClaim = {
  claimed?: boolean
  status?: string
  id?: string
  result?: unknown
  error?: string
  audit_status?: string
  audit_target_type?: string | null
  audit_target_id?: string | null
  audit_permission?: string | null
  audit_approved?: boolean
  audit_metadata?: Record<string, unknown> | null
}

async function repairSystemAutomationAudit(
  sb: ReturnType<typeof getServiceClient>,
  auth: { userId: string; shopId: string },
  claim: SystemMutationClaim,
  idempotencyKey: string,
  action: string,
) {
  if (claim.audit_status === 'delivered') return { ok: true as const }
  const audit = await writeAuditLog({
    shopId: auth.shopId,
    userId: auth.userId,
    action: `system_automation.${action}`,
    targetType: claim.audit_target_type || 'system_automation',
    targetId: claim.audit_target_id || undefined,
    permission: claim.audit_permission || 'write',
    approved: claim.audit_approved ?? true,
    idempotencyKey,
    metadata: claim.audit_metadata || { systemAutomationAction: action },
  })
  if (!audit.ok) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'The previous automation setting changed, but its audit record still needs repair' }, { status: 502 }) }
  if (!claim.id) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'The previous automation setting has no durable operation id' }, { status: 502 }) }
  const { error } = await sb.from('ai_action_operations').update({
    audit_status: audit.pending ? 'queued' : 'delivered',
    audit_error: null,
    updated_at: new Date().toISOString(),
  }).eq('id', claim.id).eq('shop_id', auth.shopId).eq('status', 'succeeded')
  if (error) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'The previous automation setting changed, but its audit state could not be repaired' }, { status: 502 }) }
  return { ok: true as const }
}

async function claimSystemAutomationMutation(
  sb: ReturnType<typeof getServiceClient>,
  auth: { userId: string; shopId: string },
  req: NextRequest,
  action: string,
  id: string,
  body: Record<string, unknown>,
) {
  const suppliedKey = getIdempotencyKey(req, [])
  if (!suppliedKey) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Idempotency-Key is required for automation setting changes' }, { status: 400 }) }
  const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const durableKey = `${auth.shopId}:system-automation:${action}:${id}:${createHash('sha256').update(suppliedKey).digest('hex')}`.slice(0, 160)
  const { data, error } = await sb.rpc('claim_ai_action_operation', {
    p_shop_id: auth.shopId,
    p_user_id: auth.userId,
    p_action: `system_automation.${action}`,
    p_idempotency_key: durableKey,
    p_payload_hash: payloadHash,
  })
  if (error) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Automation setting change could not be safely started' }, { status: 503 }) }
  const claim = (data || {}) as SystemMutationClaim
  if (claim.status === 'conflict') return { ok: false as const, response: NextResponse.json({ ok: false, error: claim.error || 'Automation setting idempotency key conflict' }, { status: 409 }) }
  if (claim.status === 'succeeded') {
    const repaired = await repairSystemAutomationAudit(sb, auth, claim, durableKey, action)
    if (!repaired.ok) return repaired
    return { ok: true as const, replay: true as const, result: claim.result }
  }
  if (claim.status === 'failed' || claim.status === 'unknown') return { ok: false as const, response: NextResponse.json({ ok: false, error: claim.error || 'The previous automation setting change needs reconciliation' }, { status: 409 }) }
  if (claim.claimed !== true || claim.status !== 'running' || !claim.id) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'This automation setting change is already in progress' }, { status: 409 }) }
  return { ok: true as const, replay: false as const, mutation: { id: String(claim.id), action, idempotencyKey: durableKey } }
}

async function finalizeSystemAutomationMutation(
  sb: ReturnType<typeof getServiceClient>,
  auth: { userId: string; shopId: string },
  mutation: { id: string; action: string; idempotencyKey: string },
  result: unknown,
  targetId: string,
) {
  const { data, error } = await sb.from('ai_action_operations').update({
    status: 'succeeded',
    result,
    error: null,
    audit_status: 'pending',
    audit_error: null,
    audit_target_type: 'system_automation',
    audit_target_id: targetId,
    audit_permission: 'write',
    audit_approved: true,
    audit_metadata: { systemAutomationAction: mutation.action, systemAutomationId: targetId },
    updated_at: new Date().toISOString(),
  }).eq('id', mutation.id).eq('shop_id', auth.shopId).eq('status', 'running').select('id').maybeSingle()
  if (error || !data) {
    await sb.from('ai_action_operations').update({
      status: 'unknown',
      error: 'Automation setting changed, but its durable result is uncertain; reconcile before retrying',
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', mutation.id).eq('shop_id', auth.shopId).eq('status', 'running')
    return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Automation setting changed, but its durable result is uncertain; reconcile before retrying' }, { status: 502 }) }
  }
  const audit = await writeAuditLog({
    shopId: auth.shopId,
    userId: auth.userId,
    action: `system_automation.${mutation.action}`,
    targetType: 'system_automation',
    targetId,
    permission: 'write',
    approved: true,
    idempotencyKey: mutation.idempotencyKey,
    metadata: { systemAutomationAction: mutation.action, systemAutomationId: targetId },
  })
  if (!audit.ok) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Automation setting changed, but its audit record could not be saved' }, { status: 502 }) }
  const { error: auditStateError } = await sb.from('ai_action_operations').update({
    audit_status: audit.pending ? 'queued' : 'delivered', audit_error: null, updated_at: new Date().toISOString(),
  }).eq('id', mutation.id).eq('shop_id', auth.shopId).eq('status', 'succeeded')
  if (auditStateError) return { ok: false as const, response: NextResponse.json({ ok: false, error: 'Automation setting changed, but its audit state could not be saved' }, { status: 502 }) }
  return { ok: true as const, auditPending: Boolean(audit.pending) }
}

function fencingTokenOf(claim: unknown): number | null {
  if (!claim || typeof claim !== 'object') return null
  const token = Number((claim as AutomationClaim).fencing_token)
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

// Pre-built system automations — these execute real actions, not just AI prompts
const SYSTEM_AUTOMATIONS = [
  {
    id: 'review_requests',
    name: 'Review Requests',
    description: 'Auto-text customers after job completion asking for a Google review',
    category: 'retention',
    schedule: 'Daily at 6pm',
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
    description: 'Review response drafts require a supplied Google review; nothing is fetched or posted automatically',
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

type AutomationConfigSnapshot = {
  config: Record<string, AutomationState>
  settingsId: string
  updatedAt: string
}

async function getConfig(sb: ReturnType<typeof getServiceClient>, shopId?: string): Promise<AutomationConfigSnapshot> {
  let query = sb.from('settings').select('id,automation_config,updated_at').order('updated_at', { ascending: false }).limit(1)
  if (shopId) query = query.eq('shop_id', shopId)
  const { data, error } = await query.maybeSingle()
  if (error) {
    console.error('[system-automations] config lookup failed:', error.message)
    throw new Error('Unable to load automation configuration')
  }
  if (!data?.id || !data.updated_at) throw new Error('Shop settings not found')
  return {
    config: (data.automation_config as Record<string, AutomationState>) || {},
    settingsId: String(data.id),
    updatedAt: String(data.updated_at),
  }
}

interface AutomationState {
  enabled: boolean
  config: Record<string, unknown>
  last_run: string | null
  run_count: number
  last_result: string | null
  last_status: 'ok' | 'error' | 'never'
}

async function saveConfig(
  sb: ReturnType<typeof getServiceClient>,
  config: Record<string, AutomationState>,
  shopId: string,
  expectedUpdatedAt: string,
) {
  const { data: existing, error: lookupError } = await sb.from('settings').select('id').eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (lookupError) throw new Error('Unable to load shop settings')
  if (!existing?.id) throw new Error('Shop settings not found')
  const { data: saved, error } = await sb.from('settings').update({ automation_config: config, updated_at: new Date().toISOString() }).eq('id', existing.id).eq('shop_id', shopId).eq('updated_at', expectedUpdatedAt).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  if (!saved) throw new Error('Automation configuration changed while this request was running')
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const sb = getServiceClient()
  const configSnapshot = await getConfig(sb, auth.shopId)
  const config = configSnapshot.config

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
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const internal = hasInternalApiSecret(req)
  const auth = await getAuthedShop()
  const action = typeof body.action === 'string' ? body.action : ''
  const id = typeof body.id === 'string' ? body.id : ''
  const aiSource = req.headers.get('x-ai-source') === 'ai'
  const approval = req.headers.get('x-ai-approval') === 'confirm'
  if (aiSource && ['toggle', 'configure', 'run_now'].includes(String(action)) && !approval) {
    return NextResponse.json({ ok: false, error: 'Explicit confirmation is required before changing automation state or running external actions', approvalRequired: true }, { status: 409 })
  }

  // Only the cron secret may run the all-shops worker. User actions always
  // operate on the authenticated shop and never on a caller-provided id.
  if (!auth && !(internal && action === 'run_all_due')) return unauthorized()
  if (auth && auth.role === 'viewer' && action !== 'run_all_due') return forbidden()
  if (action === 'run_all_due') {
    if (!internal) return unauthorized()
    const { data: settingsRows, error: settingsError } = await sb
      .from('settings')
      .select('id,shop_id,timezone,automation_config,updated_at')
      .not('shop_id', 'is', null)
    if (settingsError) return NextResponse.json({ ok: false, error: settingsError.message }, { status: 500 })

    const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || ''
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin)
    const results: Record<string, unknown> = {}
    let allOk = true

    for (const row of settingsRows || []) {
      const shopId = String(row.shop_id)
      const timezone = typeof row.timezone === 'string' && row.timezone ? row.timezone : 'America/Chicago'
      const shopConfig = (row.automation_config as Record<string, AutomationState>) || {}
      for (const auto of SYSTEM_AUTOMATIONS) {
        const state = shopConfig[auto.id]
        if (!state?.enabled || !isScheduleDue(auto.schedule, state.last_run, timezone)) continue
        const windowKey = scheduleWindowKey(auto.schedule, timezone)
        const { data: claim, error: claimError } = await sb.rpc('claim_automation_run_v2', {
          p_shop_id: shopId,
          p_automation_id: auto.id,
          p_window_key: windowKey,
          p_lease_seconds: 300,
        })
        if (claimError) {
          allOk = false
          results[`${shopId}:${auto.id}`] = { ok: false, error: 'Automation run could not be claimed' }
          continue
        }
        const fencingToken = fencingTokenOf(claim)
        if (!claim || typeof claim !== 'object' || (claim as AutomationClaim).claimed !== true || fencingToken === null) continue
        let childInvocationStarted = false
        try {
          await renewAutomationLease(sb, shopId, auto.id, windowKey, fencingToken)
          const runId = String((claim as AutomationClaim & { id?: string }).id || '')
          const mergedBody = {
            ...auto.endpointBody,
            ...(state.config || {}),
            shopId,
            automationRunId: runId,
            automationFencingToken: fencingToken,
          }
          childInvocationStarted = true
          const res = await fetch(`${baseUrl}${auto.endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${secret}`,
              'X-Automation-Run-Id': runId,
              'X-Automation-Fencing-Token': String(fencingToken),
            },
            body: JSON.stringify(mergedBody),
            signal: AbortSignal.timeout(30000),
          })
          const data = await res.json().catch(() => ({}))
          const success = res.ok && data?.success !== false && data?.ok !== false && !data?.error
          state.last_result = JSON.stringify(data).slice(0, 500)
          state.last_status = success ? 'ok' : 'error'
          const { data: completedRun, error: runUpdateError } = await sb.from('automation_runs').update({
            status: success ? 'succeeded' : 'failed',
            finished_at: new Date().toISOString(),
            next_attempt_at: success ? null : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            result: data,
            error: success ? null : (data?.error || `Child job returned HTTP ${res.status}`),
          }).eq('shop_id', shopId).eq('automation_id', auto.id).eq('window_key', windowKey).eq('fencing_token', fencingToken).eq('status', 'running').select('id').maybeSingle()
          if (runUpdateError || !completedRun) {
            await sb.from('automation_runs').update({
              status: 'unknown', finished_at: new Date().toISOString(), next_attempt_at: null,
              error: 'Child job completed, but its durable run state could not be saved',
            }).eq('shop_id', shopId).eq('automation_id', auto.id).eq('window_key', windowKey).eq('fencing_token', fencingToken).eq('status', 'running')
            allOk = false
            results[`${shopId}:${auto.id}`] = { ok: false, error: 'Automation result could not be recorded; manual reconciliation required' }
            continue
          }
          if (success) {
            state.last_run = new Date().toISOString()
            state.run_count = (state.run_count || 0) + 1
          }
          if (!success) allOk = false
          results[`${shopId}:${auto.id}`] = { ok: success, result: data }
        } catch (error) {
          allOk = false
          state.last_status = 'error'
          state.last_result = error instanceof Error ? error.message : 'Unknown error'
          await sb.from('automation_runs').update({
            status: childInvocationStarted ? 'unknown' : 'failed',
            finished_at: new Date().toISOString(),
            next_attempt_at: childInvocationStarted ? null : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            error: childInvocationStarted ? 'Child job outcome is uncertain; manual reconciliation required' : state.last_result,
          }).eq('shop_id', shopId).eq('automation_id', auto.id).eq('window_key', windowKey).eq('fencing_token', fencingToken).eq('status', 'running')
          results[`${shopId}:${auto.id}`] = { ok: false, error: childInvocationStarted ? 'Child job outcome is uncertain; manual reconciliation required' : state.last_result }
        }
      }

      const { data: savedSettings, error } = await sb.from('settings').update({
        automation_config: shopConfig,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id).eq('shop_id', shopId).eq('updated_at', row.updated_at).select('id').maybeSingle()
      if (error || !savedSettings) {
        allOk = false
        results[`${shopId}:config`] = { ok: false, error: error?.message || 'Automation configuration changed while this worker was running' }
      }
    }
    return NextResponse.json({ ok: allOk, results }, { status: allOk ? 200 : 502 })
  }

  if (!auth || !id) return NextResponse.json({ ok: false, error: 'A shop and automation id are required' }, { status: 400 })
  const configSnapshot = await getConfig(sb, auth.shopId)
  const config = configSnapshot.config

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
    const mutationClaim = await claimSystemAutomationMutation(sb, auth!, req, 'toggle', id, body)
    if (!mutationClaim.ok) return mutationClaim.response
    if (mutationClaim.replay) return NextResponse.json({ ok: true, data: mutationClaim.result, replayed: true })
    config[id].enabled = body.enabled
    try {
      await saveConfig(sb, config, auth!.shopId, configSnapshot.updatedAt)
    } catch (error) {
      const message = 'Automation setting result is uncertain; reconcile before retrying'
      await sb.from('ai_action_operations').update({ status: 'unknown', error: `${message}: ${error instanceof Error ? error.message : 'save failed'}`, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('id', mutationClaim.mutation.id).eq('shop_id', auth!.shopId).eq('status', 'running')
      return NextResponse.json({ ok: false, error: message }, { status: 502 })
    }
    const finalized = await finalizeSystemAutomationMutation(sb, auth!, mutationClaim.mutation, config[id], id)
    if (!finalized.ok) return finalized.response
    return NextResponse.json({ ok: true, state: config[id], ...(finalized.auditPending ? { auditPending: true } : {}) })
  }

  if (action === 'configure') {
    if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) return NextResponse.json({ ok: false, error: 'config must be an object' }, { status: 400 })
    const mutationClaim = await claimSystemAutomationMutation(sb, auth!, req, 'configure', id, body)
    if (!mutationClaim.ok) return mutationClaim.response
    if (mutationClaim.replay) return NextResponse.json({ ok: true, data: mutationClaim.result, replayed: true })
    config[id].config = { ...config[id].config, ...(body.config as Record<string, unknown>) }
    try {
      await saveConfig(sb, config, auth!.shopId, configSnapshot.updatedAt)
    } catch (error) {
      const message = 'Automation setting result is uncertain; reconcile before retrying'
      await sb.from('ai_action_operations').update({ status: 'unknown', error: `${message}: ${error instanceof Error ? error.message : 'save failed'}`, lease_expires_at: null, updated_at: new Date().toISOString() }).eq('id', mutationClaim.mutation.id).eq('shop_id', auth!.shopId).eq('status', 'running')
      return NextResponse.json({ ok: false, error: message }, { status: 502 })
    }
    const finalized = await finalizeSystemAutomationMutation(sb, auth!, mutationClaim.mutation, config[id], id)
    if (!finalized.ok) return finalized.response
    return NextResponse.json({ ok: true, state: config[id], ...(finalized.auditPending ? { auditPending: true } : {}) })
  }

  if (action === 'run_now') {
    const auto = SYSTEM_AUTOMATIONS.find(a => a.id === id)
    if (!auto) return NextResponse.json({ ok: false, error: 'Unknown automation' }, { status: 404 })

    const manualWindowKey = `manual:${getIdempotencyKey(req, [auth!.shopId, id, new Date().toISOString().slice(0, 16)])}`
    const { data: claim, error: claimError } = await sb.rpc('claim_automation_run_v2', {
      p_shop_id: auth!.shopId,
      p_automation_id: id,
      p_window_key: manualWindowKey,
      p_lease_seconds: 300,
    })
    if (claimError) return NextResponse.json({ ok: false, error: 'Automation run could not be claimed' }, { status: 503 })
    const fencingToken = fencingTokenOf(claim)
    if (!claim || typeof claim !== 'object' || (claim as AutomationClaim).claimed !== true || fencingToken === null) return NextResponse.json({ ok: false, error: 'This automation run is already in progress or already completed' }, { status: 409 })

    let childInvocationStarted = false
    try {
      await renewAutomationLease(sb, auth!.shopId, id, manualWindowKey, fencingToken)
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
      const userConfig = config[id].config || {}
      const mergedBody = {
        ...auto.endpointBody,
        ...userConfig,
        shopId: auth!.shopId,
        automationRunId: String((claim as AutomationClaim & { id?: string }).id || ''),
        automationFencingToken: fencingToken,
      }
      const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || ''
      const forwardedHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Automation-Run-Id': String((claim as AutomationClaim & { id?: string }).id || ''),
        'X-Automation-Fencing-Token': String(fencingToken),
      }
      if (secret) forwardedHeaders.Authorization = `Bearer ${secret}`
      else {
        const authorization = req.headers.get('authorization')
        const cookie = req.headers.get('cookie')
        if (authorization) forwardedHeaders.Authorization = authorization
        if (cookie) forwardedHeaders.Cookie = cookie
      }
      childInvocationStarted = true
      const res = await fetch(`${baseUrl}${auto.endpoint}`, {
        method: 'POST',
        headers: forwardedHeaders,
        body: JSON.stringify(mergedBody),
      })
      const data = await res.json()
      const resultStr = JSON.stringify(data).slice(0, 500)

      config[id].last_result = resultStr
      const success = res.ok && data?.success !== false && data?.ok !== false && !data?.error
      config[id].last_status = success ? 'ok' : 'error'
      if (success) {
        config[id].last_run = new Date().toISOString()
        config[id].run_count = (config[id].run_count || 0) + 1
      }
      const { data: completedRun, error: runUpdateError } = await sb.from('automation_runs').update({
        status: success ? 'succeeded' : 'failed',
        finished_at: new Date().toISOString(),
        next_attempt_at: success ? null : new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        result: data,
        error: success ? null : (data?.error || `Child job returned HTTP ${res.status}`),
      }).eq('shop_id', auth!.shopId).eq('automation_id', id).eq('window_key', manualWindowKey).eq('fencing_token', fencingToken).eq('status', 'running').select('id').maybeSingle()
      if (runUpdateError || !completedRun) {
        await sb.from('automation_runs').update({
          status: 'unknown', finished_at: new Date().toISOString(), next_attempt_at: null,
          error: 'Child job completed, but its durable run state could not be saved',
        }).eq('shop_id', auth!.shopId).eq('automation_id', id).eq('window_key', manualWindowKey).eq('fencing_token', fencingToken).eq('status', 'running')
        return NextResponse.json({ ok: false, error: 'Automation ran, but its final state could not be saved; manual reconciliation required' }, { status: 502 })
      }
      await saveConfig(sb, config, auth!.shopId, configSnapshot.updatedAt)

      return NextResponse.json({ ok: success, success, result: data, state: config[id] }, { status: success ? 200 : 502 })
    } catch (e) {
      config[id].last_status = 'error'
      config[id].last_result = (e as Error).message
      const runStatus = childInvocationStarted ? 'unknown' : 'failed'
      await sb.from('automation_runs').update({
        status: runStatus,
        finished_at: new Date().toISOString(),
        next_attempt_at: null,
        error: childInvocationStarted ? 'Child job outcome is uncertain; manual reconciliation required' : config[id].last_result,
      }).eq('shop_id', auth!.shopId).eq('automation_id', id).eq('window_key', manualWindowKey).eq('fencing_token', fencingToken).eq('status', 'running')
      await saveConfig(sb, config, auth!.shopId, configSnapshot.updatedAt)
      if (childInvocationStarted) return NextResponse.json({ ok: false, error: 'Automation outcome is uncertain; manual reconciliation required' }, { status: 502 })
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
    }
  }



  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}
