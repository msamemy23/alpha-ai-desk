import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { carWords, customerPromiseText, publicStatusOf, PARTS_WORD, flowFrom } from '@/lib/jobflow'
import type { PartsStatus } from '@/lib/jobflow'
import { nowIn } from '@/lib/schedule-capacity'
import { loadShopInfo } from '@/lib/schedule-store'
import { overLimit } from '@/lib/book-server'

export const dynamic = 'force-dynamic'

/**
 * What a customer sees when they open the status link the shop texted them.
 * Open to anyone holding the link (a long random token). The answer is deliberately small: the shop's name and phone,
 * the car by year, make and model, a plain status, the promised time, an optional line the shop wrote for the customer,
 * and a link to their inspection if one was sent. Never: ids, plate, VIN, prices, notes, or other customers.
 */
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const TOKEN = /^[A-Za-z0-9_-]{20,40}$/
const NOT_FOUND = 'This link is not valid. Call the shop and they will send a new one.'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || ''
  if (!TOKEN.test(token)) return reply({ ok: false, error: NOT_FOUND }, 404)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  if (await overLimit('status-view', ip, 120, 10)) return reply({ ok: false, error: 'Too many tries. Wait a few minutes and try again.' }, 429)

  const sb = getServiceClient()
  const { data: fr, error } = await sb.from('job_flow').select('job_id,shop_id,parts,parts_eta,promise_time,public_note,status_token,version').eq('status_token', token).maybeSingle()
  if (error || !fr) return reply({ ok: false, error: NOT_FOUND }, 404)
  const shopId = String(fr.shop_id)
  const { data: job } = await sb.from('jobs').select('*').eq('id', fr.job_id).eq('shop_id', shopId).maybeSingle()
  if (!job) return reply({ ok: false, error: NOT_FOUND }, 404)

  const info = await loadShopInfo(shopId)
  const flow = flowFrom(fr as Record<string, unknown>)
  const status = String((job as Record<string, unknown>).status || '')
  const pub = publicStatusOf(status, flow.parts)
  const finished = pub.step === 'ready' || pub.step === 'done'
  const when = customerPromiseText({ date: ((job as Record<string, unknown>).promise_date as string | null) ?? null, time: flow.promise_time, finished, now: nowIn(info.timezone) })

  // The inspection link, only when the shop has actually sent that inspection to the customer.
  let inspection: string | null = null
  const dvi = await sb.from('dvi').select('share_token,sent_to_customer').eq('job_id', fr.job_id).eq('shop_id', shopId).not('share_token', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!dvi.error && dvi.data?.sent_to_customer === true && typeof dvi.data.share_token === 'string') inspection = dvi.data.share_token

  let logo: string | null = null
  const lg = await sb.from('settings').select('logo_data').eq('shop_id', shopId).maybeSingle()
  if (!lg.error && typeof lg.data?.logo_data === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(lg.data.logo_data)) logo = lg.data.logo_data

  const j = job as Record<string, unknown>
  return reply({
    ok: true,
    shop: { name: info.name, phone: info.phone, address: info.address, logo },
    car: carWords(j),
    first: String(j.customer_name || '').replace(/^\s*walk-?\s?in\s*[:-]\s*/i, '').trim().split(/\s+/)[0] || '',
    step: pub.step,
    headline: pub.headline,
    detail: pub.detail,
    waiting: pub.waiting,
    parts: pub.waiting === 'parts' && flow.parts !== 'none' ? { word: PARTS_WORD[flow.parts as PartsStatus], eta: flow.parts_eta } : null,
    promise: when,
    note: flow.public_note,
    updated: typeof j.updated_at === 'string' ? j.updated_at : null,
    inspection,
  })
}
