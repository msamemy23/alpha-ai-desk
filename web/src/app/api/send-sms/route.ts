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
    const { data: settings } = await db.from('settings').select('telnyx_phone_number').eq('shop_id', auth.shopId).limit(1).single()
    const fromNum = settings?.telnyx_phone_number || process.env.TELNYX_PHONE_NUMBER || '+17136636979'

    if (customerId) {
      const { data: customer } = await db.from('customers').select('id').eq('id', customerId).eq('shop_id', auth.shopId).maybeSingle()
      if (!customer) return apiFail('Customer not found', 404, 'NOT_FOUND')
    }

    const formatted = formatPhone(to)
    const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'sms', formatted, text.slice(0, 80)])
    const existing = sentSmsKeys.get(idempotencyKey)
    if (existing) {
      return apiOk({ message_id: existing.messageId, idempotent: true })
    }

    const result = await sendSMS(formatted, text) as Record<string,unknown>
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
