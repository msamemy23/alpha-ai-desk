export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, calcTotals } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { sendEmail, estimateEmailHtml } from '@/lib/email'
import { sendSMS, formatPhone } from '@/lib/telnyx'

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const { documentId, channel, email: reqEmail, phone: reqPhone } = await req.json()
    const db = getServiceClient()

    // Scope both the document and settings to the caller's shop so one shop can
    // never email/SMS another shop's document.
    const [{ data: doc }, { data: settings }] = await Promise.all([
      db.from('documents').select('*').eq('id', documentId).eq('shop_id', auth.shopId).single(),
      db.from('settings').select('*').eq('shop_id', auth.shopId).limit(1).single(),
    ])
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    // Resolve customer contact info: request body > document fields > customer table
    let custEmail = reqEmail || doc.customer_email || ''
    let custPhone = reqPhone || doc.customer_phone || ''
    if ((!custEmail || !custPhone) && doc.customer_id) {
      const { data: cust } = await db
        .from('customers')
        .select('email,phone')
        .eq('id', doc.customer_id)
        .eq('shop_id', auth.shopId)
        .single()
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
      await sendEmail({
        to: email,
        subject: `${docType} #${doc.doc_number} from ${shopName}`,
        html,
        replyTo: settings?.shop_email,
      })

      await db.from('messages').insert({
        shop_id: auth.shopId,
        direction: 'outbound',
        channel: 'email',
        from_address: settings?.from_email || settings?.shop_email,
        to_address: email,
        subject: `${docType} #${doc.doc_number}`,
        body: `${docType} #${doc.doc_number} sent`,
        document_id: documentId,
        customer_id: doc.customer_id,
        status: 'sent',
        read: true,
      })

      await db
        .from('documents')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', documentId)
        .eq('shop_id', auth.shopId)
    }

    if (channel === 'sms') {
      const phone = custPhone
      if (!phone) return NextResponse.json({ error: 'No phone number on file for this customer' }, { status: 400 })
      const formatted = formatPhone(phone)
      const smsBody = `Hi! Your ${docType} #${doc.doc_number} from ${shopName} is ready. Total: $${calcTotals(doc).total.toFixed(2)}. Call us at ${settings?.shop_phone || ''} with any questions.`
      await sendSMS(formatted, smsBody)
      await db.from('messages').insert({
        shop_id: auth.shopId,
        direction: 'outbound',
        channel: 'sms',
        from_address: settings?.telnyx_phone_number,
        to_address: phone,
        body: smsBody,
        document_id: documentId,
        customer_id: doc.customer_id,
        status: 'sent',
        read: true,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
