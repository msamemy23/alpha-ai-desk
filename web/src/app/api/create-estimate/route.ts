import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const sb = getServiceClient()
  const body = await req.json()

  // Accept both "customer" (from proposeDocument) and "customer_name"
  const customerName: string = body.customer || body.customer_name || ''
  const { vehicle, vehicle_year, vehicle_make, vehicle_model, parts, labors, notes } = body

  // Parse vehicle string like "2019 Toyota Camry" if individual fields aren't provided
  let vYear = vehicle_year || ''
  let vMake = vehicle_make || ''
  let vModel = vehicle_model || ''
  if (vehicle && typeof vehicle === 'string' && (!vYear || !vMake)) {
    const vParts = vehicle.trim().split(/\s+/)
    if (vParts.length >= 1 && /^\d{4}$/.test(vParts[0])) vYear = vYear || vParts[0]
    if (vParts.length >= 2) vMake = vMake || vParts[1]
    if (vParts.length >= 3) vModel = vModel || vParts.slice(2).join(' ')
  }

  // Look up or auto-create customer to get customer_id
  let customer_id: string | null = null
  if (customerName) {
    // Try to find existing customer by name (case-insensitive)
    const { data: existing } = await sb
      .from('customers')
      .select('id')
      .ilike('name', customerName)
      .limit(1)

    if (existing && existing.length > 0) {
      customer_id = existing[0].id
    } else {
      // Auto-create the customer
      const { data: created } = await sb
        .from('customers')
        .insert({
          name: customerName,
          created_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (created) customer_id = created.id
    }
  }

  // Generate doc number
  const year = new Date().getFullYear()
  const { data: existingDocs } = await sb.from('documents').select('doc_number').eq('type', 'Estimate').like('doc_number', `EST-${year}-%`)
  const nums = (existingDocs || []).map((d: Record<string,string>) => parseInt(d.doc_number.split('-').pop() || '0'))
  const next = Math.max(0, ...nums) + 1
  const doc_number = `EST-${year}-${String(next).padStart(4, '0')}`

  const { data, error } = await sb.from('documents').insert({
    type: 'Estimate',
    doc_number,
    status: 'Draft',
    doc_date: new Date().toISOString().split('T')[0],
    customer_id: customer_id,
    customer_name: customerName || 'AI Estimate',
    vehicle_year: vYear,
    vehicle_make: vMake,
    vehicle_model: vModel,
    parts: parts || [],
    labors: labors || [],
    notes: notes || 'Generated from AI conversation',
    tax_rate: 8.25,
    apply_tax: true,
    shop_supplies: 0,
    deposit: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, estimate: data, doc_number })
}
