import { NextRequest, NextResponse } from 'next/server'
import { getRouteShop, hasInternalApiSecret, unauthorized } from '@/lib/api-auth'
import type { Db } from '@/lib/db-types'
import { runScheduled } from '@/lib/report-delivery'
import { mailerFor } from '@/lib/report-mail'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * The daily job that sends scheduled report emails for one shop. Only the server's own job may call it (it presents the shared
 * secret and names the shop). Safe to call as often as needed: each report and period is claimed once before anything is sent.
 */
export async function POST(req: NextRequest) {
  if (!hasInternalApiSecret(req)) return unauthorized()
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const shop = await getRouteShop(req, body.shopId)
  if (!shop) return NextResponse.json({ ok: false, error: 'Shop not found.' }, { status: 404 })
  const db = getServiceClient() as unknown as Db
  try {
    const out = await runScheduled({ db, shopId: shop.shopId, send: await mailerFor(db, shop.shopId), now: new Date() })
    if (!out.ok) return NextResponse.json({ ok: false, error: out.message }, { status: out.status })
    // A report that could not be sent is a result to look at, not a failure of the job itself.
    return NextResponse.json({ ok: true, sent: out.results.filter(r => r.action === 'sent').length, results: out.results })
  } catch (e) {
    console.error('[reports] scheduled run:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: false, error: 'The scheduled reports could not be run.' }, { status: 500 })
  }
}
