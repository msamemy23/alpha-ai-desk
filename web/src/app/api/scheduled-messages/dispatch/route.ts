import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, hasInternalApiSecret, unauthorized } from '@/lib/api-auth'
import { sendEmail } from '@/lib/email'
import { sendSMS, formatPhone } from '@/lib/telnyx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type ScheduledMessage = {
  id: string
  shop_id: string
  customer_id?: string | null
  customer_name?: string | null
  channel: 'sms' | 'email'
  scheduled_for: string
  message_body?: string | null
  subject?: string | null
  status: string
  attempts?: number | null
  claimed_at?: string | null
  next_attempt_at?: string | null
  idempotency_key?: string | null
}

function isStaleClaim(claimedAt: string | null | undefined, now: number) {
  return !claimedAt || (now - new Date(claimedAt).getTime()) > 15 * 60 * 1000
}

export async function POST(req: NextRequest) {
  if (!hasInternalApiSecret(req)) return unauthorized()
  const db = getServiceClient()
  const now = new Date()
  const nowMs = now.getTime()
  const { data: rows, error } = await db
    .from('scheduled_messages')
    .select('*')
    .in('status', ['pending', 'failed', 'sending'])
    .lt('attempts', 3)
    .lte('scheduled_for', now.toISOString())
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now.toISOString()}`)
    .order('scheduled_for', { ascending: true })
    .limit(100)
  if (error) return NextResponse.json({ ok: false, error: 'Scheduled messages could not be loaded' }, { status: 500 })

  const due = (rows || []).filter((row: ScheduledMessage) =>
    (Number(row.attempts || 0) < 3) &&
    (!row.next_attempt_at || new Date(row.next_attempt_at).getTime() <= nowMs) &&
    (row.status !== 'sending' || isStaleClaim(row.claimed_at, nowMs))
  ) as ScheduledMessage[]
  const settingsCache = new Map<string, Record<string, unknown>>()
  let sent = 0
  let failed = 0
  let cancelled = 0
  const results: Array<Record<string, unknown>> = []

  for (const row of due) {
    if (!isStaleClaim(row.claimed_at, nowMs)) continue
    const idempotencyKey = row.idempotency_key || `scheduled-${row.id}`
    let claimQuery = db
      .from('scheduled_messages')
      .update({
        status: 'sending',
        claimed_at: now.toISOString(),
        attempts: Number(row.attempts || 0) + 1,
        idempotency_key: idempotencyKey,
        updated_at: now.toISOString(),
      })
      .eq('id', row.id)
      .eq('shop_id', row.shop_id)
    if (row.status === 'sending') {
      claimQuery = claimQuery.eq('status', 'sending').lt('claimed_at', new Date(nowMs - 15 * 60 * 1000).toISOString())
    } else {
      claimQuery = claimQuery.in('status', ['pending', 'failed'])
    }
    const { data: claimed, error: claimError } = await claimQuery.select('*').maybeSingle()
    if (claimError || !claimed) continue

    try {
      let customer: { id: string; phone?: string | null; email?: string | null; sms_opted_out?: boolean } | null = null
      if (row.customer_id) {
        const { data, error: customerError } = await db
          .from('customers')
          .select('id,phone,email,sms_opted_out')
          .eq('id', row.customer_id)
          .eq('shop_id', row.shop_id)
          .maybeSingle()
        if (customerError) throw new Error('Customer could not be loaded')
        customer = data
      }

      if (row.channel === 'sms' && customer?.sms_opted_out) {
        const { error: cancelError } = await db.from('scheduled_messages').update({
          status: 'cancelled', claimed_at: null, last_error: 'Customer has opted out of SMS', updated_at: new Date().toISOString(),
        }).eq('id', row.id).eq('shop_id', row.shop_id).eq('status', 'sending')
        if (cancelError) throw cancelError
        cancelled++
        results.push({ id: row.id, status: 'cancelled', reason: 'sms_opted_out' })
        continue
      }

      let settings = settingsCache.get(row.shop_id)
      if (!settings) {
        const { data, error: settingsError } = await db.from('settings').select('*').eq('shop_id', row.shop_id).maybeSingle()
        if (settingsError || !data) throw new Error('Shop messaging settings could not be loaded')
        settings = data as Record<string, unknown>
        settingsCache.set(row.shop_id, settings)
      }

      const body = String(row.message_body || '').trim()
      if (!body) throw new Error('Scheduled message body is empty')
      let providerId: string | null = null
      if (row.channel === 'sms') {
        const phone = customer?.phone || ''
        if (!phone) throw new Error('Customer has no phone number')
        const result = await sendSMS(formatPhone(phone), body, String(settings.telnyx_phone_number || ''), {
          apiKey: String(settings.telnyx_api_key || ''),
          messagingProfileId: String(settings.telnyx_messaging_profile_id || ''),
          idempotencyKey,
        })
        providerId = result?.id || null
      } else {
        const email = customer?.email || ''
        if (!email) throw new Error('Customer has no email address')
        if (!settings.resend_api_key || !settings.from_email) throw new Error('Email is not configured for this shop')
        await sendEmail({
          to: email,
          subject: String(row.subject || `Message from ${settings.shop_name || 'Your Auto Shop'}`),
          body,
          apiKey: String(settings.resend_api_key),
          from: String(settings.from_email),
          replyTo: String(settings.shop_email || ''),
          idempotencyKey,
        })
      }

      // Provider success is the point of no duplicate retry. The message log
      // is best-effort after delivery, while the scheduled row becomes sent.
      const { error: messageError } = await db.from('messages').insert({
        shop_id: row.shop_id,
        direction: 'outbound',
        channel: row.channel,
        from_address: row.channel === 'sms' ? String(settings.telnyx_phone_number || '') : String(settings.from_email || ''),
        to_address: row.channel === 'sms' ? String(customer?.phone || '') : String(customer?.email || ''),
        subject: row.subject || null,
        body,
        status: 'sent',
        customer_id: row.customer_id || null,
        telnyx_message_id: providerId,
        read: true,
      })
      const { error: sentError } = await db.from('scheduled_messages').update({
        status: 'sent', sent_at: new Date().toISOString(), claimed_at: null, next_attempt_at: null,
        last_error: messageError ? 'Delivered, but the message log could not be saved' : null,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id).eq('shop_id', row.shop_id).eq('status', 'sending')
      if (sentError) throw new Error('Message was delivered but its delivery state could not be saved')
      sent++
      results.push({ id: row.id, status: 'sent', logged: !messageError })
    } catch (error) {
      failed++
      const attempts = Number((claimed as ScheduledMessage).attempts || 1)
      const message = error instanceof Error ? error.message : 'Scheduled delivery failed'
      await db.from('scheduled_messages').update({
        status: 'failed',
        claimed_at: null,
        next_attempt_at: attempts < 3 ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null,
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', row.id).eq('shop_id', row.shop_id).eq('status', 'sending')
      results.push({ id: row.id, status: 'failed', error: message })
    }
  }

  return NextResponse.json({ ok: failed === 0, success: failed === 0, inspected: due.length, sent, failed, cancelled, results }, { status: failed === 0 ? 200 : 502 })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
