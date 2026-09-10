export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { sendSMS, formatPhone } from '@/lib/telnyx'
import { sendEmail } from '@/lib/email'
import { getIdempotencyKey } from '@/lib/api-response'

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const payload = await req.json().catch(() => null)
    const { to, body, channel, subject, customerId: rawCustomerId, jobId, documentId, customerName } = payload || {}
    if (typeof to !== 'string' || !to.trim() || typeof body !== 'string' || !body.trim()) return NextResponse.json({ error: 'Missing to or body' }, { status: 400 })
    if (!['sms', 'email'].includes(channel)) return NextResponse.json({ error: 'Channel must be sms or email' }, { status: 400 })
    if (body.length > 10000) return NextResponse.json({ error: 'Message is too long' }, { status: 400 })
    const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))

    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) return NextResponse.json({ error: 'Shop settings could not be loaded' }, { status: 500 })
    if (jobId) {
      const { data: job } = await db.from('jobs').select('id').eq('id', jobId).eq('shop_id', auth.shopId).maybeSingle()
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (documentId) {
      const { data: document } = await db.from('documents').select('id').eq('id', documentId).eq('shop_id', auth.shopId).maybeSingle()
      if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Resolve customerId - if not provided but customerName is, search by name
    let resolvedCustomerId: string | null = rawCustomerId || null
    let resolvedEmail = channel === 'email' ? to : null
    let smsOptedOut = false
    const formattedPhone = formatPhone(to)

    if (resolvedCustomerId) {
      const { data: allowedCustomer, error: customerError } = await db
        .from('customers')
        .select('id,email,sms_opted_out')
        .eq('id', resolvedCustomerId)
        .eq('shop_id', auth.shopId)
        .maybeSingle()
      if (customerError) return NextResponse.json({ error: 'Customer could not be loaded' }, { status: 500 })
      if (!allowedCustomer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
      if (!resolvedEmail && allowedCustomer.email) resolvedEmail = allowedCustomer.email
      smsOptedOut = allowedCustomer.sms_opted_out === true
    }

    if (!resolvedCustomerId && customerName) {
      const { data: found } = await db
        .from('customers')
        .select('id, email, sms_opted_out')
        .eq('shop_id', auth.shopId)
        .ilike('name', `%${customerName}%`)
        .limit(1)
        .maybeSingle()
      if (found) {
        resolvedCustomerId = found.id
        if (!resolvedEmail && found.email) resolvedEmail = found.email
        smsOptedOut = found.sms_opted_out === true
      }
    }

    if (!resolvedCustomerId && channel === 'sms') {
      const { data: phoneMatches, error: phoneError } = await db
        .from('customers')
        .select('id,email,sms_opted_out')
        .eq('shop_id', auth.shopId)
        .in('phone', [...new Set([to, formattedPhone])])
        .limit(1)
      if (phoneError) return NextResponse.json({ error: 'Customer could not be loaded' }, { status: 500 })
      const phoneCustomer = phoneMatches?.[0]
      if (phoneCustomer) {
        resolvedCustomerId = phoneCustomer.id
        if (!resolvedEmail && phoneCustomer.email) resolvedEmail = phoneCustomer.email
        smsOptedOut = phoneCustomer.sms_opted_out === true
      }
    }

    // If we have a customerId and an email, save the email to the customer record if they don't have one
    if (resolvedCustomerId && resolvedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolvedEmail)) {
      const { data: cust } = await db
        .from('customers')
        .select('email,sms_opted_out')
        .eq('id', resolvedCustomerId)
        .eq('shop_id', auth.shopId)
        .single()
      if (cust && !cust.email) {
        await db.from('customers').update({ email: resolvedEmail }).eq('id', resolvedCustomerId).eq('shop_id', auth.shopId)
      }
      smsOptedOut = smsOptedOut || cust?.sms_opted_out === true
    }

    let messageId: string | null = null

    if (channel === 'sms') {
      if (smsOptedOut) return NextResponse.json({ error: 'Customer has opted out of SMS' }, { status: 409 })
      const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'send-message', channel, resolvedCustomerId || formattedPhone, body.slice(0, 80)])
      const telnyxMsg = await sendSMS(formattedPhone, body, settings?.telnyx_phone_number || '', {
        apiKey: settings?.telnyx_api_key || '',
        messagingProfileId: settings?.telnyx_messaging_profile_id || '',
        idempotencyKey,
      })
      messageId = telnyxMsg?.id || null
    } else if (channel === 'email') {
      const emailTo = resolvedEmail || to
      if (!emailTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) {
        return NextResponse.json({ error: `Invalid email address: "${emailTo}". Please provide a valid email.` }, { status: 400 })
      }
      await sendEmail({
        to: emailTo,
        subject: subject || `Message from ${settings?.shop_name || 'Your Auto Shop'}`,
        html: `<div style="font-family:Arial,sans-serif;padding:20px;max-width:600px"><p>${escapeHtml(body).replace(/\n/g,'<br>')}</p><hr><p style="color:#888;font-size:12px">${escapeHtml(String(settings?.shop_name || ''))} | ${escapeHtml(String(settings?.shop_phone || ''))}</p></div>`,
        apiKey: settings?.resend_api_key,
        from: settings?.from_email,
        idempotencyKey: getIdempotencyKey(req, [auth.shopId, 'send-message', channel, resolvedCustomerId || emailTo, body.slice(0, 80)]),
      })
    }

    // Log to DB
    const { data: msg, error: messageError } = await db.from('messages').insert({
      shop_id: auth.shopId,
      direction: 'outbound',
      channel: channel || 'sms',
      from_address: channel === 'sms' ? String(settings?.telnyx_phone_number || '') : String(settings?.from_email || ''),
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
    if (messageError) throw messageError

    return NextResponse.json({ ok: true, message: msg })
  } catch (e: unknown) {
    console.error('Send message error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
