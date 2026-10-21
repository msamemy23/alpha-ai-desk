export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { buildShopSnapshot } from '@/lib/ai/shop-snapshot'
import { loadShopFacts, todayKeyIn } from '@/lib/report-delivery'
import { loadDocs } from '@/lib/report-load'
import type { Db } from '@/lib/db-types'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, hasInternalApiSecret, unauthorized } from '@/lib/api-auth'
import { sendEmail, estimateEmailHtml } from '@/lib/email'
import { getIdempotencyKey } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { createHash, randomUUID } from 'node:crypto'
import { isSmsOptedOut } from '@/lib/sms-consent'
import { calculateDocumentTotals, nonNegativeMoney } from '@/lib/document-money'
import { loadShopRules } from '@/lib/ai/shop-rules-server'
import { decideAction, findNeverSay } from '@/lib/ai/shop-rules'
import { getActionInfo } from '@/lib/ai/action-risk'
import { describeChange, subjectOf, undoForCreate, undoForCreatedDocument, undoForDelete, undoForScheduledMessage, undoForUpdate, type BuildResult, type UndoTable } from '@/lib/ai/undo'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }

const mutatingActions = new Set([
  'createCustomer', 'createJob', 'createInvoice', 'updateJobStatus', 'updateCustomer',
  'voidDocument', 'deleteRecord', 'scheduleFollowUp', 'sendEstimateEmail',
  'convertEstimateToInvoice', 'addStaff', 'removeStaff', 'updateDocument',
  'createAppointment', 'deleteAppointment', 'updateAppointment', 'updateInventory',
])
function safeSearchTerm(value: unknown, maxLength = 120): string {
  return String(value ?? '').replace(/[%,().*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function pickFields(payload: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(payload, key)).map((key) => [key, payload[key]]))
}

const DOCUMENT_STATUSES = new Set(['Draft', 'Sent', 'Approved', 'Unpaid', 'Partial', 'Paid', 'Void'])

function validateDocumentLines(value: unknown, kind: 'parts' | 'labors'): string | null {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length > 100) return `${kind} must be an array of at most 100 lines`
  for (const [index, line] of value.entries()) {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return `Invalid ${kind}.${index}`
    const record = line as Record<string, unknown>
    const label = kind === 'parts' ? record.name || record.description : record.operation || record.description
    if (typeof label !== 'string' || !label.trim()) return `${kind}.${index} needs a description`
    const numeric = (value: unknown, minimum = 0) => {
      const number = Number(value)
      return typeof value === 'number' && Number.isFinite(number) && number >= minimum
    }
    if (kind === 'parts') {
      const qty = record.qty === undefined || record.qty === null || record.qty === '' ? 1 : record.qty
      const unitPrice = record.unitPrice
      if (!numeric(qty, 0.000001) || !numeric(unitPrice) || (record.core !== undefined && record.core !== null && !numeric(record.core))) return `Invalid numeric value in ${kind}.${index}`
    } else {
      const hasFlat = record.amount !== undefined && record.amount !== null
      const hasHourly = record.hours !== undefined || record.rate !== undefined
      if (hasFlat && hasHourly) return `${kind}.${index} cannot mix a flat amount with hours/rate`
      if (hasFlat ? !numeric(record.amount) : !numeric(record.hours, 0.000001) || !numeric(record.rate)) return `Invalid labor pricing in ${kind}.${index}`
    }
  }
  return null
}

function validateActionPayload(action: string, payload: Record<string, unknown>): string | null {
  if (action === 'createCustomer' && (typeof payload.name !== 'string' || !payload.name.trim())) return 'Customer name is required'
  if (action === 'createCustomer' && payload.email !== undefined && payload.email !== null && (typeof payload.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email.trim()))) return 'The customer email address is invalid'
  if (action === 'createInvoice' || action === 'updateDocument') {
    if (payload.type !== undefined && !['Invoice', 'Estimate', 'Receipt'].includes(String(payload.type))) return 'Document type is invalid'
    if (payload.status !== undefined && !DOCUMENT_STATUSES.has(String(payload.status))) return 'Document status is invalid'
    if (payload.apply_tax !== undefined && typeof payload.apply_tax !== 'boolean') return 'apply_tax must be true or false'
    for (const field of ['tax_rate', 'shop_supplies', 'sublet', 'deposit']) {
      if (payload[field] !== undefined && (typeof payload[field] !== 'number' || !Number.isFinite(payload[field] as number) || Number(payload[field]) < 0)) return `Invalid ${field}`
    }
    const partsError = validateDocumentLines(payload.parts, 'parts')
    if (partsError) return partsError
    const laborError = validateDocumentLines(payload.labors, 'labors')
    if (laborError) return laborError
    if (action === 'createInvoice' && (!Array.isArray(payload.parts) || !Array.isArray(payload.labors) || (payload.parts.length + payload.labors.length) === 0)) {
      return 'At least one priced part or labor line is required before saving a document'
    }
  }
  if (action === 'updateJobStatus') {
    const allowedStatuses = new Set(['New', 'Waiting on Parts', 'Waiting on Customer', 'Approved', 'In Progress', 'Completed', 'Ready for Pickup', 'Paid', 'Closed'])
    if (!allowedStatuses.has(String(payload.status))) return 'Job status is invalid'
  }
  return null
}

export async function POST(req: NextRequest) {
  let failureMessage: string | null = null
  let isMutation = false
  let mutationCommitted = false
  const fail = (error: string, status = 400, operationStatus?: 'failed' | 'unknown') => {
    failureMessage = error
    return NextResponse.json({
      ok: false,
      error,
      ...(isMutation ? { operationStatus: operationStatus || (mutationCommitted ? 'unknown' : 'failed') } : {}),
    }, { status })
  }
  const sb = getServiceClient()
  const body = await req.json().catch(() => null) as { action?: unknown; payload?: unknown; shopId?: unknown } | null
  const sessionAuth = await getAuthedShop()
  const internal = hasInternalApiSecret(req)
  let caller = sessionAuth

  // Background/mobile callers may use the deployment secret, but they must
  // name a real shop profile. A caller can never select a shop by id alone.
  if (!caller && internal) {
    const requestedShopId = typeof body?.shopId === 'string' ? body.shopId : ''
    if (!requestedShopId) return fail('shopId is required for internal calls', 400)
    const { data: profile } = await sb.from('shop_profiles').select('id,user_id').eq('id', requestedShopId).maybeSingle()
    if (!profile) return fail('Shop not found', 404)
    caller = { userId: String(profile.user_id), shopId: String(profile.id), role: 'service' }
  }
  if (!caller) return unauthorized()

  const shopId = caller.shopId
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const limited = checkRateLimit(rateLimitKey('ai-action', caller.userId, caller.shopId, ip), 120, 60_000)
  if (!limited.ok) return fail('Too many AI action requests', 429)

  const action = typeof body?.action === 'string' ? body.action : ''
  if (!action) return fail('Action is required')
  const payload = body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload as Record<string, unknown> : {}
  const safePayload = payload
  if (JSON.stringify(safePayload).length > 20000) return fail('Action payload is too large', 413)
  const payloadHash = createHash('sha256').update(JSON.stringify(safePayload)).digest('hex')
  isMutation = mutatingActions.has(action)
  if (isMutation && caller.role === 'viewer') return forbidden()
  const payloadError = validateActionPayload(action, safePayload)
  if (payloadError) return fail(payloadError)
  // The shop's own rules come first. They can switch off a whole kind of action or one
  // action by name, and they apply to every caller. If the rules cannot be read, nothing runs.
  const shopRules = await loadShopRules(sb, shopId)
  if (shopRules.status === 'error') return fail('Your shop rules could not be checked, so nothing was done. Try again in a moment.', 503, 'failed')
  const ruleDecision = decideAction(shopRules.rules, action)
  if (!ruleDecision.allowed) {
    return NextResponse.json({ ok: false, error: ruleDecision.reason, blockedByRules: true, ...(isMutation ? { operationStatus: 'failed' } : {}) }, { status: 403 })
  }
  // A caller-provided key makes retries safe. A request without one gets a
  // fresh operation identity so two intentional, identical actions do not
  // collapse into one forever.
  const requestedKey = getIdempotencyKey(req, isMutation ? [randomUUID()] : [shopId, action, payloadHash])
  // Never allow a caller-supplied key to cross a tenant boundary or silently
  // replay a different action/payload in another tenant's durable operation.
  const idempotencyKey = `${shopId}:${requestedKey}`.slice(0, 160)
  let operationId: string | null = null
  let operationFinalized = false
  let readAuditAttempted = false
  // Reads need a new audit entry on each execution, not one per payload hash.
  const readAuditKey = `${shopId}:read:${randomUUID()}`
  if (isMutation && req.headers.get('x-ai-approval') !== 'confirm') {
    return NextResponse.json({
      ok: false,
      error: 'Explicit confirmation is required before changing shop data or sending anything',
      approvalRequired: true,
      action,
      payload: safePayload,
    }, { status: 409 })
  }
  if (isMutation) {
    const { data: claimData, error: claimError } = await sb.rpc('claim_ai_action_operation', {
      p_shop_id: shopId,
      p_user_id: caller.userId,
      p_action: action,
      p_idempotency_key: idempotencyKey,
      p_payload_hash: payloadHash,
    })
    if (claimError) {
      console.error('[ai-action] durable operation claim failed:', claimError.message)
      return fail('AI action could not be safely started', 503, 'unknown')
    }
    const claim = (claimData || {}) as {
      claimed?: boolean
      status?: string
      id?: string
      result?: unknown
      error?: string
      audit_status?: string
      audit_error?: string | null
      audit_target_type?: string | null
      audit_target_id?: string | null
      audit_permission?: string | null
      audit_approved?: boolean
      audit_metadata?: Record<string, unknown> | null
    }
    operationId = typeof claim.id === 'string' ? claim.id : null
    if (claim.status === 'conflict') return fail(claim.error || 'Idempotency key conflict', 409)
    if (claim.status === 'succeeded') {
      // A completed mutation may have returned while its audit insert was
      // temporarily unavailable. Replays repair that audit state before
      // returning the durable result again, without repeating the mutation.
      if (claim.audit_status !== 'delivered') {
        const auditResult = await writeAuditLog({
          shopId,
          userId: caller.userId,
          action: `ai.${action}`,
          targetType: claim.audit_target_type || undefined,
          targetId: claim.audit_target_id || undefined,
          permission: claim.audit_permission || 'write',
          approved: claim.audit_approved ?? true,
          idempotencyKey,
          metadata: claim.audit_metadata || { payload: safePayload },
        })
        if (!auditResult.ok) return fail('The previous action completed, but its audit record still needs repair', 502, 'unknown')
        const { error: auditStateError } = await sb.from('ai_action_operations').update({
          audit_status: auditResult.pending ? 'queued' : 'delivered',
          audit_error: null,
          updated_at: new Date().toISOString(),
        }).eq('id', operationId).eq('shop_id', shopId).eq('status', 'succeeded')
        if (auditStateError) return fail('The previous action completed, but its audit state could not be updated', 502, 'unknown')
        if (auditResult.pending) return NextResponse.json({ ok: true, data: claim.result, auditPending: true })
      }
      return ok(claim.result)
    }
    if (claim.status === 'failed') return fail(claim.error || 'This AI action failed before a mutation was committed', 409, 'failed')
    if (claim.status === 'unknown') return fail(claim.error || 'The previous AI action outcome is uncertain; reconcile it before retrying', 409, 'unknown')
    if (claim.claimed !== true || claim.status !== 'running' || !operationId) {
      return fail('This AI action is already in progress', 409, 'unknown')
    }
  }

  // What an Undo needs, and a plain description of what changed, saved next to the audit entry.
  // The undo copy is a JSON string on purpose: the audit redactor blanks anything nested deeper.
  type AuditExtra = { subject?: string; summary?: string; undo?: string | null; undoReason?: string }
  const actionInfo = getActionInfo(action)
  const snapshot = async (table: string, id: unknown): Promise<Record<string, unknown> | null> => {
    if (typeof id !== 'string' || !id) return null
    try {
      const { data, error } = await sb.from(table).select('*').eq('id', id).eq('shop_id', shopId).maybeSingle()
      return error ? null : (data as Record<string, unknown> | null)
    } catch { return null }
  }
  const withUndo = (built: BuildResult, subject: string, summary: string): AuditExtra => ({
    subject, summary, undo: built.undo, ...(built.undo ? {} : { undoReason: built.reason || 'No undo copy was saved.' }),
  })
  const labelFor = (subject: string) => `${actionInfo.past}${subject ? `: ${subject}` : ''}`
  const updatedExtra = (table: UndoTable, id: unknown, fields: string[], before: Record<string, unknown> | null, after: unknown): AuditExtra => {
    const row = (after && typeof after === 'object' ? after : null) as Record<string, unknown> | null
    const keys = fields.filter(key => key !== 'updated_at')
    const subject = subjectOf(table, row || before)
    return withUndo(undoForUpdate({ table, id: String(id), fields: keys, before, after: row, label: labelFor(subject) }), subject, before && row ? describeChange(keys, before, row) : '')
  }
  const createdExtra = (table: UndoTable, row: unknown): AuditExtra => {
    const data = (row && typeof row === 'object' ? row : null) as Record<string, unknown> | null
    const subject = subjectOf(table, data)
    return withUndo(undoForCreate({ table, row: data, label: labelFor(subject) }), subject, subject)
  }
  const auditedOk = async (data: unknown, targetType?: string, targetId?: string, extra: AuditExtra = {}) => {
    const auditMetadata: Record<string, unknown> = { payload: safePayload }
    if (extra.subject) auditMetadata.subject = extra.subject.slice(0, 200)
    if (extra.summary) auditMetadata.summary = extra.summary.slice(0, 300)
    if (extra.undo) auditMetadata.undo = extra.undo
    else if (extra.undoReason) auditMetadata.undoReason = extra.undoReason.slice(0, 200)
    if (isMutation) {
      // Every mutating branch calls this only after its business write has
      // succeeded. If durable completion then fails, the operation is
      // uncertain—not failed—so a retry cannot repeat a completed mutation.
      mutationCommitted = true
      const auditPermission = action.toLowerCase().includes('delete') || action.toLowerCase().includes('void') ? 'destructive' : 'write'
      const { data: finalizedOperation, error: operationError } = await sb.from('ai_action_operations').update({
        status: 'succeeded',
        result: data,
        error: null,
        audit_status: 'pending',
        audit_error: null,
        audit_target_type: targetType || null,
        audit_target_id: targetId || null,
        audit_permission: auditPermission,
        audit_approved: true,
        audit_metadata: auditMetadata,
        updated_at: new Date().toISOString(),
      }).eq('id', operationId).eq('shop_id', shopId).eq('status', 'running').select('id').maybeSingle()
      if (operationError || !finalizedOperation) {
        console.error('[ai-action] durable operation completion failed:', operationError?.message || 'operation row was not updated')
        return fail('Action completed, but its durable result could not be recorded', 502)
      }
      // Once the durable result is stored, a retry returns it instead of
      // repeating the shop mutation or external side effect.
      operationFinalized = true
      const auditResult = await writeAuditLog({
        shopId,
        userId: caller.userId,
        action: `ai.${action}`,
        targetType,
        targetId,
        permission: auditPermission,
        approved: true,
        idempotencyKey,
        metadata: auditMetadata,
      })
      if (!auditResult.ok) return fail('Action completed, but its audit record could not be saved', 502)
      const { error: auditStateError } = await sb.from('ai_action_operations').update({
        audit_status: auditResult.pending ? 'queued' : 'delivered',
        audit_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', operationId).eq('shop_id', shopId).eq('status', 'succeeded')
      if (auditStateError) return fail('Action completed, but its audit state could not be recorded', 502)
      if (auditResult.pending) return NextResponse.json({ ok: true, data, auditPending: true })
    } else {
      readAuditAttempted = true
      const auditResult = await writeAuditLog({
        shopId, userId: caller.userId, action: `ai.${action}`,
        permission: 'read', approved: true, idempotencyKey: readAuditKey,
        metadata: { payload: safePayload, result: data, success: true },
      })
      if (!auditResult.ok) return fail('The data was read, but its audit record could not be saved', 502)
      if (auditResult.pending) return NextResponse.json({ ok: true, data, auditPending: true })
    }
    return ok(data)
  }

  try {
    switch (action) {

      // ── Create Customer ──────────────────────────────────────
      case 'createCustomer': {
        const { name, phone, email, address, notes } = payload
        if (!name) return fail('Customer name is required')
        const { data, error } = await sb.from('customers').insert({
          name, phone: phone || null, email: email || null,
          address: address || null, notes: notes || null,
          shop_id: shopId,
          created_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return await auditedOk(data, 'customer', data?.id, createdExtra('customers', data))
      }

      // ── Create Job ───────────────────────────────────────────
      case 'createJob': {
        const { customer_id, customer_name, vehicle_year, vehicle_make, vehicle_model, vin, status, notes } = payload
        if (customer_id) {
          const { data: customer, error: customerError } = await sb.from('customers').select('id').eq('id', customer_id).eq('shop_id', shopId).maybeSingle()
          if (customerError) return fail(customerError.message, 500)
          if (!customer) return fail('Customer not found in this shop', 404)
        }
        const { data, error } = await sb.from('jobs').insert({
          customer_id: customer_id || null,
          customer_name: customer_name || 'Walk-in',
          vehicle_year: vehicle_year || '', vehicle_make: vehicle_make || '',
          vehicle_model: vehicle_model || '', vehicle_vin: vin || '',
           status: status || 'New', customer_notes: notes || '',
          shop_id: shopId,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return await auditedOk(data, 'job', data?.id, createdExtra('jobs', data))
      }

      // ── Create Invoice / Estimate ────────────────────────────
      case 'createInvoice': {
        const docType = (payload.type as string) || 'Invoice'
        if (!['Invoice', 'Estimate', 'Receipt'].includes(docType)) return fail('Document type must be Invoice, Estimate, or Receipt')
        const { data: shopSettings, error: shopSettingsError } = await sb.from('settings').select('tax_rate').eq('shop_id', shopId).limit(1).maybeSingle()
        if (shopSettingsError) return fail('Shop tax settings could not be loaded', 500)
        const configuredTaxRate = nonNegativeMoney(shopSettings?.tax_rate, 0)
        const hasConfiguredTaxRate = shopSettings?.tax_rate !== undefined && shopSettings?.tax_rate !== null && Number.isFinite(Number(shopSettings.tax_rate)) && Number(shopSettings.tax_rate) >= 0
        const explicitTaxRate = payload.tax_rate !== undefined && payload.tax_rate !== null
        if (payload.apply_tax !== false && !explicitTaxRate && !hasConfiguredTaxRate) return fail('Shop tax is not configured. Set a tax rate or explicitly disable tax before saving the document')
        if (payload.customer_id !== undefined && payload.customer_id !== null && typeof payload.customer_id !== 'string') return fail('customer_id must be a string')
        if (payload.customer_id) {
          const { data: customer, error: customerError } = await sb.from('customers').select('id').eq('id', payload.customer_id).eq('shop_id', shopId).maybeSingle()
          if (customerError) return fail(customerError.message, 500)
          if (!customer) return fail('Customer not found in this shop', 404)
        }
        if (payload.job_id !== undefined && payload.job_id !== null && typeof payload.job_id !== 'string') return fail('job_id must be a string')
        if (payload.job_id) {
          const { data: job, error: jobError } = await sb.from('jobs').select('id').eq('id', payload.job_id).eq('shop_id', shopId).maybeSingle()
          if (jobError) return fail('Job lookup failed', 500)
          if (!job) return fail('Job not found in this shop', 404)
        }
        const { data: doc_number, error: numberingError } = await sb.rpc('next_document_number', { p_shop_id: shopId, p_type: docType })
        if (numberingError || typeof doc_number !== 'string') return fail('Document numbering failed', 500)

        const { data, error } = await sb.from('documents').insert({
          type: docType, doc_number, shop_id: shopId, status: 'Draft',
          doc_date: new Date().toISOString().split('T')[0],
          customer_name: (payload.customer_name as string) || 'Customer',
          customer_id: payload.customer_id || null,
          job_id: payload.job_id || null,
          customer_phone: payload.customer_phone || null,
          customer_email: payload.customer_email || null,
          vehicle_year: payload.vehicle_year || '', vehicle_make: payload.vehicle_make || '',
          vehicle_model: payload.vehicle_model || '',
          vehicle_vin: payload.vehicle_vin || '',
          vehicle_plate: payload.vehicle_plate || '',
          vehicle_mileage: payload.vehicle_mileage || null,
          parts: payload.parts || [], labors: payload.labors || [],
          notes: payload.notes || '',
          internal_notes: payload.internal_notes || null,
          warranty_type: payload.warranty_type || null,
          warranty_months: payload.warranty_months ?? null,
          warranty_mileage: payload.warranty_mileage ?? null,
          warranty_start: payload.warranty_start || null,
          warranty_exclusions: payload.warranty_exclusions || null,
          warranty_claim: payload.warranty_claim || null,
          locked: payload.locked === true,
          due_date: payload.due_date || null,
          expires_date: payload.expires_date || null,
          line_items: payload.line_items || null,
          payment_plan: payload.payment_plan || null,
          tax_rate: payload.apply_tax === false ? 0 : nonNegativeMoney(payload.tax_rate, configuredTaxRate),
          apply_tax: payload.apply_tax !== false, shop_supplies: nonNegativeMoney(payload.shop_supplies),
          sublet: nonNegativeMoney(payload.sublet), deposit: nonNegativeMoney(payload.deposit),
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        {
          const subject = subjectOf('documents', data)
          return await auditedOk(data, 'document', data?.id, withUndo(undoForCreatedDocument({ row: data, label: labelFor(subject) }), subject, subject))
        }
      }

      // ── Update Job Status ────────────────────────────────────
      case 'updateJobStatus': {
        const { id, status: newStatus } = payload
        if (!id || !newStatus) return fail('id and status are required')
        const before = await snapshot('jobs', id)
        const { data, error } = await sb.from('jobs').update({
          status: newStatus, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return await auditedOk(data, 'job', String(id), updatedExtra('jobs', id, ['status'], before, data))
      }

      // ── Update Customer ──────────────────────────────────────
      case 'updateCustomer': {
         const { id } = payload
         if (!id) return fail('Customer id is required')
         const before = await snapshot('customers', id)
         const updates = pickFields(payload, ['name','phone','email','address','preferred_contact','vehicle_year','vehicle_make','vehicle_model','vehicle_vin','vehicle_plate','vehicle_mileage','notes','tags','sentiment','last_contact','review_requested','vehicle_color','vehicle_engine','sms_opted_out'])
         const { data, error } = await sb.from('customers').update({
           ...updates, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return await auditedOk(data, 'customer', String(id), updatedExtra('customers', id, Object.keys(updates), before, data))
      }

      // ── Void Document ────────────────────────────────────────
      case 'voidDocument': {
        const { id } = payload
        if (!id) return fail('Document id is required')
        const before = await snapshot('documents', id)
        const { data, error } = await sb.from('documents').update({
          status: 'Void', updated_at: new Date().toISOString(),
        }).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return await auditedOk(data, 'document', String(id), updatedExtra('documents', id, ['status'], before, data))
      }

      // ── Delete Record ────────────────────────────────────────
      case 'deleteRecord': {
        const { table, id } = payload as { table: string; id: string }
        const allowed = ['customers', 'jobs', 'documents', 'messages']
        if (!allowed.includes(table)) return fail(`Cannot delete from table: ${table}`)
        if (!id) return fail('Record id is required')
        // Scope the delete to the caller's shop so one shop can't delete another's row.
         const doomed = await snapshot(table, id)
         const { data: deleted, error } = await sb.from(table).delete().eq('id', id).eq('shop_id', shopId).select('id').maybeSingle()
         if (error) return fail(error.message, 500)
         if (!deleted) return fail('Record not found in this shop', 404)
         return await auditedOk({ deleted: true, table, id }, table, id, { subject: subjectOf(table, doomed), undoReason: 'A deleted record and anything attached to it cannot be restored.' })
      }

      // ── Schedule Follow-Up ───────────────────────────────────
      case 'scheduleFollowUp': {
        const { customer_id, customer_name, channel, scheduled_for, message_body, subject } = payload
        const selectedChannel = channel || 'sms'
        if (!['sms', 'email'].includes(String(selectedChannel))) return fail('Channel must be sms or email')
        if (typeof message_body !== 'string' || !message_body.trim()) return fail('Message body is required')
        const requestedDate = scheduled_for ? new Date(String(scheduled_for)) : new Date(Date.now() + 86400000)
        if (Number.isNaN(requestedDate.getTime())) return fail('scheduled_for must be a valid date')
        let resolvedCustomerId = typeof customer_id === 'string' ? customer_id : ''
        let customer: { id: string; name?: string; phone?: string; email?: string; sms_opted_out?: boolean } | null = null
        if (resolvedCustomerId) {
          const { data, error: customerError } = await sb.from('customers').select('id,name,phone,email,sms_opted_out').eq('id', resolvedCustomerId).eq('shop_id', shopId).maybeSingle()
          if (customerError) return fail(customerError.message, 500)
          customer = data
        } else if (typeof customer_name === 'string' && customer_name.trim()) {
          const { data, error: customerError } = await sb.from('customers').select('id,name,phone,email,sms_opted_out').eq('shop_id', shopId).ilike('name', customer_name.trim()).limit(1).maybeSingle()
          if (customerError) return fail(customerError.message, 500)
          customer = data
          resolvedCustomerId = data?.id || ''
        }
        if (!customer || !resolvedCustomerId) return fail('Customer must be found before scheduling a follow-up', 404)
        const bannedPhrases = findNeverSay(shopRules.rules, `${message_body} ${typeof subject === 'string' ? subject : ''}`)
        if (bannedPhrases.length) return fail(`This message uses ${bannedPhrases.length === 1 ? 'a phrase' : 'phrases'} your shop rules ban: ${bannedPhrases.map(phrase => `"${phrase}"`).join(', ')}. Edit the message and try again.`, 409, 'failed')
        if (selectedChannel === 'sms' && (customer.sms_opted_out || await isSmsOptedOut(sb, shopId, customer.phone))) return fail('This destination has opted out of SMS', 409)
        const { data, error } = await sb.from('scheduled_messages').insert({
          customer_id: resolvedCustomerId,
          customer_name: customer.name || customer_name || 'Customer',
          channel: selectedChannel,
          scheduled_for: requestedDate.toISOString(),
          message_body: message_body.trim(),
          subject: subject || null,
          status: 'pending',
          shop_id: shopId,
          created_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        {
          const followUpName = subjectOf('scheduled_messages', data)
          return await auditedOk(data, 'scheduled_message', data?.id, withUndo(undoForScheduledMessage({ row: data, label: labelFor(followUpName) }), followUpName, `${String(selectedChannel) === 'email' ? 'Email' : 'Text'}: ${String(message_body).trim().slice(0, 140)}`))
        }
      }

      // ── Get Customer History ─────────────────────────────────
      case 'getCustomerHistory': {
        const { customer_id, customer_name } = payload
        let jobs: unknown[] = []
        let docs: unknown[] = []
        let msgs: unknown[] = []

        if (customer_id) {
          const [jRes, dRes, mRes] = await Promise.all([
            sb.from('jobs').select('*').eq('shop_id', shopId).eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(20),
            sb.from('documents').select('*').eq('shop_id', shopId).eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(20),
            sb.from('messages').select('*').eq('shop_id', shopId).eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(20),
          ])
          if (jRes.error || dRes.error || mRes.error) return fail('Customer history could not be loaded', 500)
          jobs = jRes.data || []
          docs = dRes.data || []
          msgs = mRes.data || []
        } else if (customer_name) {
          const name = safeSearchTerm(customer_name)
          if (!name) return fail('Customer name is required')
          const [jRes, dRes] = await Promise.all([
            sb.from('jobs').select('*').eq('shop_id', shopId).ilike('customer_name', `%${name}%`).order('created_at', { ascending: false }).limit(20),
            sb.from('documents').select('*').eq('shop_id', shopId).ilike('customer_name', `%${name}%`).order('created_at', { ascending: false }).limit(20),
          ])
          if (jRes.error || dRes.error) return fail('Customer history could not be loaded', 500)
          jobs = jRes.data || []
          docs = dRes.data || []
        }
        return await auditedOk({ jobs, documents: docs, messages: msgs })
      }




            // -- Search Customers (FULL SYSTEM SEARCH) -------------------------
      case 'searchCustomers': {
        const { query } = payload
        if (!query) return fail('Search query is required')
        const q = safeSearchTerm(query)
        if (!q) return fail('Search query is required')

        // Search customers + jobs in parallel
        const [custRes, jobsRes, docsRes, msgsRes] = await Promise.all([
          sb.from('customers').select('*').eq('shop_id', shopId).or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,address.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
          sb.from('jobs').select('*').eq('shop_id', shopId).or(`customer_name.ilike.%${q}%,customer_notes.ilike.%${q}%,vehicle_vin.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
          sb.from('documents').select('*').eq('shop_id', shopId).or(`customer_name.ilike.%${q}%,doc_number.ilike.%${q}%,notes.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
          sb.from('messages').select('*').eq('shop_id', shopId).or(`body.ilike.%${q}%,from_address.ilike.%${q}%,to_address.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
        ])

        if (custRes.error || jobsRes.error || docsRes.error || msgsRes.error) return fail('Customer search failed', 500)

        // Enrich customers with their jobs/vehicle info
        const customers = custRes.data || []
        const allJobs = jobsRes.data || []
        const allDocs = docsRes.data || []
        const enriched = customers.map((c: Record<string, unknown>) => {
          const custJobs = allJobs.filter((j: Record<string, unknown>) => {
            const cName = (c.name as string || '').toLowerCase()
            const jName = (j.customer_name as string || '').toLowerCase()
            return j.customer_id === c.id || jName.includes(cName) || cName.includes(jName)
          })
          const vehicles = custJobs.map((j: Record<string, unknown>) => ({
            year: j.vehicle_year, make: j.vehicle_make, model: j.vehicle_model, vin: j.vehicle_vin
          })).filter((v: Record<string, unknown>) => v.year || v.make || v.model)
          const uniqueVehicles = vehicles.filter((v: Record<string, unknown>, i: number, arr: Record<string, unknown>[]) =>
            arr.findIndex((u: Record<string, unknown>) => u.year === v.year && u.make === v.make && u.model === v.model) === i
          )
          // Backfill email from documents if missing on customer record
          let resolvedEmail = (c.email as string) || null
          if (!resolvedEmail) {
            const docWithEmail = allDocs.find((d: Record<string, unknown>) => d.customer_id === c.id && d.customer_email)
            if (docWithEmail) {
              resolvedEmail = docWithEmail.customer_email as string
            }
          }
          return { ...c, email: resolvedEmail, vehicles: uniqueVehicles, recent_jobs: custJobs.slice(0, 5) }
        })

        // Also find customers referenced in jobs but not in customers table
        const custNames = new Set<string>(customers.map((c: Record<string, unknown>) => (c.name as string || '').toLowerCase()))
        const jobOnlyCustomers = allJobs
          .filter((j: Record<string, unknown>) => {
            const jName = (j.customer_name as string || '').toLowerCase()
            return !custNames.has(jName) && !Array.from(custNames).some(cn => jName.includes(cn) || cn.includes(jName))
          })
          .reduce((acc: Record<string, Record<string, unknown>>, j: Record<string, unknown>) => {
            const name = j.customer_name as string || ''
            if (!acc[name]) acc[name] = { name, source: 'jobs', vehicles: [], recent_jobs: [] }
            const v = { year: j.vehicle_year, make: j.vehicle_make, model: j.vehicle_model, vin: j.vehicle_vin };
            if (v.year || v.make || v.model) (acc[name].vehicles as unknown[]).push(v);
            (acc[name].recent_jobs as unknown[]).push(j)
            return acc
          }, {} as Record<string, Record<string, unknown>>)

        return await auditedOk({
          customers: [...enriched, ...Object.values(jobOnlyCustomers)],
          documents: allDocs,
          jobs: allJobs,
          messages: msgsRes.data || [],
          search_query: q,
          total_results: enriched.length + Object.keys(jobOnlyCustomers).length
        })
      }
      // ── Shop snapshot: who owes, the schedule, open jobs ─────
      case 'getShopSnapshot': {
        const facts = await loadShopFacts(sb as unknown as Db, shopId)
        const now = new Date()
        const todayKey = todayKeyIn(facts.timezone, now)
        const [docLoad, draftsRes, estimatesRes, apptRes, jobsRes] = await Promise.all([
          loadDocs(sb as unknown as Db, shopId, now.toISOString()),
          sb.from('documents').select('id', { count: 'exact', head: true }).eq('shop_id', shopId).eq('type', 'Invoice').eq('status', 'Draft'),
          sb.from('documents').select('*').eq('shop_id', shopId).eq('type', 'Estimate').limit(500),
          sb.from('appointments').select('*').eq('shop_id', shopId).limit(1000),
          sb.from('jobs').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(500),
        ])
        if (draftsRes.error || estimatesRes.error || apptRes.error || jobsRes.error) return fail('The shop snapshot could not be loaded', 500)
        const estimates = (estimatesRes.data || []) as Record<string, unknown>[]
        return await auditedOk(buildShopSnapshot({
          todayKey,
          timezone: facts.timezone,
          saleDocs: docLoad.docs.filter(d => d.type === 'Invoice' || d.type === 'Receipt'),
          draftInvoiceCount: draftsRes.count || 0,
          estimates,
          estimateTotal: row => calculateDocumentTotals(row).total,
          appointments: (apptRes.data || []) as Record<string, unknown>[],
          jobs: (jobsRes.data || []) as Record<string, unknown>[],
          customerFilter: typeof payload.customer_name === 'string' ? payload.customer_name : undefined,
        }))
      }

      // ── Get Shop Stats ───────────────────────────────────────
      case 'getShopStats': {
        const statsFacts = await loadShopFacts(sb as unknown as Db, shopId)
        const today = todayKeyIn(statsFacts.timezone, new Date())
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0] // a 7-day window; the day key above is the shop's own

        const [jobsRes, docsRes, msgsRes, custRes] = await Promise.all([
          sb.from('jobs').select('*').eq('shop_id', shopId).gte('created_at', weekAgo),
          sb.from('documents').select('*').eq('shop_id', shopId).gte('created_at', weekAgo),
          sb.from('messages').select('*', { count: 'exact', head: true }).eq('shop_id', shopId).eq('read', false).eq('direction', 'inbound'),
          sb.from('customers').select('*', { count: 'exact', head: true }).eq('shop_id', shopId),
        ])

        if (jobsRes.error || docsRes.error || msgsRes.error || custRes.error) return fail('Shop statistics could not be loaded', 500)
        const jobs = jobsRes.data || []
        const docs = docsRes.data || []

        return await auditedOk({
          today,
          totalCustomers: custRes.count || 0,
          unreadMessages: msgsRes.count || 0,
          jobsThisWeek: jobs.length,
          jobsByStatus: jobs.reduce((acc: Record<string, number>, j: Record<string, unknown>) => {
            const s = (j.status as string) || 'Unknown'
            acc[s] = (acc[s] || 0) + 1
            return acc
          }, {}),
          documentsThisWeek: docs.length,
          docsByType: docs.reduce((acc: Record<string, number>, d: Record<string, unknown>) => {
            const t = (d.type as string) || 'Unknown'
            acc[t] = (acc[t] || 0) + 1
            return acc
          }, {}),
        })
      }

      // ── Search Web (proxy to ai-search) ─────────────────────
      case 'searchWeb': {
        const query = payload.query as string
        if (!query) return fail('Search query is required')
        const searchUrl = new URL('/api/ai-search', req.nextUrl.origin)
        searchUrl.searchParams.set('q', query)
        searchUrl.searchParams.set('shop_id', shopId)
        const searchHeaders: Record<string, string> = { Accept: 'application/json' }
        const authorization = req.headers.get('authorization')
        const cookie = req.headers.get('cookie')
        if (authorization) searchHeaders.Authorization = authorization
        if (cookie) searchHeaders.Cookie = cookie
        const res = await fetch(searchUrl, { headers: searchHeaders, signal: AbortSignal.timeout(20000) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.ok === false) return fail(data.error || `Search returned ${res.status}`, 502)
        return await auditedOk(data)
      }

      // ── Send Estimate/Invoice via Email ────────────────────
      case 'sendEstimateEmail': {
        const { doc_number, customer_name, customer_id, email: overrideEmail } = payload
        let docQuery = sb.from('documents').select('*').eq('shop_id', shopId)
        if (doc_number) docQuery = docQuery.eq('doc_number', doc_number)
        else if (customer_name) docQuery = docQuery.ilike('customer_name', `%${safeSearchTerm(customer_name)}%`).order('created_at', { ascending: false }).limit(1)
        else if (customer_id) docQuery = docQuery.eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(1)
        else return fail('Provide doc_number, customer_name, or customer_id')

        const { data: docs, error: docError } = await docQuery
        if (docError) return fail('Document lookup failed', 500)
        const doc = docs?.[0]
        if (!doc) return fail('Document not found')

        let toEmail = typeof overrideEmail === 'string' ? overrideEmail.trim() : ''
        if (!toEmail && doc.customer_email) toEmail = String(doc.customer_email)
        if (!toEmail && doc.customer_id) {
          const { data: cust, error: customerError } = await sb.from('customers')
            .select('email')
            .eq('id', doc.customer_id)
            .eq('shop_id', shopId)
            .maybeSingle()
          if (customerError) return fail('Customer lookup failed', 500)
          toEmail = cust?.email || ''
        }
        if (!toEmail) return fail('No email on file for this customer. Ask the user to add an email first.')
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) return fail('The customer email address is invalid')

        const { data: settings, error: settingsError } = await sb.from('settings')
          .select('*')
          .eq('shop_id', shopId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (settingsError) return fail('Shop email settings could not be loaded', 500)
        const html = estimateEmailHtml(doc, settings || {})
        const fromEmail = settings?.from_email || settings?.shop_email || ''
        const shopName = settings?.shop_name || 'your shop'
        if (!fromEmail) return fail('Shop email sender is not configured')

        try {
          // The provider call is an external side effect. Mark the operation
          // as committed before entering it so a timeout or lost response
          // cannot be retried as a second email.
          mutationCommitted = true
          await sendEmail({
            to: toEmail,
            subject: `${doc.type} #${doc.doc_number} from ${shopName}`,
            html,
            replyTo: settings?.shop_email,
            apiKey: settings?.resend_api_key,
            from: fromEmail,
            idempotencyKey,
          })
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : 'Email could not be sent')
        }

        const { error: messageError } = await sb.from('messages').insert({
          direction: 'outbound',
          channel: 'email',
          from_address: fromEmail,
          to_address: toEmail,
          subject: `${doc.type} #${doc.doc_number}`,
          body: `${doc.type} #${doc.doc_number} sent via AI`,
          document_id: doc.id,
          customer_id: doc.customer_id,
          shop_id: shopId,
          status: 'sent',
          idempotency_key: idempotencyKey,
          read: true,
        })
        if (messageError && messageError.code !== '23505') throw new Error('Email sent, but its message record could not be saved')

        const { error: documentError } = await sb.from('documents')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', doc.id)
          .eq('shop_id', shopId)
        if (documentError) throw new Error('Email sent, but the document could not be marked as sent')

        return await auditedOk({ sent: true, to: toEmail, doc_number: doc.doc_number, type: doc.type }, 'document', doc.id, { subject: subjectOf('documents', doc), summary: `Emailed to ${toEmail}`, undoReason: 'An email cannot be taken back once it is sent.' })
      }

        case 'convertEstimateToInvoice': {
          const { id: estId } = payload
          if (!estId) return fail('Estimate id is required')
          const { data: est, error: estErr } = await sb.from('documents').select('*').eq('id', estId).eq('shop_id', shopId).single()
          if (estErr || !est) return fail('Estimate not found')
          const { data: invDocNumber, error: numberingError } = await sb.rpc('next_document_number', { p_shop_id: shopId, p_type: 'Invoice' })
          if (numberingError || typeof invDocNumber !== 'string') return fail('Invoice numbering failed', 500)
          // The new invoice gets its own id, number, type and created date, so those four are left out of the copy.
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _rmId, doc_number: _rmDn, type: _rmType, created_at: _rmCa, ...estFields } = est
          const { data: invData, error: invErr } = await sb.from('documents').insert({
            ...estFields,
            type: 'Invoice',
            doc_number: invDocNumber,
            status: 'Draft',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).select().single()
          if (invErr) return fail(invErr.message, 500)
          {
            const subject = subjectOf('documents', invData)
            return await auditedOk(invData, 'document', invData?.id, withUndo(undoForCreatedDocument({ row: invData, label: labelFor(subject) }), subject, `From estimate #${String(est.doc_number || '')}`.trim()))
          }
        }
      // ── Add Staff Member ────────────────────────────────────
      case 'addStaff': {
        const { name, role, emoji } = payload
        if (!name) return fail('Staff name is required')
        const { data, error } = await sb.from('staff').insert({
          name: String(name).trim(),
          role: (role as string) || 'technician',
          emoji: (emoji as string) || ((role === 'technician') ? '🔧' : '👤'),
          shop_id: shopId,
          active: true,
          created_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        {
          const subject = subjectOf('staff', data)
          return await auditedOk(data, 'staff', data?.id, withUndo(undoForUpdate({ table: 'staff', id: String(data?.id || ''), fields: ['active'], before: { active: false }, after: data, label: labelFor(subject) }), subject, subject))
        }
      }

      // ── Remove Staff Member ──────────────────────────────────
      case 'removeStaff': {
        const { name, id } = payload
        let beforeStaff: Record<string, unknown> | null = id ? await snapshot('staff', id) : null
        if (!id && name) {
          const { data: matches } = await sb.from('staff').select('*').eq('shop_id', shopId).ilike('name', `%${String(name)}%`).limit(2)
          if (matches?.length === 1) beforeStaff = matches[0] as Record<string, unknown>
        }
        let query: any = sb.from('staff').update({ active: false }).eq('shop_id', shopId)
        if (id) query = query.eq('id', id)
        else if (name) query = query.ilike('name', `%${String(name)}%`)
        else return fail('Provide staff name or id')
        const { data, error } = await query.select().single()
        if (error) return fail(error.message, 500)
        {
          const subject = subjectOf('staff', data)
          const reversible = beforeStaff?.active === true
          return await auditedOk({ removed: true, staff: data }, 'staff', data?.id, reversible
            ? withUndo(undoForUpdate({ table: 'staff', id: String(data?.id || ''), fields: ['active'], before: beforeStaff, after: data, label: labelFor(subject) }), subject, subject)
            : { subject, summary: subject, undoReason: 'They were not active before, so there is nothing to put back.' })
        }
      }

      // ── List Staff ───────────────────────────────────────────
      case 'listStaff': {
        const { data, error } = await sb.from('staff').select('*').eq('shop_id', shopId).eq('active', true).order('name')
        if (error) return fail(error.message, 500)
        return await auditedOk({ staff: data || [] })
      }

      // ── Update Document ──────────────────────────────────────
      case 'updateDocument': {
         const { id } = payload
         if (!id) return fail('Document id is required')
         const before = await snapshot('documents', id)
         const updates = pickFields(payload, ['type','status','doc_date','due_date','expires_date','customer_id','customer_name','customer_phone','customer_email','job_id','vehicle_year','vehicle_make','vehicle_model','vehicle_vin','vehicle_plate','vehicle_mileage','parts','labors','shop_supplies','sublet','tax_rate','apply_tax','deposit','payment_method','cashier','payment_terms','payment_methods','warranty_type','warranty_months','warranty_mileage','warranty_start','warranty_exclusions','warranty_claim','notes','locked','sent_at','signature_signed_at','signature_signer_name','signature_requested_at','line_items','payment_plan','internal_notes'])
         const { data: existingDocument, error: documentLookupError } = await sb.from('documents')
           .select('id,type,status,amount_paid')
           .eq('id', id)
           .eq('shop_id', shopId)
           .maybeSingle()
         if (documentLookupError) return fail('Document payment state could not be checked', 500)
         if (!existingDocument) return fail('Document not found in this shop', 404)
         if (updates.status && ['Paid', 'Partial'].includes(String(updates.status)) && String(existingDocument.status) !== String(updates.status)) {
           return fail('Use the payment action to change an invoice to Paid or Partial; the payment ledger is protected.')
         }
         const financialFields = new Set(['parts','labors','shop_supplies','sublet','tax_rate','apply_tax','deposit','payment_method','payment_terms','payment_methods','payment_plan','line_items'])
         const typeChanged = updates.type !== undefined && String(updates.type) !== String(existingDocument.type)
         if (typeChanged || Object.keys(updates).some(field => financialFields.has(field))) {
           if (['Paid', 'Partial'].includes(String(existingDocument.status)) || Number(existingDocument.amount_paid || 0) > 0) {
             return fail('Financial terms cannot be changed after a payment is recorded; reconcile the payment ledger first.', 409)
           }
           const { data: existingPayment, error: paymentLookupError } = await sb.from('payments')
             .select('id')
             .eq('document_id', id)
             .eq('shop_id', shopId)
             .limit(1)
             .maybeSingle()
           if (paymentLookupError) return fail('Document payment history could not be checked', 500)
           if (existingPayment) return fail('Financial terms cannot be changed after a payment ledger entry exists; reconcile it first.', 409)
         }
         if (updates.customer_id !== undefined && updates.customer_id !== null) {
           const { data: customer, error: customerError } = await sb.from('customers').select('id').eq('id', updates.customer_id).eq('shop_id', shopId).maybeSingle()
           if (customerError) return fail('Customer lookup failed', 500)
           if (!customer) return fail('Customer not found in this shop', 404)
         }
         if (updates.job_id !== undefined && updates.job_id !== null) {
           const { data: job, error: jobError } = await sb.from('jobs').select('id').eq('id', updates.job_id).eq('shop_id', shopId).maybeSingle()
           if (jobError) return fail('Job lookup failed', 500)
           if (!job) return fail('Job not found in this shop', 404)
         }
         const { data, error } = await sb.from('documents').update({
           ...updates, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return await auditedOk(data, 'document', String(id), updatedExtra('documents', id, Object.keys(updates), before, data))
      }

      // ── Create Appointment ───────────────────────────────────
      case 'createAppointment': {
         const { customer_name, customer_id, vehicle, service, scheduled_date, scheduled_time, date, time, notes, phone, email } = payload
         const appointmentDate = String(scheduled_date || date || '')
         const appointmentTime = String(scheduled_time || time || '09:00')
         if (!customer_name || !appointmentDate) return fail('customer_name and date are required')
         if (customer_id) {
           const { data: customer, error: customerError } = await sb.from('customers').select('id').eq('id', customer_id).eq('shop_id', shopId).maybeSingle()
           if (customerError) return fail(customerError.message, 500)
           if (!customer) return fail('Customer not found in this shop', 404)
         }
         const { data, error } = await sb.from('appointments').insert({
           customer_name: String(customer_name),
           customer_id: customer_id || null,
           vehicle: vehicle || '',
           service: service || '',
           date: appointmentDate,
           time: appointmentTime,
           scheduled_date: appointmentDate,
           scheduled_time: appointmentTime,
           status: 'Scheduled',
           notes: notes || '',
           phone: phone || null,
           email: email || null,
           shop_id: shopId,
           created_at: new Date().toISOString(),
           updated_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return await auditedOk(data, 'appointment', data?.id, createdExtra('appointments', data))
      }

      // ── Time Clock Report ────────────────────────────────────
      case 'getTimeclockReport': {
        const { staff_name, startDate, endDate } = payload
        const start = (startDate as string) || new Date().toISOString().split('T')[0]
        const end   = (endDate as string) || start
        let query = sb.from('timeclock').select('*')
          .eq('shop_id', shopId)
          .gte('clock_in', start + 'T00:00:00')
          .lte('clock_in', end + 'T23:59:59')
          .order('clock_in', { ascending: true })
        if (staff_name) query = query.ilike('staff_name', `%${String(staff_name)}%`)
        const { data, error } = await query
        if (error) return fail(error.message, 500)
        const entries = (data || []) as Record<string, unknown>[]
        const grouped: Record<string, { name: string; entries: Record<string, unknown>[]; totalHours: number }> = {}
        for (const e of entries) {
          const n = e.staff_name as string
          if (!grouped[n]) grouped[n] = { name: n, entries: [], totalHours: 0 }
          grouped[n].entries.push(e)
          grouped[n].totalHours += (e.hours_worked as number) || 0
        }
        return await auditedOk({ entries, grouped: Object.values(grouped), startDate: start, endDate: end })
      }

      // ── Delete Appointment ───────────────────────────────────
      case 'deleteAppointment': {
        const { id } = payload
        if (!id) return fail('Appointment id is required')
         const beforeDelete = await snapshot('appointments', id)
         const { data: deleted, error } = await sb.from('appointments').delete().eq('id', id).eq('shop_id', shopId).select('id').maybeSingle()
         if (error) return fail(error.message, 500)
         if (!deleted) return fail('Appointment not found in this shop', 404)
         {
         const subject = subjectOf('appointments', beforeDelete)
         return await auditedOk({ deleted: true, id }, 'appointment', String(id), withUndo(undoForDelete({ table: 'appointments', row: beforeDelete, label: labelFor(subject) }), subject, subject))
         }
      }

      // ── Update Appointment ───────────────────────────────────
      case 'updateAppointment': {
         const { id } = payload
         if (!id) return fail('Appointment id is required')
         const before = await snapshot('appointments', id)
         const updates = pickFields(payload, ['customer_name','customer_id','phone','email','vehicle','service','tech','date','time','scheduled_date','scheduled_time','duration','status','notes','reminder_sent_at'])
         if (updates.scheduled_date && !updates.date) updates.date = updates.scheduled_date
         if (updates.scheduled_time && !updates.time) updates.time = updates.scheduled_time
         if (updates.date && !updates.scheduled_date) updates.scheduled_date = updates.date
         if (updates.time && !updates.scheduled_time) updates.scheduled_time = updates.time
         if (updates.customer_id) {
           const { data: customer, error: customerError } = await sb.from('customers').select('id').eq('id', updates.customer_id).eq('shop_id', shopId).maybeSingle()
           if (customerError) return fail(customerError.message, 500)
           if (!customer) return fail('Customer not found in this shop', 404)
         }
         updates.updated_at = new Date().toISOString()
         const { data, error } = await sb.from('appointments').update(updates).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return await auditedOk(data, 'appointment', String(id), updatedExtra('appointments', id, Object.keys(updates), before, data))
      }

      // ── Get Inventory ────────────────────────────────────────
      case 'getInventory': {
        const { query: q } = payload
        let dbQuery = sb.from('inventory').select('*').eq('shop_id', shopId).order('name')
        if (q) dbQuery = dbQuery.ilike('name', `%${String(q)}%`)
        const { data, error } = await dbQuery.limit(50)
        if (error) return fail(error.message, 500)
        return await auditedOk({ inventory: data || [] })
      }

      // ── Update Inventory ─────────────────────────────────────
      case 'updateInventory': {
         const { id } = payload
         if (!id) return fail('Inventory item id is required')
         const before = await snapshot('inventory', id)
         const updates = pickFields(payload, ['part_number','name','category','brand','description','cost','retail_price','qty_on_hand','qty_reorder','qty_on_order','location','supplier','supplier_part_number','notes','last_ordered'])
         const { data, error } = await sb.from('inventory').update({
           ...updates, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return await auditedOk(data, 'inventory', String(id), updatedExtra('inventory', id, Object.keys(updates), before, data))
      }
      default:
        return fail(`Unknown action: ${action}`)
    }
  } catch (err: unknown) {
    // A thrown database/provider error after a mutating request begins can be
    // a lost response after the side effect committed. Keep the operation in
    // the uncertainty state so a fresh key cannot repeat the mutation.
    if (isMutation) mutationCommitted = true
    const message = err instanceof Error ? err.message : 'Unknown error'
    return fail(message, 500)
  } finally {
    if (!isMutation && failureMessage && !readAuditAttempted) {
      const auditResult = await writeAuditLog({
        shopId, userId: caller.userId, action: `ai.${action}`,
        permission: 'read', approved: true, idempotencyKey: readAuditKey,
        metadata: { payload: safePayload, error: failureMessage, success: false },
      })
      if (!auditResult.ok) console.error('[ai-action] read failure audit could not be saved')
    }
    if (isMutation && operationId && !operationFinalized) {
      const { error } = await sb.from('ai_action_operations').update({
        status: mutationCommitted ? 'unknown' : 'failed',
        error: mutationCommitted
          ? `AI action outcome is uncertain; reconcile before retrying. ${failureMessage || 'Durable result unavailable'}`
          : failureMessage || 'AI action did not complete',
        lease_expires_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', operationId).eq('shop_id', shopId).eq('status', 'running')
      if (error) console.error('[ai-action] durable operation failure state could not be saved:', error.message)
    }
  }
}
