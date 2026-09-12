import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const SERVICES = new Set(['facebook', 'instagram', 'google_business', 'google_calendar'])

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const service = typeof body?.service === 'string' ? body.service : ''
  if (!SERVICES.has(service)) {
    return NextResponse.json({ ok: false, error: 'Unknown connector' }, { status: 400 })
  }

  const sb = getServiceClient()
  const { data, error } = await sb
    .from('connectors')
    .update({
      enabled: false,
      access_token: null,
      refresh_token: null,
      token_expires_at: null,
      page_id: null,
      page_access_token: null,
      metadata: {},
      updated_at: new Date().toISOString(),
    })
    .eq('service', service)
    .eq('shop_id', auth.shopId)
    .select('id,service,enabled,page_id,metadata,updated_at')
    .maybeSingle()

  if (error) return NextResponse.json({ ok: false, error: 'Connector could not be disconnected' }, { status: 500 })
  if (!data) return NextResponse.json({ ok: false, error: 'Connector not found' }, { status: 404 })
  return NextResponse.json({ ok: true, connector: data })
}
