import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

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
  const { action = 'run', dry_run = false } = body
  const sb = getServiceClient()

  if (action === 'run') {
    // Check vehicles for upcoming service needs
    const { data: vehicles } = await sb
      .from('vehicles')
      .select('*, customers(name, phone)')
      .order('updated_at', { ascending: true })

    const { data: invoices } = await sb
      .from('invoices')
      .select('customer_id, vehicle_id, created_at, items')
      .order('created_at', { ascending: false })

    const results: Array<Record<string, unknown>> = []
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000

    // Build last oil change per vehicle
    const lastOilChange: Record<string, string> = {}
    for (const inv of invoices || []) {
      const items = typeof inv.items === 'string' ? JSON.parse(inv.items) : (inv.items || [])
      const hasOilChange = items.some((i: Record<string, string>) => /oil.?change/i.test(i.description || i.name || ''))
      if (hasOilChange && inv.vehicle_id && !lastOilChange[inv.vehicle_id]) {
        lastOilChange[inv.vehicle_id] = inv.created_at
      }
    }

    for (const vehicle of vehicles || []) {
      const customer = vehicle.customers as Record<string, string> | null
      if (!customer?.phone) continue

      const lastChange = lastOilChange[vehicle.id]
      if (!lastChange) continue

      const daysSinceOilChange = (Date.now() - new Date(lastChange).getTime()) / (1000 * 60 * 60 * 24)
      const milesSince = (vehicle.current_mileage || 0) - (vehicle.last_oil_change_mileage || 0)

      // Due if 85+ days or 2500+ miles since last oil change
      const isDue = daysSinceOilChange > 85 || milesSince > 2500
      if (!isDue) continue

      // Don't spam — check if we sent a reminder in the last 30 days
      const { data: recentReminder } = await sb
        .from('service_reminders_sent')
        .select('id')
        .eq('vehicle_id', vehicle.id)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
        .limit(1)

      if (recentReminder && recentReminder.length > 0) continue

      const msg = `Hi ${customer.name}! Your ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} is due for an oil change. Alpha International Auto Center is ready for you — call (713) 663-6979 or just reply to this text!`

      if (!dry_run) {
        const result = await sendSMS(customer.phone, msg)
        await sb.from('service_reminders_sent').insert({
          vehicle_id: vehicle.id,
          customer_id: vehicle.customer_id,
          message: msg,
          sent: result.success,
          created_at: new Date().toISOString(),
        }).catch(() => {}) // table may not exist yet, ignore
        results.push({ vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, customer: customer.name, sent: result.success })
      } else {
        results.push({ vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, customer: customer.name, sent: false, dry_run: true, message: msg })
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results })
  }

  if (action === 'appointment_reminders') {
    // Look for jobs/appointments scheduled for tomorrow
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    const { data: jobs } = await sb
      .from('jobs')
      .select('*, customers(name, phone)')
      .gte('scheduled_date', tomorrowStr + 'T00:00:00')
      .lt('scheduled_date', tomorrowStr + 'T23:59:59')
      .eq('status', 'scheduled')

    const results: Array<Record<string, unknown>> = []

    for (const job of jobs || []) {
      const customer = job.customers as Record<string, string> | null
      if (!customer?.phone) continue
      const msg = `Hi ${customer.name}! Reminder: you have a service appointment at Alpha International Auto Center tomorrow. Call (713) 663-6979 if you need to reschedule. See you then!`
      if (!dry_run) {
        const result = await sendSMS(customer.phone, msg)
        results.push({ job: job.id, customer: customer.name, sent: result.success })
      } else {
        results.push({ job: job.id, customer: customer.name, sent: false, dry_run: true })
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results })
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}
