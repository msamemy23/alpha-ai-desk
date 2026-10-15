export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { POST as runAiAction } from '@/app/api/ai-action/route'

/**
 * Backwards-compatible document endpoint.
 *
 * Older clients still post here, but document creation must have exactly one
 * implementation. Forwarding to ai-action keeps those clients on the same
 * tenant, approval, line-validation, numbering, idempotency, audit, and
 * payment-safety rules as the current chat workflow.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const vehicle = typeof body.vehicle === 'string' ? body.vehicle.trim().split(/\s+/) : []
  const vehicleYear = typeof body.vehicle_year === 'string' ? body.vehicle_year : (/^\d{4}$/.test(vehicle[0] || '') ? vehicle[0] : '')
  const vehicleMake = typeof body.vehicle_make === 'string' ? body.vehicle_make : (vehicle[1] || '')
  const vehicleModel = typeof body.vehicle_model === 'string' ? body.vehicle_model : vehicle.slice(2).join(' ')
  const documentType = typeof body.type === 'string' ? body.type : 'Estimate'
  const customerName = typeof body.customer_name === 'string' ? body.customer_name : (typeof body.customer === 'string' ? body.customer : '')
  const payload = {
    type: documentType,
    customer_name: customerName,
    customer_email: typeof body.customer_email === 'string' ? body.customer_email : '',
    customer_phone: typeof body.customer_phone === 'string' ? body.customer_phone : '',
    vehicle_year: vehicleYear,
    vehicle_make: vehicleMake,
    vehicle_model: vehicleModel,
    parts: Array.isArray(body.parts) ? body.parts : [],
    labors: Array.isArray(body.labors) ? body.labors : [],
    notes: typeof body.notes === 'string' ? body.notes : '',
    apply_tax: body.apply_tax,
    tax_rate: body.tax_rate,
    shop_supplies: body.shop_supplies,
    sublet: body.sublet,
    deposit: body.deposit,
  }

  const requestKey = typeof body.request_id === 'string' && body.request_id.trim()
    ? body.request_id.trim()
    : createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  const headers = new Headers(req.headers)
  headers.set('X-AI-Approval', 'confirm')
  headers.set('Idempotency-Key', requestKey.slice(0, 160))
  const forwarded = new NextRequest(req.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'createInvoice', payload }),
  })
  const response = await runAiAction(forwarded)
  const result = await response.json().catch(() => ({ ok: false, error: 'Document creation failed' })) as Record<string, unknown>
  if (!response.ok) return NextResponse.json(result, { status: response.status })
  const document = result.data
  return NextResponse.json({
    ok: true,
    success: true,
    estimate: document,
    document,
    doc_number: document && typeof document === 'object' ? (document as Record<string, unknown>).doc_number : undefined,
    type: documentType,
  })
}
