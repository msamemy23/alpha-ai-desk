import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { getServiceClient } from '@/lib/supabase'

const SERVICES = ['facebook', 'instagram', 'google_business', 'google_calendar'] as const

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req)
  if (denied) return denied

  const body = await req.json().catch(() => ({}))
  const shopId = typeof body?.shopId === 'string' ? body.shopId : ''
  if (!shopId) return NextResponse.json({ error: 'shopId is required' }, { status: 400 })

  const db = getServiceClient()
  const { data: shop, error: shopError } = await db.from('shop_profiles').select('id').eq('id', shopId).maybeSingle()
  if (shopError || !shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })

  const rows = SERVICES.map(service => ({ shop_id: shopId, service, enabled: false }))
  const { data, error } = await db.from('connectors')
    .upsert(rows, { onConflict: 'shop_id,service', ignoreDuplicates: false })
    .select('id,shop_id,service,enabled')
  if (error) {
    console.error('[seed-connectors] seed failed:', error.message)
    return NextResponse.json({ error: 'Connectors could not be initialized' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, results: data || [] })
}

export async function GET(req: NextRequest) {
  const denied = requireAdmin(req)
  if (denied) return denied
  return NextResponse.json({ ok: false, error: 'Use POST with an explicit shopId to initialize connectors' }, { status: 405 })
}
