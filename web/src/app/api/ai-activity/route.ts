import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { writeAuditLog } from '@/lib/audit-log'
import { buildEntries, entriesToCsv, filterEntries, summarizeEntries, type ActivityFilters, type AuditRow, type OperationRow } from '@/lib/ai/audit-view'
import { getActionInfo } from '@/lib/ai/action-risk'
import { describeUsage, monthRange } from '@/lib/ai/usage'

export const dynamic = 'force-dynamic'

/**
 * The owner-readable record of everything the assistant (and the shop's automations) did:
 * who or what, what, when, who approved it, how it ended, and whether it was undone.
 *
 * GET  /api/ai-activity                list, with filters       (owner, admin, manager)
 * GET  /api/ai-activity?format=csv     the same list as a spreadsheet
 * GET  /api/ai-activity?view=summary   "assistant actions this month" counts
 * POST /api/ai-activity                record something only the browser knows:
 *                                      a declined review, a Stop, or an external action it ran
 */
const VIEW_ROLES = new Set(['owner', 'admin', 'manager', 'service'])
const DAY = 86_400_000

// The parts of the audit metadata the screen needs. Read results are deliberately not selected:
// a look-up's data can be large and is never shown here.
const META_TEXT = ['success', 'error', 'summary', 'subject', 'undo', 'undoReason', 'undoOf', 'to', 'length', 'query', 'title', 'url', 'automationAction', 'reportedBy'] as const
const SELECT = [
  'id', 'created_at', 'user_id', 'action', 'target_type', 'target_id', 'permission', 'approved',
  'm_payload:metadata->payload',
  ...META_TEXT.map(key => `m_${key}:metadata->>${key}`),
].join(',')

type RawRow = Record<string, unknown>

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function parseDate(value: string | null, fallback?: number): string | undefined {
  if (value) {
    const time = Date.parse(value)
    if (!Number.isNaN(time)) return new Date(time).toISOString()
  }
  return fallback === undefined ? undefined : new Date(fallback).toISOString()
}

function toAuditRow(raw: RawRow): AuditRow {
  const metadata: Record<string, unknown> = {}
  if (raw.m_payload && typeof raw.m_payload === 'object') metadata.payload = raw.m_payload
  for (const key of META_TEXT) {
    const value = raw[`m_${key}`]
    if (value === null || value === undefined) continue
    if (key === 'success') metadata.success = value === true || value === 'true'
    else if (key === 'length') { const n = Number(value); if (Number.isFinite(n)) metadata.length = n }
    else metadata[key] = String(value)
  }
  return {
    id: String(raw.id),
    created_at: String(raw.created_at),
    user_id: typeof raw.user_id === 'string' ? raw.user_id : null,
    action: String(raw.action),
    target_type: typeof raw.target_type === 'string' ? raw.target_type : null,
    target_id: typeof raw.target_id === 'string' ? raw.target_id : null,
    permission: typeof raw.permission === 'string' ? raw.permission : null,
    approved: typeof raw.approved === 'boolean' ? raw.approved : null,
    metadata,
  }
}

const roleLabel: Record<string, string> = { owner: 'Shop owner', admin: 'Admin', manager: 'Manager', member: 'Team member', viewer: 'Viewer', service: 'Automation' }

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!VIEW_ROLES.has(auth.role)) return reply({ ok: false, error: 'Only owners and managers can see the activity history.' }, 403)
  if (!checkRateLimit(rateLimitKey('ai-activity', auth.userId, auth.shopId), 60, 60_000).ok) return reply({ ok: false, error: 'Too many requests. Wait a moment.' }, 429)

  const db = getServiceClient()
  const params = req.nextUrl.searchParams

  if (params.get('view') === 'summary') {
    const range = monthRange()
    const base = () => db.from('audit_logs').select('id', { count: 'exact', head: true })
      .eq('shop_id', auth.shopId).gte('created_at', range.from).lt('created_at', range.to).like('action', 'ai.%')
    const ignored = '(ai.undo,ai.review.declined,ai.run.stopped,ai.rules.updated,ai.key.cleared)'
    const [reads, others, sends] = await Promise.all([
      base().eq('permission', 'read'),
      base().neq('permission', 'read').not('action', 'in', ignored),
      base().in('action', ['ai.sendEstimateEmail', 'ai.scheduleFollowUp']),
    ])
    if (reads.error || others.error || sends.error) return reply({ ok: false, error: 'The count for this month could not be loaded.' }, 500)
    const messages = sends.count || 0
    const counts = { lookups: reads.count || 0, messages, changes: Math.max(0, (others.count || 0) - messages) }
    return reply({ ok: true, month: range.label, ...describeUsage(counts), counts })
  }

  const csv = params.get('format') === 'csv'
  const limit = Math.max(1, Math.min(Number(params.get('limit')) || (csv ? 5000 : 600), csv ? 5000 : 1000))
  const from = parseDate(params.get('from'), Date.now() - 30 * DAY) as string
  const to = parseDate(params.get('to'))

  let query = db.from('audit_logs').select(SELECT).eq('shop_id', auth.shopId).gte('created_at', from).order('created_at', { ascending: false }).limit(limit)
  if (to) query = query.lte('created_at', to)
  const [rowsResult, undoResult] = await Promise.all([
    query,
    db.from('audit_logs').select(SELECT).eq('shop_id', auth.shopId).eq('action', 'ai.undo').gte('created_at', from).order('created_at', { ascending: false }).limit(500),
  ])
  if (rowsResult.error) return reply({ ok: false, error: 'The activity history could not be loaded.' }, 500)

  const rows = (rowsResult.data as unknown as RawRow[] || []).map(toAuditRow)
  const seen = new Set(rows.map(row => row.id))
  if (!undoResult.error) for (const raw of (undoResult.data as unknown as RawRow[] || [])) if (!seen.has(String(raw.id))) rows.push(toAuditRow(raw))

  const warnings: string[] = []
  let operations: OperationRow[] = []
  const opsResult = await db.from('ai_action_operations')
    .select('id,user_id,action,status,error,created_at,updated_at')
    .eq('shop_id', auth.shopId).in('status', ['failed', 'unknown', 'running']).gte('created_at', from)
    .order('created_at', { ascending: false }).limit(200)
  if (opsResult.error) {
    if (opsResult.error.code !== '42P01' && opsResult.error.code !== '42703') warnings.push('Actions that failed or need checking could not be loaded.')
  } else {
    operations = (opsResult.data || []) as unknown as OperationRow[]
  }
  if (undoResult.error) warnings.push('Some Undo records could not be loaded, so a few changes may look as if they can still be undone.')

  const names: Record<string, string> = {}
  let ownerId: string | null = null
  const members = await db.from('shop_memberships').select('user_id,role').eq('shop_id', auth.shopId)
  if (!members.error) {
    for (const member of (members.data || []) as { user_id: string; role: string }[]) {
      names[member.user_id] = roleLabel[member.role] || 'Team member'
      if (member.role === 'owner') ownerId = member.user_id
    }
  }
  names[auth.userId] = 'You'

  const entries = buildEntries({ rows, operations, names, ownerId })
  const filters: ActivityFilters = {
    source: (params.get('source') || 'all') as ActivityFilters['source'],
    kind: (params.get('kind') || 'all') as ActivityFilters['kind'],
    outcome: (params.get('outcome') || 'all') as ActivityFilters['outcome'],
    undo: (params.get('undo') || 'all') as ActivityFilters['undo'],
    q: params.get('q') || '',
  }
  const filtered = filterEntries(entries, filters)

  if (csv) {
    const stamp = new Date().toISOString().slice(0, 10)
    return new Response(entriesToCsv(filtered), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="assistant-activity-${stamp}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  return reply({
    ok: true,
    entries: filtered,
    summary: summarizeEntries(filtered),
    range: { from, to: to || null },
    truncated: rowsResult.data ? (rowsResult.data as unknown[]).length >= limit : false,
    warnings,
    canUndo: ['owner', 'admin', 'manager'].includes(auth.role),
  })
}

const EVENTS = new Set(['declined', 'stopped', 'external'])
const cleanText = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '')

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return reply({ ok: false, error: 'Not allowed.' }, 403)
  if (!checkRateLimit(rateLimitKey('ai-activity-post', auth.userId, auth.shopId), 120, 60_000).ok) return reply({ ok: false, error: 'Too many requests. Wait a moment.' }, 429)

  const body: unknown = await req.json().catch(() => null)
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  const event = typeof record.event === 'string' ? record.event : ''
  if (!EVENTS.has(event)) return reply({ ok: false, error: 'Unknown event.' }, 400)
  const eventId = cleanText(record.eventId, 100)
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(eventId)) return reply({ ok: false, error: 'An eventId is required.' }, 400)
  const actionId = cleanText(record.action, 60)
  if (actionId && !/^[A-Za-z][A-Za-z0-9._-]{0,60}$/.test(actionId)) return reply({ ok: false, error: 'That action name is not valid.' }, 400)
  const summary = cleanText(record.summary, 300)
  const key = `${auth.shopId}:event:${eventId}`

  if (event === 'declined') {
    const title = actionId ? getActionInfo(actionId).title : 'a review'
    const result = await writeAuditLog({
      shopId: auth.shopId, userId: auth.userId, action: 'ai.review.declined', targetType: 'review', permission: 'write', approved: false, idempotencyKey: key,
      metadata: { summary: summary || `Declined: ${title}`, declinedAction: actionId || null, reportedBy: 'browser' },
    })
    return result.ok ? reply({ ok: true }) : reply({ ok: false, error: 'The activity could not be recorded.' }, 502)
  }
  if (event === 'stopped') {
    const result = await writeAuditLog({
      shopId: auth.shopId, userId: auth.userId, action: 'ai.run.stopped', targetType: 'run', permission: 'write', approved: false, idempotencyKey: key,
      metadata: { summary: summary || 'Stopped the assistant', reportedBy: 'browser' },
    })
    return result.ok ? reply({ ok: true }) : reply({ ok: false, error: 'The activity could not be recorded.' }, 502)
  }
  // external: an approved action the browser ran through another route (a connected app, the
  // built-in browser, a phone call). The route itself may not write an audit entry.
  if (!actionId) return reply({ ok: false, error: 'An action is required.' }, 400)
  const succeeded = record.success !== false
  const result = await writeAuditLog({
    shopId: auth.shopId, userId: auth.userId, action: `ai.${actionId}`, targetType: 'external', permission: 'external', approved: true, idempotencyKey: key,
    metadata: { summary: summary || getActionInfo(actionId).past, subject: cleanText(record.subject, 160), success: succeeded, error: succeeded ? undefined : cleanText(record.error, 200), reportedBy: 'browser', undoReason: getActionInfo(actionId).undoNote },
  })
  return result.ok ? reply({ ok: true }) : reply({ ok: false, error: 'The activity could not be recorded.' }, 502)
}
