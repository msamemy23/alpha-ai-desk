export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendEmail, estimateEmailHtml } from '@/lib/email'
import { sendSMS, formatPhone } from '@/lib/telnyx'

export async function POST(req: NextRequest) {
  try {
    const { documentId, channel, email: reqEmail, phone: reqPhone } = await req.json()

    const db = getServiceClient()
    const [{ data: doc }, { data: settings }] = await Promise.all([
      db.from('documents').select('*').eq('id', documentId).single(),
      db.from('settings').select('*').limit(1).single(),
    ])

    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    // Fall back to document's own contact fields, then try customer table
    let custEmail = reqEmail || doc.customer_email || ''
    let custPhone = reqPhone || doc.customer_phone || ''
    if ((!custEmail || !custPhone) && doc.customer_id) {
      const { data: cust } = await db.from('customers').select('email,phone').eq('id', doc.customer_id).single()
      if (cust) {
        if (!custEmail) custEmail = cust.email || ''
        if (!custPhone) custPhone = cust.phone || ''
      }
    }

    const shopName = settings?.shop_name || 'Alpha International Auto Center'
    const docType = doc.type as string

    if (channel === 'email') {
      const email = custEmail
      if (!email) return NextResponse.json({ error: 'No email on file for this customer' }, { status: 400 })
      const html = estimateEmailHtml(doc, settings || {})
      // sendEmail() auto-falls back to onboarding@resend.dev for unverified domains
          // TEMP FIX: Route to account owner until DNS verified
    const originalEmail = email
      await sendEmail({
        to: email,
      subject: `[TO: ${originalEmail}] ${docType} #${doc.doc_number} from ${shopName}`,        html,
        replyTo: settings?.shop_email,
              })
      // Log
      await db.from('messages').insert({
        direction: 'outbound', channel: 'email',
        from_address: settings?.from_email || settings?.shop_email,
        to_address: email,
        subject: `${docType} #${doc.doc_number}`,
        body: `${docType} #${doc.doc_number} sent`,
        document_id: documentId,
        customer_id: doc.customer_id,
        status: 'sent', read: true,
      })
      // Mark doc as sent
      await db.from('documents').update({ sent_at: new Date().toISOString() }).eq('id', documentId)
    }

    if (channel === 'sms') {
      const phone = custPhone
      if (!phone) return NextResponse.json({ error: 'No phone number on file for this customer' }, { status: 400 })
      const formatted = formatPhone(phone)
      const smsBody = `Hi! Your ${docType} #${doc.doc_number} from ${shopName} is ready. Total: $${calcTotal(doc).toFixed(2)}. Call us at ${settings?.shop_phone || ''} with any questions.`
      await sendSMS(formatted, smsBody)
      await db.from('messages').insert({
        direction: 'outbound', channel: 'sms',
        from_address: settings?.telnyx_phone_number,
        to_address: phone,
        body: smsBody,
        document_id: documentId,
        customer_id: doc.customer_id,
        status: 'sent', read: true,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

function calcTotal(doc: Record<string, unknown>): number {
  const parts = (doc.parts as Record<string,unknown>[]) || []
  const labors = (doc.labors as Record<string,unknown>[]) || []
  const taxRate = Number(doc.tax_rate) || 8.25
  const shopSupplies = Number(doc.shop_supplies) || 0
  const partsTotal = parts.reduce((s, p) => s + (Number(p.qty)||1) * (Number(p.unitPrice)||0), 0)
  const laborTotal = labors.reduce((s, l) => s + (Number(l.hours)||0) * (Number(l.rate)||0), 0)
  const tax = partsTotal * (taxRate / 100)
  return partsTotal + laborTotal + shopSupplies + tax
}
