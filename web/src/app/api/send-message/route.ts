import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendSMS, formatPhone } from '@/lib/telnyx'
import { sendEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    const { to, body, channel, subject, customerId, jobId, documentId } = await req.json()

    if (!to || !body) return NextResponse.json({ error: 'Missing to or body' }, { status: 400 })

    const db = getServiceClient()
    const { data: settings } = await db.from('settings').select('*').limit(1).single()

    let messageId: string | null = null

    if (channel === 'sms') {
      const formatted = formatPhone(to)
      const telnyxMsg = await sendSMS(formatted, body)
      messageId = telnyxMsg?.id || null
    } else if (channel === 'email') {
      await sendEmail({
        to,
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
      to_address: to,
      subject: subject || null,
      body,
      status: 'sent',
      customer_id: customerId || null,
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
