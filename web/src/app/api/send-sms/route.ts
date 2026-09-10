import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { sendSMS, formatPhone } from '@/lib/telnyx'
import { apiFail, apiOk, getIdempotencyKey, readJsonObject } from '@/lib/api-response'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { writeAuditLog } from '@/lib/audit-log'
import { normalizePhoneDigits } from '@/lib/sms-normalize'
import { isSmsOptedOut } from '@/lib/sms-consent'

export const dynamic = 'force-dynamic'

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  return NextResponse.json({ ok: true, route: 'send-sms' })
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const limited = checkRateLimit(rateLimitKey('send-sms', auth.userId, auth.shopId, ip), 20, 60_000)
    if (!limited.ok) return apiFail('Too many SMS requests', 429, 'RATE_LIMITED', { resetAt: limited.resetAt })

    const parsed = await readJsonObject(req)
    if (!parsed.ok) return apiFail(parsed.error, 400, 'BAD_REQUEST')
    const body = parsed.body
    const to = typeof body.to === 'string' ? body.to.trim() : ''
    const text = typeof body.message === 'string' ? body.message.trim() : typeof body.body === 'string' ? body.body.trim() : ''
    const customerId = typeof body.customer_id === 'string' ? body.customer_id : typeof body.customerId === 'string' ? body.customerId : null

    if (!to || !text) {
      return apiFail('Missing to or message', 400, 'BAD_REQUEST')
    }

    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('telnyx_api_key,telnyx_phone_number,telnyx_messaging_profile_id').eq('shop_id', auth.shopId).limit(1).maybeSingle()
    if (settingsError) return apiFail('Shop messaging settings could not be loaded', 500, 'CONFIG_ERROR')
    const fromNum = settings?.telnyx_phone_number || ''
    if (!settings?.telnyx_api_key || !fromNum) return apiFail('Telnyx SMS is not configured for this shop', 503, 'NOT_CONFIGURED')

    const formatted = formatPhone(to)
    if (await isSmsOptedOut(db, auth.shopId, formatted)) {
      return apiFail('This destination has opted out of SMS', 409, 'CONFLICT')
    }
    if (customerId) {
      const { data: customer, error: customerError } = await db.from('customers').select('id,phone,sms_opted_out').eq('id', customerId).eq('shop_id', auth.shopId).maybeSingle()
      if (customerError) return apiFail('Customer could not be loaded', 500, 'INTERNAL_ERROR')
      if (!customer) return apiFail('Customer not found', 404, 'NOT_FOUND')
      if (customer.sms_opted_out) return apiFail('Customer has opted out of SMS', 409, 'CONFLICT')
      if (customer.phone && normalizePhoneDigits(customer.phone) !== normalizePhoneDigits(to)) {
        return apiFail('The recipient phone does not match the selected customer', 409, 'CONFLICT')
      }
    }

    // Only a caller-supplied key is reusable. Without one, each deliberate
    // send gets a unique durable operation; retries must opt into idempotency.
    const suppliedKey = getIdempotencyKey(req, [])
    const payloadHash = createHash('sha256').update(JSON.stringify({
      channel: 'sms',
      to: formatted,
      from: fromNum,
      customerId,
      body: text,
    })).digest('hex')
    const operationKey = suppliedKey
      ? `sms:${createHash('sha256').update(suppliedKey).digest('hex')}`
      : `sms:${randomUUID()}`
    const { data: claimed, error: claimError } = await db.rpc('claim_sms_send_operation', {
      p_shop_id: auth.shopId,
      p_channel: 'sms',
      p_operation_key: operationKey,
      p_payload_hash: payloadHash,
      p_to_number: formatted,
      p_customer_id: customerId,
      p_body: text,
    })
    if (claimError) return apiFail('SMS operation could not be claimed', 503, 'PROVIDER_ERROR')
    const claim = (claimed || {}) as { status?: string; operation_id?: string; provider_message_id?: string; last_error?: string }
    if (claim.status === 'sent') {
      return apiOk({ message_id: claim.provider_message_id || null, idempotent: true })
    }
    if (claim.status === 'in_progress') {
      return apiFail('This SMS operation is already in progress', 409, 'CONFLICT')
    }
    if (claim.status === 'unknown') {
      return apiFail('This SMS provider result is uncertain; reconcile it before retrying', 409, 'CONFLICT')
    }
    if (claim.status === 'failed') {
      return apiFail('This SMS operation has exhausted its retries', 409, 'CONFLICT')
    }

    let providerAccepted = false
    try {
      const result = await sendSMS(formatted, text, fromNum, {
        apiKey: settings.telnyx_api_key,
        messagingProfileId: settings.telnyx_messaging_profile_id || '',
        idempotencyKey: operationKey,
      }) as Record<string,unknown>
      providerAccepted = true

      const { data: savedOperation, error: operationUpdateError } = await db
        .from('message_send_operations')
        .update({
          status: 'sent',
          provider_message_id: typeof result?.id === 'string' ? result.id : null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('shop_id', auth.shopId)
        .eq('channel', 'sms')
        .eq('operation_key', operationKey)
        .eq('status', 'sending')
        .select('id')
        .maybeSingle()
      if (operationUpdateError || !savedOperation) {
        await db.from('message_send_operations').update({
          status: 'unknown',
          last_error: 'Provider accepted the SMS, but the final operation state could not be saved',
          updated_at: new Date().toISOString(),
        }).eq('shop_id', auth.shopId).eq('channel', 'sms').eq('operation_key', operationKey).eq('status', 'sending')
        return apiFail('SMS was accepted by the provider, but its final state could not be saved; do not retry automatically', 502, 'PROVIDER_ERROR')
      }

      try {
        await db.from('messages').insert({
          shop_id: auth.shopId,
          direction: 'outbound',
          channel: 'sms',
          from_address: fromNum,
          to_address: formatted,
          body: text,
          status: 'sent',
          customer_id: customerId,
          read: true,
          telnyx_message_id: (result?.id as string) || null,
          ai_handled: false,
        })
      } catch { /* logging should not mask a successful provider send */ }

      try {
        await writeAuditLog({
          shopId: auth.shopId,
          userId: auth.userId,
          action: 'sms.send',
          targetType: 'message',
          targetId: typeof result?.id === 'string' ? result.id : undefined,
          permission: 'external',
          approved: true,
          idempotencyKey: operationKey,
          metadata: { to: formatted, customerId, length: text.length },
        })
      } catch { /* observability failure must not turn a sent SMS into a retry */ }

      return apiOk({ message_id: result?.id, idempotent: false })
    } catch (e) {
      if (!providerAccepted) {
        await db.from('message_send_operations').update({
          status: 'unknown',
          last_error: (e instanceof Error ? e.message : 'SMS provider result is uncertain').slice(0, 500),
          updated_at: new Date().toISOString(),
        }).eq('shop_id', auth.shopId).eq('channel', 'sms').eq('operation_key', operationKey).eq('status', 'sending')
      }
      throw e
    }
  } catch (e) {
    console.error('send-sms error:', e)
    return apiFail((e as Error).message, 500, 'PROVIDER_ERROR')
  }
}
