export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const sb = getServiceClient()
  const { data, error } = await sb
    .from('scheduled_messages')
    .select('*')
    .eq('shop_id', auth.shopId)
    .order('scheduled_for', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scheduled: data || [] })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const sb = getServiceClient()
  const body = await req.json()

  const { customer_id, customer_name, channel, scheduled_for, message_body, subject } = body
  if (channel !== undefined && !['sms', 'email'].includes(String(channel))) {
    return NextResponse.json({ error: 'channel must be sms or email' }, { status: 400 })
  }
  if (customer_id) {
    const { data: customer, error: customerError } = await sb
      .from('customers')
      .select('id')
      .eq('id', String(customer_id))
      .eq('shop_id', auth.shopId)
      .maybeSingle()
    if (customerError) return NextResponse.json({ error: customerError.message }, { status: 500 })
    if (!customer) return NextResponse.json({ error: 'Customer not found in this shop' }, { status: 404 })
  }

  const { data, error } = await sb.from('scheduled_messages').insert({
    shop_id: auth.shopId,
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
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const sb = getServiceClient()
  const body = await req.json().catch(() => ({}))
  const { id } = body as { id?: unknown }
  if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const allowed = ['customer_id', 'customer_name', 'channel', 'scheduled_for', 'message_body', 'subject', 'status']
  const updates = Object.fromEntries(
    allowed
      .filter(key => Object.prototype.hasOwnProperty.call(body, key))
      .map(key => [key, body[key]])
  ) as Record<string, unknown>
  if (!Object.keys(updates).length) return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  if (updates.channel !== undefined && !['sms', 'email'].includes(String(updates.channel))) {
    return NextResponse.json({ error: 'channel must be sms or email' }, { status: 400 })
  }
  if (updates.status !== undefined && !['pending', 'sent', 'failed', 'cancelled'].includes(String(updates.status))) {
    return NextResponse.json({ error: 'Invalid scheduled message status' }, { status: 400 })
  }
  if (updates.customer_id) {
    const { data: customer, error: customerError } = await sb
      .from('customers')
      .select('id')
      .eq('id', String(updates.customer_id))
      .eq('shop_id', auth.shopId)
      .maybeSingle()
    if (customerError) return NextResponse.json({ error: customerError.message }, { status: 500 })
    if (!customer) return NextResponse.json({ error: 'Customer not found in this shop' }, { status: 404 })
  }

  const { data, error } = await sb
    .from('scheduled_messages')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('shop_id', auth.shopId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, scheduled: data })
}
