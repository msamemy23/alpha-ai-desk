import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkCallContext, loadCallContext, loadCallShop, resolveCall } from '@/lib/ai-call-server'
import { POST as placeCall } from '@/app/api/make-call/route'

export const dynamic = 'force-dynamic'

/**
 * The owner approved a call on the review card. The instruction is rebuilt here from the choices on the card, never taken
 * from the browser, the customer and the rules are checked again, and then the call goes out through the same durable path
 * as every other call (one approval is one call, and the approval is written to the audit trail).
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (body?.confirm !== true) return NextResponse.json({ ok: false, error: 'Approve the call on the review card first. Nothing was dialled.' }, { status: 400 })
    const key = (req.headers.get('idempotency-key') || '').trim()
    if (!key) return NextResponse.json({ ok: false, error: 'This approval has no request key, so nothing was dialled. Reload and try again.' }, { status: 400 })

    const db = getServiceClient()
    const shop = await loadCallShop(db, auth.shopId)
    const resolved = await resolveCall(db, auth.shopId, shop, body)
    if (!resolved.ok) return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status })
    const { customer, plan } = resolved
    if (!plan.ok) return NextResponse.json({ ok: false, error: plan.problems.join(' ') || 'The call is not ready to approve.' }, { status: 400 })

    const ctx = await loadCallContext(db, auth.shopId, customer.phone, shop)
    const check = checkCallContext(ctx, customer.phone)
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: check.reason, code: check.code, retry_at: check.retryAt ? check.retryAt.toISOString() : null }, { status: check.status })
    }

    const headers = new Headers(req.headers)
    headers.delete('content-length')
    headers.set('content-type', 'application/json')
    const forwarded = new NextRequest(new URL('/api/make-call', req.url), {
      method: 'POST',
      headers,
      body: JSON.stringify({ to: customer.phone, task: plan.task, name: customer.name || undefined, callerName: customer.name || undefined }),
    })
    return await placeCall(forwarded)
  } catch (error) {
    console.error('[ai-call/start] error:', error)
    return NextResponse.json({ ok: false, error: 'The call could not be started. Check Alpha’s calls on this customer before trying again.', uncertain: true }, { status: 500 })
  }
}
