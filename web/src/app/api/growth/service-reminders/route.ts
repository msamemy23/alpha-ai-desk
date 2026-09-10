import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getRouteShop, unauthorized } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'


async function sendSMS(to: string, message: string, apiKey: string, from: string) {
  if (!apiKey || !from) return { success: false, error: 'Telnyx not configured' }
  const r = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, text: message }),
  })
  if (!r.ok) return { success: false, error: `Telnyx returned ${r.status}` }
  const d = await r.json()
  return d.data?.id ? { success: true } : { success: false, error: d.errors?.[0]?.detail }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const auth = await getRouteShop(req, body?.shopId)
  if (!auth) return unauthorized()
  const action = body?.action || 'run'
  const dryRun = body?.dry_run === true
  const sb = getServiceClient()
  const { data: settings, error: settingsError } = await sb.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
  if (settingsError) return NextResponse.json({ ok: false, error: 'Unable to load shop settings' }, { status: 500 })
  const shopName = String(settings?.shop_name || 'our shop').slice(0, 120)
  const shopPhone = String(settings?.shop_phone || '').slice(0, 40)
  const telnyxKey = String(settings?.telnyx_api_key || '')
  const telnyxFrom = String(settings?.telnyx_phone_number || '')

  if (action === 'run') {
    // Check vehicles for upcoming service needs
    const { data: vehicles } = await sb
      .from('vehicles')
      .select('*, customers(name, phone)')
      .eq('shop_id', auth.shopId)
      .order('updated_at', { ascending: true })

    const { data: invoices } = await sb
      .from('invoices')
      .select('customer_id, vehicle_id, created_at, items')
      .eq('shop_id', auth.shopId)
      .order('created_at', { ascending: false })

    const results: Array<Record<string, unknown>> = []

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
        .eq('shop_id', auth.shopId)
        .eq('vehicle_id', vehicle.id)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
        .limit(1)

      if (recentReminder && recentReminder.length > 0) continue

      const msg = `Hi ${customer.name}! Your ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} is due for an oil change. ${shopName} is ready for you${shopPhone ? ` — call ${shopPhone}` : ''} or just reply to this text!`

      if (!dryRun) {
        const result = await sendSMS(customer.phone, msg, telnyxKey, telnyxFrom)
        try {
          const { error: reminderError } = await sb.from('service_reminders_sent').insert({
            shop_id: auth.shopId,
            vehicle_id: vehicle.id,
            customer_id: vehicle.customer_id,
            message: msg,
            sent: result.success,
            created_at: new Date().toISOString(),
          })
          if (reminderError) throw reminderError
        } catch { /* table may not exist yet */ }
        results.push({ vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, customer: customer.name, sent: result.success })
      } else {
        results.push({ vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, customer: customer.name, sent: false, dry_run: true, message: msg })
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results })
  }

  if (action === 'appointment_reminders') {
    // Text everyone with an appointment tomorrow. Reads the real appointments
    // table (this used to query jobs.scheduled_date, which doesn't exist — the
    // reminder never fired once).
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    const { data: appts } = await sb
      .from('appointments')
      .select('*')
      .eq('shop_id', auth.shopId)
      .eq('date', tomorrowStr)
      .in('status', ['Scheduled', 'Confirmed'])

    const results: Array<Record<string, unknown>> = []

    for (const appt of appts || []) {
      const phone = (appt.phone || '').trim()
      if (!phone) continue
      // Never double-text: skip if a reminder already went out for this one.
      if (appt.reminder_sent_at) continue

      const timeText = appt.time ? ` at ${appt.time}` : ''
      const serviceText = appt.service ? ` for ${appt.service}` : ''
      const msg = `Hi ${appt.customer_name || 'there'}! Reminder: you have an appointment${serviceText} at ${shopName} tomorrow${timeText}.${shopPhone ? ` Call ${shopPhone}` : ''} if you need to reschedule. See you then!`

      if (!dryRun) {
        const result = await sendSMS(phone, msg, telnyxKey, telnyxFrom)
        if (result.success) {
          try {
            const { error: appointmentError } = await sb.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', appt.id).eq('shop_id', auth.shopId)
            if (appointmentError) throw appointmentError
          } catch { /* column may not exist yet — reminder still went out */ }
        }
        results.push({ appointment: appt.id, customer: appt.customer_name, time: appt.time, sent: result.success, error: result.error })
      } else {
        results.push({ appointment: appt.id, customer: appt.customer_name, time: appt.time, sent: false, dry_run: true, message: msg })
      }
    }

    return NextResponse.json({ ok: true, processed: results.length, results })
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}
