import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'

export async function POST(req: Request) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const { id, data } = await req.json()
    if (!id || !data) return NextResponse.json({ error: 'Missing id or data' }, { status: 400 })

    const sb = getServiceClient()

    // Look up the existing record and confirm it belongs to the caller's shop.
    const { data: existing, error: fetchErr } = await sb
      .from('documents')
      .select('shop_id,status,parts,labors,shop_supplies,sublet,tax_rate,apply_tax,deposit,line_items,payment_plan')
      .eq('id', id)
      .eq('shop_id', auth.shopId)
      .single()

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return NextResponse.json({ error: 'Document data must be an object' }, { status: 400 })
    }
    const allowed = ['type','doc_number','status','doc_date','due_date','expires_date','customer_id','customer_name','job_id','vehicle_year','vehicle_make','vehicle_model','vehicle_vin','vehicle_plate','vehicle_mileage','parts','labors','shop_supplies','sublet','tax_rate','apply_tax','deposit','payment_method','cashier','payment_terms','payment_methods','warranty_type','warranty_months','warranty_mileage','warranty_start','warranty_exclusions','warranty_claim','notes','internal_notes','locked','sent_at','created_at','updated_at','customer_phone','customer_email','signature_signed_at','signature_signer_name','signature_requested_at','line_items','payment_plan']
    const cleanData = Object.fromEntries(
      allowed
        .filter(key => Object.prototype.hasOwnProperty.call(data, key))
        .map(key => [key, data[key]])
    )
    const paidStatuses = new Set(['Paid', 'Partial'])
    const financialFields = new Set(['parts', 'labors', 'shop_supplies', 'sublet', 'tax_rate', 'apply_tax', 'deposit', 'line_items', 'payment_plan'])
    const existingIsPaid = paidStatuses.has(String(existing.status))
    if (existingIsPaid && Object.keys(cleanData).some((key) => financialFields.has(key))) {
      return NextResponse.json({ error: 'Paid or partially paid documents are financially immutable; use a supported adjustment or refund action' }, { status: 409 })
    }
    if (existingIsPaid && cleanData.status !== undefined && cleanData.status !== existing.status) {
      return NextResponse.json({ error: 'Use the payment or refund action to change a paid document status' }, { status: 409 })
    }
    if (cleanData.status && paidStatuses.has(String(cleanData.status)) && cleanData.status !== existing.status) {
      return NextResponse.json({ error: 'Use the payment action to change an invoice to Paid or Partial' }, { status: 409 })
    }

    // Foreign keys must belong to the same shop as the document. RLS is not
    // enough here because this route intentionally uses the service client.
    for (const [field, table] of [['customer_id', 'customers'], ['job_id', 'jobs']] as const) {
      const value = cleanData[field]
      if (value === undefined || value === null || value === '') continue
      if (typeof value !== 'string') {
        return NextResponse.json({ error: `${field} must be a valid identifier` }, { status: 400 })
      }
      const { data: linked, error: linkErr } = await sb
        .from(table)
        .select('id')
        .eq('id', value)
        .eq('shop_id', auth.shopId)
        .maybeSingle()
      if (linkErr) return NextResponse.json({ error: `Unable to validate ${field}` }, { status: 500 })
      if (!linked) return NextResponse.json({ error: `${field} does not belong to this shop` }, { status: 400 })
    }

    const { error } = await sb
      .from('documents')
      .update({ ...cleanData, shop_id: auth.shopId, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('shop_id', auth.shopId)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: (e instanceof Error ? e.message : 'Unknown error') }, { status: 500 })
  }
}
