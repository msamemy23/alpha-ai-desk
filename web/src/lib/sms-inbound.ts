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

// One auto-reply per number per 10 min (resets on cold start, which is fine).
const lastAutoReply: Record<string, number> = {}
const AUTO_REPLY_COOLDOWN_MS = 10 * 60 * 1000

type Customer = { id: string; name: string; phone: string; email?: string } | undefined
type ShopSettings = {
  shop_id: string
  shop_name?: string
  shop_phone?: string
  telnyx_phone_number?: string
  telnyx_api_key?: string
  telnyx_messaging_profile_id?: string
  ai_api_key?: string
  ai_model?: string
  ai_base_url?: string
}

function phoneDigits(value: string): string {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}

async function findShopSettings(db: ReturnType<typeof getServiceClient>, toNumber: string): Promise<ShopSettings | null> {
  const target = phoneDigits(toNumber)
  if (!target) return null
  const { data, error } = await db.from('settings')
    .select('shop_id,shop_name,shop_phone,telnyx_phone_number,telnyx_api_key,telnyx_messaging_profile_id,ai_api_key,ai_model,ai_base_url')
    .limit(1000)
  if (error) {
    console.error('Inbound SMS settings lookup failed:', error)
    return null
  }
  const rows = (data || []) as ShopSettings[]
  const matches = rows.filter(row => [row.telnyx_phone_number, row.shop_phone]
    .some(value => phoneDigits(String(value || '')) === target))
  // A shared number is ambiguous: never route one tenant's inbound message
  // into another tenant's inbox.
  return matches.length === 1 ? matches[0] : null
}

export async function handleInboundSms(opts: {
  from: string
  body: string
  messageId?: string
  toNumber?: string
}): Promise<void> {
  const fromRaw = opts.from || ''
  const msgBody = opts.body || ''
  const messageId = opts.messageId || ''
  const fromDigits = phoneDigits(fromRaw)
  if (!fromRaw || !fromDigits) return

  // Resolve the destination to one shop before reading or writing any tenant data.
  const db = getServiceClient()
  const settings = await findShopSettings(db, opts.toNumber || '')
  if (!settings?.shop_id) return
  const shopNumber = settings.telnyx_phone_number || settings.shop_phone || opts.toNumber || ''
  if (!shopNumber) return

  // Never auto-reply to our own Telnyx/shop numbers.
  if (phoneDigits(shopNumber) === fromDigits) return

  // Dedupe within the resolved shop.
  if (messageId) {
    const { data: existing } = await db
      .from('messages')
      .select('id')
      .eq('shop_id', settings.shop_id)
      .eq('telnyx_message_id', messageId)
      .limit(1)
    if (existing && existing.length > 0) return
  }

  const { data: customers } = await db
    .from('customers')
    .select('id,name,phone,email')
    .eq('shop_id', settings.shop_id)
    .ilike('phone', '%' + fromDigits + '%')
    .limit(1)
  const customer = customers?.[0] as Customer

  const { error: insertErr } = await db.from('messages').insert({
    shop_id: settings.shop_id,
    direction: 'inbound',
    channel: 'sms',
    from_address: fromRaw,
    to_address: shopNumber,
    body: msgBody,
    status: 'received',
    customer_id: customer?.id || null,
    read: false,
    telnyx_message_id: messageId || null,
    ai_handled: false,
  })
  if (insertErr) {
    console.error('Inbound SMS could not be recorded:', insertErr)
    return
  }

  // STOP/UNSUBSCRIBE is recorded but never receives an auto-reply.
  if (isOptOut(msgBody)) {
    if (customer?.id) {
      try {
        await db.from('customers').update({ sms_opted_out: true }).eq('id', customer.id).eq('shop_id', settings.shop_id)
      } catch { /* The optional flag may not exist in older schemas. */ }
    }
    return
  }

  const now = Date.now()
  const cooldownKey = settings.shop_id + ':' + fromDigits
  if (lastAutoReply[cooldownKey] && now - lastAutoReply[cooldownKey] < AUTO_REPLY_COOLDOWN_MS) return

  const reply = await generateAIReply(msgBody, customer, db, settings)
  if (reply) {
    try {
      await sendSMS(fromRaw, reply, shopNumber, {
        apiKey: settings.telnyx_api_key || '',
        messagingProfileId: settings.telnyx_messaging_profile_id || '',
      })
      lastAutoReply[cooldownKey] = Date.now()
      await db.from('messages').insert({
        shop_id: settings.shop_id,
        direction: 'outbound',
        channel: 'sms',
        from_address: shopNumber,
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
  db: ReturnType<typeof getServiceClient>,
  settings: ShopSettings
): Promise<string | null> {
  try {
    if (!settings?.ai_api_key) return getDefaultReply(message, customer, settings)

    let jobContext = ''
    if (customer?.id) {
      const { data: jobs } = await db
        .from('jobs')
        .select('status,concern,vehicle_year,vehicle_make,vehicle_model')
        .eq('shop_id', settings.shop_id)
        .eq('customer_id', customer.id)
        .not('status', 'in', '("Paid","Closed")')
        .limit(3)
      if (jobs?.length) {
        jobContext = '\nOpen jobs: ' + jobs.map(j => j.status + ': ' + j.concern + ' (' + [j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ') + ')').join('; ')
      }
    }

    const shopName = settings.shop_name || 'your auto shop'
    const shopPhone = settings.shop_phone || settings.telnyx_phone_number || ''
    const systemPrompt = 'You are the SMS receptionist for ' + shopName + '.\n' +
      (shopPhone ? 'Phone: ' + shopPhone + ' | ' : '') +
      'Hours: Mon-Fri 8am-6pm, Sat 9am-3pm\n' +
      (customer ? 'Customer: ' + customer.name + jobContext : 'Unknown customer.') +
      '\nReply in 1-2 sentences under 160 characters. Warm, professional, brief.'

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const aiBaseUrl = normalizeAiBaseUrl(settings.ai_base_url || AI_BASE_URLS.OPENROUTER)
      const aiModel = normalizeAiModel(settings.ai_model, aiBaseUrl)
      const res = await fetch(aiBaseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + settings.ai_api_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: aiModel,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
          max_tokens: 80,
          temperature: 0.4,
        }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) return getDefaultReply(message, customer, settings)
      const data = await res.json()
      return data.choices?.[0]?.message?.content?.trim() || getDefaultReply(message, customer, settings)
    } catch {
      clearTimeout(timeout)
      return getDefaultReply(message, customer, settings)
    }
  } catch {
    return getDefaultReply(message, customer, settings)
  }
}

function getDefaultReply(message: string, customer: { name?: string } | undefined, settings: ShopSettings | null): string {
  const name = customer?.name ? ' ' + customer.name.split(' ')[0] : ''
  const shopName = settings?.shop_name || 'our shop'
  const phone = settings?.shop_phone || settings?.telnyx_phone_number || ''
  const lc = message.toLowerCase()
  if (lc.includes('status') || lc.includes('ready') || lc.includes('car') || lc.includes('vehicle'))
    return 'Hi' + name + '! We will check on your vehicle and call you right back.' + (phone ? ' ' + phone : '')
  if (lc.includes('schedule') || lc.includes('appointment'))
    return 'Hi' + name + '! Call us' + (phone ? ' at ' + phone : '') + ' or reply with a good time to schedule.'
  if (lc.includes('price') || lc.includes('cost') || lc.includes('how much'))
    return 'Hi' + name + '! Our technician will call you with a quote shortly.' + (phone ? ' ' + phone : '')
  return 'Hi' + name + '! Thanks for contacting ' + shopName + '. We will be in touch shortly.' + (phone ? ' Call ' + phone + ' if urgent.' : '')
}
