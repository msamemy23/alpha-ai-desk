import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const TELNYX_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_PHONE = process.env.TELNYX_PHONE_NUMBER || ''
const RESEND_KEY = process.env.RESEND_API_KEY || ''
const AI_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'
const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-v3.2'

function fetchT(url: string, opts: RequestInit, ms = 15000) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id))
}

// Fetch shop settings from DB (used to avoid hardcoding shop name/phone/address)
async function getShopSettings() {
  try {
    const db = getServiceClient()
    const { data } = await db.from('settings').select('*').limit(1).single()
    return {
      shopName: data?.shop_name || 'Alpha International Auto Center',
      shopPhone: data?.shop_phone || '(713) 663-6979',
      shopAddress: data?.shop_address || '10710 S Main St, Houston TX',
      fromEmail: data?.from_email || 'Alpha Auto <onboarding@resend.dev>',
      resendApiKey: data?.resend_api_key || RESEND_KEY,
    }
  } catch {
    return {
      shopName: 'Alpha International Auto Center',
      shopPhone: '(713) 663-6979',
      shopAddress: '10710 S Main St, Houston TX',
      fromEmail: 'Alpha Auto <onboarding@resend.dev>',
      resendApiKey: RESEND_KEY,
    }
  }
}

async function generateMessage(lead: any, method: string, shopName: string, shopPhone: string) {
  if (!AI_KEY) return `Hi ${lead.name?.split(' ')[0] || 'there'}! This is ${shopName}. We specialize in ${lead.service_needed || 'auto repair'}. Call us at ${shopPhone}!`
  try {
    const res = await fetchT(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: `You are a friendly outreach assistant for ${shopName}. Write a short personalized ${method} message. Be warm, professional, mention their specific need. For SMS keep under 160 chars. For email write subject and body. Return JSON: { "subject": "...", "body": "..." }`
        }, {
          role: 'user',
          content: `Write outreach for: ${JSON.stringify({ name: lead.name, service: lead.service_needed, source: lead.source, notes: lead.notes?.substring?.(0, 200) || '' })}`
        }],
        temperature: 0.7, max_tokens: 500
      })
    }, 20000)
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

async function sendSMS(to: string, message: string) {
  const telnyxKey = TELNYX_KEY
  const telnyxPhone = TELNYX_PHONE
  if (!telnyxKey || !telnyxPhone) throw new Error('Telnyx not configured')
  const res = await fetchT('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${telnyxKey}` },
    body: JSON.stringify({ from: telnyxPhone, to, text: message, type: 'SMS' })
  }, 10000)
  if (!res.ok) throw new Error(`SMS failed: ${res.status}`)
  return res.json()
}

async function sendEmailMsg(to: string, subject: string, body: string, shopName: string, shopPhone: string, shopAddress: string, fromEmail: string, apiKey: string) {
  if (!apiKey) throw new Error('Email (Resend) not configured — add RESEND_API_KEY to your environment or settings')
  const res = await fetchT('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: fromEmail,
      to: [to], subject,
      html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;"><p>${body.replace(/\n/g, '<br>')}</p><hr><p style="color:#888;font-size:12px;">${shopName} | ${shopPhone} | ${shopAddress}</p></div>`
    })
  }, 10000)
  if (!res.ok) throw new Error(`Email failed: ${res.status}`)
  return res.json()
}

async function makeAICall(to: string, leadName: string, service: string) {
  if (!TELNYX_KEY) throw new Error('Telnyx not configured')
  const res = await fetchT('https://api.telnyx.com/v2/calls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TELNYX_KEY}` },
    body: JSON.stringify({
      connection_id: process.env.TELNYX_CONNECTION_ID || '',
      to, from: TELNYX_PHONE,
      webhook_url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://alpha-ai-desk.vercel.app'}/api/ai-voice-call`,
      custom_headers: [{ name: 'X-Lead-Name', value: leadName }, { name: 'X-Service', value: service || 'auto repair' }]
    })
  }, 10000)
  if (!res.ok) throw new Error(`Call failed: ${res.status}`)
  return res.json()
}

export async function POST(req: NextRequest) {
  try {
    const { lead_id, method, message, ai_mode = false } = await req.json()
    if (!lead_id || !method) return NextResponse.json({ error: 'lead_id and method required' }, { status: 400 })

    const db = getServiceClient()
    const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single()
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    // Load shop settings from DB — never hardcode shop info
    const shop = await getShopSettings()

    let result: any = {}
    let finalMessage = message || ''
    let toContact = ''

    if (ai_mode && !message) {
      const gen = await generateMessage(lead, method, shop.shopName, shop.shopPhone)
      finalMessage = typeof gen === 'string' ? gen : gen.body || gen
      if (typeof gen === 'object' && gen.subject) result.subject = gen.subject
    }

    if (method === 'sms') {
      if (!lead.phone) return NextResponse.json({ error: 'No phone number for this lead' }, { status: 400 })
      toContact = lead.phone
      const smsResult = await sendSMS(lead.phone, finalMessage || `Hi ${lead.name?.split(' ')[0]}! ${shop.shopName} here. We can help with ${lead.service_needed || 'your vehicle'}. Call ${shop.shopPhone}!`)
      result.sms = smsResult
    } else if (method === 'email') {
      if (!lead.email) return NextResponse.json({ error: 'No email for this lead' }, { status: 400 })
      toContact = lead.email
      const subject = result.subject || `${shop.shopName} - ${lead.service_needed || 'Auto Repair Services'}`
      const emailResult = await sendEmailMsg(lead.email, subject, finalMessage, shop.shopName, shop.shopPhone, shop.shopAddress, shop.fromEmail, shop.resendApiKey)
      result.email = emailResult
    } else if (method === 'ai_call') {
      if (!lead.phone) return NextResponse.json({ error: 'No phone number for this lead' }, { status: 400 })
      toContact = lead.phone
      const callResult = await makeAICall(lead.phone, lead.name || 'Customer', lead.service_needed || '')
      result.call = callResult
    } else {
      return NextResponse.json({ error: 'Invalid method. Use sms, email, or ai_call' }, { status: 400 })
    }

    await db.from('outreach_history').insert({
      lead_id, method, status: 'sent', message: finalMessage,
      to_contact: toContact, ai_mode,
      metadata: result, created_at: new Date().toISOString()
    })

    await db.from('leads').update({ status: 'contacted', last_contact: new Date().toISOString() }).eq('id', lead_id)

    await db.from('growth_activity').insert({
      action: `outreach_${method}`, target: lead.name,
      details: `${ai_mode ? 'AI' : 'Manual'} ${method} sent to ${toContact}`,
      status: 'sent', created_at: new Date().toISOString()
    })

    return NextResponse.json({ success: true, method, to: toContact, ai_mode, result })
  } catch (e: any) {
    console.error('Outreach error:', e)
    return NextResponse.json({ error: e.message || 'Outreach failed' }, { status: 500 })
  }
}
