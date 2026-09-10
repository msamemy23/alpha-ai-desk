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
    if (!['email', 'sms'].includes(channel)) return NextResponse.json({ error: 'channel must be email or sms' }, { status: 400 })
    const db = getServiceClient()

    // Scope both the document and settings to the caller's shop so one shop can
    // never email/SMS another shop's document.
    const [{ data: doc, error: docError }, { data: settings, error: settingsError }] = await Promise.all([
      db.from('documents').select('*').eq('id', documentId).eq('shop_id', auth.shopId).single(),
      db.from('settings').select('*').eq('shop_id', auth.shopId).limit(1).maybeSingle(),
    ])
    if (docError) return NextResponse.json({ error: 'Document could not be loaded' }, { status: 500 })
    if (settingsError) return NextResponse.json({ error: 'Shop settings could not be loaded' }, { status: 500 })
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

    const shopName = settings?.shop_name || 'Your Auto Shop'
    const docType = doc.type as string

    if (channel === 'email') {
      const email = custEmail
      if (!email) return NextResponse.json({ error: 'No email on file for this customer' }, { status: 400 })

      if (!settings?.resend_api_key || !settings?.from_email) return NextResponse.json({ error: 'Email is not configured for this shop' }, { status: 503 })
      const html = estimateEmailHtml(doc, settings || {})
      await sendEmail({
        to: email,
        subject: `${docType} #${doc.doc_number} from ${shopName}`,
        html,
        replyTo: settings?.shop_email,
        apiKey: settings.resend_api_key,
        from: settings.from_email,
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
      if (!settings?.telnyx_api_key || !settings?.telnyx_phone_number) return NextResponse.json({ error: 'SMS is not configured for this shop' }, { status: 503 })
      const formatted = formatPhone(phone)
      const smsBody = `Hi! Your ${docType} #${doc.doc_number} from ${shopName} is ready. Total: ${calcTotals(doc).total.toFixed(2)}. Call us at ${settings?.shop_phone || ''} with any questions.`
      await sendSMS(formatted, smsBody, settings.telnyx_phone_number, {
        apiKey: settings.telnyx_api_key,
        messagingProfileId: settings.telnyx_messaging_profile_id || '',
      })
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
