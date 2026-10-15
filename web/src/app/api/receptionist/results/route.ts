export const dynamic = 'force-dynamic'
import { authed, ok } from '@/lib/receptionist-api'
import { errKind } from '@/lib/voice/store'
import { sinceIso, summarizeResults } from '@/lib/voice/results'
import type { ResultRow } from '@/lib/voice/results'

/** Plain counts of what the assistant did over the last 7, 30 or 90 days. */
export async function GET(req: Request) {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const days = Number(new URL(req.url).searchParams.get('days')) || 7
  const since = sinceIso(new Date(), days)
  const { data, error } = await db.from('ai_interactions')
    .select('channel,outcome,needs_person,needs_resolved_at,review,started_at')
    .eq('shop_id', auth.shopId).gte('started_at', since).order('started_at', { ascending: false }).limit(5000)
  if (error) return ok({ unavailable: errKind(error) === 'missing', failed: errKind(error) !== 'missing', days, counts: summarizeResults([]) })
  const counts = summarizeResults((data || []) as ResultRow[])
  return ok({ unavailable: false, failed: false, days: Math.min(90, Math.max(1, days)), counts, truncated: (data || []).length >= 5000 })
}
