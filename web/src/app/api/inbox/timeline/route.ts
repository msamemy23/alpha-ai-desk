export const dynamic = 'force-dynamic'
import { authed, fail, ok } from '@/lib/receptionist-api'
import { phoneKey } from '@/lib/voice/rules'
import { isThreadEvent, tidyEvents } from '@/lib/voice/timeline'
import type { DocEvent } from '@/lib/voice/timeline'

const isMissing = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(String(e.message || '')))

/**
 * What happened to this customer's estimates and invoices (sent, opened, approved, declined, paid), so the conversation can show
 * them next to the texts. Read only. If the history table is not there yet the thread simply shows texts.
 */
export async function GET(req: Request) {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const key = phoneKey(new URL(req.url).searchParams.get('key'))
  if (key.length < 7) return fail('Missing number.')

  const tail = key.slice(-4)
  const docs = await db.from('documents')
    .select('id,doc_number,type,customer_phone')
    .eq('shop_id', auth.shopId).ilike('customer_phone', `%${tail}%`)
    .order('created_at', { ascending: false }).limit(200)
  if (docs.error) return ok({ items: [], unavailable: isMissing(docs.error) })
  const mine = ((docs.data || []) as Array<{ id: string; doc_number: string | null; type: string | null; customer_phone: string | null }>)
    .filter(d => phoneKey(d.customer_phone) === key)
    .slice(0, 25)
  if (mine.length === 0) return ok({ items: [], unavailable: false })
  const byId = new Map(mine.map(d => [String(d.id), d]))

  const ev = await db.from('document_events')
    .select('id,document_id,doc_number,kind,summary,created_at')
    .eq('shop_id', auth.shopId).in('document_id', [...byId.keys()])
    .order('created_at', { ascending: false }).limit(150)
  if (ev.error) return ok({ items: [], unavailable: isMissing(ev.error) })

  const events: DocEvent[] = ((ev.data || []) as Array<Record<string, unknown>>)
    .filter(e => isThreadEvent(String(e.kind || '')))
    .map(e => {
      const doc = byId.get(String(e.document_id))
      return {
        id: String(e.id), document_id: String(e.document_id), doc_number: String(e.doc_number || doc?.doc_number || ''),
        doc_type: String(doc?.type || 'Invoice'), kind: String(e.kind), summary: String(e.summary || '').slice(0, 300), created_at: String(e.created_at),
      }
    })
  return ok({ items: tidyEvents(events), unavailable: false })
}
