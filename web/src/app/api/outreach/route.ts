export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { sendSMS, formatPhone } from '@/lib/telnyx'
import { sendEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const { type, filter, template, channel } = await req.json()
    // type: 'follow_up_cold' | 'oil_change_reminder' | 'custom'
    // filter: { daysSinceLastVisit, status, tags }
    // template: string with {name}, {phone}, {shopName} placeholders
    // channel: 'sms' | 'email'

    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('*').eq('shop_id', auth.shopId).limit(1).maybeSingle()
    if (settingsError) return NextResponse.json({ error: 'Shop settings could not be loaded' }, { status: 500 })
    const shopName = settings?.shop_name || 'Your Auto Shop'
    if (channel === 'sms' && (!settings?.telnyx_api_key || !settings?.telnyx_phone_number)) return NextResponse.json({ error: 'SMS is not configured for this shop' }, { status: 503 })
    if (channel === 'email' && (!settings?.resend_api_key || !settings?.from_email)) return NextResponse.json({ error: 'Email is not configured for this shop' }, { status: 503 })

    let customers: Record<string, unknown>[] = []

    if (type === 'follow_up_cold' || filter?.daysSinceLastVisit) {
      // Customers with no job in X days
      const days = filter?.daysSinceLastVisit || 90
      const cutoff = new Date(Date.now() - days * 86400000).toISOString()
      const { data: recentCustomerIds, error: recentCustomerIdsError } = await db
        .from('jobs')
        .select('customer_id')
        .eq('shop_id', auth.shopId)
        .gte('created_at', cutoff)
      if (recentCustomerIdsError) return NextResponse.json({ ok: false, error: 'Customer activity could not be loaded' }, { status: 500 })
      const activeIds = (recentCustomerIds || []).map((j: Record<string,unknown>) => j.customer_id).filter(Boolean)

      const query = db.from('customers').select('id,name,phone,email').eq('shop_id', auth.shopId).not('id', 'in', `(${activeIds.map((id: unknown) => `"${id}"`).join(',') || '"00000000-0000-0000-0000-000000000000"'})`)
      if (channel === 'sms') query.not('phone', 'is', null)
      if (channel === 'email') query.not('email', 'is', null)
      const { data, error: customersError } = await query.limit(500)
      if (customersError) return NextResponse.json({ ok: false, error: 'Customers could not be loaded' }, { status: 500 })
      customers = (data || []) as Record<string, unknown>[]
    } else if (type === 'custom' && filter?.status) {
      const { data: jobs, error: jobsError } = await db
        .from('jobs')
        .select('customer_id, customer_name, customer:customers(id,name,phone,email)')
        .eq('shop_id', auth.shopId)
        .eq('status', filter.status)
      if (jobsError) return NextResponse.json({ ok: false, error: 'Jobs could not be loaded' }, { status: 500 })
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
          await sendSMS(formatPhone(c.phone as string), msg, settings.telnyx_phone_number, { apiKey: settings.telnyx_api_key, messagingProfileId: settings.telnyx_messaging_profile_id || '' })
          const { error: messageError } = await db.from('messages').insert({
            shop_id: auth.shopId,
            direction: 'outbound', channel: 'sms',
            from_address: settings?.telnyx_phone_number,
            to_address: c.phone,
            body: msg, customer_id: c.id,
            status: 'sent', read: true, ai_handled: true,
          })
          if (messageError) throw messageError
          sent++
        } else if (channel === 'email' && c.email) {
          await sendEmail({
            to: c.email as string,
            subject: `${shopName} — We miss you!`,
            html: `<div style="font-family:Arial;padding:20px"><p>Hi ${name},</p><p>${msg.replace(/\n/g,'<br>')}</p><p style="color:#888;font-size:12px;margin-top:20px">${shopName} | ${settings?.shop_phone}</p></div>`,
            apiKey: settings?.resend_api_key,
            from: settings?.from_email,
          })
          const { error: messageError } = await db.from('messages').insert({
            shop_id: auth.shopId,
            direction: 'outbound', channel: 'email',
            from_address: settings?.from_email,
            to_address: c.email,
            body: msg, customer_id: c.id,
            status: 'sent', read: true, ai_handled: true,
          })
          if (messageError) throw messageError
          sent++
        }
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 100))
      } catch (e: unknown) {
        errors.push(`${c.name}: ${(e as Error).message}`)
      }
    }

    const success = errors.length === 0
    return NextResponse.json({ ok: success, success, sent, errors, total: customers.length }, { status: success ? 200 : 502 })
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
