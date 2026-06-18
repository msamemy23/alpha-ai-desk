import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized, forbidden } from '@/lib/api-auth'

export async function POST(req: Request) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const { id, data } = await req.json()
    if (!id || !data) return NextResponse.json({ error: 'Missing id or data' }, { status: 400 })

    const sb = getServiceClient()

    // Look up the existing record and confirm it belongs to the caller's shop.
    const { data: existing, error: fetchErr } = await sb
      .from('documents')
      .select('shop_id')
      .eq('id', id)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    if (existing.shop_id !== auth.shopId) return forbidden()

    const { error } = await sb
      .from('documents')
      .update({ ...data, shop_id: auth.shopId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('shop_id', auth.shopId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : 'Unknown error') }, { status: 500 })
  }
}
