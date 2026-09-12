import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getRouteShop, unauthorized } from '@/lib/api-auth'

function generateCode(length = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = 'ALPHA-'
  for (let i = 0; i < length; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// GET - List all referral codes or lookup a specific code
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const code = searchParams.get('code')
    const customerId = searchParams.get('customer_id')
    const auth = await getRouteShop(req, searchParams.get('shop_id'))
    if (!auth) return unauthorized()
    const supabase = getServiceClient()

    if (code) {
      // Lookup specific referral code
      const { data, error } = await supabase
        .from('growth_referrals')
        .select('*')
        .eq('shop_id', auth.shopId)
        .eq('code', code.toUpperCase())
        .single()

      if (error || !data) {
        return NextResponse.json({ error: 'Referral code not found' }, { status: 404 })
      }

      return NextResponse.json(data)
    }

    if (customerId) {
      // Get referral code for a specific customer
      const { data, error } = await supabase
        .from('growth_referrals')
        .select('*')
        .eq('shop_id', auth.shopId)
        .eq('customer_id', customerId)
        .single()

      if (error || !data) {
        return NextResponse.json({ error: 'No referral code for this customer' }, { status: 404 })
      }

      return NextResponse.json(data)
    }

    // List all referral codes with stats
    const { data, error } = await supabase
      .from('growth_referrals')
      .select('*')
      .eq('shop_id', auth.shopId)
      .order('total_referrals', { ascending: false })

    if (error) throw error

    return NextResponse.json({ referrals: data || [] })
  } catch (e) {
    console.error('Referrals GET error:', e)
    return NextResponse.json({ error: 'Failed to fetch referrals' }, { status: 500 })
  }
}

// POST - Create a referral code for a customer OR redeem a referral
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    const supabase = getServiceClient()
    const { action } = body || {}

    if (action === 'create') {
      // Create a new referral code for a customer
      const { customer_id, customer_name } = body
      const discountValue = Number(body?.discount_percent ?? 10)
      const discount_percent = Number.isFinite(discountValue) && discountValue >= 0 && discountValue <= 100
        ? Math.round(discountValue * 100) / 100
        : 10

      if (typeof customer_id !== 'string' || !customer_id || typeof customer_name !== 'string' || !customer_name.trim()) {
        return NextResponse.json({ error: 'customer_id and customer_name required' }, { status: 400 })
      }
      const { data: customer } = await supabase
        .from('customers')
        .select('id, name')
        .eq('id', customer_id)
        .eq('shop_id', auth.shopId)
        .maybeSingle()
      if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

      // Check if customer already has a code
      const { data: existing } = await supabase
        .from('growth_referrals')
        .select('code')
        .eq('shop_id', auth.shopId)
        .eq('customer_id', customer_id)
        .single()

      if (existing) {
        return NextResponse.json({ code: existing.code, message: 'Customer already has a referral code' })
      }

      // Generate unique code
      let code = generateCode()
      let attempts = 0
      while (attempts < 10) {
        const { data: dup } = await supabase
          .from('growth_referrals')
          .select('code')
          .eq('shop_id', auth.shopId)
          .eq('code', code)
          .single()
        if (!dup) break
        code = generateCode()
        attempts++
      }

      const { data, error } = await supabase
        .from('growth_referrals')
        .insert({
          shop_id: auth.shopId,
          customer_id,
          customer_name,
          code,
          discount_percent,
          total_referrals: 0,
          total_discount_given: 0,
          active: true,
          created_at: new Date().toISOString()
        })
        .select()
        .single()

      if (error) throw error

      return NextResponse.json({
        code: data.code,
        discount_percent: data.discount_percent,
        message: `Referral code ${data.code} created for ${customer_name}. Share it with friends for ${discount_percent}% off!`
      })
    }

    if (action === 'redeem') {
      // Redeem a referral code
      const { code: refCode, new_customer_name, new_customer_phone, service_total = 0 } = body

      if (!refCode) {
        return NextResponse.json({ error: 'Referral code required' }, { status: 400 })
      }

      // Look up the referral code
      const { data: referral, error: refError } = await supabase
        .from('growth_referrals')
        .select('*')
        .eq('shop_id', auth.shopId)
        .eq('code', String(refCode).trim().toUpperCase())
        .eq('active', true)
        .single()

      if (refError || !referral) {
        return NextResponse.json({ error: 'Invalid or inactive referral code' }, { status: 404 })
      }

      const totalValue = Number(service_total)
      if (!Number.isFinite(totalValue) || totalValue < 0 || totalValue > 100000000) {
        return NextResponse.json({ error: 'service_total must be a valid non-negative amount' }, { status: 400 })
      }
      const discountAmount = (totalValue * Number(referral.discount_percent || 0)) / 100

      // Log the redemption
      const { error: redemptionError } = await supabase.from('growth_referral_redemptions').insert({
        shop_id: auth.shopId,
        referral_id: referral.id,
        referral_code: referral.code,
        referrer_id: referral.customer_id,
        referrer_name: referral.customer_name,
        new_customer_name: new_customer_name || 'Walk-in',
        new_customer_phone: new_customer_phone || null,
        service_total: totalValue,
        discount_amount: discountAmount,
        created_at: new Date().toISOString()
      })
      if (redemptionError) throw redemptionError

      // Update referral stats
      const { error: updateError } = await supabase
        .from('growth_referrals')
        .update({
          total_referrals: (referral.total_referrals || 0) + 1,
          total_discount_given: (referral.total_discount_given || 0) + discountAmount
        })
        .eq('id', referral.id)
        .eq('shop_id', auth.shopId)
      if (updateError) throw updateError

      return NextResponse.json({
        valid: true,
        referrer: referral.customer_name,
        discount_percent: referral.discount_percent,
        discount_amount: discountAmount,
        message: `Referral code valid! ${referral.discount_percent}% discount ($${discountAmount.toFixed(2)} off) from ${referral.customer_name}'s referral.`
      })
    }

    return NextResponse.json({ error: 'Invalid action. Use "create" or "redeem"' }, { status: 400 })
  } catch (e) {
    console.error('Referrals POST error:', e)
    return NextResponse.json({ error: 'Failed to process referral' }, { status: 500 })
  }
}
