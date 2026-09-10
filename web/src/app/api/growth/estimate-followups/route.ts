import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import { getRouteShop, unauthorized } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'


async function sendSMS(to: string, message: string, apiKey: string, fromNumber: string) {
  if (!apiKey || !fromNumber) return { success: false, error: 'Telnyx not configured' }
  const r = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromNumber, to, text: message }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) return { success: false, error: d.errors?.[0]?.detail || `Telnyx returned ${r.status}` }
  return d.data?.id ? { success: true } : { success: false, error: d.errors?.[0]?.detail || 'Telnyx did not return a message id' }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const auth = await getRouteShop(req, body?.shopId)
  if (!auth) return unauthorized()

  const rawHours = Number(body?.followup_hours ?? 48)
  const followupHours = Number.isFinite(rawHours) && rawHours >= 1 && rawHours <= 720 ? rawHours : 48
  const dryRun = body?.dry_run === true
  const sb = getServiceClient()
  const { data: settings, error: settingsError } = await sb.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
  if (settingsError) return NextResponse.json({ ok: false, error: 'Unable to load shop settings' }, { status: 500 })
  const shopName = String(settings?.shop_name || settings?.company_name || settings?.business_name || 'our shop').slice(0, 120)
  const shopPhone = String(settings?.shop_phone || settings?.phone || settings?.business_phone || '').slice(0, 40)
  const telnyxKey = String(settings?.telnyx_api_key || '')
  const telnyxFrom = String(settings?.telnyx_phone_number || '')
  const contactLine = shopPhone ? `Call us at ${shopPhone} or reply here.` : 'Reply here to schedule.'
  const cutoff = new Date(Date.now() - followupHours * 3600 * 1000).toISOString()
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()

  // Find estimates older than followup_hours that don't have a matching invoice
  const { data: estimates, error: estimatesError } = await sb
    .from('estimates')
    .select('*, customers(name, phone, email)')
    .lte('created_at', cutoff)
    .gte('created_at', twoWeeksAgo)
    .eq('shop_id', auth.shopId)
    .neq('status', 'converted')
    .neq('status', 'cancelled')
  if (estimatesError) return NextResponse.json({ ok: false, error: 'Unable to load estimates' }, { status: 500 })

  const results: Array<Record<string, unknown>> = []

  for (const est of estimates || []) {
    const customer = est.customers as Record<string, string> | null
    if (!customer) continue

    // Check if already followed up on this estimate
    const { data: existing, error: existingError } = await sb
      .from('estimate_followups_sent')
      .select('id')
      .eq('shop_id', auth.shopId)
      .eq('estimate_id', est.id)
      .eq('sent', true)
      .limit(1)
    if (existingError) return NextResponse.json({ ok: false, error: 'Unable to check estimate follow-up history' }, { status: 500 })

    if (existing && existing.length > 0) continue

    const total = typeof est.total === 'number' ? `$${est.total.toFixed(2)}` : 'your estimate'
    const msg = `Hi ${customer.name}! Just checking in — we sent you an estimate for ${total} for your vehicle. We'd love to help you get it done. ${contactLine} ${shopName}`

    let sent = false
    if (!dryRun) {
      // Try SMS first, then email
      if (customer.phone) {
        const smsResult = await sendSMS(customer.phone, msg, telnyxKey, telnyxFrom)
        sent = smsResult.success
      }
      if (!sent && customer.email) {
        try {
          if (!settings?.resend_api_key || !settings?.from_email) throw new Error('Email is not configured for this shop')
          await sendEmail({
            to: customer.email,
            subject: `Following up on your estimate — ${shopName}`,
            html: `<p>Hi ${customer.name},</p><p>We wanted to follow up on the estimate we sent you. We're ready to help get your vehicle taken care of!</p><p>Total estimate: <strong>${total}</strong></p><p>${contactLine}</p><p>${shopName}</p>`,
            apiKey: settings.resend_api_key,
            from: settings.from_email,
            replyTo: settings.shop_email,
          })
          sent = true
        } catch { /* ignore */ }
      }

      // Log it
      try {
        await sb.from('estimate_followups_sent').insert({
          shop_id: auth.shopId,
          estimate_id: est.id,
          customer_id: est.customer_id,
          method: customer.phone && sent ? 'sms' : 'email',
          sent,
          created_at: new Date().toISOString(),
        })
      } catch { /* table may not exist yet */ }
    }

    results.push({
      estimate_id: est.id,
      customer: customer.name,
      total,
      sent: dryRun ? false : sent,
      dry_run: dryRun,
    })
  }

  const failed = !dryRun && results.some(result => result.sent !== true)
  const success = dryRun || !failed
  return NextResponse.json({ ok: success, success, processed: results.length, followed_up: results.filter(r => r.sent).length, results }, { status: success ? 200 : 502 })
}
