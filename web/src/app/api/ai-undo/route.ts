import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { writeAuditLog } from '@/lib/audit-log'
import { getActionInfo } from '@/lib/ai/action-risk'
import { parseUndo } from '@/lib/ai/undo'
import { runUndo } from '@/lib/ai/undo-server'

export const dynamic = 'force-dynamic'

/**
 * Undo one assistant change with a compensating action.
 *
 * The audit entry holds a saved "undo copy" made when the assistant acted. Undo reads the record
 * fresh and only goes ahead if it is still exactly as the assistant left it. It changes one
 * record, in this shop, guarded by that record's own timestamp, and writes its own audit entry.
 * Asking twice does nothing the second time.
 *
 * GET  ?id=<audit entry>  or  ?operationKey=<the key the change was sent with>
 *      says whether Undo is available and what it would do. Changes nothing.
 * POST { id } or { operationKey }, with x-ai-approval: confirm, runs it.
 */
const UNDO_ROLES = new Set(['owner', 'admin', 'manager'])

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

type Db = ReturnType<typeof getServiceClient>
type Found = { id: string; action: string; target_type: string | null; target_id: string | null; metadata: Record<string, unknown> }

async function findEntry(db: Db, shopId: string, ref: { id?: string; operationKey?: string }): Promise<{ entry: Found | null; error: boolean }> {
  let query = db.from('audit_logs').select('id,action,target_type,target_id,metadata').eq('shop_id', shopId)
  if (ref.id) query = query.eq('id', ref.id)
  else if (ref.operationKey) query = query.eq('idempotency_key', `${shopId}:${ref.operationKey}`)
  else return { entry: null, error: false }
  const { data, error } = await query.limit(1).maybeSingle()
  if (error) return { entry: null, error: true }
  if (!data) return { entry: null, error: false }
  const meta = data.metadata && typeof data.metadata === 'object' ? data.metadata as Record<string, unknown> : {}
  return { entry: { id: String(data.id), action: String(data.action), target_type: data.target_type ?? null, target_id: data.target_id ?? null, metadata: meta }, error: false }
}

function refFrom(source: { id?: unknown; operationKey?: unknown }): { id?: string; operationKey?: string } | null {
  if (typeof source.id === 'string' && /^[0-9a-fA-F-]{16,64}$/.test(source.id)) return { id: source.id }
  if (typeof source.operationKey === 'string' && /^[A-Za-z0-9._:-]{8,140}$/.test(source.operationKey)) return { operationKey: source.operationKey }
  return null
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!checkRateLimit(rateLimitKey('ai-undo-preview', auth.userId, auth.shopId), 120, 60_000).ok) return reply({ ok: false, error: 'Too many requests. Wait a moment.' }, 429)
  const ref = refFrom({ id: req.nextUrl.searchParams.get('id') ?? undefined, operationKey: req.nextUrl.searchParams.get('operationKey') ?? undefined })
  if (!ref) return reply({ ok: false, error: 'Choose the entry to check.' }, 400)

  const db = getServiceClient()
  const { entry, error } = await findEntry(db, auth.shopId, ref)
  if (error) return reply({ ok: false, error: 'The entry could not be loaded.' }, 500)
  // The audit entry is written just after the change. If it is not there yet, say so rather than guess.
  if (!entry) return reply({ ok: true, state: 'pending', available: false, reason: 'The record of this change is still being saved.' })

  const canUndo = UNDO_ROLES.has(auth.role)
  const { data: done, error: doneError } = await db.from('audit_logs').select('id,created_at').eq('shop_id', auth.shopId).eq('idempotency_key', `${auth.shopId}:undo:${entry.id}`).maybeSingle()
  if (doneError) return reply({ ok: false, error: 'Undo history could not be checked.' }, 500)
  if (done) return reply({ ok: true, entryId: entry.id, state: 'undone', available: false, at: done.created_at })

  const descriptor = parseUndo(entry.metadata.undo)
  if (descriptor) return reply({ ok: true, entryId: entry.id, state: 'available', available: canUndo, canUndo, summary: descriptor.summary, label: descriptor.label })
  const info = getActionInfo(entry.action.replace(/^ai\./, ''))
  const reason = typeof entry.metadata.undoReason === 'string' && entry.metadata.undoReason ? entry.metadata.undoReason : info.undoNote || 'There is no undo copy for this one.'
  return reply({ ok: true, entryId: entry.id, state: info.reversibility === 'irreversible' ? 'cannot' : 'unavailable', available: false, reason })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!UNDO_ROLES.has(auth.role)) return reply({ ok: false, error: 'Only owners and managers can undo a change.' }, 403)
  if (!checkRateLimit(rateLimitKey('ai-undo', auth.userId, auth.shopId), 30, 60_000).ok) return reply({ ok: false, error: 'Too many requests. Wait a moment.' }, 429)
  // The same single approval path as every other change: the browser sends this only after the owner taps Undo on the review.
  if (req.headers.get('x-ai-approval') !== 'confirm') {
    return reply({ ok: false, error: 'Confirm the undo before it runs.', approvalRequired: true }, 409)
  }

  const body: unknown = await req.json().catch(() => null)
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  const ref = refFrom(record)
  if (!ref) return reply({ ok: false, error: 'Choose the entry to undo.' }, 400)

  const db = getServiceClient()
  const { entry, error } = await findEntry(db, auth.shopId, ref)
  if (error) return reply({ ok: false, error: 'The entry could not be loaded, so nothing was changed.' }, 500)
  if (!entry || !entry.action.startsWith('ai.') || entry.action === 'ai.undo') return reply({ ok: false, error: 'That entry cannot be undone.' }, 404)

  const meta = entry.metadata
  const descriptor = parseUndo(meta.undo)
  if (!descriptor) return reply({ ok: false, error: typeof meta.undoReason === 'string' && meta.undoReason ? meta.undoReason : 'There is no undo copy for this one.' }, 409)

  const undoKey = `${auth.shopId}:undo:${entry.id}`
  const { data: previous, error: previousError } = await db.from('audit_logs').select('id,created_at').eq('shop_id', auth.shopId).eq('idempotency_key', undoKey).maybeSingle()
  if (previousError) return reply({ ok: false, error: 'Undo history could not be checked, so nothing was changed.' }, 500)
  if (previous) return reply({ ok: true, undone: true, alreadyDone: true, message: 'This was already undone.' })

  const run = await runUndo(db, auth.shopId, descriptor)
  if (!run.ok && run.outcome !== 'already') return reply({ ok: false, outcome: run.outcome, error: run.message }, run.status)

  const audit = await writeAuditLog({
    shopId: auth.shopId, userId: auth.userId, action: 'ai.undo', targetType: entry.target_type || undefined, targetId: entry.target_id || undefined,
    permission: 'write', approved: true, idempotencyKey: undoKey,
    metadata: { undoOf: entry.id, summary: run.ok ? descriptor.summary : 'Already back to how it was.', subject: typeof meta.subject === 'string' ? meta.subject : undefined },
  })
  if (!audit.ok) return reply({ ok: true, undone: true, auditPending: true, message: 'It was put back, but the record of the undo could not be saved. Do not press Undo again.' }, 200)
  return reply({ ok: true, undone: true, message: run.ok ? run.message : 'It is already back to how it was.' })
}
