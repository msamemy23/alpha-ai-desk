import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const svc = getServiceClient()
  const { data, error } = await svc
    .from('daily_notes')
    .select('*')
    .eq('shop_id', auth.shopId)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data || [] })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const svc = getServiceClient()
  const { content, note_date } = await req.json()
  if (!content?.trim()) return NextResponse.json({ error: 'Content required' }, { status: 400 })
  const { data, error } = await svc
    .from('daily_notes')
    .insert({ shop_id: auth.shopId, content: content.trim(), note_date: note_date || new Date().toISOString().split('T')[0] })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: data })
}

export async function DELETE(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const svc = getServiceClient()
  const { id } = await req.json()
  const { error } = await svc.from('daily_notes').delete().eq('id', id).eq('shop_id', auth.shopId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
