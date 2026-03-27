export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

  const db = getServiceClient()
  const { data: sig, error } = await db
    .from('signatures')
    .select('*, documents(*)')
    .eq('token', token)
    .single()

  if (error || !sig) return NextResponse.json({ error: 'Invalid or expired link' }, { status: 404 })
  if (sig.signed_at) return NextResponse.json({ already_signed: true, signed_at: sig.signed_at, signer_name: sig.signer_name })

  // Check expiry
  if (sig.expires_at && new Date(sig.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This signing link has expired' }, { status: 410 })
  }

  return NextResponse.json({ doc: sig.documents, signature_id: sig.id })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const db = getServiceClient()

  // ── SEND signature request ──────────────────────────────────────────────
  if (body.action === 'send') {
    const { documentId } = body as { documentId: string }

    const [{ data: doc }, { data: settings }] = await Promise.all([
      db.from('documents').select('*').eq('id', documentId).single(),
      db.from('settings').select('*').limit(1).single(),
    ])
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    let email = doc.customer_email || ''
    if (!email && doc.customer_id) {
      const { data: cust } = await db.from('customers').select('email').eq('id', doc.customer_id).single()
      email = cust?.email || ''
    }
    if (!email) return NextResponse.json({ error: 'No email address on file for this customer' }, { status: 400 })

    // Deactivate any existing unsigned tokens for this doc
    await db.from('signatures').update({ expires_at: new Date().toISOString() })
      .eq('document_id', documentId).is('signed_at', null)

    const token = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { error: insertErr } = await db.from('signatures').insert({
      token,
      document_id: documentId,
      customer_email: email,
      expires_at: expiresAt,
    })
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

    const shopName = settings?.shop_name || 'Alpha International Auto Center'
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://alpha-ai-desk.vercel.app'
    const signUrl = `${siteUrl}/sign/${token}`
    const total = Number(doc.total || 0).toFixed(2)
    const vehicle = [doc.vehicle_year, doc.vehicle_make, doc.vehicle_model].filter(Boolean).join(' ') || ''

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font-family:Arial,sans-serif;background:#f0f0f0;margin:0;padding:20px}
.wrap{max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.12)}
.hdr{background:#111827;padding:32px;text-align:center;color:#fff}
.hdr h1{margin:0 0 6px;font-size:24px;letter-spacing:-0.5px}
.hdr p{margin:0;opacity:.7;font-size:14px}
.body{padding:32px}
.info{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin:20px 0;font-size:14px;line-height:1.9}
.info strong{color:#111827}
.btn{display:block;background:#2563eb;color:#fff !important;text-decoration:none;padding:16px;border-radius:10px;font-size:17px;font-weight:700;text-align:center;margin:24px 0}
.btn:hover{background:#1d4ed8}
.note{font-size:12px;color:#9ca3af;text-align:center;margin-top:4px}
.ftr{background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px;text-align:center;font-size:12px;color:#6b7280}
</style></head>
<body><div class="wrap">
<div class="hdr"><h1>${shopName}</h1><p>Please review and sign your ${doc.type}</p></div>
<div class="body">
<p style="font-size:16px">Hi <strong>${doc.customer_name || 'Valued Customer'}</strong>,</p>
<p>Your <strong>${doc.type} #${doc.doc_number}</strong> from ${shopName} is ready for your electronic signature.</p>
<div class="info">
<strong>Document:</strong> ${doc.type} #${doc.doc_number}<br>
${vehicle ? `<strong>Vehicle:</strong> ${vehicle}<br>` : ''}
<strong>Total:</strong> $${total}<br>
<strong>Date:</strong> ${doc.doc_date || ''}
</div>
<p>Please click below to review the full document and sign electronically. Your signed copy will be emailed to you.</p>
<a href="${signUrl}" class="btn">📝 Review &amp; Sign Now</a>
<p class="note">This link expires in 7 days. Questions? Call us at ${settings?.shop_phone || ''}.</p>
</div>
<div class="ftr">${shopName}<br>${settings?.shop_address || ''}</div>
</div></body></html>`

    const fromAddr = settings?.from_email || process.env.FROM_EMAIL || `${shopName} <onboarding@resend.dev>`
    let emailError: string | null = null
    try {
      await sendEmail({
        to: email,
        subject: `Action Required: Sign your ${doc.type} #${doc.doc_number} — ${shopName}`,
        html,
        apiKey: settings?.resend_api_key || process.env.RESEND_API_KEY,
        from: fromAddr,
        replyTo: settings?.shop_email,
      })
    } catch (err: unknown) {
      emailError = err instanceof Error ? err.message : String(err)
      console.error('Sign email error:', emailError)
    }

    await db.from('documents').update({ signature_requested_at: new Date().toISOString() }).eq('id', documentId)

    const siteUrl2 = process.env.NEXT_PUBLIC_SITE_URL || 'https://alpha-ai-desk.vercel.app'
    return NextResponse.json({ success: true, email, token, signUrl: `${siteUrl2}/sign/${token}`, emailError })
  }

  // ── COMPLETE signature ──────────────────────────────────────────────────
  if (body.action === 'complete') {
    const { token, signatureData, signerName } = body as { token: string; signatureData: string; signerName: string }

    const { data: sig, error } = await db.from('signatures').select('*, documents(*)').eq('token', token).single()
    if (error || !sig) return NextResponse.json({ error: 'Invalid signing link' }, { status: 404 })
    if (sig.signed_at) return NextResponse.json({ error: 'This document has already been signed' }, { status: 409 })
    if (sig.expires_at && new Date(sig.expires_at) < new Date()) {
      return NextResponse.json({ error: 'This signing link has expired' }, { status: 410 })
    }

    const now = new Date().toISOString()
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''

    await db.from('signatures').update({
      signed_at: now,
      signer_name: signerName,
      signature_data: signatureData,
      ip_address: ip,
    }).eq('token', token)

    const doc = sig.documents
    await db.from('documents').update({
      signature_signed_at: now,
      signature_signer_name: signerName,
    }).eq('id', sig.document_id)

    const { data: settings } = await db.from('settings').select('*').limit(1).single()
    const shopName = settings?.shop_name || 'Alpha International Auto Center'
    const vehicle = [doc.vehicle_year, doc.vehicle_make, doc.vehicle_model].filter(Boolean).join(' ') || ''
    const total = Number(doc.total || 0).toFixed(2)

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
<div class="hdr"><h1>✅ Document Signed</h1><p>${shopName}</p></div>
<div class="body">
<p style="font-size:16px">Hi <strong>${signerName || doc.customer_name || 'Valued Customer'}</strong>,</p>
<p>Thank you! Your electronic signature has been recorded. Here is your confirmation:</p>
<div class="info">
<strong>Document:</strong> ${doc.type} #${doc.doc_number}<br>
${vehicle ? `<strong>Vehicle:</strong> ${vehicle}<br>` : ''}
<strong>Total:</strong> $${total}<br>
<strong>Signed by:</strong> ${signerName}<br>
<strong>Signed on:</strong> ${new Date(now).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}<br>
<strong>IP Address:</strong> ${ip}
</div>
<div class="sig-box">
${signatureData ? `<img src="${signatureData}" style="max-width:300px;max-height:120px" alt="Your Signature"/>` : ''}
</div>
<p style="font-size:13px;color:#6b7280">This serves as your official record. Keep this email for your records. If you have any questions, contact us at ${settings?.shop_phone || ''}.</p>
</div>
<div class="ftr">${shopName} · ${settings?.shop_address || ''}</div>
</div></body></html>`

    await sendEmail({
      to: sig.customer_email,
      subject: `✅ Signature Confirmed — ${doc.type} #${doc.doc_number}`,
      html: confirmHtml,
      apiKey: settings?.resend_api_key,
      from: settings?.from_email || `${shopName} <onboarding@resend.dev>`,
    })

    // Also notify shop
    if (settings?.shop_email) {
      await sendEmail({
        to: settings.shop_email,
        subject: `🖊️ Customer signed ${doc.type} #${doc.doc_number} — ${signerName}`,
        html: `<p><strong>${signerName}</strong> has signed <strong>${doc.type} #${doc.doc_number}</strong> for ${vehicle} on ${new Date(now).toLocaleString()}.</p>`,
        apiKey: settings?.resend_api_key,
        from: settings?.from_email || `${shopName} <onboarding@resend.dev>`,
      }).catch(() => {}) // Don't fail if shop notification fails
    }

    return NextResponse.json({ success: true, signed_at: now })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}