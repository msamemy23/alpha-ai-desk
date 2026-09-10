import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getRouteShop, unauthorized } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'


async function sendSMS(to: string, message: string, apiKey: string, from: string, idempotencyKey?: string) {
  if (!apiKey || !from) return { success: false, error: 'Telnyx not configured' }
  const r = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
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
    const { data: vehicles, error: vehiclesError } = await sb
      .from('vehicles')
      .select('*')
      .eq('shop_id', auth.shopId)
      .order('updated_at', { ascending: true })
    if (vehiclesError) return NextResponse.json({ ok: false, error: 'Unable to load vehicles' }, { status: 500 })

    const customerIds = [...new Set((vehicles || []).map(vehicle => vehicle.customer_id).filter(Boolean))]
    const { data: customers, error: customersError } = customerIds.length
      ? await sb.from('customers').select('id,name,phone,sms_opted_out').eq('shop_id', auth.shopId).in('id', customerIds)
      : { data: [], error: null }
    if (customersError) return NextResponse.json({ ok: false, error: 'Unable to load vehicle customers' }, { status: 500 })
    const customerById = new Map((customers || []).map(customer => [customer.id, customer]))

    const { data: invoices, error: invoicesError } = await sb
      .from('documents')
      .select('customer_id, vehicle_year, vehicle_make, vehicle_model, vehicle_vin, created_at, parts, labors, line_items')
      .eq('shop_id', auth.shopId)
      .in('type', ['Invoice', 'Receipt'])
      .order('created_at', { ascending: false })
    if (invoicesError) return NextResponse.json({ ok: false, error: 'Unable to load service history' }, { status: 500 })

    const results: Array<Record<string, unknown>> = []

    // Build last oil change per vehicle
    const lastOilChange: Record<string, string> = {}
    for (const inv of invoices || []) {
      const items = [
        ...(Array.isArray(inv.parts) ? inv.parts : []),
        ...(Array.isArray(inv.labors) ? inv.labors : []),
        ...(Array.isArray(inv.line_items) ? inv.line_items : []),
      ]
      const hasOilChange = items.some((item: Record<string, unknown>) => /oil.?change/i.test(String(item.description || item.name || item.operation || '')))
      if (hasOilChange && inv.customer_id) {
        const key = vehicleHistoryKey(inv.customer_id, inv.vehicle_vin, inv.vehicle_year, inv.vehicle_make, inv.vehicle_model)
        if (!lastOilChange[key]) lastOilChange[key] = inv.created_at
        const customerKey = vehicleHistoryKey(inv.customer_id, '', '', '', '')
        if (!lastOilChange[customerKey]) lastOilChange[customerKey] = inv.created_at
      }
    }

    for (const vehicle of vehicles || []) {
      const customer = customerById.get(vehicle.customer_id) as { name?: string; phone?: string; sms_opted_out?: boolean } | undefined
      if (!customer?.phone) continue

      const lastChange = lastOilChange[vehicleHistoryKey(vehicle.customer_id, vehicle.vin, vehicle.year, vehicle.make, vehicle.model)]
        || lastOilChange[vehicleHistoryKey(vehicle.customer_id, '', '', '', '')]
      if (!lastChange) continue

      const daysSinceOilChange = (Date.now() - new Date(lastChange).getTime()) / (1000 * 60 * 60 * 24)
      const milesSince = (vehicle.current_mileage || 0) - (vehicle.last_oil_change_mileage || 0)

      // Due if 85+ days or 2500+ miles since last oil change
      const isDue = daysSinceOilChange > 85 || milesSince > 2500
      if (!isDue) continue

      // Don't spam — check if we sent a reminder in the last 30 days
      const { data: recentReminder, error: recentReminderError } = await sb
        .from('service_reminders_sent')
        .select('id')
        .eq('shop_id', auth.shopId)
        .eq('vehicle_id', vehicle.id)
        .gte('created_at', new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString())
        .limit(1)
      if (recentReminderError) return NextResponse.json({ ok: false, error: 'Unable to load service reminder history' }, { status: 500 })

      if (recentReminder && recentReminder.length > 0) continue

      const msg = `Hi ${customer.name}! Your ${vehicle.year || ''} ${vehicle.make || ''} ${vehicle.model || ''} is due for an oil change. ${shopName} is ready for you${shopPhone ? ` — call ${shopPhone}` : ''} or just reply to this text!`

      if (customer.sms_opted_out) {
        results.push({ vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, customer: customer.name, sent: false, skipped: true, error: 'Customer has opted out of SMS' })
        continue
      }

      if (!dryRun) {
        const result = await sendSMS(customer.phone, msg, telnyxKey, telnyxFrom, `service-reminder-${vehicle.id}`)
        const { error: reminderError } = await sb.from('service_reminders_sent').insert({
          shop_id: auth.shopId,
          vehicle_id: vehicle.id,
          customer_id: vehicle.customer_id,
          message: msg,
          sent: result.success,
          created_at: new Date().toISOString(),
        })
        if (reminderError) return NextResponse.json({ ok: false, error: 'Service reminder was sent but could not be logged' }, { status: 502 })
        results.push({ vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, customer: customer.name, sent: result.success, error: result.error })
      } else {
        results.push({ vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`, customer: customer.name, sent: false, dry_run: true, message: msg })
      }
    }

    const success = dryRun || results.every(result => result.skipped || result.sent === true)
    return NextResponse.json({ ok: success, success, processed: results.length, results }, { status: success ? 200 : 502 })
  }

  if (action === 'appointment_reminders') {
    // Text everyone with an appointment tomorrow. Reads the real appointments
    // table (this used to query jobs.scheduled_date, which doesn't exist — the
    // reminder never fired once).
    const timezone = typeof settings?.timezone === 'string' && settings.timezone ? settings.timezone : 'America/Chicago'
    const tomorrowStr = localDateString(new Date(Date.now() + 24 * 60 * 60 * 1000), timezone)

    const { data: appts, error: appointmentsError } = await sb
      .from('appointments')
      .select('*')
      .eq('shop_id', auth.shopId)
      .eq('date', tomorrowStr)
      .in('status', ['Scheduled', 'Confirmed'])
    if (appointmentsError) return NextResponse.json({ ok: false, error: 'Unable to load appointments' }, { status: 500 })

    const results: Array<Record<string, unknown>> = []

    const appointmentCustomerIds = [...new Set((appts || []).map(appt => appt.customer_id).filter(Boolean))]
    const { data: appointmentCustomers, error: appointmentCustomersError } = appointmentCustomerIds.length
      ? await sb.from('customers').select('id,phone,sms_opted_out').eq('shop_id', auth.shopId).in('id', appointmentCustomerIds)
      : { data: [], error: null }
    if (appointmentCustomersError) return NextResponse.json({ ok: false, error: 'Unable to load appointment customers' }, { status: 500 })
    const appointmentCustomerById = new Map((appointmentCustomers || []).map(customer => [customer.id, customer]))

    for (const appt of appts || []) {
      const appointmentCustomer = appt.customer_id ? appointmentCustomerById.get(appt.customer_id) : null
      const phone = String(appointmentCustomer?.phone || appt.phone || '').trim()
      if (!phone) continue
      // Never double-text: skip if a reminder already went out for this one.
      if (appt.reminder_sent_at) continue

      const timeText = appt.time ? ` at ${appt.time}` : ''
      const serviceText = appt.service ? ` for ${appt.service}` : ''
      const msg = `Hi ${appt.customer_name || 'there'}! Reminder: you have an appointment${serviceText} at ${shopName} tomorrow${timeText}.${shopPhone ? ` Call ${shopPhone}` : ''} if you need to reschedule. See you then!`

      if (appointmentCustomer?.sms_opted_out) {
        results.push({ appointment: appt.id, customer: appt.customer_name, time: appt.time, sent: false, skipped: true, error: 'Customer has opted out of SMS' })
        continue
      }

      if (!dryRun) {
        const result = await sendSMS(phone, msg, telnyxKey, telnyxFrom, `appointment-reminder-${appt.id}`)
        if (result.success) {
          const { error: appointmentError } = await sb.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', appt.id).eq('shop_id', auth.shopId)
          if (appointmentError) return NextResponse.json({ ok: false, error: 'Appointment reminder was sent but could not be recorded' }, { status: 502 })
        }
        results.push({ appointment: appt.id, customer: appt.customer_name, time: appt.time, sent: result.success, error: result.error })
      } else {
        results.push({ appointment: appt.id, customer: appt.customer_name, time: appt.time, sent: false, dry_run: true, message: msg })
      }
    }

    const success = dryRun || results.every(result => result.skipped || result.sent === true)
    return NextResponse.json({ ok: success, success, processed: results.length, results }, { status: success ? 200 : 502 })
  }

  return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 })
}

function vehicleHistoryKey(customerId: string, vin: string, year: string, make: string, model: string) {
  return [customerId || '', vin || '', year || '', make || '', model || ''].map(value => String(value).trim().toLowerCase()).join('|')
}

function localDateString(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
