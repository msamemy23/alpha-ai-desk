export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient, calcTotals } from '@/lib/supabase'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { estimateEmailHtml } from '@/lib/email'
import { formatPhone } from '@/lib/telnyx'
import { getIdempotencyKey } from '@/lib/api-response'
import { normalizePhoneDigits } from '@/lib/sms-normalize'
import { isSmsOptedOut } from '@/lib/sms-consent'
import { sendDurableSms } from '@/lib/durable-sms'
import { sendDurableEmail } from '@/lib/durable-email'

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()

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
    const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'send-document', documentId, channel, custEmail || custPhone, String(doc.updated_at || '')])

    if (channel === 'email') {
      const email = custEmail
      if (!email) return NextResponse.json({ error: 'No email on file for this customer' }, { status: 400 })

      if (!settings?.resend_api_key || !settings?.from_email) return NextResponse.json({ error: 'Email is not configured for this shop' }, { status: 503 })
      const emailSubject = `${docType} #${doc.doc_number} from ${shopName}`
      const html = estimateEmailHtml(doc, settings || {})
      const emailHeaders = new Headers(req.headers)
      emailHeaders.set('Idempotency-Key', idempotencyKey)
      const emailResult = await sendDurableEmail({
        request: new Request(req.url, { headers: emailHeaders }),
        db,
        shopId: auth.shopId,
        userId: auth.userId,
        to: email,
        subject: emailSubject,
        html,
        messageBody: `${docType} #${doc.doc_number} sent`,
        fromAddress: settings.from_email,
        replyTo: settings.shop_email,
        apiKey: settings.resend_api_key,
        documentId,
        customerId: doc.customer_id,
      })
      if (!emailResult.ok) return NextResponse.json({ ok: false, error: emailResult.error, uncertain: emailResult.uncertain === true }, { status: emailResult.status })

      const { error: emailDocumentError } = await db
        .from('documents')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', documentId)
        .eq('shop_id', auth.shopId)
      if (emailDocumentError) return NextResponse.json({ error: 'Email sent, but the document could not be marked as sent' }, { status: 502 })
      return NextResponse.json({ ok: true, idempotent: emailResult.idempotent, message: emailResult.message, ...(emailResult.auditPending ? { audit_pending: true } : {}) })
    }

    if (channel === 'sms') {
      const phone = custPhone
      if (!phone) return NextResponse.json({ error: 'No phone number on file for this customer' }, { status: 400 })
      if (!settings?.telnyx_api_key || !settings?.telnyx_phone_number) return NextResponse.json({ error: 'SMS is not configured for this shop' }, { status: 503 })
      const formatted = formatPhone(phone)
      if (smsOptedOut || await isSmsOptedOut(db, auth.shopId, formatted)) return NextResponse.json({ error: 'This destination has opted out of SMS' }, { status: 409 })
      const smsBody = `Hi! Your ${docType} #${doc.doc_number} from ${shopName} is ready. Total: ${calcTotals(doc).total.toFixed(2)}. Call us at ${settings?.shop_phone || ''} with any questions.`
      const durableHeaders = new Headers(req.headers)
      durableHeaders.set('Idempotency-Key', idempotencyKey)
      const smsResult = await sendDurableSms({
        request: new Request(req.url, { headers: durableHeaders }),
        db,
        shopId: auth.shopId,
        userId: auth.userId,
        to: formatted,
        text: smsBody,
        customerId: doc.customer_id,
        documentId,
        settings: {
          telnyx_api_key: settings.telnyx_api_key,
          telnyx_phone_number: settings.telnyx_phone_number,
          telnyx_messaging_profile_id: settings.telnyx_messaging_profile_id || '',
        },
      })
      if (!smsResult.ok) return NextResponse.json({ ok: false, error: smsResult.error, uncertain: smsResult.uncertain === true }, { status: smsResult.status })
      if (!smsResult.messageRecordSaved) return NextResponse.json({ ok: true, message_record_saved: false, warning: 'SMS was accepted, but its local message record still needs repair. Retry this send; the provider will not be called again.' })
      const { error: smsDocumentError } = await db.from('documents')
        .update({ sent_at: new Date().toISOString() })
        .eq('id', documentId)
        .eq('shop_id', auth.shopId)
      if (smsDocumentError) return NextResponse.json({ ok: true, message_record_saved: true, document_marked_sent: false, warning: 'SMS sent, but the document still needs to be marked as sent. Retry this send; the provider will not be called again.' })
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
