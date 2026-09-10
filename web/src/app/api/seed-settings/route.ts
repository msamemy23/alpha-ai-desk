import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { requireAdmin } from '@/lib/admin-guard'
import { AI_BASE_URLS, DEFAULT_OPENROUTER_MODEL } from '@/lib/ai-config'

export async function POST(req: NextRequest) {
  const denied = requireAdmin(req)
  if (denied) return denied
  try {
    const body = await req.json().catch(() => null)
    const shopId = typeof body?.shopId === 'string' ? body.shopId : ''
    if (!shopId) return NextResponse.json({ error: 'shopId is required' }, { status: 400 })
    const supabase = getServiceClient()
    const { data: shop } = await supabase.from('shop_profiles').select('id').eq('id', shopId).maybeSingle()
    if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })
    const { data: existing } = await supabase.from('settings').select('id').eq('shop_id', shopId).maybeSingle()

    // Only include columns that definitely exist in the schema
    const defaults: Record<string, unknown> = {
      shop_id: shopId,
      shop_name: 'Alpha International Auto Center',
      shop_address: '10710 S Main St, Houston TX 77025',
      shop_phone: '(713) 663-6979',
      shop_email: process.env.FROM_EMAIL || 'service@alphainternationalauto.com',
      labor_rate: 120,
      tax_rate: 8.25,
      warranty_months: 12,
      payment_methods: 'Cash, Card, Zelle, Cash App',
      // Never copy API secrets from env into the database — server routes read
      // them from env directly. Rows in `settings` are visible to any
      // authenticated shop user; secrets don't belong there.
      ai_model: DEFAULT_OPENROUTER_MODEL,
      ai_base_url: AI_BASE_URLS.OPENROUTER,
      telnyx_phone_number: process.env.TELNYX_PHONE_NUMBER || '',
      from_email: process.env.FROM_EMAIL || 'service@alphainternationalauto.com',
    }

    if (existing?.id) {
      const { data: current } = await supabase.from('settings').select('*').eq('shop_id', shopId).maybeSingle()
      const updates: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(defaults)) {
        if (!current?.[k]) updates[k] = v
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await supabase.from('settings').update(updates).eq('id', existing.id).eq('shop_id', shopId)
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
