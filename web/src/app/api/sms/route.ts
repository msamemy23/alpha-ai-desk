import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/telnyx'

const SHOP_PHONE = process.env.TELNYX_PHONE_NUMBER || '+17136636979'

// All Telnyx numbers on this account - never auto-reply to these (prevents intra-account echo loops)
const INTERNAL_NUMBERS = ['+17136636979', '+12819368645']

// In-memory rate limit: track last auto-reply time per number (resets on cold start)
const lastAutoReply: Record<string, number> = {}
const AUTO_REPLY_COOLDOWN_MS = 10 * 60 * 1000 // 10 minutes

export async function POST(req: NextRequest) {
  // Respond to Telnyx IMMEDIATELY to prevent retries/duplicate webhooks
  const body = await req.json()
  processWebhook(body).catch(e => console.error('SMS webhook error:', e))
  return NextResponse.json({ ok: true })
}

async function processWebhook(body: Record<string, unknown>) {
  const event = body?.data as Record<string, unknown> | undefined
  if (!event) return

  // Only handle inbound SMS
  if (event.event_type !== 'message.received') return

  const msg = event.payload as Record<string, unknown>
  const fromNumber: string = ((msg.from as Record<string, unknown>)?.phone_number as string) || (msg.from as string) || ''
  const msgBody: string = (msg.text as string) || ''
  const messageId: string = (msg.id as string) || ''

  // Normalize from number for comparison
  const fromDigits = fromNumber.replace(/\D/g, '')
  
  // Never auto-reply to our own Telnyx numbers (prevents intra-account echo loops)
  const isInternalNumber = INTERNAL_NUMBERS.some(n => n.replace(/\D/g,'') === fromDigits)
  if (isInternalNumber) {
    console.log('Ignoring intra-account echo from', fromNumber)
    return
  }

  const db = getServiceClient()

  // DEDUPLICATION: check if we already processed this message ID
  if (messageId) {
    const { data: existing } = await db
      .from('messages')
      .select('id')
      .eq('telnyx_message_id', messageId)
      .limit(1)
    if (existing && existing.length > 0) {
      console.log('Duplicate webhook for message', messageId, '- skipping')
      return
    }
  }

  // Look up customer by phone
  const digits = fromDigits.slice(-10)
  const { data: customers } = await db
    .from('customers')
    .select('id,name,phone,email')
    .ilike('phone', `%${digits}%`)
    .limit(1)
  const customer = customers?.[0]

  // Store inbound message
  const { error: insertErr } = await db.from('messages').insert({
    direction: 'inbound',
    channel: 'sms',
    from_address: fromNumber,
    to_address: (msg.to as Record<string, unknown>[])?.[0]?.phone_number as string || SHOP_PHONE,
    body: msgBody,
    status: 'received',
    customer_id: customer?.id || null,
    read: false,
    telnyx_message_id: messageId,
    ai_handled: false,
  })

  if (insertErr) {
    console.log('Insert conflict for', messageId, '- skipping reply')
    return
  }

  // RATE LIMIT: max one auto-reply per number per 10 minutes
  const now = Date.now()
  const lastReply = lastAutoReply[fromDigits] || 0
  if (now - lastReply < AUTO_REPLY_COOLDOWN_MS) {
    console.log('Rate limiting auto-reply for', fromNumber, '- last reply was', Math.round((now - lastReply)/1000), 'seconds ago')
    return
  }

  // Generate and send ONE auto-reply
  const reply = await generateAIReply(msgBody, customer, db)
  if (reply) {
    try {
      await sendSMS(fromNumber, reply)
      lastAutoReply[fromDigits] = Date.now()
      await db.from('messages').insert({
        direction: 'outbound',
        channel: 'sms',
        from_address: SHOP_PHONE,
        to_address: fromNumber,
        body: reply,
        status: 'sent',
        customer_id: customer?.id || null,
        ai_handled: true,
      })
    } catch (e) {
      console.error('Auto-reply send failed:', e)
    }
  }
}

async function generateAIReply(
  message: string,
  customer: { id: string; name: string; phone: string } | undefined,
  db: ReturnType<typeof getServiceClient>
): Promise<string | null> {
  try {
    const { data: settings } = await db.from('settings').select('*').limit(1).single()
    if (!settings?.ai_api_key) return getDefaultReply(message, customer, settings)

    let jobContext = ''
    if (customer?.id) {
      const { data: jobs } = await db
        .from('jobs')
        .select('status,concern,vehicle_year,vehicle_make,vehicle_model')
        .eq('customer_id', customer.id)
        .not('status', 'in', '("Paid","Closed")')
        .limit(3)
      if (jobs?.length) {
        jobContext = `\nCustomer open jobs: ${jobs.map(j => `${j.status}: ${j.concern} (${[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')})`).join('; ')}`
      }
    }

    const systemPrompt = `You are the AI receptionist for ${settings.shop_name || 'Alpha International Auto Center'}, an auto repair shop.
Phone: ${settings.shop_phone || '(713) 663-6979'}
Hours: Mon-Fri 8am-6pm, Sat 9am-3pm
${customer ? `Customer: ${customer.name}${jobContext}` : 'Unknown customer.'}
Reply SHORT (1-2 sentences, under 160 chars). Be warm and professional. This is SMS.`

    const res = await fetch(`${settings.ai_base_url || 'https://openrouter.ai/api/v1'}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${settings.ai_api_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.ai_model || 'meta-llama/llama-3.3-70b-instruct:free',
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
        max_tokens: 100,
        temperature: 0.4
      })
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() || getDefaultReply(message, customer, settings)
  } catch {
    return getDefaultReply(message, customer, null)
  }
}

function getDefaultReply(message: string, customer: { name?: string } | undefined, settings: Record<string, unknown> | null): string {
  const name = customer?.name ? ` ${customer.name.split(' ')[0]}` : ''
  const shopName = (settings?.shop_name as string) || 'Alpha International Auto Center'
  const phone = (settings?.shop_phone as string) || '(713) 663-6979'
  const lc = message.toLowerCase()
  if (lc.includes('status') || lc.includes('ready') || lc.includes('car') || lc.includes('vehicle'))
    return `Hi${name}! We'll check on your vehicle and call you right back. ${phone}`
  if (lc.includes('schedule') || lc.includes('appointment'))
    return `Hi${name}! Call us at ${phone} or reply with a good time to schedule.`
  if (lc.includes('price') || lc.includes('cost') || lc.includes('how much'))
    return `Hi${name}! Our tech will call you with a quote shortly. ${phone}`
  return `Hi${name}! Thanks for contacting ${shopName}. We'll be in touch shortly. Call ${phone} if urgent.`
}