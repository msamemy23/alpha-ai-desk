import { NextRequest } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { apiFail, apiOk, getIdempotencyKey, readJsonObject } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { laborLineTotal, partLineTotal } from '@/lib/document-money'
import { getServiceClient } from '@/lib/supabase'
import { createHash } from 'node:crypto'

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

function validateLines(parts: Record<string, unknown>[], labors: Record<string, unknown>[]) {
  for (const [index, line] of parts.entries()) {
    const description = text(line.name || line.description)
    const qty = line.qty === undefined || line.qty === null || line.qty === '' ? 1 : line.qty
    const unitPrice = line.unitPrice ?? line.unit_price
    if (!description) return `Part line ${index + 1} needs a description`
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) return `Part line ${index + 1} has an invalid quantity`
    if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice) || unitPrice < 0) return `Part line ${index + 1} has invalid pricing`
    if (line.core !== undefined && (typeof line.core !== 'number' || !Number.isFinite(line.core) || line.core < 0)) return `Part line ${index + 1} has an invalid core charge`
  }
  for (const [index, line] of labors.entries()) {
    const description = text(line.operation || line.description, 'Repair labor')
    const amount = line.amount ?? line.flat_amount ?? line.flatAmount
    const hasFlat = amount !== undefined && amount !== null
    if (!description) return `Labor line ${index + 1} needs a description`
    if (hasFlat) {
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) return `Labor line ${index + 1} has invalid pricing`
    } else if (typeof line.hours !== 'number' || !Number.isFinite(line.hours) || line.hours <= 0 || typeof line.rate !== 'number' || !Number.isFinite(line.rate) || line.rate < 0) {
      return `Labor line ${index + 1} needs valid hours and rate or a flat amount`
    }
  }
  return null
}

async function customerIdForName(db: ReturnType<typeof getServiceClient>, shopId: string, name: string, email: string, phone: string) {
  if (!name) return null
  const { data: existing, error: lookupError } = await db
    .from('customers')
    .select('id,email,phone')
    .eq('shop_id', shopId)
    .ilike('name', name)
    .limit(1)
  if (lookupError) throw new Error('Customer lookup failed')
  if (existing?.length) {
    const updates: Record<string, string> = {}
    if (email && !existing[0].email) updates.email = email
    if (phone && !existing[0].phone) updates.phone = phone
    if (Object.keys(updates).length) {
      const { error } = await db.from('customers').update(updates).eq('id', existing[0].id).eq('shop_id', shopId)
      if (error) throw new Error('Customer update failed')
    }
    return existing[0].id as string
  }
  const { data, error } = await db.from('customers').insert({
    shop_id: shopId,
    name,
    email: email || null,
    phone: phone || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).select('id').single()
  if (error) throw new Error('Customer creation failed')
  return data?.id || null
}

export async function POST(req: NextRequest) {
  let db: ReturnType<typeof getServiceClient> | null = null
  let shopId = ''
  let operationId: string | null = null
  let operationFinalized = false
  let mutationCommitted = false
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()
    shopId = auth.shopId

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
    let labors: Record<string, unknown>[] = rawLabors.map(line => ({
      ...line,
      operation: text(line.operation || line.description, 'Repair labor'),
    }))
    let subtotal = positiveTotal(parts, labors)
    // A locked total is a complete pricing instruction even when the
    // repair parser could not safely itemize the operation. Preserve that
    // instruction as an explicit flat labor line instead of creating a
    // zero-value estimate that looks successful but cannot be invoiced.
    if (hasLockedTotal && subtotal <= 0) {
      labors = [{
        operation: 'Repair estimate — locked total',
        amount: targetTotal,
        pricing: 'flat',
        source_status: 'shop_locked',
      }]
      subtotal = positiveTotal(parts, labors)
    }
    if (!hasLockedTotal && subtotal <= 0) {
      return apiFail('Enter a locked total or verified line pricing before creating an estimate.', 400, 'BAD_REQUEST')
    }

    db = getServiceClient()
    const { data: shopSettings, error: shopSettingsError } = await db.from('settings').select('tax_rate').eq('shop_id', auth.shopId).limit(1).maybeSingle()
    if (shopSettingsError) return apiFail('Shop tax settings could not be loaded', 500, 'INTERNAL_ERROR')
    const configuredTax = shopSettings?.tax_rate
    const hasConfiguredTax = configuredTax !== null && configuredTax !== undefined && Number.isFinite(Number(configuredTax)) && Number(configuredTax) >= 0
    if (!hasLockedTotal && !hasConfiguredTax) return apiFail('Shop tax is not configured. Set a tax rate or lock the estimate total without tax.', 400, 'BAD_REQUEST')

    const lineError = validateLines(parts, labors)
    if (lineError) return apiFail(lineError, 400, 'BAD_REQUEST')
    if (hasLockedTotal && subtotal > 0 && Math.abs(subtotal - targetTotal!) > 0.01) {
      return apiFail('The locked total must match the priced estimate lines before saving.', 400, 'BAD_REQUEST')
    }

    // This endpoint creates a document, so a caller must send a stable key.
    // The repair UI supplies one per click; retries reuse it and can only
    // replay the saved result, never create a second customer/document pair.
    const requestedKey = getIdempotencyKey(req, [typeof body.request_id === 'string' ? body.request_id : undefined])
    if (!requestedKey) return apiFail('Idempotency-Key is required for estimate creation', 400, 'BAD_REQUEST')
    const payloadHash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
    const idempotencyKey = `${auth.shopId}:repair-estimate:${requestedKey}`.slice(0, 160)
    const { data: claimData, error: claimError } = await db.rpc('claim_ai_action_operation', {
      p_shop_id: auth.shopId,
      p_user_id: auth.userId,
      p_action: 'repairEstimate',
      p_idempotency_key: idempotencyKey,
      p_payload_hash: payloadHash,
    })
    if (claimError) return apiFail('Estimate could not be safely started. Retry with the same request key.', 503, 'INTERNAL_ERROR')
    const claim = (claimData || {}) as { claimed?: boolean; status?: string; id?: string; result?: unknown; error?: string }
    if (claim.status === 'conflict') return apiFail(claim.error || 'Idempotency key was used for a different estimate', 409, 'CONFLICT')
    if (claim.status === 'succeeded') return apiOk(claim.result)
    if (claim.status === 'failed') return apiFail(claim.error || 'This estimate request failed before a write was committed', 409, 'CONFLICT')
    if (claim.status === 'unknown') return apiFail(claim.error || 'The previous estimate request has an uncertain outcome; reconcile it before retrying', 409, 'CONFLICT')
    if (claim.claimed !== true || claim.status !== 'running' || typeof claim.id !== 'string') return apiFail('This estimate request is already in progress', 409, 'CONFLICT')
    operationId = claim.id

    const failOperation = async (message: string, status = 500) => {
      if (db && operationId && !operationFinalized) {
        await db.from('ai_action_operations').update({
          status: mutationCommitted ? 'unknown' : 'failed',
          error: message.slice(0, 1000),
          lease_expires_at: null,
          updated_at: new Date().toISOString(),
        }).eq('id', operationId).eq('shop_id', auth.shopId).eq('status', 'running')
      }
      return apiFail(message, status, mutationCommitted ? 'INTERNAL_ERROR' : 'BAD_REQUEST')
    }

    const { data: docNumber, error: numberingError } = await db.rpc('next_document_number', {
      p_shop_id: auth.shopId,
      p_type: 'Estimate',
    })
    if (numberingError || typeof docNumber !== 'string') return await failOperation('Document numbering failed')

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
      tax_rate: hasLockedTotal ? 0 : Number(configuredTax),
      apply_tax: !hasLockedTotal,
      shop_supplies: 0,
      deposit: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).select().single()

    if (error) return await failOperation(error.message)
    mutationCommitted = true

    const result = { document: data, docNumber }
    const { data: finalized, error: finalizeError } = await db.from('ai_action_operations').update({
      status: 'succeeded',
      result,
      error: null,
      audit_status: 'pending',
      audit_error: null,
      audit_target_type: 'document',
      audit_target_id: data?.id || null,
      audit_permission: 'write',
      audit_approved: true,
      audit_metadata: { customerName, targetTotal, operationCount: labors.length },
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', operationId).eq('shop_id', auth.shopId).eq('status', 'running').select('id').maybeSingle()
    if (finalizeError || !finalized) throw new Error('Estimate was created, but its durable result could not be recorded')
    operationFinalized = true

    const auditResult = await writeAuditLog({
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
    if (!auditResult.ok) {
      await db.from('ai_action_operations').update({ audit_status: 'queued', audit_error: auditResult.error.slice(0, 1000), updated_at: new Date().toISOString() }).eq('id', operationId).eq('shop_id', auth.shopId).eq('status', 'succeeded')
    } else {
      await db.from('ai_action_operations').update({ audit_status: auditResult.pending ? 'queued' : 'delivered', audit_error: null, updated_at: new Date().toISOString() }).eq('id', operationId).eq('shop_id', auth.shopId).eq('status', 'succeeded')
    }
    return apiOk({ ...result, ...(auditResult.ok && auditResult.pending ? { auditPending: true } : {}) })
  } catch (err) {
    if (db && operationId && !operationFinalized) {
      await db.from('ai_action_operations').update({
        status: mutationCommitted ? 'unknown' : 'failed',
        error: (err instanceof Error ? err.message : 'Estimate request failed').slice(0, 1000),
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', operationId).eq('shop_id', shopId).eq('status', 'running')
    }
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiFail(message, mutationCommitted ? 502 : 500, 'INTERNAL_ERROR')
  }
}
