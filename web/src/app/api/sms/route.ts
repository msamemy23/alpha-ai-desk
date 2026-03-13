export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendSMS } from '@/lib/telnyx'

const SHOP_PHONE = process.env.TELNYX_PHONE_NUMBER || '+17136636979'

// All Telnyx numbers on this account - never auto-reply to these (prevents intra-account echo loops)
const INTERNAL_NUMBERS = new Set(['17136636979', '12819368645'])

// In-memory rate limit: one auto-reply per number per 10 minutes (resets on cold start, that's fine)
const lastAutoReply: Record<string, number> = {}
const AUTO_REPLY_COOLDOWN_MS = 10 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const event = body?.data as Record<string, unknown> | undefined

    // Only handle inbound SMS - ignore delivery receipts, status updates, etc.
    if (!event || event.event_type !== 'message.received') {
      return NextResponse.json({ ok: true })
    }

    const msg = event.payload as Record<string, unknown>
    const fromRaw = (msg.from as Record<string, unknown>)?.phone_number as string || msg.from as string || ''
    const msgBody: string = (msg.text as string) || ''
    const messageId: string = (msg.id as string) || ''
    const fromDigits = fromRaw.replace(/\D/g, '').slice(-10)

    // BLOCK: Never auto-reply to our own Telnyx numbers (intra-account echo prevention)
    if (INTERNAL_NUMBERS.has(fromDigits) || INTERNAL_NUMBERS.has(fromRaw.replace(/\D/g,''))) {
      return NextResponse.json({ ok: true })
    }

    const db = getServiceClient()

    // DEDUP: Skip if we already handled this message
    if (messageId) {
      const { data: existing } = await db
        .from('messages')
        .select('id')
        .eq('telnyx_message_id', messageId)
        .limit(1)
      if (existing && existing.length > 0) {
        return NextResponse.json({ ok: true })
      }
    }

    // Look up customer
    const { data: customers } = await db
      .from('customers')
      .select('id,name,phone,email')
      .ilike('phone', `%${fromDigits}%`)
      .limit(1)
    const customer = customers?.[0]

    // Store inbound message
    const { error: insertErr } = await db.from('messages').insert({
      direction: 'inbound',
      channel: 'sms',
      from_address: fromRaw,
      to_address: (msg.to as Record<string, unknown>[])?.[0]?.phone_number as string || SHOP_PHONE,
      body: msgBody,
      status: 'received',
      customer_id: customer?.id || null,
      read: false,
      telnyx_message_id: messageId || null,
      ai_handled: false,
    })

    // If insert conflict, message already handled
    if (insertErr) {
      return NextResponse.json({ ok: true })
    }

    // RATE LIMIT: one auto-reply per number per 10 minutes
    const now = Date.now()
    if (lastAutoReply[fromDigits] && now - lastAutoReply[fromDigits] < AUTO_REPLY_COOLDOWN_MS) {
      return NextResponse.json({ ok: true })
    }

    // Generate and send auto-reply
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

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('SMS webhook error:', e)
    return NextResponse.json({ ok: true }) // Always 200 to prevent Telnyx retries
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
        jobContext = `\nOpen jobs: ${jobs.map(j => `${j.status}: ${j.concern} (${[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')})`).join('; ')}`
      }
    }

    const systemPrompt = `You are the SMS receptionist for ${settings.shop_name || 'Alpha International Auto Center'} auto repair shop.
Phone: ${settings.shop_phone || '(713) 663-6979'} | Hours: Mon-Fri 8am-6pm, Sat 9am-3pm
${customer ? `Customer: ${customer.name}${jobContext}` : 'Unknown customer.'}
Reply in 1-2 sentences under 160 characters. Warm, professional, brief.`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000) // 8s max for AI
    try {
      const res = await fetch(`${settings.ai_base_url || 'https://openrouter.ai/api/v1'}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${settings.ai_api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.ai_model || 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
          max_tokens: 80,
          temperature: 0.4
        }),
        signal: controller.signal
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