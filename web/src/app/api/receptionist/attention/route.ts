export const dynamic = 'force-dynamic'
import { authed, ok } from '@/lib/receptionist-api'

/**
 * How many things are waiting for a person, for badges and the Today screen. Cheap: counts only, all four in parallel.
 * Missing tables simply count as zero, so this never breaks a page.
 */
export async function GET() {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const count = async (build: () => any): Promise<number> => {
    try {
      const { count: c, error } = await build()
      return error ? 0 : (c || 0)
    } catch { return 0 }
  }
  const sel = (table: string) => db.from(table).select('id', { count: 'exact', head: true }).eq('shop_id', auth.shopId)
  const [needsPerson, bookingRequests, unseenCalls, drafts] = await Promise.all([
    count(() => sel('ai_interactions').eq('needs_person', true).is('needs_resolved_at', null)),
    count(() => sel('ai_booking_requests').eq('status', 'pending')),
    count(() => sel('ai_interactions').eq('channel', 'call').is('seen_at', null).gte('started_at', new Date(Date.now() - 14 * 86_400_000).toISOString())),
    count(() => sel('ai_interactions').eq('outcome', 'draft').is('seen_at', null)),
  ])
  return ok({ needsPerson, bookingRequests, unseenCalls, drafts, total: needsPerson + bookingRequests + drafts })
}
