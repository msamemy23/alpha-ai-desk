// Shared inbound-SMS handler — used by BOTH the Telnyx webhook (/api/sms) and
// the phone-gateway webhook (/api/sms-inbound). One place so the two never drift.
//
// Responsibilities: ignore our own numbers, dedupe, look up the customer, store
// the inbound message, honor STOP/opt-out, then (rate-limited) generate and send
// an AI auto-reply. The reply goes out via sendSMS(), which is provider-agnostic
// — so if SMS_PROVIDER=textbee/httpsms it replies from YOUR phone, not Telnyx.

import { getServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/sms'
import { isOptOut } from '@/lib/sms-normalize'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'

const SHOP_PHONE = process.env.TELNYX_PHONE_NUMBER || '+17136636979'

// Our own numbers — never auto-reply to these (prevents intra-account echo loops).
const INTERNAL_NUMBERS = new Set(['17136636979', '12819368645'])

// One auto-reply per number per 10 min (resets on cold start, which is fine).
const lastAutoReply: Record<string, number> = {}
const AUTO_REPLY_COOLDOWN_MS = 10 * 60 * 1000

type Customer = { id: string; name: string; phone: string; email?: string } | undefined

export async function handleInboundSms(opts: {
  from: string
  body: string
  messageId?: string
  toNumber?: string
}): Promise<void> {
  const fromRaw = opts.from || ''
  const msgBody = opts.body || ''
  const messageId = opts.messageId || ''
  const fromDigits = fromRaw.replace(/\D/g, '').slice(-10)
  if (!fromRaw) return

  // Never auto-reply to our own Telnyx/shop numbers.
  if (INTERNAL_NUMBERS.has(fromDigits) || INTERNAL_NUMBERS.has(fromRaw.replace(/\D/g, ''))) return

  const db = getServiceClient()

  // Dedupe — skip if we already handled this message id.
  if (messageId) {
    const { data: existing } = await db
      .from('messages')
      .select('id')
      .eq('telnyx_message_id', messageId)
      .limit(1)
    if (existing && existing.length > 0) return
  }

  // Look up the customer by phone.
  const { data: customers } = await db
    .from('customers')
    .select('id,name,phone,email')
    .ilike('phone', `%${fromDigits}%`)
    .limit(1)
  const customer = customers?.[0] as Customer

  // Store the inbound message.
  const { error: insertErr } = await db.from('messages').insert({
    direction: 'inbound',
    channel: 'sms',
    from_address: fromRaw,
    to_address: opts.toNumber || SHOP_PHONE,
    body: msgBody,
    status: 'received',
    customer_id: customer?.id || null,
    read: false,
    telnyx_message_id: messageId || null,
    ai_handled: false,
  })
  if (insertErr) return // insert conflict → already handled

  // ── Opt-out (STOP/UNSUBSCRIBE/…): record it and NEVER auto-reply. ──
  if (isOptOut(msgBody)) {
    if (customer?.id) {
      // Best-effort flag — once an sms_opted_out column exists, outbound sends
      // should check it. Ignore the error if the column isn't there yet.
      try { await db.from('customers').update({ sms_opted_out: true }).eq('id', customer.id) } catch { /* column may not exist yet */ }
    }
    return
  }

  // Rate-limit auto-replies.
  const now = Date.now()
  if (lastAutoReply[fromDigits] && now - lastAutoReply[fromDigits] < AUTO_REPLY_COOLDOWN_MS) return

  const reply = await generateAIReply(msgBody, customer, db)
  if (reply) {
    try {
      await sendSMS(fromRaw, reply)
      lastAutoReply[fromDigits] = Date.now()
      await db.from('messages').insert({
        direction: 'outbound',
        channel: 'sms',
        from_address: SHOP_PHONE,
        to_address: fromRaw,
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
  customer: Customer,
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
        jobContext = `\nOpen jobs: ${jobs.map(j => `${j.status}: ${j.concern} (${[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')})`).join('; ')}`
      }
    }

    const systemPrompt = `You are the SMS receptionist for ${settings.shop_name || 'Alpha International Auto Center'} auto repair shop.
Phone: ${settings.shop_phone || '(713) 663-6979'} | Hours: Mon-Fri 8am-6pm, Sat 9am-3pm
${customer ? `Customer: ${customer.name}${jobContext}` : 'Unknown customer.'}
Reply in 1-2 sentences under 160 characters. Warm, professional, brief.`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const aiBaseUrl = normalizeAiBaseUrl(settings.ai_base_url || AI_BASE_URLS.OPENROUTER)
      const aiModel = normalizeAiModel(settings.ai_model, aiBaseUrl)
      const res = await fetch(`${aiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${settings.ai_api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: aiModel,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
          max_tokens: 80,
          temperature: 0.4,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      const data = await res.json()
      return data.choices?.[0]?.message?.content?.trim() || getDefaultReply(message, customer, settings)
    } catch {
      clearTimeout(timeout)
      return getDefaultReply(message, customer, settings)
    }
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
