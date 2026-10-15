export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import { calculateDocumentTotals, getLaborFlatAmount, nonNegativeDecimal, quantityFromUnknown } from '@/lib/document-money'
import crypto, { createHash } from 'crypto'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'

// ─────────────────────────────────────────────────────────────────────────────
// normalizeDocForSigning
// The shop editor persists documents using `parts[]` + `labors[]` (with
// `unitPrice`, `qty`, `hours`, `rate`) and does NOT persist a top-level
// `total` column — totals are computed on the fly by calcTotals() in
// @/lib/supabase. The customer-facing sign page and sign emails, however,
// read `doc.line_items[]` and `doc.total`. Without this normalizer the
// customer sees "$0.00" and no line items. Mirrors calcTotals() exactly.
// ─────────────────────────────────────────────────────────────────────────────
function normalizeDocForSigning<T extends Record<string, unknown>>(doc: T): T & {
  line_items: Array<{ description: string; qty: number; unit_price: number; unitPrice: number; total: number }>
  total: number
  parts_total: number
  labor_total: number
  core_total: number
  tax_amount: number
  shop_supplies: number
  sublet_total: number
  balance_due: number
} {
  if (!doc) return doc as never
  const parts = Array.isArray(doc.parts) ? doc.parts.filter((line): line is Record<string, unknown> => Boolean(line && typeof line === 'object')) : []
  const labors = Array.isArray(doc.labors) ? doc.labors.filter((line): line is Record<string, unknown> => Boolean(line && typeof line === 'object')) : []
  const { partsTotal, laborTotal, coreTotal, shopSupplies, sublet, taxAmount, total, balanceDue } = calculateDocumentTotals(doc)

  // Build line_items from parts + labors so the sign page renders rows.
  // Keep any existing line_items if already populated.
  const existingLineItems = (doc.line_items as unknown[]) || []
  const built = [
    ...parts.flatMap((p) => {
      const qty = quantityFromUnknown(p.qty)
      const unitPrice = nonNegativeDecimal(p.unitPrice)
      const lines = [{
        description: (p.name as string) || (p.description as string) || (p.brand ? `${p.brand} part` : 'Part'),
        qty,
        unit_price: unitPrice,
        unitPrice,
        total: roundDocumentLine(qty * unitPrice),
      }]
      const coreAmount = nonNegativeDecimal(p.core)
      const core = roundDocumentLine(qty * coreAmount)
      if (core > 0) lines.push({ description: 'Core charge (refundable)', qty, unit_price: coreAmount, unitPrice: coreAmount, total: core })
      return lines
    }),
    ...labors.map((l) => {
      const hours = nonNegativeDecimal(l.hours)
      const rate = nonNegativeDecimal(l.rate)
      const flatAmount = getLaborFlatAmount(l)
      const opName = (l.operation as string) || (l.description as string) || 'Labor'
      return {
        description: flatAmount !== null ? `${opName} (flat)` : `${opName} (${hours}h @ $${rate}/h)`,
        qty: flatAmount !== null ? 1 : hours,
        unit_price: flatAmount !== null ? flatAmount : rate,
        unitPrice: flatAmount !== null ? flatAmount : rate,
        total: roundDocumentLine(flatAmount !== null ? flatAmount : hours * rate),
      }
    }),
  ]
  if (sublet > 0) built.push({ description: 'Sublet', qty: 1, unit_price: sublet, unitPrice: sublet, total: sublet })
  const line_items = existingLineItems.length > 0 ? (existingLineItems as typeof built) : built

  return {
    ...doc,
    line_items,
    total,
    parts_total: partsTotal,
    labor_total: laborTotal,
    core_total: coreTotal,
    shop_supplies: shopSupplies,
    sublet_total: sublet,
    tax_amount: taxAmount,
    balance_due: balanceDue,
  } as T & {
    line_items: typeof built
    total: number
    parts_total: number
    labor_total: number
    core_total: number
    tax_amount: number
    shop_supplies: number
    sublet_total: number
    balance_due: number
  }
}

function roundDocumentLine(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

type CustomerFacingLine = { description: string; qty: number; unit_price: number; unitPrice: number; total: number }

/**
 * Signing links are bearer tokens, not staff sessions. Never serialize the
 * document row itself here: it carries shop-only notes, cost data, contacts,
 * and operational metadata that a customer does not need to sign.
 */
function customerFacingDocument(doc: Record<string, unknown>) {
  const normalized = normalizeDocForSigning(doc)
  const line_items: CustomerFacingLine[] = normalized.line_items.map((line) => ({
    description: String(line.description || ''),
    qty: Number(line.qty || 0),
    unit_price: Number(line.unit_price || 0),
    unitPrice: Number(line.unitPrice || 0),
    total: Number(line.total || 0),
  }))

  return {
    type: normalized.type,
    doc_number: normalized.doc_number,
    customer_name: normalized.customer_name,
    vehicle_year: normalized.vehicle_year,
    vehicle_make: normalized.vehicle_make,
    vehicle_model: normalized.vehicle_model,
    vehicle_vin: normalized.vehicle_vin,
    vehicle_plate: normalized.vehicle_plate,
    vehicle_mileage: normalized.vehicle_mileage,
    doc_date: normalized.doc_date,
    due_date: normalized.due_date,
    // `notes` can be internal in legacy documents. Only expose the expressly
    // customer-facing field under the name expected by the public sign page.
    notes: normalized.customer_notes,
    warranty_type: normalized.warranty_type,
    warranty_months: normalized.warranty_months,
    warranty_mileage: normalized.warranty_mileage,
    // Warranty wording is printed on the paperwork the customer signs, so the signing page shows it too.
    warranty_start: normalized.warranty_start,
    warranty_exclusions: normalized.warranty_exclusions,
    line_items,
    total: normalized.total,
    parts_total: normalized.parts_total,
    labor_total: normalized.labor_total,
    core_total: normalized.core_total,
    shop_supplies: normalized.shop_supplies,
    sublet_total: normalized.sublet_total,
    tax_amount: normalized.tax_amount,
    balance_due: normalized.balance_due,
  }
}

function customerFacingDocumentHash(doc: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(doc)).digest('hex')
}

function isStaleSigningLink(signature: Record<string, unknown>, document: Record<string, unknown>): boolean {
  const issuedAt = typeof signature.created_at === 'string' ? Date.parse(signature.created_at) : Number.NaN
  const updatedAt = typeof document.updated_at === 'string' ? Date.parse(document.updated_at) : Number.NaN
  // Legacy rows without timestamps retain their existing behavior. All current
  // rows have both timestamps; edits after the request invalidate the token.
  return Number.isFinite(issuedAt) && Number.isFinite(updatedAt) && updatedAt > issuedAt
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function loadSignatureDocument(db: ReturnType<typeof getServiceClient>, token: string) {
  const { data: signature, error: signatureError } = await db
    .from('signatures')
    .select('*')
    .eq('token', token)
    .maybeSingle()
  if (signatureError || !signature) return { signature: null, document: null, error: signatureError }
  if (!signature.shop_id || !signature.document_id) return { signature, document: null, error: new Error('Signing link is missing tenant metadata') }
  const { data: document, error: documentError } = await db
    .from('documents')
    .select('*')
    .eq('id', signature.document_id)
    .eq('shop_id', signature.shop_id)
    .maybeSingle()
  return { signature, document, error: documentError }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })
  const db = getServiceClient()
  const { signature: sig, document: doc, error } = await loadSignatureDocument(db, token)
  if (error || !sig || !doc) return NextResponse.json({ error: 'This signing link is invalid.' }, { status: 404 })
  if (sig.signed_at)
    return NextResponse.json({ already_signed: true, signed_at: sig.signed_at, signer_name: sig.signer_name })
  if (sig.expires_at && new Date(sig.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This signing link has expired' }, { status: 410 })
  }
  if (isStaleSigningLink(sig, doc)) {
    return NextResponse.json({ error: 'This signing link is no longer current. Ask the shop for an updated document.' }, { status: 409 })
  }
  // The page shows the shop that sent the document. Return only the public
  // business details (the same ones that already appear in the signing email),
  // never the whole settings row, which also holds provider configuration.
  const { data: shopSettings } = await db
    .from('settings')
    .select('shop_name,shop_address,shop_phone')
    .eq('shop_id', sig.shop_id)
    .maybeSingle()
  const shop = {
    name: typeof shopSettings?.shop_name === 'string' ? shopSettings.shop_name.trim() : '',
    address: typeof shopSettings?.shop_address === 'string' ? shopSettings.shop_address.trim() : '',
    phone: typeof shopSettings?.shop_phone === 'string' ? shopSettings.shop_phone.trim() : '',
  }
  return NextResponse.json({ doc: customerFacingDocument(doc), signature_id: sig.id, shop })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const db = getServiceClient()

  // ── SEND signature request ────────────────────────────────────────────────
  if (body.action === 'send') {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return NextResponse.json({ error: 'Viewer accounts cannot send signature requests' }, { status: 403 })
    const { documentId } = body as { documentId: string }
    if (typeof documentId !== 'string' || !documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })
    const [{ data: docRaw, error: docError }, { data: settings, error: settingsError }] = await Promise.all([
      db.from('documents').select('*').eq('id', documentId).eq('shop_id', auth.shopId).maybeSingle(),
      db.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle(),
    ])
    if (docError || settingsError) return NextResponse.json({ error: 'The document or shop settings could not be loaded' }, { status: 500 })
    if (!docRaw) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    if (!settings?.resend_api_key || !settings?.from_email) return NextResponse.json({ error: 'Email is not configured for this shop' }, { status: 503 })
    const doc = customerFacingDocument(docRaw)
    const documentHash = customerFacingDocumentHash(doc)

    let email = typeof docRaw.customer_email === 'string' ? docRaw.customer_email : ''
    if (!email && docRaw.customer_id) {
      const { data: cust } = await db.from('customers').select('email').eq('id', docRaw.customer_id).eq('shop_id', auth.shopId).maybeSingle()
      email = cust?.email || ''
    }
    if (!email) return NextResponse.json({ error: 'No email address on file for this customer' }, { status: 400 })

    // Previously this deactivated ALL prior unsigned tokens for the doc, which
    // caused customers who clicked an earlier email (from a resend) to see
    // "link expired". Multiple valid tokens for the same document are fine —
    // whichever the customer clicks marks the document signed.

    const requestedAt = new Date().toISOString()
    // Set the revision boundary before creating the token. A later document
    // edit advances updated_at and makes the token unusable rather than
    // allowing a customer to sign changed terms.
    const { error: requestUpdateError } = await db.from('documents').update({ signature_requested_at: requestedAt }).eq('id', documentId).eq('shop_id', auth.shopId)
    if (requestUpdateError) return NextResponse.json({ error: 'The document could not be prepared for signing' }, { status: 500 })

    // Read the revision after the request marker is saved. Some installations
    // maintain updated_at with a trigger, so the token must bind to the
    // revision that actually exists in the database, not the pre-update row.
    const { data: preparedDocument, error: preparedDocumentError } = await db
      .from('documents')
      .select('updated_at')
      .eq('id', documentId)
      .eq('shop_id', auth.shopId)
      .maybeSingle()
    if (preparedDocumentError || !preparedDocument) return NextResponse.json({ error: 'The document revision could not be prepared for signing' }, { status: 500 })

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: signatureRecord, error: insertErr } = await db.from('signatures').insert({
      shop_id: auth.shopId,
      token,
      document_id: documentId,
      customer_email: email,
      expires_at: expiresAt,
      document_hash: documentHash,
      document_updated_at: preparedDocument.updated_at || docRaw.updated_at || null,
      document_snapshot: doc,
    }).select('id').single()
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

    const shopName = settings?.shop_name || 'your shop'
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
    const signUrl = `${siteUrl}/sign/${token}`
    const total = Number(doc.total || 0).toFixed(2)
    const vehicle = [doc.vehicle_year, doc.vehicle_make, doc.vehicle_model].filter(Boolean).join(' ') || ''
    const safeShopName = escapeHtml(shopName)
    const safeCustomerName = escapeHtml(doc.customer_name || 'Valued Customer')
    const safeType = escapeHtml(doc.type)
    const safeDocNumber = escapeHtml(doc.doc_number)
    const safeVehicle = escapeHtml(vehicle)
    const safeDocDate = escapeHtml(doc.doc_date)
    const safeSignUrl = escapeHtml(signUrl)

    // Build a small line-item table for the email so the customer sees the
    // breakdown right in the inbox, not just a button to click.
    const itemsTable = doc.line_items.length
      ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0 16px">
          <thead><tr style="background:#f9fafb;text-align:left;border-bottom:1px solid #e5e7eb">
            <th style="padding:6px 8px">Description</th>
            <th style="padding:6px 8px;text-align:center">Qty/Hrs</th>
            <th style="padding:6px 8px;text-align:right">Amount</th>
          </tr></thead>
          <tbody>
            ${doc.line_items
              .map(
                (li: { description?: unknown; qty?: unknown; total?: unknown }) =>
                  `<tr style="border-bottom:1px solid #f3f4f6"><td style="padding:6px 8px">${escapeHtml(li.description)}</td><td style="padding:6px 8px;text-align:center">${escapeHtml(li.qty)}</td><td style="padding:6px 8px;text-align:right">$${Number(li.total).toFixed(2)}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>`
      : ''

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:20px;background:#f4f4f4">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
  <div style="background:#111827;padding:24px;text-align:center;color:#fff">
    <h2 style="margin:0;font-size:20px">${safeShopName}</h2>
  </div>
  <div style="padding:24px">
    <p>Hi ${safeCustomerName},</p>
    <p>Your ${safeType} #${safeDocNumber} is ready for your electronic signature.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:6px 0"><strong>Document:</strong></td><td style="padding:6px 0">${safeType} #${safeDocNumber}</td></tr>
      ${vehicle ? `<tr><td style="padding:6px 0"><strong>Vehicle:</strong></td><td style="padding:6px 0">${safeVehicle}</td></tr>` : ''}
      <tr><td style="padding:6px 0"><strong>Date:</strong></td><td style="padding:6px 0">${safeDocDate}</td></tr>
    </table>
    ${itemsTable}
    <table style="width:260px;margin-left:auto;font-size:13px;margin-bottom:16px">
      ${doc.parts_total > 0 ? `<tr><td style="padding:3px 8px">Parts</td><td style="padding:3px 8px;text-align:right">$${doc.parts_total.toFixed(2)}</td></tr>` : ''}
      ${doc.labor_total > 0 ? `<tr><td style="padding:3px 8px">Labor</td><td style="padding:3px 8px;text-align:right">$${doc.labor_total.toFixed(2)}</td></tr>` : ''}
      ${doc.core_total > 0 ? `<tr><td style="padding:3px 8px">Core Charges</td><td style="padding:3px 8px;text-align:right">$${doc.core_total.toFixed(2)}</td></tr>` : ''}
      ${doc.shop_supplies > 0 ? `<tr><td style="padding:3px 8px">Shop Supplies</td><td style="padding:3px 8px;text-align:right">$${doc.shop_supplies.toFixed(2)}</td></tr>` : ''}
      ${doc.sublet_total > 0 ? `<tr><td style="padding:3px 8px">Sublet</td><td style="padding:3px 8px;text-align:right">$${doc.sublet_total.toFixed(2)}</td></tr>` : ''}
      ${doc.tax_amount > 0 ? `<tr><td style="padding:3px 8px">Tax</td><td style="padding:3px 8px;text-align:right">$${doc.tax_amount.toFixed(2)}</td></tr>` : ''}
      <tr style="font-size:15px;font-weight:bold;border-top:2px solid #111">
        <td style="padding:6px 8px">Total</td>
        <td style="padding:6px 8px;text-align:right">$${total}</td>
      </tr>
    </table>
    <p>Click below to review the full document and sign electronically:</p>
    <p style="text-align:center;margin:24px 0 8px">
      <a href="${safeSignUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 32px;border-radius:6px;font-size:16px;font-weight:600">Review and Sign</a>
    </p>
    <p style="font-size:12px;color:#888">Questions? Call us at ${escapeHtml(settings?.shop_phone)}.</p>
  </div>
  <div style="border-top:1px solid #eee;padding:16px;text-align:center;font-size:12px;color:#888">${safeShopName} · ${escapeHtml(settings?.shop_address)}</div>
</div>
</body></html>`

    let emailError: string | null = null
    try {
      await sendEmail({
        to: email,
        subject: `${doc.type} #${doc.doc_number} — Please review and sign`,
        html,
        replyTo: settings?.shop_email,
        apiKey: settings.resend_api_key,
        from: settings.from_email,
        idempotencyKey: signatureRecord?.id ? `signature-request-${signatureRecord.id}` : undefined,
      })
    } catch (err: unknown) {
      emailError = err instanceof Error ? err.message : String(err)
      console.error('Sign email error:', emailError)
    }

    const siteUrl2 = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
    return NextResponse.json({ success: !emailError, emailAccepted: !emailError, email, token, signUrl: `${siteUrl2}/sign/${token}`, emailError })
  }

  // ── EXPLICIT estimate approval ────────────────────────────────────────────
  // GET/HEAD must remain read-only because mail scanners and link previews
  // routinely request links before the customer sees them.
  if (body.action === 'approve') {
    const { token, signerName } = body as { token: string; signerName?: string }
    if (typeof token !== 'string' || !token) return NextResponse.json({ error: 'Valid token required' }, { status: 400 })
    const { signature: sig, document: doc, error } = await loadSignatureDocument(db, token)
    if (error || !sig || !doc) return NextResponse.json({ error: 'Invalid signing link' }, { status: 404 })
    if (sig.expires_at && new Date(sig.expires_at) < new Date()) return NextResponse.json({ error: 'This signing link has expired' }, { status: 410 })
    if (isStaleSigningLink(sig, doc)) return NextResponse.json({ error: 'This signing link is no longer current. Ask the shop for an updated document.' }, { status: 409 })
    if (doc.type !== 'Estimate') return NextResponse.json({ error: 'Only estimates can be approved with this link' }, { status: 400 })

    const approvedBy = typeof signerName === 'string' && signerName.trim()
      ? signerName.trim().slice(0, 160)
      : String(sig.customer_email || 'customer')
    const { data: approvedDocument, error: approvalError } = await db.from('documents').update({
      approved_at: new Date().toISOString(),
      approved_by_name: approvedBy,
      status: 'Approved',
    }).eq('id', sig.document_id).eq('shop_id', sig.shop_id).is('approved_at', null).select('id,approved_at,status').maybeSingle()
    if (approvalError) return NextResponse.json({ error: 'We could not save your approval. Please try again or call the shop.' }, { status: 500 })
    if (!approvedDocument) {
      const { data: currentDocument } = await db.from('documents').select('approved_at,status').eq('id', sig.document_id).eq('shop_id', sig.shop_id).maybeSingle()
      if (currentDocument?.status === 'Approved' && currentDocument.approved_at) return NextResponse.json({ success: true, approved: true, alreadyApproved: true })
      return NextResponse.json({ error: 'This estimate changed before approval. Ask the shop for an updated link.' }, { status: 409 })
    }
    return NextResponse.json({ success: true, approved: true })
  }

  // ── COMPLETE signature ─────────────────────────────────────────────────────
  if (body.action === 'complete') {
    const { token, signatureData, signerName } = body as { token: string; signatureData: string; signerName: string }
    if (typeof token !== 'string' || !token || typeof signerName !== 'string' || signerName.trim().length > 160) {
      return NextResponse.json({ error: 'Valid token and signer name required' }, { status: 400 })
    }
    if (typeof signatureData !== 'string' || signatureData.length > 500000 || !/^data:image\/(png|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(signatureData)) {
      return NextResponse.json({ error: 'Invalid signature image' }, { status: 400 })
    }
    const { signature: sig, document: docRecord, error } = await loadSignatureDocument(db, token)
    if (error || !sig) return NextResponse.json({ error: 'Invalid signing link' }, { status: 404 })
    if (sig.signed_at) return NextResponse.json({ error: 'This document has already been signed' }, { status: 409 })
    if (sig.expires_at && new Date(sig.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This signing link has expired' }, { status: 410 })
    }
    if (!docRecord || typeof docRecord !== 'object') {
      return NextResponse.json({ error: 'The document for this signing link is unavailable' }, { status: 404 })
    }
    if (isStaleSigningLink(sig, docRecord)) {
      return NextResponse.json({ error: 'This signing link is no longer current. Ask the shop for an updated document.' }, { status: 409 })
    }

    const now = new Date().toISOString()
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
    const doc = customerFacingDocument(docRecord)
    const documentHash = customerFacingDocumentHash(doc)
    const { data: completion, error: completionError } = await db.rpc('complete_signature', {
      p_token: token,
      p_shop_id: sig.shop_id,
      p_document_id: sig.document_id,
      p_signer_name: signerName.trim(),
      p_signature_data: signatureData,
      p_ip_address: ip,
      p_document_hash: documentHash,
      p_document_snapshot: doc,
      p_expected_updated_at: docRecord.updated_at || null,
      p_signed_at: now,
    })
    if (completionError) return NextResponse.json({ error: 'Could not save signature safely. Please try again.' }, { status: 503 })
    const completionStatus = completion && typeof completion === 'object' ? String((completion as Record<string, unknown>).status || '') : ''
    if (completionStatus === 'already_signed') return NextResponse.json({ error: 'This document has already been signed' }, { status: 409 })
    if (completionStatus === 'expired') return NextResponse.json({ error: 'This signing link has expired' }, { status: 410 })
    if (completionStatus === 'stale') return NextResponse.json({ error: 'This signing link is no longer current. Ask the shop for an updated document.' }, { status: 409 })
    if (completionStatus !== 'signed') return NextResponse.json({ error: 'This signing link is invalid.' }, { status: 404 })

    const { data: settings } = await db.from('settings').select('*').eq('shop_id', sig.shop_id).maybeSingle()
    const shopName = settings?.shop_name || 'your shop'
    const vehicle = [doc.vehicle_year, doc.vehicle_make, doc.vehicle_model].filter(Boolean).join(' ') || ''
    const total = Number(doc.total || 0).toFixed(2)
    const safeShopName = escapeHtml(shopName)
    const safeSignerName = escapeHtml(signerName.trim())
    const safeCustomerName = escapeHtml(doc.customer_name || 'Valued Customer')
    const safeType = escapeHtml(doc.type)
    const safeDocNumber = escapeHtml(doc.doc_number)
    const safeVehicle = escapeHtml(vehicle)
    const safeIp = escapeHtml(ip)
    const safeSignatureData = escapeHtml(signatureData)

    const confirmHtml = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:Arial,sans-serif;background:#f0f0f0;margin:0;padding:20px}
.wrap{max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.12)}
.hdr{background:#16a34a;padding:32px;text-align:center;color:#fff}
.hdr h1{margin:0 0 6px;font-size:24px}
.body{padding:32px}
.info{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin:20px 0;font-size:14px;line-height:1.9}
.sig-box{border:2px solid #e5e7eb;border-radius:10px;padding:16px;margin:16px 0;text-align:center;background:#fafafa}
.ftr{background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px;text-align:center;font-size:12px;color:#6b7280}
</style></head>
<body><div class="wrap">
  <div class="hdr"><h1>Document Signed</h1><p>${safeShopName}</p></div>
  <div class="body">
    <p style="font-size:16px">Hi <strong>${safeSignerName || safeCustomerName}</strong>,</p>
    <p>Thank you! Your electronic signature has been recorded.</p>
    <div class="info">
      <strong>Document:</strong> ${safeType} #${safeDocNumber}<br>
      ${vehicle ? `<strong>Vehicle:</strong> ${safeVehicle}<br>` : ''}
      <strong>Total:</strong> $${total}<br>
      <strong>Signed by:</strong> ${safeSignerName}<br>
      <strong>Signed on:</strong> ${new Date(now).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}<br>
      <strong>IP Address:</strong> ${safeIp}
    </div>
    <div class="sig-box">
      ${signatureData ? `<img src="${safeSignatureData}" style="max-width:300px;max-height:120px" alt="Your Signature"/>` : ''}
    </div>
    <p style="font-size:13px;color:#6b7280">Keep this email for your records. Questions? Call ${escapeHtml(settings?.shop_phone)}.</p>
  </div>
  <div class="ftr">${safeShopName} · ${escapeHtml(settings?.shop_address)}</div>
</div></body></html>`

    // The signature is already durable. A receipt delivery failure must not
    // make the customer retry the signature and receive a false failure.
    await sendEmail({
      to: sig.customer_email,
      subject: `Signature Confirmed — ${doc.type} #${doc.doc_number}`,
      html: confirmHtml,
      replyTo: settings?.shop_email,
      apiKey: settings?.resend_api_key,
      from: settings?.from_email,
      idempotencyKey: `signature-confirmation-${sig.id}`,
    }).catch((emailError: unknown) => console.error('Signature confirmation email error:', emailError))

    // Also notify shop
    if (settings?.shop_email) {
      await sendEmail({
        to: settings.shop_email,
        subject: `Customer signed ${doc.type} #${doc.doc_number} — ${signerName}`,
        html: `<p><strong>${safeSignerName}</strong> signed <strong>${safeType} #${safeDocNumber}</strong> for ${safeVehicle} on ${escapeHtml(new Date(now).toLocaleString())} — Total: $${total}.</p>`,
        replyTo: settings.shop_email,
        apiKey: settings.resend_api_key,
        from: settings.from_email,
        idempotencyKey: `signature-shop-notification-${sig.id}`,
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, signed_at: now })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
