export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { NeedsDatabaseUpdate } from '@/lib/automation-store'
import { engineDeps } from '@/lib/automation-service'
import { createPromotionStore } from '@/lib/growth-promotions-store'
import { cleanInput, createPromotion, sendPromotion } from '@/lib/growth-promotions'
import { legacyOutreachMessage } from '@/lib/growth-text'

export const maxDuration = 60

// The older one-tap "text customers who have not been in" call. It is now a promotion like any other, so it goes
// through the same checks: STOP is honoured right before each text, nothing goes out during quiet hours, nobody gets
// more than the marketing limit, and every message is written down in the history. It texts only. Email campaigns
// are written and sent from Get more customers, where the owner reads the exact message first.

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status })
const WRITERS = new Set(['owner', 'admin', 'manager'])

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (!WRITERS.has(auth.role)) return forbidden()

    const body = await req.json().catch(() => ({})) as { type?: unknown; filter?: { daysSinceLastVisit?: unknown }; template?: unknown; channel?: unknown }
    if (body.channel && body.channel !== 'sms') {
      return json({ ok: false, error: 'Email campaigns are sent from Get more customers, where you read the exact message first. This only sends texts.' }, 400)
    }
    const days = Math.min(Math.max(Math.floor(Number(body.filter?.daysSinceLastVisit) || 90), 7), 1095)
    const limit = checkRateLimit(`outreach:${auth.shopId}`, 3, 10 * 60_000)
    if (!limit.ok) return json({ ok: false, error: 'Slow down for a minute, then try again.' }, 429)

    const message = legacyOutreachMessage(typeof body.template === 'string' ? body.template : '')
    const parsed = cleanInput({ name: `Win-back, not in ${days}+ days`, message, email_subject: '', audience: { lastVisitMinDays: days } })
    if (!parsed.ok) return json({ ok: false, error: parsed.errors[0] }, 400)

    const sb = getServiceClient()
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin)
    const store = createPromotionStore(sb)
    const created = await createPromotion(store, auth.shopId, auth.userId, parsed.value)
    const out = await sendPromotion(engineDeps(sb, baseUrl), store, auth.shopId, created.id)
    if (!out.ok) return json({ ok: false, error: out.error, code: out.code }, out.status)
    // `sent` and `total` keep their old meaning for any screen still reading them.
    return json({ ok: true, success: true, sent: out.sent, total: out.queued + out.left_out, queued: out.queued, left_out: out.left_out, waiting: out.waiting, errors: [], promotion_id: created.id, message: out.message })
  } catch (error) {
    if (error instanceof NeedsDatabaseUpdate) return json({ ok: false, error: 'Sending needs a database update first. Ask your developer to apply it.', needs_database_update: true }, 409)
    console.error('[outreach]', error instanceof Error ? error.message : error)
    return json({ ok: false, error: 'Something went wrong. Nothing was sent twice. Try again.' }, 500)
  }
}
