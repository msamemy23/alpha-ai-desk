import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { isKnownAutomation } from '@/lib/automation-catalog'
import { messageHistory, runHistory } from '@/lib/automation-service'

export const dynamic = 'force-dynamic'

const STATUSES = new Set(['queued', 'sent', 'failed', 'skipped', 'cancelled', 'unknown'])

// Readable history for the Automations screen: every message (who, what, when, outcome) and every run.
export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const q = req.nextUrl.searchParams
  const automationId = q.get('automation') || undefined
  if (automationId && !isKnownAutomation(automationId)) return NextResponse.json({ ok: false, error: 'Unknown automation' }, { status: 400 })
  const status = q.get('status') || undefined
  if (status && !STATUSES.has(status)) return NextResponse.json({ ok: false, error: 'Unknown status' }, { status: 400 })
  const campaignId = q.get('campaign') || undefined
  if (campaignId && !/^[0-9a-f-]{36}$/i.test(campaignId)) return NextResponse.json({ ok: false, error: 'Unknown promotion' }, { status: 400 })
  const limit = Math.min(Math.max(Number(q.get('limit')) || 50, 1), 200)
  const sb = getServiceClient()
  try {
    if (q.get('kind') === 'runs') {
      return NextResponse.json({ ok: true, runs: await runHistory(sb, auth.shopId, { automationId, limit }) })
    }
    const history = await messageHistory(sb, auth.shopId, { automationId, campaignId, status, limit, before: q.get('before') || undefined, tests: q.get('tests') === '1' })
    return NextResponse.json({ ok: true, available: history.available, messages: history.rows, next: history.next })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'The history could not be loaded.' }, { status: 500 })
  }
}
