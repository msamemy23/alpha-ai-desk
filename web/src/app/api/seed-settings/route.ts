import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Check if settings already exist
  const { data: existing } = await supabase.from('settings').select('id').limit(1).single()

  const defaults = {
    shop_name: 'Alpha International Auto Center',
    shop_address: '10710 S Main St, Houston TX 77025',
    shop_phone: '(713) 663-6979',
    shop_email: process.env.FROM_EMAIL || 'service@alphainternationalauto.com',
    labor_rate: 120,
    tax_rate: 8.25,
    warranty_months: 12,
    technicians: ['Paul', 'Devin', 'Luis', 'Louie'],
    payment_methods: ['Cash', 'Card', 'Zelle', 'Cash App'],
    ai_api_key: process.env.OPENROUTER_API_KEY || '',
    ai_model: 'meta-llama/llama-3.3-70b-instruct:free',
    ai_base_url: 'https://openrouter.ai/api/v1',
    telnyx_api_key: process.env.TELNYX_API_KEY || '',
    telnyx_phone: process.env.TELNYX_PHONE_NUMBER || '',
    resend_api_key: process.env.RESEND_API_KEY || '',
    from_email: process.env.FROM_EMAIL || 'service@alphainternationalauto.com',
  }

  let result
  if (existing?.id) {
    // Only fill in missing/empty values, don't overwrite existing
    const { data: current } = await supabase.from('settings').select('*').limit(1).single()
    const updates: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(defaults)) {
      if (!current?.[k]) updates[k] = v
    }
    if (Object.keys(updates).length > 0) {
      result = await supabase.from('settings').update(updates).eq('id', existing.id)
    } else {
      return NextResponse.json({ status: 'already configured' })
    }
  } else {
    result = await supabase.from('settings').insert(defaults)
  }

  if (result?.error) return NextResponse.json({ error: result.error.message }, { status: 500 })
  return NextResponse.json({ status: 'ok', seeded: true })
}
