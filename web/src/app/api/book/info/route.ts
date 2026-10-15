import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { cleanDecisions, findings, normalizeSections } from '@/lib/dvi'
import { publicView, SLUG } from '@/lib/booking'
import { issueFormToken } from '@/lib/booking-token'
import { loadBySlug, loadShopInfo } from '@/lib/schedule-store'
import { nowIn } from '@/lib/schedule-capacity'
import { bookingSecret, ipOf, json, overLimit } from '@/lib/book-server'

export const dynamic = 'force-dynamic'

/**
 * What the public booking page needs to draw itself: the shop's name and phone, its hours, the services it offers,
 * and a signed form token. Nothing about technicians, bays, limits, or other customers.
 * `r` is an optional inspection link token: the page then offers that car's declined or unanswered work as extra things to add.
 */
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GONE = 'This booking page is not available. Please call the shop.'

export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get('slug') || '').toLowerCase()
  if (!SLUG.test(slug)) return json({ ok: false, error: GONE }, 404)
  if (await overLimit('book-info', ipOf(req), 90, 10)) return json({ ok: false, error: 'Too many tries. Wait a few minutes and try again.' }, 429)
  const secret = bookingSecret()
  if (!secret) return json({ ok: false, error: GONE }, 503)

  const shop = await loadBySlug(slug)
  if (!shop) return json({ ok: false, error: GONE }, 404)
  const info = await loadShopInfo(shop.shopId)

  let suggested: { id: string; name: string }[] = []
  const r = req.nextUrl.searchParams.get('r') || ''
  if (TOKEN.test(r)) {
    const { data: row } = await getServiceClient().from('dvi').select('sections,customer_decisions').eq('share_token', r).eq('shop_id', shop.shopId).maybeSingle()
    if (row) {
      const list = findings(normalizeSections(row.sections))
      const decided = cleanDecisions(row.customer_decisions, list.map(f => f.id))
      suggested = list.filter(f => decided[f.id] !== 'approved').slice(0, 8).map(f => ({ id: f.id, name: f.name }))
    }
  }

  return json({
    ok: true,
    shop: publicView({ name: info.name, phone: info.phone }, shop.capacity, shop.online),
    today: nowIn(info.timezone).ymd,
    token: issueFormToken(slug, secret),
    suggested,
    leadHours: shop.online.leadHours,
  })
}
