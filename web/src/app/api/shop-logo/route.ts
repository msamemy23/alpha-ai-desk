import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * The shop's logo, kept apart from /api/settings on purpose: if the database column has not been added
 * yet, this route says so and everything else in Settings keeps working.
 * The logo is a small data URL. Only raster types are accepted, never SVG, because a logo is shown
 * on pages and printed paperwork and an SVG can carry script.
 */
const MAX_LENGTH = 300_000
const DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function columnMissing(error: { code?: string; message?: string } | null) {
  return Boolean(error) && (error?.code === '42703' || /logo_data/i.test(error?.message || ''))
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const { data, error } = await getServiceClient()
    .from('settings')
    .select('logo_data')
    .eq('shop_id', auth.shopId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (columnMissing(error)) return reply({ ok: true, logo: null, available: false })
    return reply({ ok: false, error: 'The logo could not be loaded' }, 500)
  }
  const logo = typeof data?.logo_data === 'string' && DATA_URL.test(data.logo_data) ? data.logo_data : null
  return reply({ ok: true, logo, available: true })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()

  const body = await req.json().catch(() => null) as { logo?: unknown } | null
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'logo')) return reply({ ok: false, error: 'No logo was sent' }, 400)
  const logo = body.logo
  if (logo !== null) {
    if (typeof logo !== 'string' || logo.length > MAX_LENGTH) return reply({ ok: false, error: 'That picture is too large. Try a smaller one.' }, 400)
    if (!DATA_URL.test(logo)) return reply({ ok: false, error: 'Use a PNG, JPG or WebP picture.' }, 400)
  }

  const sb = getServiceClient()
  const { data: existing, error: lookupError } = await sb
    .from('settings')
    .select('id')
    .eq('shop_id', auth.shopId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lookupError) return reply({ ok: false, error: 'Shop settings could not be loaded' }, 500)

  const now = new Date().toISOString()
  const { error } = existing?.id
    ? await sb.from('settings').update({ logo_data: logo, updated_at: now }).eq('id', existing.id).eq('shop_id', auth.shopId)
    : await sb.from('settings').insert({ shop_id: auth.shopId, logo_data: logo, updated_at: now })

  if (error) {
    if (columnMissing(error)) return reply({ ok: false, error: 'Logos are not switched on for this account yet.', available: false }, 409)
    return reply({ ok: false, error: 'The logo could not be saved' }, 500)
  }
  return reply({ ok: true })
}
