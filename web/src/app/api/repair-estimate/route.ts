import { NextRequest } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { apiFail, apiOk, getIdempotencyKey, readJsonObject } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { laborLineTotal, partLineTotal } from '@/lib/document-money'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function asLines(value: unknown) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object').map(item => item as Record<string, unknown>).slice(0, 40) : []
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function positiveTotal(parts: Record<string, unknown>[], labors: Record<string, unknown>[]) {
  return parts.reduce((sum, line) => sum + partLineTotal(line), 0) + labors.reduce((sum, line) => sum + laborLineTotal(line), 0)
}

async function customerIdForName(db: ReturnType<typeof getServiceClient>, shopId: string, name: string, email: string, phone: string) {
  if (!name) return null
  const { data: existing } = await db
    .from('customers')
    .select('id,email,phone')
    .eq('shop_id', shopId)
    .ilike('name', name)
    .limit(1)
  if (existing?.length) {
    const updates: Record<string, string> = {}
    if (email && !existing[0].email) updates.email = email
    if (phone && !existing[0].phone) updates.phone = phone
    if (Object.keys(updates).length) await db.from('customers').update(updates).eq('id', existing[0].id).eq('shop_id', shopId)
    return existing[0].id as string
  }
  const { data } = await db.from('customers').insert({
    shop_id: shopId,
    name,
    email: email || null,
    phone: phone || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select('id').single()
  return data?.id || null
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const limited = checkRateLimit(rateLimitKey('repair-estimate', auth.userId, auth.shopId, ip), 25, 60_000)
    if (!limited.ok) return apiFail('Too many repair estimate requests', 429, 'RATE_LIMITED', { resetAt: limited.resetAt })

    const parsedBody = await readJsonObject(req)
    if (!parsedBody.ok) return apiFail(parsedBody.error, 400, 'BAD_REQUEST')
    const body = parsedBody.body
    const vehicle = asRecord(body.vehicle)
    const estimateDraft = asRecord(body.estimateDraft)
    const rawParts = asLines(estimateDraft.parts)
    const rawLabors = asLines(estimateDraft.labors)
    const targetTotal = typeof estimateDraft.targetTotal === 'number' ? estimateDraft.targetTotal : null
    const hasLockedTotal = targetTotal !== null && Number.isFinite(targetTotal) && targetTotal > 0
    const parts = rawParts
    const labors = rawLabors.map(line => ({
      ...line,
      operation: text(line.operation || line.description, 'Repair labor'),
    }))
    const subtotal = positiveTotal(parts, labors)
    if (!hasLockedTotal && subtotal <= 0) {
      return apiFail('Enter a locked total or verified line pricing before creating an estimate.', 400, 'BAD_REQUEST')
    }

    const db = getServiceClient()
    const year = new Date().getFullYear()
    const prefix = 'EST'
    const { data: existingDocs } = await db
      .from('documents')
      .select('doc_number')
      .eq('shop_id', auth.shopId)
      .eq('type', 'Estimate')
      .like('doc_number', `${prefix}-${year}-%`)
    const nums = (existingDocs || []).map((d: Record<string, string>) => parseInt(d.doc_number.split('-').pop() || '0'))
    const docNumber = `${prefix}-${year}-${String(Math.max(0, ...nums) + 1).padStart(4, '0')}`

    const customerName = text(body.customerName, 'Customer')
    const customerEmail = text(body.customerEmail)
    const customerPhone = text(body.customerPhone)
    const customerId = await customerIdForName(db, auth.shopId, customerName, customerEmail, customerPhone)
    const notes = [
      text(estimateDraft.notes),
      text(body.notes),
      'Generated from Repair Workspace. Technician source verification and customer authorization required before work.',
    ].filter(Boolean).join('\n\n').slice(0, 5000)

    const { data, error } = await db.from('documents').insert({
      type: 'Estimate',
      doc_number: docNumber,
      shop_id: auth.shopId,
      status: 'Draft',
      doc_date: new Date().toISOString().split('T')[0],
      customer_id: customerId,
      customer_name: customerName,
      customer_phone: customerPhone || null,
      customer_email: customerEmail || null,
      vehicle_year: text(vehicle.year),
      vehicle_make: text(vehicle.make),
      vehicle_model: text(vehicle.model),
      vehicle_vin: text(vehicle.vin),
      parts,
      labors,
      notes,
      tax_rate: hasLockedTotal ? 0 : 8.25,
      apply_tax: !hasLockedTotal,
      shop_supplies: 0,
      deposit: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select().single()

    if (error) return apiFail(error.message, 500, 'INTERNAL_ERROR')

    const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'repair-estimate', customerName, docNumber])
    await writeAuditLog({
      shopId: auth.shopId,
      userId: auth.userId,
      action: 'repair.estimate.create',
      targetType: 'document',
      targetId: data?.id,
      permission: 'write',
      approved: true,
      idempotencyKey,
      metadata: {
        docNumber,
        customerName,
        targetTotal,
        operationCount: labors.length,
      },
    })

    return apiOk({ document: data, docNumber })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiFail(message, 500, 'INTERNAL_ERROR')
  }
}
