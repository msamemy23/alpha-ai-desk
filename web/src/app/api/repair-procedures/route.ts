import { NextRequest } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { apiFail, apiOk, getIdempotencyKey, readJsonObject, requireString } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function missingRepairTables(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message || '') : String(error || '')
  return /repair_procedure_cards|does not exist|schema cache|PGRST205/i.test(message)
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 40)
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value.slice(0, 80) : []
}

function vehicleRecord(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const limited = checkRateLimit(rateLimitKey('repair-procedures-read', auth.userId, auth.shopId, ip), 80, 60_000)
    if (!limited.ok) return apiFail('Too many procedure card requests', 429, 'RATE_LIMITED', { resetAt: limited.resetAt })

    const params = req.nextUrl.searchParams
    const db = getServiceClient()
    let query = db
      .from('repair_procedure_cards')
      .select('*')
      .eq('shop_id', auth.shopId)
      .order('updated_at', { ascending: false })
      .limit(30)

    const year = params.get('year')?.trim()
    const make = params.get('make')?.trim()
    const model = params.get('model')?.trim()
    const text = params.get('query')?.trim()
    if (year) query = query.eq('vehicle_year', year)
    if (make) query = query.ilike('vehicle_make', make)
    if (model) query = query.ilike('vehicle_model', `%${model}%`)
    if (text) query = query.or(`title.ilike.%${text}%,operation.ilike.%${text}%,technician_notes.ilike.%${text}%`)

    const { data, error } = await query
    if (error) {
      if (missingRepairTables(error)) return apiOk({ cards: [], migrationRequired: true, message: 'Repair workspace tables are not installed yet.' })
      return apiFail(error.message, 500, 'INTERNAL_ERROR')
    }
    return apiOk({ cards: data || [], migrationRequired: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiFail(message, 500, 'INTERNAL_ERROR')
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const limited = checkRateLimit(rateLimitKey('repair-procedures-write', auth.userId, auth.shopId, ip), 30, 60_000)
    if (!limited.ok) return apiFail('Too many procedure card writes', 429, 'RATE_LIMITED', { resetAt: limited.resetAt })

    const parsedBody = await readJsonObject(req)
    if (!parsedBody.ok) return apiFail(parsedBody.error, 400, 'BAD_REQUEST')
    const title = requireString(parsedBody.body, 'title', 'Title')
    if (!title.ok) return apiFail(title.error, 400, 'BAD_REQUEST')
    const operation = requireString(parsedBody.body, 'operation', 'Operation')
    if (!operation.ok) return apiFail(operation.error, 400, 'BAD_REQUEST')

    const vehicle = vehicleRecord(parsedBody.body.vehicle)
    const db = getServiceClient()
    const insert = {
      shop_id: auth.shopId,
      title: title.value.slice(0, 180),
      status: parsedBody.body.status === 'verified' ? 'verified' : 'draft',
      confidence: parsedBody.body.confidence === 'shop_verified' ? 'shop_verified' : parsedBody.body.confidence === 'source_linked' ? 'source_linked' : 'needs_review',
      vehicle_year: typeof vehicle.year === 'string' ? vehicle.year : null,
      vehicle_make: typeof vehicle.make === 'string' ? vehicle.make : null,
      vehicle_model: typeof vehicle.model === 'string' ? vehicle.model : null,
      vehicle_engine: typeof vehicle.engine === 'string' ? vehicle.engine : null,
      vehicle_trim: typeof vehicle.trim === 'string' ? vehicle.trim : null,
      vehicle_drivetrain: typeof vehicle.drivetrain === 'string' ? vehicle.drivetrain : null,
      vehicle_transmission: typeof vehicle.transmission === 'string' ? vehicle.transmission : null,
      vehicle_brake_system: typeof vehicle.brakeSystem === 'string' ? vehicle.brakeSystem : null,
      operation: operation.value.slice(0, 240),
      systems: stringArray(parsedBody.body.systems),
      tools: stringArray(parsedBody.body.tools),
      parts_fluids: stringArray(parsedBody.body.partsFluids),
      safety_gates: jsonArray(parsedBody.body.safetyGates),
      operation_lines: jsonArray(parsedBody.body.operationLines),
      source_links: jsonArray(parsedBody.body.sourceLinks),
      technician_notes: typeof parsedBody.body.technicianNotes === 'string' ? parsedBody.body.technicianNotes.slice(0, 5000) : '',
      approved_by: typeof parsedBody.body.approvedBy === 'string' ? parsedBody.body.approvedBy.slice(0, 120) : null,
      approved_at: parsedBody.body.status === 'verified' ? new Date().toISOString() : null,
      created_by: auth.userId,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await db.from('repair_procedure_cards').insert(insert).select().single()
    if (error) {
      if (missingRepairTables(error)) return apiOk({ saved: false, migrationRequired: true, message: 'Repair workspace tables are not installed yet.' }, { status: 202 })
      return apiFail(error.message, 500, 'INTERNAL_ERROR')
    }

    const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'repair-procedure', title.value, operation.value])
    await writeAuditLog({
      shopId: auth.shopId,
      userId: auth.userId,
      action: 'repair.procedure_card.create',
      targetType: 'repair_procedure_card',
      targetId: data?.id,
      permission: 'write',
      approved: true,
      idempotencyKey,
      metadata: { title: title.value, operation: operation.value, vehicle },
    })

    return apiOk({ saved: true, card: data, migrationRequired: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiFail(message, 500, 'INTERNAL_ERROR')
  }
}
