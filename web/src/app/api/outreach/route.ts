export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendSMS, formatPhone } from '@/lib/telnyx'
import { sendEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    const { type, filter, template, channel } = await req.json()
    // type: 'follow_up_cold' | 'oil_change_reminder' | 'custom'
    // filter: { daysSinceLastVisit, status, tags }
    // template: string with {name}, {phone}, {shopName} placeholders
    // channel: 'sms' | 'email'

    const db = getServiceClient()
    const { data: settings } = await db.from('settings').select('*').limit(1).single()
    const shopName = settings?.shop_name || 'Alpha International Auto Center'

    let customers: Record<string, unknown>[] = []

    if (type === 'follow_up_cold' || filter?.daysSinceLastVisit) {
      // Customers with no job in X days
      const days = filter?.daysSinceLastVisit || 90
      const cutoff = new Date(Date.now() - days * 86400000).toISOString()
      const { data: recentCustomerIds } = await db
        .from('jobs')
        .select('customer_id')
        .gte('created_at', cutoff)
      const activeIds = (recentCustomerIds || []).map((j: Record<string,unknown>) => j.customer_id).filter(Boolean)

      const query = db.from('customers').select('id,name,phone,email').not('id', 'in', `(${activeIds.map((id: unknown) => `"${id}"`).join(',') || '"00000000-0000-0000-0000-000000000000"'})`)
      if (channel === 'sms') query.not('phone', 'is', null)
      if (channel === 'email') query.not('email', 'is', null)
      const { data } = await query.limit(500)
      customers = (data || []) as Record<string, unknown>[]
    } else if (type === 'custom' && filter?.status) {
      const { data: jobs } = await db
        .from('jobs')
        .select('customer_id, customer_name, customer:customers(id,name,phone,email)')
        .eq('status', filter.status)
      customers = (jobs || []).map((j: Record<string,unknown>) => j.customer as Record<string,unknown>).filter(Boolean)
    }

    let sent = 0; const errors: string[] = []

    for (const c of customers) {
      try {
        const name = (c.name as string || 'Valued Customer').split(' ')[0]
        const msg = (template || getDefaultTemplate(type, shopName))
          .replace('{name}', name)
          .replace('{shopName}', shopName)
          .replace('{phone}', settings?.shop_phone || '')

        if (channel === 'sms' && c.phone) {
          await sendSMS(formatPhone(c.phone as string), msg)
          await db.from('messages').insert({
            direction: 'outbound', channel: 'sms',
            from_address: settings?.telnyx_phone_number,
            to_address: c.phone,
            body: msg, customer_id: c.id,
            status: 'sent', read: true, ai_handled: true,
          })
          sent++
        } else if (channel === 'email' && c.email) {
          await sendEmail({
            to: c.email as string,
            subject: `${shopName} — We miss you!`,
            html: `<div style="font-family:Arial;padding:20px"><p>Hi ${name},</p><p>${msg.replace(/\n/g,'<br>')}</p><p style="color:#888;font-size:12px;margin-top:20px">${shopName} | ${settings?.shop_phone}</p></div>`,
            apiKey: settings?.resend_api_key,
            from: settings?.from_email,
          })
          await db.from('messages').insert({
            direction: 'outbound', channel: 'email',
            from_address: settings?.from_email,
            to_address: c.email,
            body: msg, customer_id: c.id,
            status: 'sent', read: true, ai_handled: true,
          })
          sent++
        }
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 100))
      } catch (e: unknown) {
        errors.push(`${c.name}: ${(e as Error).message}`)
      }
    }

    return NextResponse.json({ ok: true, sent, errors, total: customers.length })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

function getDefaultTemplate(type: string, shopName: string): string {
  const templates: Record<string, string> = {
    follow_up_cold: `Hi {name}! It's been a while since we've seen you at {shopName}. We miss you! 🚗\n\nWe're running specials this week on oil changes, brakes, and inspections. Call us at {phone} or just reply here to book.\n\nSee you soon!`,
    oil_change_reminder: `Hi {name}! Just a friendly reminder from {shopName} — it may be time for your oil change. 🛢️\n\nGive us a call at {phone} to schedule. Same-day appointments available!\n\n— {shopName}`,
    custom: `Hi {name}, this is {shopName}. We wanted to reach out — call us at {phone} if you need anything!`,
  }
  return templates[type] || templates.custom
}
