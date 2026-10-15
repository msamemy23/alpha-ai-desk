import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { normalizeRules } from '@/lib/timerules'
import { loadRules, saveRules } from '@/lib/timeclock-server'
import { audit } from '@/lib/people-audit'

export const dynamic = 'force-dynamic'

/** The pay week and overtime rules decide what people are paid, so only an owner or admin changes them. Everyone signed in can read them. */
const CAN_CHANGE = new Set(['owner', 'admin'])

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status })

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  try {
    const { rules, available } = await loadRules(getServiceClient(), auth.shopId)
    return NextResponse.json({ ok: true, rules, available, canChange: CAN_CHANGE.has(auth.role), role: auth.role })
  } catch (e) {
    console.error('[timeclock/rules] load:', e instanceof Error ? e.message : e)
    return fail(500, 'The pay rules could not be loaded.')
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  if (!CAN_CHANGE.has(auth.role)) return fail(403, 'Only an owner or admin can change the pay rules.')
  const raw = await req.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(400, 'Send the request as JSON.')
  const rules = normalizeRules(raw)
  // A two-week period needs a first day to count from, and it has to be a day the pay week can start on.
  if (rules.periodDays === 14 && !rules.periodAnchor) return fail(400, 'Pick the first day of a pay period to count two-week periods from.')
  try {
    const sb = getServiceClient()
    const before = await loadRules(sb, auth.shopId)
    const result = await saveRules(sb, auth.shopId, auth.userId, rules)
    if (result === 'unavailable') return fail(400, 'Pay rules need a database update. Ask whoever set up the app to apply it.', { code: 'rules_unavailable' })
    await audit(auth, 'timeclock.rules', { type: 'time_rules' }, { before: before.rules, after: rules })
    return NextResponse.json({ ok: true, rules })
  } catch (e) {
    console.error('[timeclock/rules] save:', e instanceof Error ? e.message : e)
    return fail(500, 'The pay rules could not be saved. Try again in a moment.')
  }
}
