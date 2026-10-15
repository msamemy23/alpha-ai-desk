import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { cleanDecisions, counts, findings, isStorageRef, normalizeSections, storageRefParts } from '@/lib/dvi'
import type { Finding } from '@/lib/dvi'
import { MEDIA_BUCKET, SIGNED_URL_SECONDS } from '@/lib/dvi-media'
import { loadSchedule } from '@/lib/schedule-store'

export const dynamic = 'force-dynamic'

/**
 * What a customer sees when they open the link in a text, and how they answer.
 * Open to anyone who has the link (the token is a random UUID). It returns only what the customer needs:
 * never the shop's id, the customer's id or phone, or the technician's notes to the shop.
 */
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ipOf = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'

async function load(token: string) {
  const sb = getServiceClient()
  const { data: row, error } = await sb.from('dvi').select('*').eq('share_token', token).maybeSingle()
  if (error || !row) return { sb, row: null as Record<string, unknown> | null }
  return { sb, row: row as Record<string, unknown> }
}

type Db = ReturnType<typeof getServiceClient>

/**
 * Photos and clips kept in storage are turned into short-lived viewing addresses. Only files in this inspection's own
 * folder are signed, so a link to one inspection can never open another one's files. A file that cannot be signed
 * (storage not set up yet) is simply left out; the page still shows everything else.
 */
async function publicFindings(sb: Db, inspectionId: string, list: Finding[]) {
  const wanted = new Set<string>()
  for (const f of list) {
    for (const p of f.photos) if (isStorageRef(p)) wanted.add(p)
    for (const c of f.clips) wanted.add(c.ref)
  }
  const urls = new Map<string, string>()
  const own = [...wanted].filter(r => storageRefParts(r)?.folder === inspectionId)
  if (own.length > 0) {
    const paths = own.map(r => (storageRefParts(r) as { path: string }).path)
    const { data, error } = await sb.storage.from(MEDIA_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
    if (!error && data) for (const item of data) {
      const ref = own.find(r => (storageRefParts(r) as { path: string }).path === item.path)
      if (ref && item.signedUrl) urls.set(ref, item.signedUrl)
    }
  }
  return list.map(f => ({
    ...f,
    photos: f.photos.map(p => (isStorageRef(p) ? urls.get(p) : p)).filter((p): p is string => typeof p === 'string'),
    clips: f.clips.flatMap(c => { const url = urls.get(c.ref); return url ? [{ kind: c.kind, secs: c.secs, url }] : [] }),
  }))
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || ''
  if (!TOKEN.test(token)) return reply({ ok: false, error: 'This link is not valid. Call the shop and they will send a new one.' }, 404)
  if (!checkRateLimit(`inspection-view:${ipOf(req)}`, 60, 60_000).ok) return reply({ ok: false, error: 'Too many tries. Wait a minute and try again.' }, 429)

  const { sb, row } = await load(token)
  if (!row) return reply({ ok: false, error: 'This link is not valid. Call the shop and they will send a new one.' }, 404)

  const shopId = String(row.shop_id || '')
  const { data: s } = await sb.from('settings').select('shop_name,shop_phone,shop_address').eq('shop_id', shopId).maybeSingle()
  let logo: string | null = null
  const lg = await sb.from('settings').select('logo_data').eq('shop_id', shopId).maybeSingle()
  if (!lg.error && typeof lg.data?.logo_data === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(lg.data.logo_data)) logo = lg.data.logo_data

  const sections = normalizeSections(row.sections)
  const list = findings(sections)
  const shown = await publicFindings(sb, String(row.id), list)
  const good = sections.flatMap(sec => sec.items.filter(i => i.status === 'green').map(i => i.name))
  // A "book this work" button, only when the shop has switched its booking page on.
  let book: string | null = null
  try { const sch = await loadSchedule(shopId); if (sch.online.enabled && sch.online.slug) book = sch.online.slug } catch { /* no booking page: no button */ }
  const decisions = cleanDecisions(row.customer_decisions, list.map(f => f.id))

  // First time opened: note it so the shop knows the customer has seen it. Never blocks the page.
  if (!row.viewed_at) void sb.from('dvi').update({ viewed_at: new Date().toISOString() }).eq('id', row.id as string).eq('shop_id', shopId).then(() => undefined, () => undefined)

  return reply({
    ok: true,
    shop: {
      name: typeof s?.shop_name === 'string' ? s.shop_name.trim() : '',
      phone: typeof s?.shop_phone === 'string' ? s.shop_phone.trim() : '',
      address: typeof s?.shop_address === 'string' ? s.shop_address.trim() : '',
      logo,
    },
    inspection: {
      customer: String(row.customer_name || ''),
      vehicle: String(row.vehicle || ''),
      date: String(row.created_at || ''),
      note: String(row.tech_notes || '').slice(0, 1000),
      findings: shown,
      good,
      checked: counts(sections).rated,
      decisions,
      decidedAt: typeof row.customer_decided_at === 'string' ? row.customer_decided_at : null,
    },
    book,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { token?: unknown; decisions?: unknown } | null
  const token = typeof body?.token === 'string' ? body.token : ''
  if (!TOKEN.test(token)) return reply({ ok: false, error: 'This link is not valid. Call the shop and they will send a new one.' }, 404)
  if (!checkRateLimit(`inspection-answer:${ipOf(req)}`, 20, 60_000).ok) return reply({ ok: false, error: 'Too many tries. Wait a minute and try again.' }, 429)

  const { sb, row } = await load(token)
  if (!row) return reply({ ok: false, error: 'This link is not valid. Call the shop and they will send a new one.' }, 404)

  const list = findings(normalizeSections(row.sections))
  const decisions = cleanDecisions(body?.decisions, list.map(f => f.id))
  if (Object.keys(decisions).length === 0) return reply({ ok: false, error: 'Choose approve or decline for at least one item.' }, 400)

  const { error } = await sb.from('dvi').update({
    customer_decisions: decisions,
    customer_decided_at: new Date().toISOString(),
    customer_approved: Object.values(decisions).includes('approved'),
  }).eq('id', row.id as string).eq('shop_id', row.shop_id as string)
  if (error) { console.error('[inspection/public] answer failed:', error.message); return reply({ ok: false, error: 'Your answers could not be saved. Please try again, or call the shop.' }, 500) }
  return reply({ ok: true, decisions })
}
