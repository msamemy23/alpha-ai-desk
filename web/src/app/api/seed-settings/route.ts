import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: existing } = await supabase.from('settings').select('id').limit(1).single()

    // Only include columns that definitely exist in the schema
    const defaults: Record<string, unknown> = {
      shop_name: 'Alpha International Auto Center',
      shop_address: '10710 S Main St, Houston TX 77025',
      shop_phone: '(713) 663-6979',
      shop_email: process.env.FROM_EMAIL || 'service@alphainternationalauto.com',
      labor_rate: 120,
      tax_rate: 8.25,
      warranty_months: 12,
      payment_methods: ['Cash', 'Card', 'Zelle', 'Cash App'],
      ai_api_key: process.env.OPENROUTER_API_KEY || '',
      ai_model: 'deepseek/deepseek-v3.2',
      ai_base_url: 'https://openrouter.ai/api/v1',
      telnyx_api_key: process.env.TELNYX_API_KEY || '',
      telnyx_phone_number: process.env.TELNYX_PHONE_NUMBER || '',
      resend_api_key: process.env.RESEND_API_KEY || '',
      from_email: process.env.FROM_EMAIL || 'service@alphainternationalauto.com',
    }

    if (existing?.id) {
      const { data: current } = await supabase.from('settings').select('*').limit(1).single()
      const updates: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(defaults)) {
        if (!current?.[k]) updates[k] = v
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await supabase.from('settings').update(updates).eq('id', existing.id)
        if (error) console.warn('seed-settings update warn:', error.message)
      }
    } else {
      const { error } = await supabase.from('settings').insert(defaults)
      if (error) console.warn('seed-settings insert warn:', error.message)
    }

    return NextResponse.json({ status: 'ok' })
  } catch (e) {
    // Never return 500 — dashboard should not crash on seed failure
    console.error('seed-settings error:', e)
    return NextResponse.json({ status: 'ok', warning: (e as Error).message })
  }
}