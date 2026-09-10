export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import { calculateDocumentTotals, getLaborFlatAmount, nonNegativeDecimal, quantityFromUnknown } from '@/lib/document-money'
import crypto from 'crypto'
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
  tax_amount: number
  shop_supplies: number
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
    tax_amount: number
    shop_supplies: number
    balance_due: number
  }
}

function roundDocumentLine(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// One-click approval from the estimate email. Uses the same token as signing —
// the customer taps Approve and the estimate is marked approved, no pen needed.
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

function approvalPage(title: string, message: string) {
  return new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:40px 16px;text-align:center">
<div style="max-width:440px;margin:0 auto;background:#fff;border-radius:12px;padding:32px 24px">
<div style="font-size:44px">✅</div>
<h2 style="margin:12px 0 8px">${escapeHtml(title)}</h2>
<p style="color:#555;margin:0">${escapeHtml(message)}</p>
</div></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(req: NextRequest) {
  const approveToken = req.nextUrl.searchParams.get('approve')
  if (approveToken) {
    const db = getServiceClient()
    const { signature: sig, document: doc, error: loadError } = await loadSignatureDocument(db, approveToken)
    if (loadError || !sig || !doc) return approvalPage('Link not found', 'This approval link is invalid. Call the shop and we will sort it out.')
    if (sig.expires_at && new Date(sig.expires_at) < new Date()) {
      return approvalPage('Link expired', 'This approval link has expired. Call the shop for a fresh one.')
    }
    if (!doc.approved_at) {
      const { error: approvalError } = await db.from('documents').update({
        approved_at: new Date().toISOString(),
        approved_by: sig.customer_email || 'customer',
        ...(doc.type === 'Estimate' ? { status: 'Approved' } : {}),
      }).eq('id', doc.id as string).eq('shop_id', sig.shop_id)
      if (approvalError) {
        console.error('[sign] approval update failed:', approvalError.message)
        return approvalPage('Approval not recorded', 'We could not save your approval. Please try again or call the shop.')
      }
    }
    return approvalPage('You\'re approved!', `Thanks — ${String(doc.type || 'document')} #${String(doc.doc_number || '')} is approved and we\'ll get started. We\'ll text you when it\'s ready.`)
  }

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
  // Normalize so the sign page sees line_items + total, not $0.00.
  const normalized = normalizeDocForSigning(doc)
  return NextResponse.json({ doc: normalized, signature_id: sig.id })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const db = getServiceClient()

  // ── SEND signature request ────────────────────────────────────────────────
  if (body.action === 'send') {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    const { documentId } = body as { documentId: string }
    if (typeof documentId !== 'string' || !documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })
    const [{ data: docRaw, error: docError }, { data: settings, error: settingsError }] = await Promise.all([
      db.from('documents').select('*').eq('id', documentId).eq('shop_id', auth.shopId).maybeSingle(),
      db.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle(),
    ])
    if (docError || settingsError) return NextResponse.json({ error: 'The document or shop settings could not be loaded' }, { status: 500 })
    if (!docRaw) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    const doc = normalizeDocForSigning(docRaw)

    let email = (doc.customer_email as string) || ''
    if (!email && doc.customer_id) {
      const { data: cust } = await db.from('customers').select('email').eq('id', doc.customer_id).eq('shop_id', auth.shopId).maybeSingle()
      email = cust?.email || ''
    }
    if (!email) return NextResponse.json({ error: 'No email address on file for this customer' }, { status: 400 })

    // Previously this deactivated ALL prior unsigned tokens for the doc, which
    // caused customers who clicked an earlier email (from a resend) to see
    // "link expired". Multiple valid tokens for the same document are fine —
    // whichever the customer clicks marks the document signed.

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: signatureRecord, error: insertErr } = await db.from('signatures').insert({
      shop_id: auth.shopId,
      token,
      document_id: documentId,
      customer_email: email,
      expires_at: expiresAt,
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
    const safeApproveUrl = escapeHtml(`${siteUrl}/api/sign?approve=${token}`)

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
    ${doc.type === 'Estimate' ? `<p style="text-align:center;margin:0 0 24px">
      <a href="${safeApproveUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:15px;font-weight:600">Approve — Start the Work</a>
    </p>` : ''}
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
        idempotencyKey: signatureRecord?.id ? `signature-request-${signatureRecord.id}` : undefined,
      })
    } catch (err: unknown) {
      emailError = err instanceof Error ? err.message : String(err)
      console.error('Sign email error:', emailError)
    }

    const { error: requestUpdateError } = await db.from('documents').update({ signature_requested_at: new Date().toISOString() }).eq('id', documentId).eq('shop_id', auth.shopId)
    if (requestUpdateError) return NextResponse.json({ error: 'Signature request created, but the document could not be updated' }, { status: 500 })
    const siteUrl2 = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
    return NextResponse.json({ success: !emailError, emailSent: !emailError, email, token, signUrl: `${siteUrl2}/sign/${token}`, emailError })
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

    const now = new Date().toISOString()
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
    const { data: signedSignature, error: signatureUpdateError } = await db.from('signatures').update({
      signed_at: now,
      signer_name: signerName.trim(),
      signature_data: signatureData,
      ip_address: ip,
    }).eq('token', token).eq('shop_id', sig.shop_id).is('signed_at', null).select('id').maybeSingle()
    if (signatureUpdateError) return NextResponse.json({ error: 'Could not save signature' }, { status: 500 })
    if (!signedSignature) return NextResponse.json({ error: 'This document has already been signed' }, { status: 409 })

    const doc = normalizeDocForSigning(docRecord)
    const { error: documentUpdateError } = await db.from('documents').update({
      signature_signed_at: now,
      signature_signer_name: signerName.trim(),
    }).eq('id', sig.document_id).eq('shop_id', sig.shop_id)
    if (documentUpdateError) return NextResponse.json({ error: 'Signature saved, but document status could not be updated' }, { status: 500 })

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

    await sendEmail({
      to: sig.customer_email,
      subject: `Signature Confirmed — ${doc.type} #${doc.doc_number}`,
      html: confirmHtml,
      replyTo: settings?.shop_email,
      idempotencyKey: `signature-confirmation-${sig.id}`,
    })

    // Also notify shop
    if (settings?.shop_email) {
      await sendEmail({
        to: settings.shop_email,
        subject: `Customer signed ${doc.type} #${doc.doc_number} — ${signerName}`,
        html: `<p><strong>${safeSignerName}</strong> signed <strong>${safeType} #${safeDocNumber}</strong> for ${safeVehicle} on ${escapeHtml(new Date(now).toLocaleString())} — Total: $${total}.</p>`,
        replyTo: settings.shop_email,
        idempotencyKey: `signature-shop-notification-${sig.id}`,
      }).catch(() => {})
    }

    return NextResponse.json({ success: true, signed_at: now })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
