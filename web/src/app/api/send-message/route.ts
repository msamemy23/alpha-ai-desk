export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendSMS, formatPhone } from '@/lib/telnyx'
import { sendEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    const { to, body, channel, subject, customerId: rawCustomerId, jobId, documentId, customerName } = await req.json()

    if (!to || !body) return NextResponse.json({ error: 'Missing to or body' }, { status: 400 })

    const db = getServiceClient()
    const { data: settings } = await db.from('settings').select('*').limit(1).single()

    // Resolve customerId - if not provided but customerName is, search by name
    let resolvedCustomerId: string | null = rawCustomerId || null
    let resolvedEmail = channel === 'email' ? to : null

    if (!resolvedCustomerId && customerName) {
      const { data: found } = await db
        .from('customers')
        .select('id, email')
        .ilike('name', `%${customerName}%`)
        .limit(1)
        .single()
      if (found) {
        resolvedCustomerId = found.id
        if (!resolvedEmail && found.email) resolvedEmail = found.email
      }
    }

    // If we have a customerId and an email, save the email to the customer record if they don't have one
    if (resolvedCustomerId && resolvedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedEmail)) {
      const { data: cust } = await db.from('customers').select('email').eq('id', resolvedCustomerId).single()
      if (cust && !cust.email) {
        await db.from('customers').update({ email: resolvedEmail }).eq('id', resolvedCustomerId)
      }
    }

    let messageId: string | null = null

    if (channel === 'sms') {
      const formatted = formatPhone(to)
      const telnyxMsg = await sendSMS(formatted, body)
      messageId = telnyxMsg?.id || null
    } else if (channel === 'email') {
      const emailTo = resolvedEmail || to
      if (!emailTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
        return NextResponse.json({ error: `Invalid email address: "${emailTo}". Please provide a valid email.` }, { status: 400 })
      }
      await sendEmail({
        to: emailTo,
        subject: subject || `Message from ${settings?.shop_name || 'Alpha Auto'}`,
        html: `<div style="font-family:Arial,sans-serif;padding:20px;max-width:600px"><p>${body.replace(/\n/g,'<br>')}</p><hr><p style="color:#888;font-size:12px">${settings?.shop_name} | ${settings?.shop_phone}</p></div>`,
        apiKey: settings?.resend_api_key,
        from: settings?.from_email,
      })
    }

    // Log to DB
    const { data: msg } = await db.from('messages').insert({
      direction: 'outbound',
      channel: channel || 'sms',
      from_address: channel === 'sms' ? (settings?.telnyx_phone_number || process.env.TELNYX_PHONE_NUMBER) : (settings?.from_email || process.env.FROM_EMAIL),
      to_address: resolvedEmail || to,
      subject: subject || null,
      body,
      status: 'sent',
      customer_id: resolvedCustomerId,
      job_id: jobId || null,
      document_id: documentId || null,
      telnyx_message_id: messageId,
      read: true,
    }).select().single()

    return NextResponse.json({ ok: true, message: msg })
  } catch (e: unknown) {
    console.error('Send message error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}