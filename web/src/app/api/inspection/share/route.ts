import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * The shop side of an inspection's customer link: is the link feature turned on (migration 036),
 * make or stop a link for one inspection. The customer side is /api/inspection/public.
 */
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const columnMissing = (e: { code?: string; message?: string } | null) => Boolean(e) && (e?.code === '42703' || /share_token|customer_decisions|customer_id/i.test(e?.message || ''))

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const { error } = await getServiceClient().from('dvi').select('share_token').eq('shop_id', auth.shopId).limit(1)
  if (error && !columnMissing(error)) return reply({ ok: false, error: 'Inspections could not be checked.' }, 500)
  return reply({ ok: true, link: !error })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()

  const body = await req.json().catch(() => null) as { id?: unknown; action?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id : ''
  const action = body?.action === 'revoke' ? 'revoke' : 'share'
  if (!id) return reply({ ok: false, error: 'Choose an inspection first.' }, 400)

  const sb = getServiceClient()
  const { data: row, error } = await sb.from('dvi').select('*').eq('id', id).eq('shop_id', auth.shopId).maybeSingle()
  if (error) { console.error('[inspection/share] load failed:', error.message); return reply({ ok: false, error: 'The inspection could not be loaded.' }, 500) }
  if (!row) return reply({ ok: false, error: 'That inspection could not be found.' }, 404)

  const { data: settings } = await sb.from('settings').select('shop_name,shop_phone').eq('shop_id', auth.shopId).maybeSingle()
  const shop = { name: typeof settings?.shop_name === 'string' ? settings.shop_name.trim() : '', phone: typeof settings?.shop_phone === 'string' ? settings.shop_phone.trim() : '' }

  // Without migration 036 there is no token column. The text still goes out, just without a link.
  if (!('share_token' in row)) return reply({ ok: true, url: null, shop })

  if (action === 'revoke') {
    const { error: e } = await sb.from('dvi').update({ share_token: null }).eq('id', id).eq('shop_id', auth.shopId)
    if (e) { console.error('[inspection/share] revoke failed:', e.message); return reply({ ok: false, error: 'The link could not be turned off. Try again.' }, 500) }
    return reply({ ok: true, url: null, shop })
  }

  let token = typeof row.share_token === 'string' && row.share_token ? row.share_token : ''
  if (!token) {
    token = crypto.randomUUID()
    const { error: e } = await sb.from('dvi').update({ share_token: token }).eq('id', id).eq('shop_id', auth.shopId)
    if (e) { console.error('[inspection/share] token save failed:', e.message); return reply({ ok: false, error: 'The link could not be made. Try again.' }, 500) }
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  return reply({ ok: true, url: `${site.replace(/\/$/, '')}/inspection/${token}`, shop })
}
