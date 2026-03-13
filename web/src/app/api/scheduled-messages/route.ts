export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function GET() {
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('scheduled_messages')
    .select('*')
    .order('scheduled_for', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scheduled: data || [] })
}

export async function POST(req: NextRequest) {
  const sb = getServiceClient()
  const body = await req.json()

  const { customer_id, customer_name, channel, scheduled_for, message_body, subject } = body

  const { data, error } = await sb.from('scheduled_messages').insert({
    customer_id: customer_id || null,
    customer_name: customer_name || 'Customer',
    channel: channel || 'sms',
    scheduled_for: scheduled_for || new Date(Date.now() + 86400000).toISOString(),
    message_body: message_body || '',
    subject: subject || null,
    status: 'pending',
    created_at: new Date().toISOString(),
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, scheduled: data })
}

export async function PATCH(req: NextRequest) {
  const sb = getServiceClient()
  const body = await req.json()
  const { id, ...updates } = body as { id: string; [key: string]: unknown }

  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data, error } = await sb
    .from('scheduled_messages')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, scheduled: data })
}
