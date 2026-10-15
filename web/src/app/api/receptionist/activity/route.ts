export const dynamic = 'force-dynamic'
import { authed, ok } from '@/lib/receptionist-api'
import { errKind } from '@/lib/voice/store'

const LIST_COLUMNS = 'id,channel,ref_id,contact_key,contact_phone,contact_name,customer_id,started_at,ended_at,outcome,needs_person,needs_reason,needs_resolved_at,summary,captured,rules_fired,review,seen_at,detail'

/** The assistant's recent calls and text conversations, newest first, with a filter. */
export async function GET(req: Request) {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const q = new URL(req.url).searchParams
  const filter = q.get('filter') || 'all'
  const days = Math.min(90, Math.max(1, Number(q.get('days')) || 30))
  const limit = Math.min(100, Math.max(1, Number(q.get('limit')) || 40))
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  let query = db.from('ai_interactions').select(LIST_COLUMNS).eq('shop_id', auth.shopId).gte('started_at', since)
  if (filter === 'needs') query = query.eq('needs_person', true).is('needs_resolved_at', null)
  else if (filter === 'calls') query = query.eq('channel', 'call')
  else if (filter === 'texts') query = query.eq('channel', 'sms')
  else if (filter === 'booked') query = query.in('outcome', ['booked', 'booking_requested'])
  else if (filter === 'unreviewed') query = query.is('review', null).not('outcome', 'in', '(spam,silent,opt_out)')
  else if (filter === 'bad') query = query.eq('review', 'bad')
  const { data, error } = await query.order('started_at', { ascending: false }).limit(limit)
  if (error) return ok({ unavailable: errKind(error) === 'missing', failed: errKind(error) !== 'missing', items: [] })

  const items = ((data || []) as Array<Record<string, any>>).map(r => {
    const { detail, ...rest } = r
    return { ...rest, draft: detail?.draft && typeof detail.draft.text === 'string' ? { text: String(detail.draft.text).slice(0, 600), at: String(detail.draft.at || '') } : null, last_inbound: typeof detail?.last_inbound === 'string' ? detail.last_inbound : '' }
  })
  return ok({ unavailable: false, failed: false, items })
}
