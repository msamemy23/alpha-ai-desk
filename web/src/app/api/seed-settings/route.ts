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
    const { data: shop, error: shopError } = await supabase.from('shop_profiles').select('id,shop_name,phone,address,city_state_zip').eq('id', shopId).maybeSingle()
    if (shopError) return NextResponse.json({ ok: false, error: 'Shop profile could not be loaded' }, { status: 500 })
    if (!shop) return NextResponse.json({ ok: false, error: 'Shop not found' }, { status: 404 })
    const { data: existing, error: existingError } = await supabase.from('settings').select('id').eq('shop_id', shopId).maybeSingle()
    if (existingError) return NextResponse.json({ ok: false, error: 'Shop settings could not be loaded' }, { status: 500 })

    // Seed only from this shop's profile. Never copy the original deployment's
    // name, address, phone, or sender into another tenant.
    const profileName = typeof shop.shop_name === 'string' ? shop.shop_name.trim() : ''
    const profileAddress = [shop.address, shop.city_state_zip].filter(value => typeof value === 'string' && value.trim()).map(value => String(value).trim()).join(', ')
    const profilePhone = typeof shop.phone === 'string' ? shop.phone.trim() : ''
    const defaults: Record<string, unknown> = {
      shop_id: shopId,
      shop_name: profileName || 'Your Auto Repair Shop',
      shop_address: profileAddress,
      shop_phone: profilePhone,
      shop_email: '',
      labor_rate: 120,
      tax_rate: 8.25,
      warranty_months: 12,
      payment_methods: 'Cash, Card, Zelle, Cash App',
      // Never copy API secrets from env into the database — server routes read
      // them from env directly. Rows in `settings` are visible to any
      // authenticated shop user; secrets don't belong there.
      ai_model: DEFAULT_OPENROUTER_MODEL,
      ai_base_url: AI_BASE_URLS.OPENROUTER,
      // Provider numbers and sender identities are tenant-owned settings.
      telnyx_phone_number: '',
      from_email: '',
    }

    if (existing?.id) {
      const { data: current, error: currentError } = await supabase.from('settings').select('*').eq('shop_id', shopId).maybeSingle()
      if (currentError) return NextResponse.json({ ok: false, error: 'Shop settings could not be read' }, { status: 500 })
      const updates: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(defaults)) {
        const value = current?.[k]
        if (value === null || value === undefined || value === '') updates[k] = v
      }
      if (Object.keys(updates).length > 0) {
        const { error } = await supabase.from('settings').update(updates).eq('id', existing.id).eq('shop_id', shopId)
        if (error) return NextResponse.json({ ok: false, error: 'Shop settings could not be updated' }, { status: 500 })
      }
    } else {
      const { error } = await supabase.from('settings').insert(defaults)
      if (error) return NextResponse.json({ ok: false, error: 'Shop settings could not be created' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, status: 'ok' })
  } catch (e) {
    console.error('seed-settings error:', e)
    return NextResponse.json({ ok: false, error: 'Settings could not be initialized' }, { status: 500 })
  }
}
