// A customer answers an estimate or signs a document, from the secret link. Server only.
//
// Order of work, chosen so nothing is half done:
//   1. Check the link, the page they were shown (fingerprint), and the answers.
//   2. Write the signed record first, as "pending". It is one row per link, so a second tap cannot answer twice.
//   3. Update the document, only if it has not changed since it was read (compare-and-set on updated_at).
//   4. Mark the record "applied" and the link finished. If step 3 fails, the record is marked "failed" and the
//      customer is told to try again; the link stays open.
// Emails and history lines come last and never undo the answer if they fail.

import { NextResponse } from 'next/server'
import { calculateDocumentTotals } from '@/lib/document-money'
import { planResponse, previewTotals, outcomeWords, sha256Hex, signatureRecordHash, linkState } from '@/lib/doc-approval'
import type { Outcome, ResponsePlan } from '@/lib/doc-approval'
import { buildPublicDocument } from '@/lib/doc-public'
import type { PublicDocument, PublicPage, PublicSigned } from '@/lib/doc-public'
import { buildShopNotice, buildSignedCopyEmail } from '@/lib/doc-email'
import { clientIp, deviceLabel, isLinkToken, logoUrl as logoLink, signUrl as signLink } from '@/lib/doc-links'
import { addDaysIso } from '@/lib/doc-approval'
import { revisionSnapshot } from '@/lib/doc-history'
import { recordView, resolveToken } from '@/lib/doc-links-server'
import { addRevision, isMissingSchema, loadOptions, loadPrefs, logEvent, originFor, sendShopEmail, shopFromSettings, todayInZone } from '@/lib/doc-server'
import type { Db } from '@/lib/doc-server'
import { checkRateLimit } from '@/lib/rate-limit'
import type { NextRequest } from 'next/server'

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })
const text = (v: unknown, max = 500): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

const PNG_DATA = /^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/

export async function handleRespond(req: NextRequest, body: Record<string, unknown>, db: Db): Promise<Response> {
  const ip = clientIp(req.headers)
  const ua = (req.headers.get('user-agent') || '').slice(0, 400)
  const token = body.token
  if (!isLinkToken(token)) return json({ error: 'This link is not valid.' }, 400)
  if (!checkRateLimit(`sign:respond:${ip || 'unknown'}`, 20, 600_000).ok || !checkRateLimit(`sign:respond-token:${token}`, 12, 600_000).ok) {
    return json({ error: 'Too many tries. Wait a few minutes and try again.' }, 429)
  }

  let resolved
  try { resolved = await resolveToken(db, token) } catch { return json({ error: 'We could not save your answer. Try again.' }, 500) }
  if (!resolved) return json({ error: 'This link is not valid.' }, 404)
  if (resolved.kind !== 'link') return json({ error: 'This page is out of date. Reload it and try again.', code: 'reload' }, 409)
  const link = resolved.link

  const nowMs = Date.now()
  const state = linkState(link, nowMs)
  if (state === 'done') return json({ error: 'You already answered this. Open your link again to see your signed copy.', code: 'done' }, 409)
  if (state === 'revoked') return json({ error: 'The shop turned this link off. Call the shop for a new one.', code: 'revoked' }, 410)
  if (state === 'expired') return json({ error: 'This link has expired. Call the shop for a new one.', code: 'expired' }, 410)

  const { data: doc, error: docError } = await db.from('documents').select('*').eq('id', link.document_id).eq('shop_id', link.shop_id).maybeSingle()
  if (docError) return json({ error: 'We could not load the document. Try again.' }, 500)
  if (!doc) return json({ error: 'This document is no longer available. Call the shop.' }, 404)
  if (link.doc_type && link.doc_type !== doc.type) return json({ error: 'The shop has changed this document. Call the shop for the current one.', code: 'replaced' }, 410)

  const [{ data: settings }, { prefs }, { options }] = await Promise.all([
    db.from('settings').select('*').eq('shop_id', link.shop_id).maybeSingle(),
    loadPrefs(db, link.shop_id),
    loadOptions(db, link.shop_id, link.document_id),
  ])
  const shop = shopFromSettings(settings)
  const today = todayInZone(shop.timezone)
  const before = await buildPublicDocument({ doc, options, prefs, shop, todayIso: today })
  if (!before.canRespond) return json({ error: before.closedReason || 'This cannot be answered right now.', code: 'closed' }, 409)
  if (typeof body.viewHash !== 'string' || body.viewHash !== before.contentHash) {
    return json({ error: 'The shop updated this while you were looking. Reload the page to see the latest, then answer again.', code: 'changed' }, 409)
  }

  const isEstimate = doc.type === 'Estimate'
  const decisions = record(body.decisions)
  const optionChoices = record(body.options)
  let plan: ResponsePlan | null = null
  let outcome: Outcome | 'signed' = 'signed'
  if (isEstimate) {
    const planned = planResponse({ doc, options, decisions, optionChoices, supplies: prefs.supplies })
    if (!planned.ok) return json({ error: planned.error }, 400)
    plan = planned.plan
    outcome = plan.outcome
  }

  const accepting = outcome !== 'declined'
  const name = text(body.signerName, 160)
  const method = body.method === 'drawn' ? 'drawn' : body.method === 'typed' ? 'typed' : 'click'
  const note = text(body.note, 2000)
  let signatureData: string | null = null
  if (accepting) {
    if (name.length < 2) return json({ error: 'Type your full name to continue.' }, 400)
    if (prefs.requireSignature) {
      if (method === 'click') return json({ error: 'A signature is required. Draw it or type your name and agree.' }, 400)
      if (method === 'typed' && body.agree !== true) return json({ error: 'Check the box to agree that your typed name is your signature.' }, 400)
    }
    if (method === 'drawn') {
      const data = body.signatureData
      if (typeof data !== 'string' || data.length > 500000 || !PNG_DATA.test(data)) return json({ error: 'The signature did not come through. Draw it again.' }, 400)
      signatureData = data
    }
  }
  const signerName = name || 'Customer (declined without signing)'
  const signedAt = new Date(nowMs).toISOString()
  const signatureHash = signatureData ? await sha256Hex(signatureData) : ''

  const afterDoc = plan ? { ...doc, parts: plan.parts, labors: plan.labors, shop_supplies: plan.shop_supplies, status: plan.status } : doc
  const after = await buildPublicDocument({ doc: afterDoc, options: [], prefs, shop, todayIso: today })
  const decisionsRecord: Record<string, string> = {}
  for (const [k, v] of Object.entries(decisions)) if (typeof v === 'string') decisionsRecord[k] = v
  const optionsRecord: Record<string, string> = {}
  for (const [k, v] of Object.entries(optionChoices)) if (typeof v === 'string') optionsRecord[k] = v

  const rec = {
    documentId: String(doc.id), docNumber: String(doc.doc_number || ''), contentHash: before.contentHash, signerName, signedAt, ip,
    userAgent: ua, decisions: decisionsRecord, options: optionsRecord, note, signatureHash, method: method as 'drawn' | 'typed' | 'click',
  }
  const recordHash = await signatureRecordHash(rec)
  const totalBefore = calculateDocumentTotals(doc).total
  const totalAfter = plan ? plan.totalAfter : totalBefore

  // 2. The signed record, as pending.
  const inserted = await db.from('document_approvals').insert({
    shop_id: link.shop_id, document_id: link.document_id, link_id: link.id, status: 'pending', outcome, signer_name: signerName, method,
    signature_data: signatureData, signature_hash: signatureHash || null, content_hash: before.contentHash, record_hash: recordHash,
    signer_ip: ip || null, signer_agent: ua || null, signer_device: deviceLabel(ua), decisions: decisionsRecord, options: optionsRecord,
    note: note || null, snapshot: { viewed: before, result: after }, total_before: totalBefore, total_after: totalAfter, signed_at: signedAt,
  }).select('id').single()
  if (inserted.error) {
    if (inserted.error.code === '23505') return json({ error: 'You already answered this. Open your link again to see your signed copy.', code: 'done' }, 409)
    console.error('[sign] answer record failed:', inserted.error.message)
    return json({ error: 'We could not save your answer. Nothing was changed. Try again.' }, 500)
  }
  const approvalId = (inserted.data as { id: string }).id
  const fail = async (why: string, status: number, message: string, code?: string) => {
    await db.from('document_approvals').update({ status: 'failed', error: why.slice(0, 480) }).eq('id', approvalId).eq('shop_id', link.shop_id)
    return json({ error: message, ...(code ? { code } : {}) }, status)
  }

  // 3. The document, only if nobody changed it since it was read.
  const guard = <T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(q: T): T =>
    doc.updated_at ? q.eq('updated_at', String(doc.updated_at)) : q.is('updated_at', null)
  if (plan) {
    const patch: Record<string, unknown> = {
      parts: plan.parts, labors: plan.labors, shop_supplies: plan.shop_supplies, status: plan.status, updated_at: signedAt,
    }
    if (accepting) Object.assign(patch, { signature_signed_at: signedAt, signature_signer_name: signerName })
    const withApproval = accepting ? { ...patch, approved_at: signedAt, approved_by: signerName } : patch
    let res = await guard(db.from('documents').update(withApproval).eq('id', doc.id).eq('shop_id', link.shop_id)).select('id')
    if (res.error && isMissingSchema(res.error)) res = await guard(db.from('documents').update(patch).eq('id', doc.id).eq('shop_id', link.shop_id)).select('id')
    if (res.error) return await fail(res.error.message, 500, 'We could not save your answer. Nothing was changed. Try again.')
    if (!res.data || res.data.length === 0) return await fail('document changed while answering', 409, 'The shop updated this while you were answering. Reload the page to see the latest, then answer again.', 'changed')
  } else {
    const { error } = await db.from('documents').update({ signature_signed_at: signedAt, signature_signer_name: signerName }).eq('id', doc.id).eq('shop_id', link.shop_id)
    if (error) return await fail(error.message, 500, 'We could not save your signature. Try again.')
  }

  // 4. Bookkeeping. These follow the answer; a failure here is noted but never undoes it.
  const noted: string[] = []
  const settle = async (label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    try {
      const { error } = await run()
      if (error) noted.push(`${label}: ${error.message}`)
    } catch (e) { noted.push(`${label}: ${e instanceof Error ? e.message : 'failed'}`) }
  }

  if (plan) {
    for (const c of plan.chosen) {
      await settle('option', () => db.from('document_options').update({
        status: c.choiceId ? 'chosen' : 'declined', chosen_choice_id: c.choiceId, decided_at: signedAt, updated_at: signedAt,
      }).eq('id', c.optionId).eq('shop_id', link.shop_id))
    }
    for (const d of plan.declined) {
      const { error } = await db.from('declined_work').insert({
        shop_id: link.shop_id, document_id: link.document_id, customer_id: doc.customer_id || null, customer_name: doc.customer_name || null,
        vehicle: before.vehicle || null, job: d.job.slice(0, 120), amount: d.amount, lines: d.lines, source: 'estimate', status: 'open',
        declined_at: signedAt, remind_after: addDaysIso(today, 30),
      })
      if (error && error.code !== '23505' && !isMissingSchema(error)) noted.push(`declined work: ${error.message}`)
    }
    await settle('earlier version', async () => {
      const r = await addRevision(db, { shopId: link.shop_id, documentId: link.document_id, reason: 'customer_answer', total: totalBefore, snapshot: { ...revisionSnapshot(doc), status: doc.status } })
      return { error: r.ok || r.unavailable ? null : { message: 'could not be saved' } }
    })
  }
  await settle('link', () => db.from('document_links').update({ completed_at: signedAt, response: outcome }).eq('id', link.id).eq('shop_id', link.shop_id))
  await settle('record', () => db.from('document_approvals').update({
    status: 'applied', applied_at: new Date().toISOString(), total_after: totalAfter, error: noted.length ? noted.join('; ').slice(0, 480) : null,
  }).eq('id', approvalId).eq('shop_id', link.shop_id))

  const approvedCount = plan ? plan.approvedKeys.length + plan.chosen.filter((c) => c.choiceId).length : 0
  const declinedCount = plan ? plan.declined.length + plan.chosen.filter((c) => !c.choiceId).length : 0
  const words = outcome === 'signed' ? 'Signed' : outcomeWords(outcome, approvedCount, declinedCount)
  const kind = outcome === 'signed' ? 'signed' : outcome === 'approved' ? 'approved' : outcome === 'partial' ? 'partial' : 'declined'
  await logEvent(db, {
    shopId: link.shop_id, documentId: link.document_id, docNumber: String(doc.doc_number || ''), kind, actor: 'customer', actorName: signerName,
    summary: `${words}. Total $${totalAfter.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    detail: { decisions: decisionsRecord, options: optionsRecord, outcome, method, totalBefore, totalAfter, recordHash, declined: plan?.declined.map((d) => ({ job: d.job, amount: d.amount })) ?? [] },
  })
  if (note) await logEvent(db, { shopId: link.shop_id, documentId: link.document_id, docNumber: String(doc.doc_number || ''), kind: 'note', actor: 'customer', actorName: signerName, summary: `Customer note: ${note}`.slice(0, 600) })

  // Email: the signed copy for the customer, and a note for the shop. Neither can undo the answer.
  const origin = originFor(req)
  const declinedList = (plan?.declined || []).map((d) => ({ job: d.job, amount: d.amount }))
  const customerEmail = /@/.test(link.sent_to || '') ? (link.sent_to as string) : String(doc.customer_email || '')
  if (customerEmail && accepting) {
    try {
      const mail = buildSignedCopyEmail({
        doc: after, shop, link: signLink(origin, link.token), logoUrl: shop.hasLogo ? logoLink(origin, link.token) : null,
        signerName, signedAt, outcomeWords: words, declined: declinedList, recordId: recordHash,
      })
      await sendShopEmail(settings, { to: customerEmail, subject: mail.subject, html: mail.html, replyTo: shop.email || undefined, idempotencyKey: `signed-copy-${approvalId}` })
    } catch (e) { console.error('[sign] signed copy email failed:', e instanceof Error ? e.message : e) }
  }
  if (shop.email) {
    try {
      const mail = buildShopNotice({
        doc: after, shop, customerName: signerName, outcomeWords: words, note, declined: declinedList,
        openUrl: `${origin}/${doc.type === 'Estimate' ? 'estimates' : 'invoices'}?document=${encodeURIComponent(String(doc.id))}`,
      })
      await sendShopEmail(settings, { to: shop.email, subject: mail.subject, html: mail.html, idempotencyKey: `signed-shop-${approvalId}` })
    } catch (e) { console.error('[sign] shop notice email failed:', e instanceof Error ? e.message : e) }
  }

  return json({ ok: true, outcome, outcomeWords: words, total: totalAfter, signedAt, recordId: recordHash.slice(0, 12), declined: declinedList })
}

/** The total the customer would owe if they confirmed right now, so the page can show it as they tap. Writes nothing. */
export async function handlePreview(req: NextRequest, body: Record<string, unknown>, db: Db): Promise<Response> {
  const token = body.token
  if (!isLinkToken(token)) return json({ error: 'This link is not valid.' }, 400)
  const ip = clientIp(req.headers)
  if (!checkRateLimit(`sign:preview:${token}`, 200, 600_000).ok || !checkRateLimit(`sign:preview-ip:${ip || 'unknown'}`, 300, 600_000).ok) {
    return json({ error: 'Too many tries. Wait a few minutes.' }, 429)
  }
  let resolved
  try { resolved = await resolveToken(db, token) } catch { return json({ error: 'We could not work that out. Try again.' }, 500) }
  if (!resolved || resolved.kind !== 'link') return json({ error: 'This link is not valid.' }, 404)
  const link = resolved.link
  if (linkState(link, Date.now()) !== 'active') return json({ error: 'This link is closed.' }, 409)
  const { data: doc, error } = await db.from('documents').select('*').eq('id', link.document_id).eq('shop_id', link.shop_id).maybeSingle()
  if (error) return json({ error: 'We could not work that out. Try again.' }, 500)
  if (!doc) return json({ error: 'This document is no longer available.' }, 404)
  const [{ prefs }, { options }] = await Promise.all([loadPrefs(db, link.shop_id), loadOptions(db, link.shop_id, link.document_id)])
  const preview = previewTotals({ doc, options, decisions: record(body.decisions), optionChoices: record(body.options), supplies: prefs.supplies })
  return json({ ok: true, preview })
}

/** A customer question or note without answering. */
export async function handleMessage(req: NextRequest, body: Record<string, unknown>, db: Db): Promise<Response> {
  const token = body.token
  if (!isLinkToken(token)) return json({ error: 'This link is not valid.' }, 400)
  const ip = clientIp(req.headers)
  if (!checkRateLimit(`sign:message:${token}`, 3, 600_000).ok || !checkRateLimit(`sign:message-ip:${ip || 'unknown'}`, 10, 600_000).ok) {
    return json({ error: 'Too many messages. Call the shop instead.' }, 429)
  }
  const message = text(body.message, 1000)
  if (message.length < 2) return json({ error: 'Type your message first.' }, 400)
  const name = text(body.name, 160) || 'Customer'

  let resolved
  try { resolved = await resolveToken(db, token) } catch { return json({ error: 'We could not send your message. Try again.' }, 500) }
  if (!resolved) return json({ error: 'This link is not valid.' }, 404)
  const shopId = resolved.kind === 'link' ? resolved.link.shop_id : resolved.sig.shop_id
  const documentId = resolved.kind === 'link' ? resolved.link.document_id : resolved.sig.document_id
  if (!shopId) return json({ error: 'This link is not valid.' }, 404)
  if (resolved.kind === 'link' && linkState(resolved.link, Date.now()) === 'revoked') return json({ error: 'The shop turned this link off. Call the shop.' }, 410)

  const { data: doc } = await db.from('documents').select('id,type,doc_number,customer_name').eq('id', documentId).eq('shop_id', shopId).maybeSingle()
  if (!doc) return json({ error: 'This document is no longer available.' }, 404)
  await logEvent(db, { shopId, documentId, docNumber: String(doc.doc_number || ''), kind: 'note', actor: 'customer', actorName: name, summary: `Customer message: ${message}`.slice(0, 600) })

  const { data: settings } = await db.from('settings').select('*').eq('shop_id', shopId).maybeSingle()
  const shop = shopFromSettings(settings)
  if (shop.email) {
    try {
      const subject = `${name} sent a message about ${doc.type} ${doc.doc_number}`
      const html = `<p style="font-family:Arial,sans-serif;font-size:15px"><strong>${escapeText(name)}</strong> wrote about ${escapeText(String(doc.type))} ${escapeText(String(doc.doc_number))}:</p><blockquote style="font-family:Arial,sans-serif;font-size:15px;border-left:3px solid #999;margin:0;padding:6px 12px">${escapeText(message)}</blockquote>`
      await sendShopEmail(settings, { to: shop.email, subject, html })
    } catch (e) { console.error('[sign] message email failed:', e instanceof Error ? e.message : e) }
  }
  return json({ ok: true })
}

function escapeText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Older sign-only links (before migration 046): a signature on the whole document, as it always worked. */
export async function handleLegacyComplete(req: NextRequest, body: Record<string, unknown>, db: Db): Promise<Response> {
  const token = body.token
  const signerName = text(body.signerName, 160)
  const signatureData = body.signatureData
  if (!isLinkToken(token) || signerName.length < 2) return json({ error: 'Valid token and signer name required' }, 400)
  if (typeof signatureData !== 'string' || signatureData.length > 500000 || !PNG_DATA.test(signatureData)) return json({ error: 'Invalid signature image' }, 400)
  const ip = clientIp(req.headers)
  if (!checkRateLimit(`sign:complete:${ip || 'unknown'}`, 20, 600_000).ok) return json({ error: 'Too many tries. Wait a few minutes and try again.' }, 429)

  let resolved
  try { resolved = await resolveToken(db, token) } catch { return json({ error: 'Could not save signature' }, 500) }
  if (!resolved || resolved.kind !== 'legacy') return json({ error: 'Invalid signing link' }, 404)
  const sig = resolved.sig
  if (sig.signed_at) return json({ error: 'This document has already been signed' }, 409)
  if (sig.expires_at && new Date(sig.expires_at) < new Date()) return json({ error: 'This signing link has expired' }, 410)
  if (!sig.shop_id) return json({ error: 'Invalid signing link' }, 404)
  const { data: doc } = await db.from('documents').select('*').eq('id', sig.document_id).eq('shop_id', sig.shop_id).maybeSingle()
  if (!doc) return json({ error: 'The document for this signing link is unavailable' }, 404)

  const now = new Date().toISOString()
  const signed = await db.from('signatures').update({ signed_at: now, signer_name: signerName, signature_data: signatureData, ip_address: ip })
    .eq('token', token).eq('shop_id', sig.shop_id).is('signed_at', null).select('id').maybeSingle()
  if (signed.error) return json({ error: 'Could not save signature' }, 500)
  if (!signed.data) return json({ error: 'This document has already been signed' }, 409)

  const patch: Record<string, unknown> = { signature_signed_at: now, signature_signer_name: signerName }
  const { error: docError } = await db.from('documents').update(patch).eq('id', sig.document_id).eq('shop_id', sig.shop_id)
  if (docError) return json({ error: 'Signature saved, but the document could not be updated' }, 500)

  // Approving an estimate from an older link: same rule as the old email button, only while it is still waiting.
  if (body.approve === true && doc.type === 'Estimate' && ['Draft', 'Sent'].includes(String(doc.status))) {
    const approve = { status: 'Approved', approved_at: now, approved_by: signerName }
    let r = await db.from('documents').update(approve).eq('id', sig.document_id).eq('shop_id', sig.shop_id)
    if (r.error && isMissingSchema(r.error)) r = await db.from('documents').update({ status: 'Approved' }).eq('id', sig.document_id).eq('shop_id', sig.shop_id)
    if (r.error) console.error('[sign] approval update failed:', r.error.message)
  }
  await logEvent(db, { shopId: sig.shop_id, documentId: sig.document_id, docNumber: String(doc.doc_number || ''), kind: body.approve === true ? 'approved' : 'signed', actor: 'customer', actorName: signerName, summary: body.approve === true ? 'Customer approved and signed' : 'Customer signed' })
  return json({ ok: true, success: true, signed_at: now })
}

/* ───────────────────────── Opening a customer link ───────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v))

/** The copy the customer signed, from the record kept at the time, so later edits to the document never change it. */
function signedFromRecord(row: Record<string, unknown>, fallback: PublicDocument): { signed: PublicSigned; doc: PublicDocument } {
  const snapshot = isRecord(row.snapshot) ? row.snapshot : {}
  const viewed = isRecord(snapshot.viewed) && Array.isArray((snapshot.viewed as { groups?: unknown }).groups) ? (snapshot.viewed as unknown as PublicDocument) : null
  const result = isRecord(snapshot.result) && Array.isArray((snapshot.result as { groups?: unknown }).groups) ? (snapshot.result as unknown as PublicDocument) : null
  const decisions = isRecord(row.decisions) ? row.decisions : {}
  const declined = viewed ? viewed.groups.filter((g) => decisions[g.key] === 'decline').map((g) => ({ job: g.name, amount: g.total })) : []
  const signed: PublicSigned = {
    name: String(row.signer_name || ''),
    at: String(row.signed_at || ''),
    method: String(row.method || ''),
    device: String(row.signer_device || ''),
    outcome: String(row.outcome || ''),
    recordId: String(row.record_hash || '').slice(0, 12),
    signatureData: typeof row.signature_data === 'string' ? row.signature_data : null,
    note: String(row.note || ''),
    declined,
    totalBefore: Number(row.total_before) || 0,
    totalAfter: Number(row.total_after) || 0,
  }
  return { signed, doc: result || fallback }
}

/**
 * What a customer sees when they open their link. Read only: nothing is counted here, because mail programs and link
 * previews open links before the customer does. The page counts its own view afterwards (handleView).
 * Returns null for a link that is not one of the new links, so the older sign-only route can answer it.
 */
export async function handlePage(req: NextRequest, token: string, db: Db): Promise<Response | null> {
  const ip = clientIp(req.headers)
  if (!checkRateLimit(`sign:page:${ip || 'unknown'}`, 240, 600_000).ok) return json({ error: 'Too many tries. Wait a few minutes and try again.' }, 429)
  let resolved
  try { resolved = await resolveToken(db, token) } catch { return json({ error: 'We could not open this link. Try again.' }, 500) }
  if (!resolved || resolved.kind !== 'link') return null
  const link = resolved.link
  const state = linkState(link, Date.now())
  if (state === 'revoked') return json({ error: 'The shop turned this link off. Call the shop for a new one.', code: 'revoked' }, 410)

  const { data: doc, error: docError } = await db.from('documents').select('*').eq('id', link.document_id).eq('shop_id', link.shop_id).maybeSingle()
  if (docError) return json({ error: 'We could not open this link. Try again.' }, 500)
  if (!doc) return json({ error: 'This document is no longer available. Call the shop.', code: 'gone' }, 404)
  if (link.doc_type && link.doc_type !== doc.type) return json({ error: 'The shop has changed this document. Call the shop for the current one.', code: 'replaced' }, 410)

  const [{ data: settings }, { prefs }, { options }] = await Promise.all([
    db.from('settings').select('*').eq('shop_id', link.shop_id).maybeSingle(),
    loadPrefs(db, link.shop_id),
    loadOptions(db, link.shop_id, link.document_id),
  ])
  const shop = shopFromSettings(settings)
  const publicShop = { name: shop.name, address: shop.address, phone: shop.phone, email: shop.email, hasLogo: shop.hasLogo }
  const today = todayInZone(shop.timezone)
  const live = await buildPublicDocument({ doc, options, prefs, shop, todayIso: today })

  if (state === 'done') {
    const { data: row, error } = await db.from('document_approvals').select('*').eq('link_id', link.id).eq('shop_id', link.shop_id).neq('status', 'failed').order('signed_at', { ascending: false }).limit(1).maybeSingle()
    if (error) return json({ error: 'We could not open your signed copy. Try again.' }, 500)
    if (row) {
      const { signed, doc: copy } = signedFromRecord(row as Record<string, unknown>, live)
      const page: PublicPage = { ok: true, mode: 'link', link: { state: 'done', expiresAt: link.expires_at, purpose: link.purpose }, shop: publicShop, doc: copy, signed, canDecideByJob: false }
      return json(page as unknown as Record<string, unknown>)
    }
  }
  if (state === 'expired') return json({ error: 'This link has expired. Call the shop for a new one.', code: 'expired' }, 410)

  const hasJobs = live.groups.some((g) => !g.approved)
  const hasOptions = live.options.some((o) => o.status === 'open')
  const canDecideByJob = live.kind === 'estimate' && live.canRespond && (hasJobs || hasOptions)
  const page: PublicPage = { ok: true, mode: 'link', link: { state: 'active', expiresAt: link.expires_at, purpose: link.purpose }, shop: publicShop, doc: live, signed: null, canDecideByJob }
  return json(page as unknown as Record<string, unknown>)
}

/** The page counts its own view once it has drawn. A reload within half a minute is not counted again. */
export async function handleView(req: NextRequest, body: Record<string, unknown>, db: Db): Promise<Response> {
  const token = body.token
  if (!isLinkToken(token)) return json({ error: 'This link is not valid.' }, 400)
  const ip = clientIp(req.headers)
  if (!checkRateLimit(`sign:view:${token}`, 30, 600_000).ok || !checkRateLimit(`sign:view-ip:${ip || 'unknown'}`, 120, 600_000).ok) return json({ ok: true })
  let resolved
  try { resolved = await resolveToken(db, token) } catch { return json({ ok: true }) }
  if (!resolved || resolved.kind !== 'link') return json({ ok: true })
  const link = resolved.link
  if (linkState(link, Date.now()) !== 'active') return json({ ok: true })
  const first = await recordView(db, link)
  if (first) {
    await logEvent(db, { shopId: link.shop_id, documentId: link.document_id, docNumber: link.doc_number || '', kind: 'viewed', actor: 'customer', summary: 'The customer opened the link' })
  }
  return json({ ok: true })
}
