import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendSMS, formatPhone } from '@/lib/telnyx'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const event = body?.data

    // Handle inbound SMS
    if (event?.event_type === 'message.received') {
      const msg = event.payload
      const fromNumber = msg.from?.phone_number || msg.from
      const msgBody = msg.text || ''

      const db = getServiceClient()

      // Look up customer by phone
      const digits = (fromNumber || '').replace(/\D/g, '').slice(-10)
      const { data: customers } = await db
        .from('customers')
        .select('id,name,phone,email')
        .ilike('phone', `%${digits}%`)
        .limit(1)
      const customer = customers?.[0]

      // Store inbound message
      await db.from('messages').insert({
        direction: 'inbound',
        channel: 'sms',
        from_address: fromNumber,
        to_address: msg.to?.[0]?.phone_number || process.env.TELNYX_PHONE_NUMBER,
        body: msgBody,
        status: 'received',
        customer_id: customer?.id || null,
        read: false,
        telnyx_message_id: msg.id,
        ai_handled: false,
      })

      // AI auto-reply
      const reply = await generateAIReply(msgBody, customer, db)
      if (reply) {
        await sendSMS(fromNumber, reply)
        await db.from('messages').insert({
          direction: 'outbound',
          channel: 'sms',
          from_address: process.env.TELNYX_PHONE_NUMBER,
          to_address: fromNumber,
          body: reply,
          status: 'sent',
          customer_id: customer?.id || null,
          ai_handled: true,
        })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e: unknown) {
    console.error('SMS webhook error:', e)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

async function generateAIReply(
  message: string,
  customer: { id: string; name: string; phone: string } | undefined,
  db: ReturnType<typeof getServiceClient>
): Promise<string | null> {
  try {
    // Get shop settings
    const { data: settings } = await db.from('settings').select('*').limit(1).single()
    if (!settings?.ai_api_key) return getDefaultReply(message, customer, settings)

    // Get customer's open jobs if known
    let jobContext = ''
    if (customer?.id) {
      const { data: jobs } = await db
        .from('jobs')
        .select('status,concern,vehicle_year,vehicle_make,vehicle_model')
        .eq('customer_id', customer.id)
        .not('status', 'in', '("Paid","Closed")')
        .limit(3)
      if (jobs?.length) {
        jobContext = `\nCustomer's open jobs: ${jobs.map(j => `${j.status}: ${j.concern} (${[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')})`).join('; ')}`
      }
    }

    const systemPrompt = `You are the AI receptionist for ${settings.shop_name}, an auto repair shop.
Address: ${settings.shop_address}
Phone: ${settings.shop_phone}
Hours: Monday-Friday 8am-6pm, Saturday 9am-3pm
Labor rate: $${settings.labor_rate}/hr

${customer ? `Texting with known customer: ${customer.name}${jobContext}` : 'This is an unknown customer.'}

Reply to their text message professionally but warmly. Keep it SHORT (1-3 sentences max — this is SMS).
If they ask about their car status, give the job status if you have it.
If they want to schedule, say you'll have someone call them shortly.
If they have a complex question, say you'll have a technician follow up.
Never make up prices or promises you can't keep.
NEVER exceed 160 characters if possible.`

    const res = await fetch(`${settings.ai_base_url || 'https://openrouter.ai/api/v1'}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${settings.ai_api_key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.ai_model || 'meta-llama/llama-3.3-70b-instruct:free',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        max_tokens: 200,
        temperature: 0.5
      })
    })

    const data = await res.json()
    return data.choices?.[0]?.message?.content?.trim() || getDefaultReply(message, customer, settings)
  } catch {
    return null
  }
}

function getDefaultReply(message: string, customer: { name?: string } | undefined, settings: Record<string, unknown> | null): string {
  const name = customer?.name ? ` ${customer.name.split(' ')[0]}` : ''
  const shopName = (settings?.shop_name as string) || 'Alpha International Auto Center'
  const phone = (settings?.shop_phone as string) || '(713) 663-6979'
  const lc = message.toLowerCase()

  if (lc.includes('status') || lc.includes('ready') || lc.includes('car') || lc.includes('vehicle'))
    return `Hi${name}! We'll check on your vehicle status and call you right back. ${phone} — ${shopName}`
  if (lc.includes('schedule') || lc.includes('appointment') || lc.includes('bring'))
    return `Hi${name}! We'd love to schedule you. Call us at ${phone} or reply with a good time. — ${shopName}`
  if (lc.includes('price') || lc.includes('cost') || lc.includes('how much'))
    return `Hi${name}! Our tech will call you with a quote shortly. ${phone} — ${shopName}`

  return `Hi${name}! Thanks for reaching out to ${shopName}. We'll get back to you shortly. Call us at ${phone} if urgent.`
}
