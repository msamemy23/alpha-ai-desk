import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { missingSchema } from '@/lib/schema-missing'
import { toIcal } from '@/lib/schedule-ical'
import { addDaysYmd, nowIn } from '@/lib/schedule-capacity'
import { loadByIcalToken, loadShopInfo } from '@/lib/schedule-store'
import { ipOf, overLimit } from '@/lib/book-server'

export const dynamic = 'force-dynamic'

/**
 * The shop's schedule as a calendar feed to subscribe to from Google Calendar, Apple Calendar or Outlook.
 * The address holds a long random token; whoever has it can read the feed, so the owner can switch it off or reset it.
 * Customer phone numbers are never in the feed. 14 days back, 90 days ahead.
 */
const TOKEN = /^[A-Za-z0-9_-]{24,64}$/

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || ''
  const plain = (text: string, status: number) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } })
  if (!TOKEN.test(token)) return plain('This calendar link is not valid.', 404)
  if (await overLimit('book-ical', ipOf(req), 60, 10)) return plain('Too many requests.', 429)

  const shop = await loadByIcalToken(token)
  if (!shop) return plain('This calendar link is not valid.', 404)
  const info = await loadShopInfo(shop.shopId)
  const today = nowIn(info.timezone).ymd

  const sb = getServiceClient()
  const cols = 'id,customer_name,vehicle,service,tech,date,time,duration,status,notes'
  const res = await sb.from('appointments').select(cols).eq('shop_id', shop.shopId).gte('date', addDaysYmd(today, -14)).lte('date', addDaysYmd(today, 90)).order('date', { ascending: true }).limit(2000)
  if (res.error) return plain(missingSchema(res.error) ? 'The schedule is not set up yet.' : 'The schedule could not be loaded.', 500)

  const body = toIcal(info.name, (res.data || []).map(r => ({ ...(r as Record<string, unknown>), id: String(r.id), customer_name: String(r.customer_name || ''), date: String(r.date || '').slice(0, 10), time: String(r.time || '').slice(0, 5) })) as Parameters<typeof toIcal>[1])
  return new Response(body, { status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300', 'content-disposition': 'inline; filename="schedule.ics"' } })
}
