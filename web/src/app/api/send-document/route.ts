import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendEmail, estimateEmailHtml } from '@/lib/email'
import { sendSMS, formatPhone } from '@/lib/telnyx'

export async function POST(req: NextRequest) {
  try {
    const { documentId, channel, email, phone } = await req.json()

    const db = getServiceClient()
    const [{ data: doc }, { data: settings }] = await Promise.all([
      db.from('documents').select('*').eq('id', documentId).single(),
      db.from('settings').select('*').limit(1).single(),
    ])

    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    const shopName = settings?.shop_name || 'Alpha International Auto Center'
    const docType = doc.type as string

    if (channel === 'email' && email) {
      const html = estimateEmailHtml(doc, settings || {})
      const fromEmail = settings?.from_email || 'Alpha Auto <onboarding@resend.dev>'
      await sendEmail({
        to: email,
        subject: `${docType} #${doc.doc_number} from ${shopName}`,
        html,
        replyTo: settings?.shop_email,
        apiKey: settings?.resend_api_key,
        from: fromEmail,
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

    if (channel === 'sms' && phone) {
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
