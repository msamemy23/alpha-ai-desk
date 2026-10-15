export const dynamic = 'force-dynamic'
import { authed, fail, isUuid, ok, readBody } from '@/lib/receptionist-api'
import { resolveNeedsPerson } from '@/lib/voice/actions'
import { patchInteraction } from '@/lib/voice/store'
import { phoneKey, phoneLikePattern } from '@/lib/voice/rules'

type Params = { params: Promise<{ id: string }> }

/** One conversation in full: the transcript or the texts, what the assistant captured, the rules it used, and its bookings. */
export async function GET(_req: Request, ctx: Params) {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const { id } = await ctx.params
  if (!isUuid(id)) return fail('Not found.', 404)
  const { data: row } = await db.from('ai_interactions').select('*').eq('shop_id', auth.shopId).eq('id', id).maybeSingle()
  if (!row) return fail('Not found.', 404)

  let transcript: Array<{ speaker: string; text: string }> = []
  let hasRecording = false
  let texts: Array<{ id: string; direction: string; body: string; created_at: string; ai_handled: boolean }> = []
  if (row.channel === 'call') {
    const { data: call } = await db.from('ai_calls').select('transcript,recording_url,summary').eq('shop_id', auth.shopId).eq('id', row.ref_id).maybeSingle()
    const t = Array.isArray(call?.transcript) ? call.transcript : []
    transcript = (t as Array<Record<string, unknown>>).filter(x => x && typeof x.text === 'string').slice(-120).map(x => ({ speaker: String(x.speaker || ''), text: String(x.text).slice(0, 800) }))
    hasRecording = Boolean(call?.recording_url)
  } else {
    const pat = phoneLikePattern(row.contact_phone || row.contact_key)
    const from = new Date(Date.parse(row.started_at) - 3_600_000).toISOString()
    const to = new Date((row.ended_at ? Date.parse(row.ended_at) : Date.parse(row.started_at)) + 12 * 3_600_000).toISOString()
    const [inb, outb] = await Promise.all([
      db.from('messages').select('id,direction,body,created_at,ai_handled').eq('shop_id', auth.shopId).ilike('from_address', pat).gte('created_at', from).lte('created_at', to).limit(60),
      db.from('messages').select('id,direction,body,created_at,ai_handled').eq('shop_id', auth.shopId).ilike('to_address', pat).gte('created_at', from).lte('created_at', to).limit(60),
    ])
    texts = [...(inb.data || []), ...(outb.data || [])]
      .sort((x: any, y: any) => String(x.created_at).localeCompare(String(y.created_at)))
      .filter((m: any, i: number, all: any[]) => all.findIndex(o => o.id === m.id) === i)
      .map((m: any) => ({ id: String(m.id), direction: String(m.direction), body: String(m.body || '').slice(0, 1000), created_at: String(m.created_at), ai_handled: m.ai_handled === true }))
  }
  const { data: bookings } = await db.from('ai_booking_requests').select('id,kind,status,preferred_text,slot_date,slot_time,vehicle,problem,customer_name,phone,appointment_id,created_at').eq('shop_id', auth.shopId).eq('interaction_id', id).limit(5)
  const { detail, ...rest } = row as Record<string, any>
  return ok({ interaction: { ...rest, draft: detail?.draft || null }, transcript, texts, hasRecording, bookings: bookings || [] })
}

/** Review (good or bad), mark seen, or mark "needs a person" as dealt with. */
export async function PATCH(req: Request, ctx: Params) {
  const a = await authed({ write: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const { id } = await ctx.params
  if (!isUuid(id)) return fail('Not found.', 404)
  const body = await readBody(req)
  if (!body) return fail('Nothing to change.')
  const { data: row } = await db.from('ai_interactions').select('id,contact_key').eq('shop_id', auth.shopId).eq('id', id).maybeSingle()
  if (!row) return fail('Not found.', 404)

  const now = new Date().toISOString()
  if (body.action === 'review') {
    const value = body.value === 'good' || body.value === 'bad' ? body.value : null
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : null
    const done = await patchInteraction(db, auth.shopId, id, { review: value, review_note: value ? note || null : null, reviewed_by: value ? auth.userId : null, reviewed_at: value ? now : null })
    return done ? ok({ review: value }) : fail('Could not save the review.', 500)
  }
  if (body.action === 'seen') {
    const done = await patchInteraction(db, auth.shopId, id, { seen_at: now })
    return done ? ok({}) : fail('Could not save.', 500)
  }
  if (body.action === 'resolve') {
    await patchInteraction(db, auth.shopId, id, { needs_resolved_at: now, seen_at: now })
    await resolveNeedsPerson(db, auth.shopId, phoneKey(row.contact_key), auth.userId)
    return ok({})
  }
  return fail('Unknown action.')
}
