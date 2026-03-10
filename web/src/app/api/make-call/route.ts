import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  try {
    const { to, name } = await req.json()
    if (!to) return NextResponse.json({ error: 'Missing to' }, { status: 400 })
    const apiKey = process.env.TELNYX_API_KEY!
    const shopPhone = process.env.TELNYX_PHONE_NUMBER || '+17136636979'
    if (!apiKey) return NextResponse.json({ error: 'TELNYX_API_KEY not configured' }, { status: 500 })
    const digits = to.replace(/\D/g, '')
    const e164 = digits.startsWith('1') ? '+'+digits : digits.length===10 ? '+1'+digits : '+'+digits
    const res = await fetch('https://api.telnyx.com/v2/calls', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer '+apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: '2789559726713603103', to: e164, from: shopPhone, answering_machine_detection: 'disabled' })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.errors?.[0]?.detail || 'Call failed')
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    await supabase.from('activities').insert({ type: 'call', direction: 'outbound', phone: e164, customer_name: name || e164, notes: 'Outbound call from web dashboard' })
    return NextResponse.json({ ok: true, callId: data.data?.call_control_id })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}