import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { sendSMS, formatPhone } from '@/lib/telnyx'
import { apiFail, apiOk, getIdempotencyKey, readJsonObject } from '@/lib/api-response'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { writeAuditLog } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'

const sentSmsKeys = new Map<string, { messageId?: unknown; createdAt: number }>()

function rememberSmsKey(key: string, messageId?: unknown) {
  const now = Date.now()
  for (const [existingKey, value] of sentSmsKeys) {
    if (now - value.createdAt > 10 * 60_000) sentSmsKeys.delete(existingKey)
  }
  sentSmsKeys.set(key, { messageId, createdAt: now })
}

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
    if (customerId) {
      const { data: customer, error: customerError } = await db.from('customers').select('id,sms_opted_out').eq('id', customerId).eq('shop_id', auth.shopId).maybeSingle()
      if (customerError) return apiFail('Customer could not be loaded', 500, 'INTERNAL_ERROR')
      if (!customer) return apiFail('Customer not found', 404, 'NOT_FOUND')
      if (customer.sms_opted_out) return apiFail('Customer has opted out of SMS', 409, 'CONFLICT')
    } else {
      // A phone-only request still has to honor the shop customer's opt-out.
      // Callers cannot bypass consent simply by omitting customer_id.
      const { data: phoneMatches, error: phoneError } = await db
        .from('customers')
        .select('id,sms_opted_out')
        .eq('shop_id', auth.shopId)
        .in('phone', [...new Set([to, formatted])])
        .limit(1)
      if (phoneError) return apiFail('Customer could not be loaded', 500, 'INTERNAL_ERROR')
      if (phoneMatches?.[0]?.sms_opted_out) return apiFail('Customer has opted out of SMS', 409, 'CONFLICT')
    }

    const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'sms', formatted, text.slice(0, 80)])
    const existing = sentSmsKeys.get(idempotencyKey)
    if (existing) {
      return apiOk({ message_id: existing.messageId, idempotent: true })
    }

    const result = await sendSMS(formatted, text, fromNum, { apiKey: settings.telnyx_api_key, messagingProfileId: settings.telnyx_messaging_profile_id || '', idempotencyKey }) as Record<string,unknown>
    rememberSmsKey(idempotencyKey, result?.id)

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

    await writeAuditLog({
      shopId: auth.shopId,
      userId: auth.userId,
      action: 'sms.send',
      targetType: 'message',
      targetId: typeof result?.id === 'string' ? result.id : undefined,
      permission: 'external',
      approved: true,
      idempotencyKey,
      metadata: { to: formatted, customerId, length: text.length },
    })

    return apiOk({ message_id: result?.id, idempotent: false })
  } catch (e) {
    console.error('send-sms error:', e)
    return apiFail((e as Error).message, 500, 'PROVIDER_ERROR')
  }
}
