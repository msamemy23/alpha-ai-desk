import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET() {
  const { data, error } = await svc
    .from('daily_notes')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ notes: data || [] })
}

export async function POST(req: NextRequest) {
  const { content, note_date } = await req.json()
  if (!content?.trim()) return NextResponse.json({ error: 'Content required' }, { status: 400 })
  const { data, error } = await svc
    .from('daily_notes')
    .insert({ content: content.trim(), note_date: note_date || new Date().toISOString().split('T')[0] })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ note: data })
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json()
  const { error } = await svc.from('daily_notes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
