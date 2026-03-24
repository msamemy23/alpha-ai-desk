import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendEmail } from '@/lib/email'

export const dynamic = 'force-dynamic'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_FROM = process.env.TELNYX_PHONE_NUMBER || ''

async function sendSMS(to: string, message: string) {
  if (!TELNYX_API_KEY || !TELNYX_FROM) return { success: false, error: 'Telnyx not configured' }
  const r = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: TELNYX_FROM, to, text: message }),
  })
  const d = await r.json()
  return d.data?.id ? { success: true } : { success: false, error: d.errors?.[0]?.detail }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { followup_hours = 48, dry_run = false } = body
  const sb = getServiceClient()

  const cutoff = new Date(Date.now() - followup_hours * 3600 * 1000).toISOString()
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()

  // Find estimates older than followup_hours that don't have a matching invoice
  const { data: estimates } = await sb
    .from('estimates')
    .select('*, customers(name, phone, email)')
    .lte('created_at', cutoff)
    .gte('created_at', twoWeeksAgo)
    .neq('status', 'converted')
    .neq('status', 'cancelled')

  const results: Array<Record<string, unknown>> = []

  for (const est of estimates || []) {
    const customer = est.customers as Record<string, string> | null
    if (!customer) continue

    // Check if already followed up on this estimate
    const { data: existing } = await sb
      .from('estimate_followups_sent')
      .select('id')
      .eq('estimate_id', est.id)
      .limit(1)

    if (existing && existing.length > 0) continue

    const total = typeof est.total === 'number' ? `$${est.total.toFixed(2)}` : 'your estimate'
    const msg = `Hi ${customer.name}! Just checking in — we sent you an estimate for ${total} for your vehicle. We'd love to help you get it done. Call us at (713) 663-6979 or reply here. Alpha International Auto Center`

    let sent = false
    if (!dry_run) {
      // Try SMS first, then email
      if (customer.phone) {
        const smsResult = await sendSMS(customer.phone, msg)
        sent = smsResult.success
      }
      if (!sent && customer.email) {
        try {
          await sendEmail({
            to: customer.email,
            subject: `Following up on your estimate — Alpha International`,
            body: `<p>Hi ${customer.name},</p><p>We wanted to follow up on the estimate we sent you. We're ready to help get your vehicle taken care of!</p><p>Total estimate: <strong>${total}</strong></p><p>Call us at <strong>(713) 663-6979</strong> or reply to this email to schedule your appointment.</p><p>Alpha International Auto Center<br>10710 S Main St, Houston TX</p>`,
          })
          sent = true
        } catch { /* ignore */ }
      }

      // Log it
      await sb.from('estimate_followups_sent').insert({
        estimate_id: est.id,
        customer_id: est.customer_id,
        method: customer.phone ? 'sms' : 'email',
        sent,
        created_at: new Date().toISOString(),
      }).catch(() => {})
    }

    results.push({
      estimate_id: est.id,
      customer: customer.name,
      total,
      sent: dry_run ? false : sent,
      dry_run,
    })
  }

  return NextResponse.json({ ok: true, processed: results.length, followed_up: results.filter(r => r.sent).length, results })
}
