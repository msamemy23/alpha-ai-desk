import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const sb = getServiceClient()
  const body = await req.json()

  const { customer_name, vehicle_year, vehicle_make, vehicle_model, parts, labors, notes } = body

  // Generate doc number
  const year = new Date().getFullYear()
  const { data: existing } = await sb.from('documents').select('doc_number').eq('type', 'Estimate').like('doc_number', `EST-${year}-%`)
  const nums = (existing || []).map((d: Record<string,string>) => parseInt(d.doc_number.split('-').pop() || '0'))
  const next = Math.max(0, ...nums) + 1
  const doc_number = `EST-${year}-${String(next).padStart(4, '0')}`

  const { data, error } = await sb.from('documents').insert({
    type: 'Estimate',
    doc_number,
    status: 'Draft',
    doc_date: new Date().toISOString().split('T')[0],
    customer_name: customer_name || 'AI Estimate',
    vehicle_year: vehicle_year || '',
    vehicle_make: vehicle_make || '',
    vehicle_model: vehicle_model || '',
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
