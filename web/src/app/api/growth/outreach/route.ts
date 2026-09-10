import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { getRouteShop, unauthorized } from '@/lib/api-auth'
import { createVoiceClientState } from '@/lib/voice-state'
import { createHash } from 'node:crypto'

const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'

function fetchT(url: string, opts: RequestInit, ms = 15000) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id))
}

// Fetch shop settings from DB (used to avoid hardcoding shop name/phone/address)
async function getShopSettings(shopId: string) {
  const db = getServiceClient()
  const { data, error } = await db.from('settings').select('*').eq('shop_id', shopId).maybeSingle()
  if (error) throw error
  const aiBase = normalizeAiBaseUrl(data?.ai_base_url || AI_BASE_URLS.OPENROUTER)
  return {
    shopName: String(data?.shop_name || data?.company_name || data?.business_name || 'your shop').slice(0, 120),
    shopPhone: String(data?.shop_phone || data?.phone || data?.business_phone || '').slice(0, 40),
    shopAddress: String(data?.shop_address || data?.address || '').slice(0, 200),
    fromEmail: String(data?.from_email || '').slice(0, 160),
    resendApiKey: String(data?.resend_api_key || ''),
    aiKey: String(data?.ai_api_key || ''),
    telnyxApiKey: String(data?.telnyx_api_key || ''),
    telnyxPhone: String(data?.telnyx_phone_number || ''),
    telnyxConnectionId: String(data?.telnyx_connection_id || ''),
    aiBase,
    aiModel: normalizeAiModel(data?.ai_model, aiBase),
    shopId,
  }
}

async function generateMessage(lead: any, method: string, shopName: string, shopPhone: string, aiKey: string, aiUrl: string, aiModel: string) {
  if (!aiKey) return `Hi ${lead.name?.split(' ')[0] || 'there'}! This is ${shopName}. We specialize in ${lead.service_needed || 'auto repair'}. Call us at ${shopPhone}!`
  try {
    const res = await fetchT(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: aiModel,
        messages: [{
          role: 'system',
          content: 'You are a friendly outreach assistant for ' + shopName + '. Write a short personalized ' + method + ' message. Be warm, professional, mention their specific need. For SMS keep under 160 chars. For email write subject and body. Return JSON with subject and body.'
        }, {
          role: 'user',
          content: `Write outreach for: ${JSON.stringify({ name: lead.name, service: lead.service_needed, source: lead.source, notes: lead.notes?.substring?.(0, 200) || '' })}`
        }],
        temperature: 0.7, max_tokens: 500
      })
    }, 20000)
    if (!res.ok) throw new Error(`AI provider returned ${res.status}`)
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
  } catch {
    return {
      subject: shopName,
      body: `Hi ${lead.name?.split(' ')[0] || 'there'}! ${shopName} here - ready to help with ${lead.service_needed || 'your vehicle'}. Call ${shopPhone}!`
    }
  }
}

function idempotencyKey(parts: string[]) {
  return `growth-outreach-${createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32)}`
}

async function sendSMS(to: string, message: string, telnyxKey: string, telnyxPhone: string, key?: string) {
  if (!telnyxKey || !telnyxPhone) throw new Error('Telnyx not configured')
  const res = await fetchT('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${telnyxKey}`, ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify({ from: telnyxPhone, to, text: message, type: 'SMS' })
  }, 10000)
  if (!res.ok) throw new Error(`SMS failed: ${res.status}`)
  return res.json()
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
}

async function sendEmailMsg(to: string, subject: string, body: string, shopName: string, shopPhone: string, shopAddress: string, fromEmail: string, apiKey: string, key?: string) {
  if (!apiKey || !fromEmail) throw new Error('Email is not configured for this shop')
  const res = await fetchT('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify({
      from: fromEmail,
      to: [to], subject,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;"><p>${escapeHtml(body).replace(/\n/g, '<br>')}</p><hr><p style="color:#888;font-size:12px;">${escapeHtml(shopName)} | ${escapeHtml(shopPhone)} | ${escapeHtml(shopAddress)}</p></div>`
    })
  }, 10000)
  if (!res.ok) throw new Error(`Email failed: ${res.status}`)
  return res.json()
}

async function makeAICall(to: string, leadName: string, service: string, shop: { shopId: string; telnyxApiKey: string; telnyxPhone: string; telnyxConnectionId: string }) {
  if (!shop.telnyxApiKey || !shop.telnyxPhone || !shop.telnyxConnectionId) throw new Error('Telnyx calling is not configured for this shop')
  const res = await fetchT('https://api.telnyx.com/v2/calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${shop.telnyxApiKey}` },
    body: JSON.stringify({
      connection_id: shop.telnyxConnectionId,
      to, from: shop.telnyxPhone,
      webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/telnyx-voice-webhook`,
      client_state: createVoiceClientState({ shopId: shop.shopId, task: service ? `Call ${leadName} about ${service}` : `Call ${leadName} and offer a helpful conversation` }),
      custom_headers: [{ name: 'X-Lead-Name', value: leadName }, { name: 'X-Service', value: service || 'auto repair' }]
    })
  }, 10000)
  if (!res.ok) throw new Error(`Call failed: ${res.status}`)
  return res.json()
}

type OutreachShop = Awaited<ReturnType<typeof getShopSettings>>

async function runAutoOutreach(
  db: ReturnType<typeof getServiceClient>,
  shopId: string,
  body: Record<string, unknown>,
  shop: OutreachShop,
) {
  const rawLimit = Number(body.limit ?? 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 50) : 10
  const { data: leads, error } = await db.from('leads')
    .select('*')
    .eq('shop_id', shopId)
    .eq('status', 'new')
    .not('email', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit)
  if (error) throw error

  const results: Array<Record<string, unknown>> = []
  for (const lead of leads || []) {
    if (!lead.email) continue
    try {
      const generated = await generateMessage(lead, 'email', shop.shopName, shop.shopPhone, shop.aiKey, shop.aiBase + '/chat/completions', shop.aiModel)
      const message = typeof generated === 'string' ? generated : String(generated?.body || '')
      const subject = typeof generated === 'object' && generated?.subject
        ? String(generated.subject).slice(0, 200)
        : `${shop.shopName} - ${lead.service_needed || 'Auto Repair Services'}`
      const key = idempotencyKey([shopId, 'lead-email', String(lead.id), message])
      const emailResult = await sendEmailMsg(lead.email, subject, message, shop.shopName, shop.shopPhone, shop.shopAddress, shop.fromEmail, shop.resendApiKey, key)
      const { error: historyError } = await db.from('outreach_history').insert({
        shop_id: shopId, lead_id: lead.id, method: 'email', status: 'sent', message,
        to_contact: lead.email, ai_mode: true, metadata: { email: emailResult }, created_at: new Date().toISOString(),
      })
      if (historyError) throw historyError
      const { error: updateError } = await db.from('leads').update({ status: 'contacted', last_contact: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', lead.id).eq('shop_id', shopId)
      if (updateError) throw updateError
      results.push({ lead_id: lead.id, email: lead.email, sent: true })
    } catch (error) {
      results.push({ lead_id: lead.id, email: lead.email, sent: false, error: error instanceof Error ? error.message : 'Outreach failed' })
    }
  }
  const sent = results.filter(result => result.sent === true).length
  return NextResponse.json({ ok: results.every(result => result.sent === true), success: results.every(result => result.sent === true), attempted: results.length, sent, results })
}

async function runSmsBlast(
  db: ReturnType<typeof getServiceClient>,
  shopId: string,
  body: Record<string, unknown>,
  shop: OutreachShop,
) {
  if (!shop.telnyxApiKey || !shop.telnyxPhone) return NextResponse.json({ ok: false, success: false, error: 'SMS is not configured for this shop' }, { status: 503 })
  const template = typeof body.message_template === 'string' && body.message_template.trim()
    ? body.message_template.trim().slice(0, 1600)
    : 'Hi {name}! We have a special this week at your local auto repair shop. Reply to this text or call us to schedule.'
  const rawLimit = Number(body.limit ?? 100)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 100) : 100
  const { data: customers, error } = await db.from('customers').select('id,name,phone,sms_opted_out').eq('shop_id', shopId).not('phone', 'is', null).order('created_at', { ascending: true }).limit(limit)
  if (error) throw error
  const results: Array<Record<string, unknown>> = []
  for (const customer of customers || []) {
    if (customer.sms_opted_out || !customer.phone) continue
    const firstName = String(customer.name || 'there').trim().split(/\s+/)[0] || 'there'
    const message = template.replace(/\{name\}/gi, firstName)
    try {
      const result = await sendSMS(customer.phone, message, shop.telnyxApiKey, shop.telnyxPhone, idempotencyKey([shopId, 'sms-blast', String(customer.id), message]))
      const { error: logError } = await db.from('messages').insert({
        shop_id: shopId, direction: 'outbound', channel: 'sms', from_address: shop.telnyxPhone,
        to_address: customer.phone, body: message, status: result?.id ? 'sent' : 'failed',
        customer_id: customer.id, telnyx_message_id: result?.id || null, read: true, created_at: new Date().toISOString(),
      })
      if (logError) throw logError
      results.push({ customer_id: customer.id, phone: customer.phone, sent: Boolean(result?.id) })
    } catch (error) {
      results.push({ customer_id: customer.id, phone: customer.phone, sent: false, error: error instanceof Error ? error.message : 'SMS failed' })
    }
  }
  const sent = results.filter(result => result.sent === true).length
  const success = results.every(result => result.sent === true)
  return NextResponse.json({ ok: success, success, attempted: results.length, sent, results }, { status: success ? 200 : 502 })
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()

    const { lead_id, method, ai_mode = false } = body || {}
    const rawMessage = typeof body?.message === 'string' ? body.message.trim() : ''
    const automationAction = typeof body?.action === 'string' ? body.action : ''

    const db = getServiceClient()
    const shop = await getShopSettings(auth.shopId)
    if (automationAction === 'auto_outreach') return runAutoOutreach(db, auth.shopId, body as Record<string, unknown>, shop)
    if (automationAction === 'sms_blast') return runSmsBlast(db, auth.shopId, body as Record<string, unknown>, shop)

    if (typeof lead_id !== 'string' || !lead_id || !['sms', 'email', 'ai_call'].includes(method)) {
      return NextResponse.json({ error: 'lead_id and a valid method are required' }, { status: 400 })
    }
    if (rawMessage.length > 4000) return NextResponse.json({ error: 'Message is too long' }, { status: 400 })

    const { data: lead, error: leadError } = await db.from('leads').select('*').eq('id', lead_id).eq('shop_id', auth.shopId).maybeSingle()
    if (leadError) throw leadError
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    if (method === 'sms' && (!shop.telnyxApiKey || !shop.telnyxPhone)) return NextResponse.json({ error: 'SMS is not configured for this shop' }, { status: 503 })
    if (method === 'email' && (!shop.resendApiKey || !shop.fromEmail)) return NextResponse.json({ error: 'Email is not configured for this shop' }, { status: 503 })

    let result: any = {}
    let finalMessage = rawMessage
    let toContact = ''

    if (ai_mode === true && !rawMessage) {
      const gen = await generateMessage(lead, method, shop.shopName, shop.shopPhone, shop.aiKey, shop.aiBase + '/chat/completions', shop.aiModel)
      finalMessage = typeof gen === 'string' ? gen : gen.body || gen
      if (typeof gen === 'object' && gen.subject) result.subject = gen.subject
    }

    if (method === 'sms') {
      if (!lead.phone) return NextResponse.json({ error: 'No phone number for this lead' }, { status: 400 })
      toContact = lead.phone
      const outboundMessage = finalMessage || `Hi ${lead.name?.split(' ')[0]}! ${shop.shopName} here. We can help with ${lead.service_needed || 'your vehicle'}. Call ${shop.shopPhone}!`
      const smsResult = await sendSMS(lead.phone, outboundMessage, shop.telnyxApiKey, shop.telnyxPhone, idempotencyKey([auth.shopId, 'lead-sms', String(lead.id), outboundMessage]))
      result.sms = smsResult
    } else if (method === 'email') {
      if (!lead.email) return NextResponse.json({ error: 'No email for this lead' }, { status: 400 })
      toContact = lead.email
      const subject = String(result.subject || `${shop.shopName} - ${lead.service_needed || 'Auto Repair Services'}`)
      const emailResult = await sendEmailMsg(lead.email, subject, finalMessage, shop.shopName, shop.shopPhone, shop.shopAddress, shop.fromEmail, shop.resendApiKey)
      result.email = emailResult
    } else if (method === 'ai_call') {
      if (!lead.phone) return NextResponse.json({ error: 'No phone number for this lead' }, { status: 400 })
      toContact = lead.phone
      const callResult = await makeAICall(lead.phone, lead.name || 'Customer', lead.service_needed || '', shop)
      result.call = callResult
    } else {
      return NextResponse.json({ error: 'Invalid method. Use sms, email, or ai_call' }, { status: 400 })
    }

    const { error: historyError } = await db.from('outreach_history').insert({
      shop_id: auth.shopId,
      lead_id, method, status: 'sent', message: finalMessage,
      to_contact: toContact, ai_mode,
      metadata: result, created_at: new Date().toISOString()
    })
    if (historyError) throw historyError

    const { error: leadUpdateError } = await db.from('leads').update({ status: 'contacted', last_contact: new Date().toISOString() }).eq('id', lead_id).eq('shop_id', auth.shopId)
    if (leadUpdateError) throw leadUpdateError

    const { error: activityError } = await db.from('growth_activity').insert({
      shop_id: auth.shopId,
      action: `outreach_${method}`, target: lead.name,
      details: `${ai_mode ? 'AI' : 'Manual'} ${method} sent to ${toContact}`,
      status: 'sent', created_at: new Date().toISOString()
    })
    if (activityError) throw activityError

    return NextResponse.json({ success: true, method, to: toContact, ai_mode, result })
  } catch (e: any) {
    console.error('Outreach error:', e)
    return NextResponse.json({ error: e.message || 'Outreach failed' }, { status: 500 })
  }
}
