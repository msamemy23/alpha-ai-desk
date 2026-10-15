import { canManageBooks } from '@/lib/books-store'
import { reminderCandidates } from '@/lib/ar-reminders'
import { loadShopFacts, todayKeyIn } from '@/lib/report-delivery'
import { loadDocs } from '@/lib/report-load'
import { jsonFail, jsonOk, routeCtx } from '@/lib/route-ctx'

export const dynamic = 'force-dynamic'

/**
 * Customers with an unpaid balance old enough to follow up on. Read only: this lists who and how much, and sends nothing.
 * It is the one place other parts of the app (an automation, a reminder screen) read from, so they all agree on who is owed.
 */
export async function GET() {
  const c = await routeCtx(canManageBooks)
  if (!c.ok) return c.response
  const { db, shopId } = c.ctx
  try {
    const facts = await loadShopFacts(db, shopId)
    const now = new Date()
    const { docs } = await loadDocs(db, shopId, now.toISOString())
    const todayKey = todayKeyIn(facts.timezone, now)
    return jsonOk({ todayKey, candidates: reminderCandidates(docs, todayKey) })
  } catch (e) {
    console.error('[reports] ar:', e instanceof Error ? e.message : e)
    return jsonFail(500, 'Who owes you could not be worked out. Nothing is wrong with your invoices. Try again.')
  }
}
