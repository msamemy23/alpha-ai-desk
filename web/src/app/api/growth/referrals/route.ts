import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

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

    if (code) {
      // Lookup specific referral code
      const { data, error } = await supabase
        .from('growth_referrals')
        .select('*')
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
    const body = await req.json()
    const { action } = body

    if (action === 'create') {
      // Create a new referral code for a customer
      const { customer_id, customer_name, discount_percent = 10 } = body

      if (!customer_id || !customer_name) {
        return NextResponse.json({ error: 'customer_id and customer_name required' }, { status: 400 })
      }

      // Check if customer already has a code
      const { data: existing } = await supabase
        .from('growth_referrals')
        .select('code')
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
          .eq('code', code)
          .single()
        if (!dup) break
        code = generateCode()
        attempts++
      }

      const { data, error } = await supabase
        .from('growth_referrals')
        .insert({
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
        .eq('code', refCode.toUpperCase())
        .eq('active', true)
        .single()

      if (refError || !referral) {
        return NextResponse.json({ error: 'Invalid or inactive referral code' }, { status: 404 })
      }

      const discountAmount = (service_total * referral.discount_percent) / 100

      // Log the redemption
      await supabase.from('growth_referral_redemptions').insert({
        referral_id: referral.id,
        referral_code: referral.code,
        referrer_id: referral.customer_id,
        referrer_name: referral.customer_name,
        new_customer_name: new_customer_name || 'Walk-in',
        new_customer_phone: new_customer_phone || null,
        service_total,
        discount_amount: discountAmount,
        created_at: new Date().toISOString()
      })

      // Update referral stats
      await supabase
        .from('growth_referrals')
        .update({
          total_referrals: (referral.total_referrals || 0) + 1,
          total_discount_given: (referral.total_discount_given || 0) + discountAmount
        })
        .eq('id', referral.id)

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
