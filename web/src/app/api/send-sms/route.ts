import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { formatPhone } from '@/lib/telnyx'
import { apiFail, apiOk, readJsonObject } from '@/lib/api-response'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { normalizePhoneDigits } from '@/lib/sms-normalize'
import { isSmsOptedOut } from '@/lib/sms-consent'
import { sendDurableSms } from '@/lib/durable-sms'

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
    if (auth.role === 'viewer') return forbidden()

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

    // The caller's Idempotency-Key is the only reusable SMS operation identity;
    // sendDurableSms owns the claim_sms_send_operation -> provider -> message
    // record -> writeAuditLog transaction boundary for this route.
    const result = await sendDurableSms({
      request: req,
      db,
      shopId: auth.shopId,
      userId: auth.userId,
      to: formatted,
      text,
      customerId,
      settings,
    })
    if (!result.ok) return apiFail(result.error, result.status, result.uncertain ? 'PROVIDER_ERROR' : 'CONFLICT')
    return apiOk({
      message_id: result.messageId,
      idempotent: result.idempotent,
      message_record_saved: result.messageRecordSaved,
      audit_pending: result.auditPending || false,
      ...(result.auditError ? { audit_error: result.auditError } : {}),
    })
  } catch (e) {
    console.error('send-sms error:', e)
    return apiFail((e as Error).message, 500, 'PROVIDER_ERROR')
  }
}
