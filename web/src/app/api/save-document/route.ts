import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const { id, data } = await req.json()
    if (!id || !data) return NextResponse.json({ error: 'Missing id or data' }, { status: 400 })

    const sb = getServiceClient()

    // Ensure shop_id is preserved — look it up from the existing record
    const { data: existing, error: fetchErr } = await sb
      .from('documents')
      .select('shop_id')
      .eq('id', id)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    const { error } = await sb
      .from('documents')
      .update({ ...data, shop_id: existing.shop_id, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : 'Unknown error') }, { status: 500 })
  }
}
