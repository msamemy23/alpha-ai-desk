export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const sb = getServiceClient()
  const body = await req.json()

  // Accept both "customer" (from proposeDocument) and "customer_name"
  const customerName: string = body.customer || body.customer_name || ''
  const customerEmail: string = body.customer_email || ''
  const customerPhone: string = body.customer_phone || ''
  const { vehicle, vehicle_year, vehicle_make, vehicle_model, parts, labors, notes } = body

  // Only Invoice and Estimate types — Receipt is treated as Invoice
  const rawType: string = body.type || 'Estimate'
  const docType: string = rawType === 'Receipt' ? 'Invoice' : rawType
  const prefix = docType === 'Estimate' ? 'EST' : 'INV'

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
    const { data: existing } = await sb
      .from('customers')
      .select('id, email, phone')
      .ilike('name', customerName)
      .limit(1)

    if (existing && existing.length > 0) {
      customer_id = existing[0].id
      const updates: Record<string, string> = {}
      if (customerEmail && !existing[0].email) updates.email = customerEmail
      if (customerPhone && !existing[0].phone) updates.phone = customerPhone
      if (Object.keys(updates).length > 0) {
        await sb.from('customers').update(updates).eq('id', customer_id)
      }
    } else {
      const insertData: Record<string, string> = {
        name: customerName,
        created_at: new Date().toISOString(),
      }
      if (customerEmail) insertData.email = customerEmail
      if (customerPhone) insertData.phone = customerPhone
      const { data: created } = await sb
        .from('customers')
        .insert(insertData)
        .select('id')
        .single()
      if (created) customer_id = created.id
    }
  }

  // Generate doc number using correct prefix for type
  const year = new Date().getFullYear()
  const { data: existingDocs } = await sb.from('documents').select('doc_number').eq('type', docType).like('doc_number', `${prefix}-${year}-%`)
  const nums = (existingDocs || []).map((d: Record<string, string>) => parseInt(d.doc_number.split('-').pop() || '0'))
  const next = Math.max(0, ...nums) + 1
  const doc_number = `${prefix}-${year}-${String(next).padStart(4, '0')}`

  // Handle tax - if type is Receipt and body.apply_tax is explicitly false, no tax
  const applyTax = body.apply_tax !== undefined ? body.apply_tax !== false : true
  const taxRate = body.tax_rate ?? 8.25

  const { data, error } = await sb.from('documents').insert({
    type: docType,
    doc_number,
    status: rawType === 'Receipt' ? 'Paid' : 'Draft',
    doc_date: new Date().toISOString().split('T')[0],
    customer_id: customer_id,
    customer_name: customerName || 'Customer',
    customer_phone: customerPhone || null,
    customer_email: customerEmail || null,
    vehicle_year: vYear,
    vehicle_make: vMake,
    vehicle_model: vModel,
    parts: parts || [],
    labors: labors || [],
    notes: notes || `Generated from AI conversation`,
    tax_rate: taxRate,
    apply_tax: applyTax,
    shop_supplies: body.shop_supplies || 0,
    deposit: body.deposit || 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, estimate: data, doc_number, type: docType })
}
