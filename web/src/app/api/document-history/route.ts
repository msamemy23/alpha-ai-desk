export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, getSessionUser, unauthorized } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { calculateDocumentTotals } from '@/lib/document-money'
import { describeChange, revisionSnapshot, statusEventKind } from '@/lib/doc-history'
import { addRevision, isMissingSchema, jsonError, jsonOk, logEvent, staffLabel } from '@/lib/doc-server'
import type { Db } from '@/lib/doc-server'

// The history of one document, for staff: what happened, who did it, when the customer looked, what they answered,
// payments, earlier versions. Every part is optional: if the database update (migration 046 to 048) is not applied
// yet, that part comes back as unavailable and the rest still works.

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

interface Part<T> { rows: T[]; available: boolean; failed: boolean }

async function part<T>(run: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<Part<T>> {
  const { data, error } = await run
  if (error) return { rows: [], available: !isMissingSchema(error), failed: !isMissingSchema(error) }
  return { rows: (data || []) as T[], available: true, failed: false }
}

async function ownDocument(db: Db, shopId: string, documentId: string) {
  const { data, error } = await db.from('documents').select('*').eq('id', documentId).eq('shop_id', shopId).maybeSingle()
  return { doc: (data || null) as Record<string, unknown> | null, error }
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const documentId = req.nextUrl.searchParams.get('documentId')
  if (!documentId) return jsonError('documentId required', 400)
  const db = getServiceClient()

  // One earlier version, in full, to compare or copy back into the editor.
  const revisionId = req.nextUrl.searchParams.get('revision')
  if (revisionId) {
    const { data, error } = await db.from('document_revisions').select('id,revision_no,reason,total,snapshot,created_at')
      .eq('id', revisionId).eq('shop_id', auth.shopId).eq('document_id', documentId).maybeSingle()
    if (error) return jsonError(isMissingSchema(error) ? 'Earlier versions need a database update first.' : 'That version could not be loaded.', isMissingSchema(error) ? 503 : 500)
    if (!data) return jsonError('That version was not found.', 404)
    return jsonOk({ revision: data })
  }

  const { doc, error } = await ownDocument(db, auth.shopId, documentId)
  if (error) return jsonError('Document could not be loaded', 500)
  if (!doc) return jsonError('Document not found', 404)

  const [events, payments, links, approvals, revisions] = await Promise.all([
    part<Record<string, unknown>>(db.from('document_events').select('id,kind,actor,actor_name,summary,detail,created_at').eq('shop_id', auth.shopId).eq('document_id', documentId).order('created_at', { ascending: false }).limit(300)),
    part<Record<string, unknown>>(db.from('payments').select('id,amount,method,note,paid_at,created_at').eq('shop_id', auth.shopId).eq('document_id', documentId).order('paid_at', { ascending: false }).limit(100)),
    part<Record<string, unknown>>(db.from('document_links').select('id,purpose,channel,sent_to,created_at,expires_at,revoked_at,first_viewed_at,last_viewed_at,view_count,email_opened_at,email_open_count,completed_at,response').eq('shop_id', auth.shopId).eq('document_id', documentId).order('created_at', { ascending: false }).limit(20)),
    part<Record<string, unknown>>(db.from('document_approvals').select('id,status,outcome,signer_name,method,signer_device,note,total_before,total_after,signed_at').eq('shop_id', auth.shopId).eq('document_id', documentId).order('signed_at', { ascending: false }).limit(20)),
    part<Record<string, unknown>>(db.from('document_revisions').select('id,revision_no,reason,total,created_at').eq('shop_id', auth.shopId).eq('document_id', documentId).order('revision_no', { ascending: false }).limit(50)),
  ])
  if (events.failed || payments.failed) return jsonError('The history could not be loaded. Try again.', 500)

  // Only the list of changes goes with each event, not everything stored in it.
  const trimmed = events.rows.map((e) => {
    const detail = e.detail && typeof e.detail === 'object' ? (e.detail as Record<string, unknown>) : {}
    return { id: e.id, kind: e.kind, actor: e.actor_name || (e.actor === 'customer' ? 'Customer' : e.actor === 'system' ? 'System' : 'Shop staff'), summary: e.summary, created_at: e.created_at, detail: Array.isArray(detail.changes) ? { changes: detail.changes } : undefined }
  })
  return jsonOk({
    events: trimmed,
    payments: payments.rows,
    links: links.rows,
    approvals: approvals.rows.filter((a) => a.status !== 'failed'),
    revisions: revisions.rows,
    available: { events: events.available, links: links.available, approvals: approvals.available, revisions: revisions.available },
  })
}

const STAFF_KINDS = new Set(['edited', 'status', 'converted', 'supplement', 'options', 'extended', 'created', 'note'])

/**
 * Writes a history line after staff did something. For an edit, the browser sends the document as it was before the
 * change; the server compares it to what is stored now and records exactly what is different, so the history can not
 * claim a change that did not happen.
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  if (!checkRateLimit(`document-history:${auth.shopId}`, 240, 60_000).ok) return jsonError('Too many requests. Wait a minute.', 429)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('Invalid request', 400)
  const { documentId, kind, summary, detail, before, from, to } = body as Record<string, unknown>
  if (typeof documentId !== 'string' || !documentId) return jsonError('documentId required', 400)
  if (typeof kind !== 'string' || !STAFF_KINDS.has(kind)) return jsonError('That kind of history line is not allowed.', 400)

  const db = getServiceClient()
  const { doc, error } = await ownDocument(db, auth.shopId, documentId)
  if (error) return jsonError('Document could not be loaded', 500)
  if (!doc) return jsonError('Document not found', 404)
  const user = await getSessionUser().catch(() => null)
  const who = staffLabel(user)
  const base = { shopId: auth.shopId, documentId, docNumber: str(doc.doc_number), actorName: who }

  if (kind === 'edited') {
    if (!before || typeof before !== 'object' || Array.isArray(before)) return jsonError('The earlier version is needed to record an edit.', 400)
    const prev = before as Record<string, unknown>
    const diff = describeChange(prev, doc)
    if (!diff.changed) return jsonOk({ ok: true, logged: false })
    // A draft nobody has seen is just being written. History starts once it has been sent or moved on.
    const sentish = !!doc.sent_at || (str(doc.status) !== '' && str(doc.status) !== 'Draft')
    if (!sentish) return jsonOk({ ok: true, logged: false })
    let revisionNo: number | null = null
    let revisionsAvailable = true
    if (diff.material) {
      const r = await addRevision(db, { shopId: auth.shopId, documentId, reason: 'edited', total: calculateDocumentTotals(prev).total, snapshot: { ...revisionSnapshot(prev), status: prev.status }, userId: auth.userId })
      revisionNo = r.revisionNo
      revisionsAvailable = !r.unavailable
    }
    const logged = await logEvent(db, { ...base, kind: 'edited', summary: diff.summary, detail: { changes: diff.changes, totalBefore: diff.totalBefore, totalAfter: diff.totalAfter, revisionNo } })
    return jsonOk({ ok: true, logged, revisionNo, revisionsAvailable, summary: diff.summary })
  }

  const text = str(summary).trim()
  if (text.length < 1) return jsonError('A summary is needed.', 400)
  const small = detail && typeof detail === 'object' && JSON.stringify(detail).length <= 20000 ? detail : undefined
  let eventKind = kind
  if (kind === 'status' && typeof from === 'string' && typeof to === 'string') eventKind = statusEventKind(from, to)
  const logged = await logEvent(db, { ...base, kind: eventKind, summary: text.slice(0, 600), detail: small })
  return jsonOk({ ok: true, logged })
}
