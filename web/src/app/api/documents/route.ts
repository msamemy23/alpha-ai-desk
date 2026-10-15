export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, getSessionUser, unauthorized } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { jsonError, jsonOk, logEvent, staffLabel } from '@/lib/doc-server'
import { checkConvert, checkNewDocument, checkPayment, checkUpdate, isDocType, paymentErrorText } from '@/lib/doc-write'

// The estimate, invoice and receipt screens write through here. The database no longer lets the browser add, change
// or number documents or take payments itself, so each of those happens on the server after checking who is asking:
//   number   hands out the next document number for the shop
//   create   adds a new document to the caller's shop
//   update   changes a saved document (lines, tax and totals are frozen once money is taken)
//   convert  turns an open estimate into an invoice with its own number
//   payment  records one payment (the same payment sent twice is recorded once)
// Void, restore and delete stay in /api/document-actions. These rules are the same ones the assistant's
// createInvoice / updateDocument actions follow, but a person using the screen is never held up by the
// assistant's own switches in Settings, so the screen has its own route.

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  if (!checkRateLimit(`documents:${auth.shopId}`, 120, 60_000).ok) return jsonError('Too many requests. Wait a minute.', 429)

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return jsonError('Invalid request', 400)
  const input = body as Record<string, unknown>
  const action = str(input.action)
  const db = getServiceClient()
  const now = new Date().toISOString()

  if (action === 'number') {
    if (!isDocType(input.type)) return jsonError('Choose a document type.', 400)
    const { data, error } = await db.rpc('next_document_number', { p_shop_id: auth.shopId, p_type: input.type })
    if (error || typeof data !== 'string') return jsonError('A document number could not be made. Try again.', 500)
    return jsonOk({ ok: true, docNumber: data })
  }

  if (action === 'create') {
    const check = checkNewDocument(input.data)
    if (!check.ok) return jsonError(check.error, 400)
    const fields = check.fields

    // Customer and job must belong to this shop. The service client skips RLS, so this is the check that counts.
    for (const [field, table] of [['customer_id', 'customers'], ['job_id', 'jobs']] as const) {
      const value = fields[field]
      if (value === undefined || value === null || value === '') { delete fields[field]; continue }
      if (typeof value !== 'string') return jsonError(`${field} must be a valid identifier`, 400)
      const { data: linked, error: linkError } = await db.from(table).select('id').eq('id', value).eq('shop_id', auth.shopId).maybeSingle()
      if (linkError) return jsonError('The customer or job could not be checked. Nothing was saved.', 500)
      if (!linked) return jsonError(`${field === 'customer_id' ? 'That customer' : 'That job'} does not belong to this shop.`, 400)
    }

    // A number is made on the server unless the screen already asked for one for this same type.
    let docNumber = typeof fields.doc_number === 'string' ? fields.doc_number.trim() : ''
    if (!docNumber) {
      const made = await db.rpc('next_document_number', { p_shop_id: auth.shopId, p_type: fields.type })
      if (made.error || typeof made.data !== 'string') return jsonError('A document number could not be made. Nothing was saved.', 500)
      docNumber = made.data
    }

    const row = { ...fields, doc_number: docNumber, shop_id: auth.shopId, created_at: now, updated_at: now }
    const { data: created, error } = await db.from('documents').insert(row).select('*').single()
    if (error || !created) {
      if (error?.code === '23505') {
        // The same save sent twice (a double tap, a retry after a dropped connection) lands here on the second try.
        // If the number already belongs to the same document made moments ago, hand it back instead of an error.
        const same = await db.from('documents').select('*').eq('shop_id', auth.shopId).eq('doc_number', docNumber).maybeSingle()
        const row = (same.data || null) as Record<string, unknown> | null
        const age = row ? Date.now() - Date.parse(str(row.created_at)) : Infinity
        if (row && str(row.type) === str(fields.type) && str(row.customer_name) === str(fields.customer_name) && Number(row.amount_paid || 0) === 0 && age >= 0 && age < 5 * 60_000) {
          return jsonOk({ ok: true, document: row, replayed: true })
        }
        return jsonError('That document number is already used. Try saving again.', 409)
      }
      return jsonError('The document could not be saved. Nothing was changed.', 500)
    }
    const user = await getSessionUser().catch(() => null)
    await logEvent(db, {
      shopId: auth.shopId, documentId: str((created as Record<string, unknown>).id), docNumber, kind: 'created', actorName: staffLabel(user),
      summary: `Created ${str(fields.type).toLowerCase()} ${docNumber}`.trim(),
    })
    return jsonOk({ ok: true, document: created })
  }

  if (action === 'update') {
    const documentId = str(input.documentId)
    if (!documentId) return jsonError('documentId required', 400)
    const { data: found, error: loadError } = await db.from('documents').select('id,doc_number,type,status,amount_paid').eq('id', documentId).eq('shop_id', auth.shopId).maybeSingle()
    if (loadError) return jsonError('The document could not be loaded. Nothing was changed.', 500)
    if (!found) return jsonError('Document not found', 404)
    const existing = found as Record<string, unknown>
    const check = checkUpdate(input.data, existing)
    if (!check.ok) return jsonError(check.error, check.status)
    const fields = check.fields

    // Customer and job must belong to this shop. The service client skips RLS, so this is the check that counts.
    for (const [field, table] of [['customer_id', 'customers'], ['job_id', 'jobs']] as const) {
      const value = fields[field]
      if (value === undefined || value === null || value === '') { if (value === '') fields[field] = null; continue }
      if (typeof value !== 'string') return jsonError(`${field} must be a valid identifier`, 400)
      const { data: linked, error: linkError } = await db.from(table).select('id').eq('id', value).eq('shop_id', auth.shopId).maybeSingle()
      if (linkError) return jsonError('The customer or job could not be checked. Nothing was saved.', 500)
      if (!linked) return jsonError(`${field === 'customer_id' ? 'That customer' : 'That job'} does not belong to this shop.`, 400)
    }

    // A payment row can exist even when the document status has not caught up. Lines and totals stay frozen then too.
    if (check.touchesMoney) {
      const { data: ledger, error: ledgerError } = await db.from('payments').select('id').eq('document_id', documentId).eq('shop_id', auth.shopId).limit(1)
      if (ledgerError) return jsonError('The payment history could not be checked. Nothing was changed.', 500)
      if (Array.isArray(ledger) && ledger.length > 0) return jsonError('A payment is recorded, so the lines, tax and totals are locked. Customer, notes and warranty can still be changed.', 409)
    }

    // A document number is not renumbered by a screen unless it is a real change to a free number.
    if (typeof fields.doc_number === 'string' && fields.doc_number.trim() === '') delete fields.doc_number

    // The status is part of the filter, so a payment that lands while this save is in flight turns the save away
    // instead of letting it rewrite lines that have just been paid against.
    let write = db.from('documents').update({ ...fields, updated_at: now }).eq('id', documentId).eq('shop_id', auth.shopId)
    if (existing.status !== null && existing.status !== undefined) write = write.eq('status', str(existing.status))
    const { data: updated, error } = await write.select('*').maybeSingle()
    if (error) {
      if (error.code === '23505') return jsonError('That document number is already used by another document.', 409)
      return jsonError('The document could not be saved. Nothing was changed.', 500)
    }
    if (!updated) return jsonError('This document changed while you were editing it (a payment or a status change). Reload and look again. Nothing was overwritten.', 409)
    return jsonOk({ ok: true, document: updated })
  }

  if (action === 'convert') {
    const documentId = str(input.documentId)
    if (!documentId) return jsonError('documentId required', 400)
    const { data: found, error: loadError } = await db.from('documents').select('*').eq('id', documentId).eq('shop_id', auth.shopId).maybeSingle()
    if (loadError) return jsonError('The document could not be loaded.', 500)
    if (!found) return jsonError('Document not found', 404)
    const doc = found as Record<string, unknown>
    const check = checkConvert(doc)
    if (!check.ok) return jsonError(check.error, check.status)

    const made = await db.rpc('next_document_number', { p_shop_id: auth.shopId, p_type: 'Invoice' })
    if (made.error || typeof made.data !== 'string') return jsonError('An invoice number could not be made. Nothing was changed.', 500)
    // The type is part of the filter, so pressing the button twice converts once.
    const { data: updated, error } = await db.from('documents')
      .update({ type: 'Invoice', doc_number: made.data, status: 'Draft', updated_at: now })
      .eq('id', documentId).eq('shop_id', auth.shopId).eq('type', 'Estimate').select('id')
    if (error) return jsonError('The estimate could not be converted. Nothing was changed.', 500)
    if (!updated || updated.length === 0) return jsonError('This estimate was already converted or changed. Reload and look again.', 409)
    const user = await getSessionUser().catch(() => null)
    await logEvent(db, {
      shopId: auth.shopId, documentId, docNumber: made.data, kind: 'converted', actorName: staffLabel(user),
      summary: `Turned estimate ${str(doc.doc_number)} into invoice ${made.data}`,
      detail: { fromNumber: str(doc.doc_number), toNumber: made.data, previousStatus: str(doc.status) },
    })
    return jsonOk({ ok: true, docNumber: made.data })
  }

  if (action === 'payment') {
    const documentId = str(input.documentId)
    if (!documentId) return jsonError('documentId required', 400)
    const check = checkPayment({ amount: input.amount, method: input.method, note: input.note, idempotencyKey: input.idempotencyKey })
    if (!check.ok) return jsonError(check.error, 400)
    const { data: found, error: loadError } = await db.from('documents').select('id,doc_number,type,status').eq('id', documentId).eq('shop_id', auth.shopId).maybeSingle()
    if (loadError) return jsonError('The document could not be loaded. No payment was recorded.', 500)
    if (!found) return jsonError('Document not found', 404)
    const doc = found as Record<string, unknown>
    if (str(doc.status) === 'Void') return jsonError('This document is void, so a payment cannot be recorded.', 409)

    const { data, error } = await db.rpc('record_document_payment_server', {
      p_user_id: auth.userId,
      p_document_id: documentId,
      p_amount: check.input.amount,
      p_method: check.input.method,
      p_note: check.input.note,
      p_idempotency_key: check.input.key,
    })
    if (error) {
      console.error('[documents] payment refused:', error.code, error.message)
      const missing = error.code === 'PGRST202' || error.code === '42883'
      return jsonError(missing ? 'Payments are not available until the database is updated.' : paymentErrorText(error.message), missing ? 503 : 400)
    }
    // A retry of the same payment is recorded once by the database; keep one history line for it too.
    const seen = await db.from('document_events').select('id').eq('shop_id', auth.shopId).eq('document_id', documentId).eq('kind', 'payment').eq('detail->>key', check.input.key).limit(1)
    if (seen.error || (seen.data || []).length === 0) {
      const user = await getSessionUser().catch(() => null)
      await logEvent(db, {
        shopId: auth.shopId, documentId, docNumber: str(doc.doc_number), kind: 'payment', actorName: staffLabel(user),
        summary: `Payment of $${check.input.amount.toFixed(2)} recorded (${check.input.method})`,
        detail: { amount: check.input.amount, method: check.input.method, key: check.input.key },
      })
    }
    return jsonOk({ ok: true, result: data ?? null })
  }

  return jsonError('Unknown action', 400)
}
