import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { missingSchema } from '@/lib/schema-missing'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { cleanPatch, flowFrom } from '@/lib/jobflow'
import type { JobFlow } from '@/lib/jobflow'

export const dynamic = 'force-dynamic'

/**
 * The extras on a repair order that the shop board shows: parts status, labels, hours, the promised time, a note for the
 * customer, and the customer's status link. Kept in their own table so a repair order itself is never touched.
 *
 *   GET                                 every extra for the shop's open and recent cars
 *   PATCH  { job_id, base_version, patch }   change fields. base_version is the version you last saw; if somebody else
 *                                       saved since, nothing is written and the newest copy comes back (409)
 *   POST   { action: 'link' | 'revoke' | 'ready-text', job_id }
 *
 * Until migration 051 is applied: GET answers { available: false } and writes answer 409 with a plain sentence.
 */
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLS = 'job_id,parts,parts_note,parts_eta,labels,est_hours,promise_time,public_note,status_token,ready_text_at,version,updated_at'
const NEEDS_UPDATE = 'These board details need a database update before they can be saved.'

async function ownJob(shopId: string, jobId: string): Promise<boolean> {
  const { data } = await getServiceClient().from('jobs').select('id').eq('id', jobId).eq('shop_id', shopId).maybeSingle()
  return Boolean(data)
}

async function current(shopId: string, jobId: string) {
  return getServiceClient().from('job_flow').select(COLS).eq('job_id', jobId).eq('shop_id', shopId).maybeSingle()
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const { data, error } = await getServiceClient().from('job_flow').select(COLS).eq('shop_id', auth.shopId).limit(3000)
  if (error) {
    if (missingSchema(error)) return reply({ ok: true, available: false, flows: [] })
    return reply({ ok: false, error: 'The board details could not be loaded' }, 500)
  }
  return reply({ ok: true, available: true, flows: (data || []).map(r => flowFrom(r as Record<string, unknown>)) })
}

export async function PATCH(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  if (!checkRateLimit(rateLimitKey('jobflow', auth.userId, auth.shopId), 240, 60_000).ok) return reply({ ok: false, error: 'Too many changes at once. Wait a moment.' }, 429)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const jobId = typeof body?.job_id === 'string' ? body.job_id : ''
  if (!ID.test(jobId)) return reply({ ok: false, error: 'Missing car' }, 400)
  const base = Number.isInteger(body?.base_version) ? (body?.base_version as number) : 0
  const patch = cleanPatch(body?.patch)
  if (Object.keys(patch).length === 0) return reply({ ok: false, error: 'Nothing to change' }, 400)
  if (!(await ownJob(auth.shopId, jobId))) return reply({ ok: false, error: 'Car not found' }, 404)

  const sb = getServiceClient()
  const now = new Date().toISOString()

  if (base === 0) {
    const ins = await sb.from('job_flow').insert({ job_id: jobId, shop_id: auth.shopId, ...patch, version: 1, updated_at: now }).select(COLS).single()
    if (!ins.error && ins.data) return reply({ ok: true, flow: flowFrom(ins.data as Record<string, unknown>) })
    if (ins.error && missingSchema(ins.error)) return reply({ ok: false, available: false, error: NEEDS_UPDATE }, 409)
    // Somebody else created the row first: hand back theirs, change nothing.
    if (ins.error?.code === '23505') {
      const cur = await current(auth.shopId, jobId)
      return reply({ ok: false, conflict: true, error: 'Somebody else just changed this car. Showing their version.', flow: cur.data ? flowFrom(cur.data as Record<string, unknown>) : null }, 409)
    }
    console.error('[jobflow] insert failed:', ins.error?.message)
    return reply({ ok: false, error: 'The change could not be saved' }, 500)
  }

  const upd = await sb.from('job_flow').update({ ...patch, version: base + 1, updated_at: now }).eq('job_id', jobId).eq('shop_id', auth.shopId).eq('version', base).select(COLS)
  if (upd.error) {
    if (missingSchema(upd.error)) return reply({ ok: false, available: false, error: NEEDS_UPDATE }, 409)
    console.error('[jobflow] update failed:', upd.error.message)
    return reply({ ok: false, error: 'The change could not be saved' }, 500)
  }
  if (!upd.data || upd.data.length === 0) {
    const cur = await current(auth.shopId, jobId)
    return reply({ ok: false, conflict: true, error: 'Somebody else just changed this car. Showing their version.', flow: cur.data ? flowFrom(cur.data as Record<string, unknown>) : null }, 409)
  }
  return reply({ ok: true, flow: flowFrom(upd.data[0] as Record<string, unknown>) })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const jobId = typeof body?.job_id === 'string' ? body.job_id : ''
  const action = body?.action
  if (!ID.test(jobId) || (action !== 'link' && action !== 'revoke' && action !== 'ready-text')) return reply({ ok: false, error: 'Unknown request' }, 400)
  if (!(await ownJob(auth.shopId, jobId))) return reply({ ok: false, error: 'Car not found' }, 404)

  const sb = getServiceClient()
  const existing = await current(auth.shopId, jobId)
  if (existing.error) {
    if (missingSchema(existing.error)) return reply({ ok: false, available: false, error: NEEDS_UPDATE }, 409)
    return reply({ ok: false, error: 'The car could not be checked' }, 500)
  }
  const now = new Date().toISOString()
  const fields: Record<string, unknown> =
    action === 'link' ? { status_token: (existing.data?.status_token as string | null) || randomBytes(18).toString('base64url') }
    : action === 'revoke' ? { status_token: null }
    : { ready_text_at: now }

  const version = (existing.data?.version as number | undefined) ?? 0
  const write = existing.data
    ? await sb.from('job_flow').update({ ...fields, version: version + 1, updated_at: now }).eq('job_id', jobId).eq('shop_id', auth.shopId).select(COLS).maybeSingle()
    : await sb.from('job_flow').insert({ job_id: jobId, shop_id: auth.shopId, ...fields, version: 1, updated_at: now }).select(COLS).single()
  if (write.error || !write.data) {
    if (write.error && missingSchema(write.error)) return reply({ ok: false, available: false, error: NEEDS_UPDATE }, 409)
    console.error('[jobflow] action failed:', write.error?.message)
    return reply({ ok: false, error: 'That could not be saved' }, 500)
  }
  const flow: JobFlow = flowFrom(write.data as Record<string, unknown>)
  // The link itself goes back only to the person who just asked for it.
  return reply({ ok: true, flow, ...(action === 'link' ? { token: String((write.data as Record<string, unknown>).status_token || '') } : {}) })
}
