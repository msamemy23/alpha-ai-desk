import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { callingHoursWords, prettyPhone } from '@/lib/ai-call'
import { checkCallContext, loadCallContext, loadCallShop, resolveCall } from '@/lib/ai-call-server'

export const dynamic = 'force-dynamic'

/**
 * The review card for a call Alpha would place. Nothing is dialled here. It answers, in plain words: who would be called,
 * what the customer would hear, what Alpha will and will not do, and whether the call may be placed right now.
 * The same checks run again on the server when the owner approves, so this answer is a preview and never the permission.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const db = getServiceClient()
    const shop = await loadCallShop(db, auth.shopId)

    const resolved = await resolveCall(db, auth.shopId, shop, body)
    if (!resolved.ok) return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status })
    const { customer, plan } = resolved
    const ctx = await loadCallContext(db, auth.shopId, customer.phone, shop)
    const check = checkCallContext(ctx, customer.phone)

    return NextResponse.json({
      ok: true,
      customer: { id: customer.id, name: customer.name, phone: customer.phone, phone_pretty: prettyPhone(customer.phone) },
      hours: callingHoursWords(shop.rules),
      plan: { ok: plan.ok, problems: plan.problems, disclosure: plan.disclosure, goals: plan.goals, limits: plan.limits },
      check: { ok: check.ok, code: check.code, reason: check.reason, retry_at: check.retryAt ? check.retryAt.toISOString() : null },
    })
  } catch (error) {
    console.error('[ai-call/preview] error:', error)
    return NextResponse.json({ ok: false, error: 'The call could not be checked. Nothing was dialled.' }, { status: 500 })
  }
}
