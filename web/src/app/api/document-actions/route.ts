export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, getSessionUser, unauthorized } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { calculateDocumentTotals } from '@/lib/document-money'
import { revisionSnapshot } from '@/lib/doc-history'
import { addDaysIso, isIsoDay } from '@/lib/doc-approval'
import { extendLinks, revokeLinks } from '@/lib/doc-links-server'
import { addRevision, isMissingSchema, jsonError, jsonOk, logEvent, staffLabel } from '@/lib/doc-server'
import type { Db } from '@/lib/doc-server'

// Things staff do to a whole document: void it (with a reason), bring it back, delete a draft, turn its customer
// links off, push the good-through date out. Each one checks the document belongs to the caller's shop, refuses
// anything that would touch money already taken, and leaves a line in the document's history.

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

/** Money has moved on this document. Voiding or deleting it would hide that, so those actions refuse. */
async function hasPayments(db: Db, shopId: string, doc: Record<string, unknown>): Promise<{ paid: boolean; error: boolean }> {
  if (Number(doc.amount_paid) > 0 || str(doc.status) === 'Paid' || str(doc.status) === 'Partial') return { paid: true, error: false }
  const { data, error } = await db.from('payments').select('id').eq('shop_id', shopId).eq('document_id', str(doc.id)).limit(1)
  if (error) return { paid: false, error: true }
  return { paid: (data || []).length > 0, error: false }
}

const RESTORABLE = new Set(['Draft', 'Sent', 'Approved', 'Declined', 'Unpaid'])

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  if (!checkRateLimit(`document-actions:${auth.shopId}`, 60, 60_000).ok) return jsonError('Too many requests. Wait a minute.', 429)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('Invalid request', 400)
  const { documentId, action } = body as { documentId?: unknown; action?: unknown }
  if (typeof documentId !== 'string' || !documentId) return jsonError('documentId required', 400)
  if (typeof action !== 'string') return jsonError('action required', 400)

  const db = getServiceClient()
  const { data: found, error: loadError } = await db.from('documents').select('*').eq('id', documentId).eq('shop_id', auth.shopId).maybeSingle()
  if (loadError) return jsonError('Document could not be loaded', 500)
  if (!found) return jsonError('Document not found', 404)
  const doc = found as Record<string, unknown>
  const user = await getSessionUser().catch(() => null)
  const who = staffLabel(user)
  const base = { shopId: auth.shopId, documentId, docNumber: str(doc.doc_number), actorName: who }
  const status = str(doc.status)
  const now = new Date().toISOString()

  if (action === 'void') {
    const reason = str((body as { reason?: unknown }).reason).replace(/\s+/g, ' ').trim()
    if (reason.length < 3 || reason.length > 300) return jsonError('Say why you are voiding it, in 3 to 300 characters.', 400)
    if (status === 'Void') return jsonError('This document is already void.', 409)
    const money = await hasPayments(db, auth.shopId, doc)
    if (money.error) return jsonError('Payments could not be checked, so nothing was changed. Try again.', 500)
    if (money.paid) return jsonError('This has payments on it, so it cannot be voided. A paid invoice stays on the books.', 409)
    const { data: updated, error } = await db.from('documents').update({ status: 'Void', updated_at: now }).eq('id', documentId).eq('shop_id', auth.shopId).select('id')
    if (error) return jsonError('The document could not be voided. Nothing was changed.', 500)
    if (!updated || updated.length === 0) return jsonError('Document not found', 404)
    const revoked = await revokeLinks(db, auth.shopId, documentId, now)
    const total = calculateDocumentTotals(doc).total
    await addRevision(db, { shopId: auth.shopId, documentId, reason: 'voided', total, snapshot: { ...revisionSnapshot(doc), status }, userId: auth.userId })
    await logEvent(db, { ...base, kind: 'void', summary: `Voided: ${reason}`, detail: { reason, previousStatus: status, total, linksTurnedOff: revoked.count } })
    return jsonOk({ ok: true, status: 'Void', linksTurnedOff: revoked.count })
  }

  if (action === 'restore') {
    if (status !== 'Void') return jsonError('Only a void document can be restored.', 409)
    // Back to what it was before it was voided. A sent document goes back to draft because its links were turned off.
    let target = 'Draft'
    const last = await db.from('document_events').select('detail,created_at').eq('shop_id', auth.shopId).eq('document_id', documentId).eq('kind', 'void').order('created_at', { ascending: false }).limit(1)
    if (!last.error) {
      const previous = str(((last.data || [])[0] as { detail?: { previousStatus?: unknown } } | undefined)?.detail?.previousStatus)
      if (RESTORABLE.has(previous) && previous !== 'Sent') target = previous
    }
    const { data: updated, error } = await db.from('documents').update({ status: target, updated_at: now }).eq('id', documentId).eq('shop_id', auth.shopId).select('id')
    if (error) return jsonError('The document could not be restored. Nothing was changed.', 500)
    if (!updated || updated.length === 0) return jsonError('Document not found', 404)
    await logEvent(db, { ...base, kind: 'restored', summary: `Restored to ${target === 'Draft' ? 'draft' : target.toLowerCase()}`, detail: { status: target } })
    return jsonOk({ ok: true, status: target })
  }

  if (action === 'delete') {
    if (status !== 'Draft' && status !== 'Void') return jsonError('Only a draft or a void document can be deleted. Void it first, with a reason, so the record stays.', 409)
    const money = await hasPayments(db, auth.shopId, doc)
    if (money.error) return jsonError('Payments could not be checked, so nothing was deleted. Try again.', 500)
    if (money.paid) return jsonError('This has payments on it, so it cannot be deleted.', 409)
    const signed = await db.from('document_approvals').select('id,status').eq('shop_id', auth.shopId).eq('document_id', documentId).limit(5)
    if (signed.error && !isMissingSchema(signed.error)) return jsonError('The signed records could not be checked, so nothing was deleted. Try again.', 500)
    if (!signed.error && ((signed.data || []) as { status: string }[]).some((r) => r.status !== 'failed')) {
      return jsonError('A customer signed this, so it is kept on record. Void it instead.', 409)
    }
    const total = calculateDocumentTotals(doc).total
    const snapshot = JSON.stringify(revisionSnapshot(doc)).length <= 30000 ? revisionSnapshot(doc) : undefined
    await revokeLinks(db, auth.shopId, documentId, now)
    const { error } = await db.from('documents').delete().eq('id', documentId).eq('shop_id', auth.shopId)
    if (error) return jsonError('The document could not be deleted. Nothing was changed.', 500)
    await db.from('document_options').delete().eq('shop_id', auth.shopId).eq('document_id', documentId)
    await logEvent(db, {
      ...base, kind: 'deleted', summary: `Deleted ${str(doc.type).toLowerCase() || 'document'} ${str(doc.doc_number)}`.trim(),
      detail: { type: str(doc.type), docNumber: str(doc.doc_number), customer: str(doc.customer_name), status, total, snapshot },
    })
    return jsonOk({ ok: true })
  }

  if (action === 'revoke_links') {
    const result = await revokeLinks(db, auth.shopId, documentId, now)
    if (result.failed) return jsonError('Some links could not be turned off. Try again.', 500)
    if (result.count > 0) await logEvent(db, { ...base, kind: 'link_revoked', summary: result.count === 1 ? 'Turned off the customer link' : `Turned off ${result.count} customer links`, detail: { count: result.count } })
    return jsonOk({ ok: true, count: result.count })
  }

  if (action === 'extend') {
    if (str(doc.type) !== 'Estimate') return jsonError('Only an estimate has a good-through date.', 400)
    if (status === 'Void') return jsonError('This estimate is void. Restore it first.', 409)
    const requested = (body as { expiresDate?: unknown }).expiresDate
    if (!isIsoDay(requested)) return jsonError('Choose a date.', 400)
    const todayMs = Date.now()
    if (new Date(`${requested}T23:59:59Z`).getTime() < todayMs - 86400000) return jsonError('That date has already passed. Choose a later one.', 400)
    if (requested > addDaysIso(new Date(todayMs).toISOString().slice(0, 10), 730)) return jsonError('That date is too far away. Pick one within two years.', 400)
    const before = str(doc.expires_date).slice(0, 10)
    const { error } = await db.from('documents').update({ expires_date: requested, updated_at: now }).eq('id', documentId).eq('shop_id', auth.shopId)
    if (error) return jsonError('The date could not be changed. Nothing was changed.', 500)
    await extendLinks(db, auth.shopId, documentId, new Date(`${requested}T23:59:59Z`).toISOString())
    await logEvent(db, { ...base, kind: 'extended', summary: before ? `Good through ${before} changed to ${requested}` : `Good through set to ${requested}`, detail: { from: before || null, to: requested } })
    return jsonOk({ ok: true, expiresDate: requested })
  }

  return jsonError('Unknown action', 400)
}
