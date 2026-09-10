export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { isSmsOptedOut } from '@/lib/sms-consent'

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
  let resolvedCustomerId = typeof customer_id === 'string' ? customer_id : ''
  let resolvedCustomerName = typeof customer_name === 'string' ? customer_name.trim() : ''
  const selectedChannel = channel || 'sms'
  if (!['sms', 'email'].includes(String(selectedChannel))) {
    return NextResponse.json({ error: 'channel must be sms or email' }, { status: 400 })
  }
  const scheduledDate = scheduled_for ? new Date(String(scheduled_for)) : new Date(Date.now() + 86400000)
  if (Number.isNaN(scheduledDate.getTime())) return NextResponse.json({ error: 'scheduled_for must be a valid date' }, { status: 400 })
  if (typeof message_body !== 'string' || !message_body.trim()) return NextResponse.json({ error: 'message_body is required' }, { status: 400 })
  if (!resolvedCustomerId && resolvedCustomerName) {
    const { data: customer, error: customerError } = await sb
      .from('customers')
      .select('id,name,phone,email,sms_opted_out')
      .eq('shop_id', auth.shopId)
      .ilike('name', resolvedCustomerName)
      .limit(1)
      .maybeSingle()
    if (customerError) return NextResponse.json({ error: customerError.message }, { status: 500 })
    if (customer) {
      resolvedCustomerId = customer.id
      resolvedCustomerName = customer.name || resolvedCustomerName
    }
  }
  if (!resolvedCustomerId) return NextResponse.json({ error: 'A scheduled message requires a customer' }, { status: 400 })
  if (resolvedCustomerId) {
    const { data: customer, error: customerError } = await sb
      .from('customers')
      .select('id,sms_opted_out,phone')
      .eq('id', resolvedCustomerId)
      .eq('shop_id', auth.shopId)
      .maybeSingle()
    if (customerError) return NextResponse.json({ error: customerError.message }, { status: 500 })
    if (!customer) return NextResponse.json({ error: 'Customer not found in this shop' }, { status: 404 })
    if (selectedChannel === 'sms' && (customer.sms_opted_out || await isSmsOptedOut(sb, auth.shopId, customer.phone))) return NextResponse.json({ error: 'This destination has opted out of SMS' }, { status: 409 })
  }

  const { data, error } = await sb.from('scheduled_messages').insert({
    shop_id: auth.shopId,
    customer_id: resolvedCustomerId,
    customer_name: resolvedCustomerName || 'Customer',
    channel: selectedChannel,
    scheduled_for: scheduledDate.toISOString(),
    message_body: message_body.trim(),
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
  if (updates.status !== undefined && !['pending', 'cancelled'].includes(String(updates.status))) {
    return NextResponse.json({ error: 'Only pending or cancelled status can be set by the browser' }, { status: 400 })
  }
  if (updates.scheduled_for !== undefined) {
    const scheduledDate = new Date(String(updates.scheduled_for))
    if (Number.isNaN(scheduledDate.getTime())) return NextResponse.json({ error: 'scheduled_for must be a valid date' }, { status: 400 })
    updates.scheduled_for = scheduledDate.toISOString()
  }
  if (updates.message_body !== undefined && (typeof updates.message_body !== 'string' || !String(updates.message_body).trim())) {
    return NextResponse.json({ error: 'message_body cannot be empty' }, { status: 400 })
  }
  const { data: existing, error: existingError } = await sb
    .from('scheduled_messages')
    .select('customer_id,channel,status')
    .eq('id', id)
    .eq('shop_id', auth.shopId)
    .maybeSingle()
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'Scheduled message not found' }, { status: 404 })
  if (['sent', 'sending'].includes(String(existing.status))) {
    return NextResponse.json({ error: 'Delivered or in-flight messages cannot be edited' }, { status: 409 })
  }
  const nextCustomerId = updates.customer_id !== undefined ? String(updates.customer_id || '') : String(existing.customer_id || '')
  const nextChannel = String(updates.channel || existing.channel || 'sms')
  if (!nextCustomerId) return NextResponse.json({ error: 'A scheduled message requires a customer' }, { status: 400 })
  if (updates.customer_id !== undefined) updates.customer_id = nextCustomerId
  if (updates.status === 'pending') {
    updates.next_attempt_at = null
    updates.last_error = null
    updates.claimed_at = null
  }
  {
    const { data: customer, error: customerError } = await sb
      .from('customers')
      .select('id,sms_opted_out,phone')
      .eq('id', nextCustomerId)
      .eq('shop_id', auth.shopId)
      .maybeSingle()
    if (customerError) return NextResponse.json({ error: customerError.message }, { status: 500 })
    if (!customer) return NextResponse.json({ error: 'Customer not found in this shop' }, { status: 404 })
    if (nextChannel === 'sms' && (customer.sms_opted_out || await isSmsOptedOut(sb, auth.shopId, customer.phone))) return NextResponse.json({ error: 'This destination has opted out of SMS' }, { status: 409 })
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
