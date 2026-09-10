export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const sb = getServiceClient()
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const shopId = auth.shopId

  // Accept both "customer" (from proposeDocument) and "customer_name"
  const customerName: string = body.customer || body.customer_name || ''
  const customerEmail: string = body.customer_email || ''
  const customerPhone: string = body.customer_phone || ''
  const { vehicle, vehicle_year, vehicle_make, vehicle_model, parts, labors, notes } = body

  // Keep the requested document type. A receipt starts as a draft until a
  // real payment is recorded; it must never claim to be paid by itself.
  const rawType: string = body.type || 'Estimate'
  if (!['Invoice', 'Estimate', 'Receipt'].includes(rawType)) return NextResponse.json({ error: 'Type must be Invoice, Estimate, or Receipt' }, { status: 400 })
  const docType: string = rawType
  const prefix = docType === 'Estimate' ? 'EST' : docType === 'Receipt' ? 'REC' : 'INV'

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
    const { data: existing, error: existingError } = await sb
      .from('customers')
      .select('id, email, phone')
      .eq('shop_id', shopId)
      .ilike('name', customerName)
      .limit(1)
    if (existingError) return NextResponse.json({ error: 'Customer lookup failed' }, { status: 500 })

    if (existing && existing.length > 0) {
      customer_id = existing[0].id
      const updates: Record<string, string> = {}
      if (customerEmail && !existing[0].email) updates.email = customerEmail
      if (customerPhone && !existing[0].phone) updates.phone = customerPhone
      if (Object.keys(updates).length > 0) {
        const { error: updateError } = await sb.from('customers').update(updates).eq('id', customer_id).eq('shop_id', shopId)
        if (updateError) return NextResponse.json({ error: 'Customer update failed' }, { status: 500 })
      }
    } else {
      const insertData: Record<string, string | null> = {
        name: customerName,
        created_at: new Date().toISOString(),
        shop_id: shopId,
      }
      if (customerEmail) insertData.email = customerEmail
      if (customerPhone) insertData.phone = customerPhone
      const { data: created, error: createCustomerError } = await sb
        .from('customers')
        .insert(insertData)
        .select('id')
        .single()
      if (createCustomerError) return NextResponse.json({ error: 'Customer creation failed' }, { status: 500 })
      if (created) customer_id = created.id
    }
  }

  // Numbering is serialized in the database so concurrent browser/API writes
  // cannot receive the same document number.
  const { data: generatedNumber, error: numberingError } = await sb.rpc('next_document_number', {
    p_shop_id: shopId,
    p_type: docType,
  })
  if (numberingError || typeof generatedNumber !== 'string') return NextResponse.json({ error: 'Document numbering failed' }, { status: 500 })
  const doc_number = generatedNumber

  // Handle tax - if type is Receipt and body.apply_tax is explicitly false, no tax
  const applyTax = body.apply_tax !== undefined ? body.apply_tax !== false : true
  const rawTaxRate = Number(body.tax_rate)
  const taxRate = Number.isFinite(rawTaxRate) && rawTaxRate >= 0 ? rawTaxRate : 8.25

  const { data, error } = await sb.from('documents').insert({
    type: docType,
    doc_number,
    shop_id: shopId,
    status: 'Draft',
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
    sublet: body.sublet || 0,
    deposit: body.deposit || 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, estimate: data, document: data, doc_number, type: docType })
}
