import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'
import { getRouteShop, unauthorized } from '@/lib/api-auth'
import { calcTotals } from '@/lib/supabase'
import { isSmsOptedOut } from '@/lib/sms-consent'
import { revalidateAutomationInvocation, validateAutomationInvocation } from '@/lib/automation-fencing'

export const dynamic = 'force-dynamic'


async function sendSMS(to: string, message: string, apiKey: string, fromNumber: string, idempotencyKey?: string) {
  if (!apiKey || !fromNumber) return { success: false, error: 'Telnyx not configured' }
  const r = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
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
  const automationCheck = await validateAutomationInvocation(req, body as Record<string, unknown> | null, auth.shopId, ['estimate_followups'])
  if (!automationCheck.ok) return NextResponse.json({ ok: false, error: automationCheck.error }, { status: automationCheck.status })

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
    .from('documents')
    .select('id,customer_id,customer_name,customer_phone,customer_email,parts,labors,line_items,created_at,status,type')
    .lte('created_at', cutoff)
    .gte('created_at', twoWeeksAgo)
    .eq('shop_id', auth.shopId)
    .eq('type', 'Estimate')
    .neq('status', 'converted')
    .neq('status', 'cancelled')
  if (estimatesError) return NextResponse.json({ ok: false, error: 'Unable to load estimates' }, { status: 500 })

  const customerIds = [...new Set((estimates || []).map(est => est.customer_id).filter(Boolean))]
  const { data: customers, error: customersError } = customerIds.length
    ? await sb.from('customers').select('id,name,phone,email,sms_opted_out').eq('shop_id', auth.shopId).in('id', customerIds)
    : { data: [], error: null }
  if (customersError) return NextResponse.json({ ok: false, error: 'Unable to load estimate customers' }, { status: 500 })
  const customerById = new Map((customers || []).map(customer => [customer.id, customer]))

  const results: Array<Record<string, unknown>> = []

  for (const est of estimates || []) {
    const customer = (est.customer_id ? customerById.get(est.customer_id) : null) || {
      id: est.customer_id,
      name: est.customer_name || 'Customer',
      phone: est.customer_phone || '',
      email: est.customer_email || '',
      sms_opted_out: false,
    }

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

    const total = `$${calcTotals(est as Record<string, unknown>).total.toFixed(2)}`
    const msg = `Hi ${customer.name}! Just checking in — we sent you an estimate for ${total} for your vehicle. We'd love to help you get it done. ${contactLine} ${shopName}`

    let sent = false
    if (!dryRun) {
      // Try SMS first, then email
      let sentBySms = false
      if (customer.phone && !customer.sms_opted_out && !(await isSmsOptedOut(sb, auth.shopId, customer.phone))) {
        const beforeSms = await revalidateAutomationInvocation(req, body as Record<string, unknown>, auth.shopId, ['estimate_followups'])
        if (!beforeSms.ok) return NextResponse.json({ ok: false, error: beforeSms.error }, { status: beforeSms.status })
        const smsResult = await sendSMS(customer.phone, msg, telnyxKey, telnyxFrom, `estimate-followup-${est.id}`)
        sent = smsResult.success
        sentBySms = smsResult.success
      }
      if (!sent && customer.email) {
        try {
          const beforeEmail = await revalidateAutomationInvocation(req, body as Record<string, unknown>, auth.shopId, ['estimate_followups'])
          if (!beforeEmail.ok) return NextResponse.json({ ok: false, error: beforeEmail.error }, { status: beforeEmail.status })
          if (!settings?.resend_api_key || !settings?.from_email) throw new Error('Email is not configured for this shop')
          await sendEmail({
            to: customer.email,
            subject: `Following up on your estimate — ${shopName}`,
            html: `<p>Hi ${escapeHtml(String(customer.name))},</p><p>We wanted to follow up on the estimate we sent you. We're ready to help get your vehicle taken care of!</p><p>Total estimate: <strong>${escapeHtml(total)}</strong></p><p>${escapeHtml(contactLine)}</p><p>${escapeHtml(shopName)}</p>`,
            apiKey: settings.resend_api_key,
            from: settings.from_email,
            replyTo: settings.shop_email,
            idempotencyKey: `estimate-followup-${est.id}`,
          })
          sent = true
        } catch { /* ignore */ }
      }

      // Log it and surface a provider/logging mismatch instead of pretending
      // the workflow completed.
      let logError: { message: string } | null = null
      if (automationCheck.ok && automationCheck.runId && automationCheck.fencingToken !== undefined) {
        const fenced = await sb.rpc('insert_estimate_followup_fenced', {
          p_shop_id: auth.shopId,
          p_run_id: automationCheck.runId,
          p_fencing_token: automationCheck.fencingToken,
          p_estimate_id: est.id,
          p_customer_id: est.customer_id,
          p_method: sentBySms ? 'sms' : 'email',
          p_sent: sent,
        })
        logError = fenced.error
      } else {
        const beforeLog = await revalidateAutomationInvocation(req, body as Record<string, unknown>, auth.shopId, ['estimate_followups'])
        if (!beforeLog.ok) return NextResponse.json({ ok: false, uncertain: true, reconciliation_required: true, error: 'Estimate follow-up was sent but its automation lease expired before it could be logged' }, { status: 502 })
        const logged = await sb.from('estimate_followups_sent').insert({
          shop_id: auth.shopId,
          estimate_id: est.id,
          customer_id: est.customer_id,
          method: sentBySms ? 'sms' : 'email',
          sent,
          created_at: new Date().toISOString(),
        })
        logError = logged.error
      }
      if (logError) return NextResponse.json({ ok: false, uncertain: true, reconciliation_required: true, error: 'Estimate follow-up was sent but could not be logged' }, { status: 502 })
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

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char))
}
