export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, calcTotals } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { sendEmail, estimateEmailHtml } from '@/lib/email'
import { sendSMS, formatPhone } from '@/lib/telnyx'
import { getIdempotencyKey } from '@/lib/api-response'
import { normalizePhoneDigits } from '@/lib/sms-normalize'
import { isSmsOptedOut } from '@/lib/sms-consent'

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
    let smsOptedOut = false
    if (doc.customer_id) {
      const { data: cust, error: customerError } = await db
        .from('customers')
        .select('email,phone,sms_opted_out')
        .eq('id', doc.customer_id)
        .eq('shop_id', auth.shopId)
        .single()
      if (customerError) return NextResponse.json({ error: 'Customer could not be loaded' }, { status: 500 })
      if (cust) {
        if (reqPhone && cust.phone && normalizePhoneDigits(reqPhone) !== normalizePhoneDigits(cust.phone)) {
          return NextResponse.json({ error: 'The requested phone does not match the document customer' }, { status: 409 })
        }
        if (!custEmail) custEmail = cust.email || ''
        if (!custPhone) custPhone = cust.phone || ''
        smsOptedOut = cust.sms_opted_out === true
      }
    }

    const shopName = settings?.shop_name || 'Your Auto Shop'
    const docType = doc.type as string
    const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'send-document', documentId, channel, custEmail || custPhone])

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
        idempotencyKey,
      })

      const { error: emailMessageError } = await db.from('messages').insert({
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
      if (emailMessageError) return NextResponse.json({ error: 'Email sent, but its message record could not be saved' }, { status: 502 })

      const { error: emailDocumentError } = await db
        .from('documents')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', documentId)
        .eq('shop_id', auth.shopId)
      if (emailDocumentError) return NextResponse.json({ error: 'Email sent, but the document could not be marked as sent' }, { status: 502 })
    }

    if (channel === 'sms') {
      const phone = custPhone
      if (!phone) return NextResponse.json({ error: 'No phone number on file for this customer' }, { status: 400 })
      if (!settings?.telnyx_api_key || !settings?.telnyx_phone_number) return NextResponse.json({ error: 'SMS is not configured for this shop' }, { status: 503 })
      const formatted = formatPhone(phone)
      if (smsOptedOut || await isSmsOptedOut(db, auth.shopId, formatted)) return NextResponse.json({ error: 'This destination has opted out of SMS' }, { status: 409 })
      const smsBody = `Hi! Your ${docType} #${doc.doc_number} from ${shopName} is ready. Total: ${calcTotals(doc).total.toFixed(2)}. Call us at ${settings?.shop_phone || ''} with any questions.`
      await sendSMS(formatted, smsBody, settings.telnyx_phone_number, {
        apiKey: settings.telnyx_api_key,
        messagingProfileId: settings.telnyx_messaging_profile_id || '',
        idempotencyKey,
      })
      const { error: smsMessageError } = await db.from('messages').insert({
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
      if (smsMessageError) return NextResponse.json({ error: 'SMS sent, but its message record could not be saved' }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
