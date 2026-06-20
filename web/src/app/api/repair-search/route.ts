import { NextRequest } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { apiFail, apiOk, getIdempotencyKey, readJsonObject, requireString } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { searchRepairSources, type RepairVehicle } from '@/lib/repair/sources'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function optionalVehicle(body: Record<string, unknown>): Partial<RepairVehicle> {
  const value = body.vehicle
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  return {
    vin: typeof record.vin === 'string' ? record.vin.trim() : undefined,
    year: typeof record.year === 'string' ? record.year.trim() : undefined,
    make: typeof record.make === 'string' ? record.make.trim() : undefined,
    model: typeof record.model === 'string' ? record.model.trim() : undefined,
    engine: typeof record.engine === 'string' ? record.engine.trim() : undefined,
    trim: typeof record.trim === 'string' ? record.trim.trim() : undefined,
    drivetrain: typeof record.drivetrain === 'string' ? record.drivetrain.trim() : undefined,
    transmission: typeof record.transmission === 'string' ? record.transmission.trim() : undefined,
    fuel: typeof record.fuel === 'string' ? record.fuel.trim() : undefined,
    bodyClass: typeof record.bodyClass === 'string' ? record.bodyClass.trim() : undefined,
    brakeSystem: typeof record.brakeSystem === 'string' ? record.brakeSystem.trim() : undefined,
    adas: typeof record.adas === 'string' ? record.adas.trim() : undefined,
    emissions: typeof record.emissions === 'string' ? record.emissions.trim() : undefined,
  }
}

function missingRepairTables(error: unknown) {
  const message = error && typeof error === 'object' && 'message' in error ? String((error as { message?: unknown }).message || '') : String(error || '')
  return /repair_procedure_cards|repair_research_sessions|does not exist|schema cache|PGRST205/i.test(message)
}

async function attachShopProcedures(shopId: string, result: Awaited<ReturnType<typeof searchRepairSources>>) {
  try {
    const db = getServiceClient()
    let query = db
      .from('repair_procedure_cards')
      .select('id,title,operation,status,confidence,updated_at')
      .eq('shop_id', shopId)
      .order('updated_at', { ascending: false })
      .limit(8)
    if (result.normalizedVehicle.year) query = query.eq('vehicle_year', result.normalizedVehicle.year)
    if (result.normalizedVehicle.make) query = query.ilike('vehicle_make', result.normalizedVehicle.make)
    if (result.normalizedVehicle.model) query = query.ilike('vehicle_model', `%${result.normalizedVehicle.model}%`)
    const operation = result.draft.operation || result.query
    if (operation) query = query.or(`title.ilike.%${operation}%,operation.ilike.%${operation}%`)
    const { data, error } = await query
    if (error) {
      result.coverageDashboard.shopProcedure = missingRepairTables(error) ? 'needs_database' : 'not_found'
      result.workflow.coverage.hasShopProcedure = false
      return
    }
    result.shopProcedures = (data || []).map(item => ({
      id: item.id,
      title: item.title,
      operation: item.operation,
      status: item.status,
      confidence: item.confidence,
      updatedAt: item.updated_at,
    }))
    result.coverageDashboard.shopProcedure = result.shopProcedures.length ? 'found' : 'not_found'
    result.workflow.coverage.hasShopProcedure = result.shopProcedures.length > 0
  } catch {
    result.coverageDashboard.shopProcedure = 'needs_database'
  }
}

async function logResearchSession(shopId: string, userId: string, result: Awaited<ReturnType<typeof searchRepairSources>>) {
  try {
    const db = getServiceClient()
    await db.from('repair_research_sessions').insert({
      shop_id: shopId,
      user_id: userId,
      query: result.query,
      normalized_vehicle: result.normalizedVehicle,
      coverage: result.coverageDashboard,
      operation_lines: result.operationLines,
      safety_profile: result.safetyProfile,
      estimate_draft: result.estimateDraft,
      source_links: result.sources.slice(0, 20),
      manual_matches: result.manualMatches.slice(0, 20),
      warnings: result.warnings,
      created_at: new Date().toISOString(),
    })
  } catch {
    // Research logging is best-effort so missing migrations do not break search.
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const limited = checkRateLimit(rateLimitKey('repair-search', auth.userId, auth.shopId, ip), 20, 60_000)
    if (!limited.ok) return apiFail('Too many repair lookups', 429, 'RATE_LIMITED', { resetAt: limited.resetAt })

    const parsedBody = await readJsonObject(req)
    if (!parsedBody.ok) return apiFail(parsedBody.error, 400, 'BAD_REQUEST')
    const queryValue = requireString(parsedBody.body, 'query', 'Repair query')
    if (!queryValue.ok) return apiFail(queryValue.error, 400, 'BAD_REQUEST')

    const query = queryValue.value.slice(0, 280)
    const vehicle = optionalVehicle(parsedBody.body)
    const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'repair-search', query])
    const result = await searchRepairSources(query, vehicle)
    await attachShopProcedures(auth.shopId, result)
    await logResearchSession(auth.shopId, auth.userId, result)

    await writeAuditLog({
      shopId: auth.shopId,
      userId: auth.userId,
      action: 'repair.search',
      targetType: 'repair',
      permission: 'read',
      approved: true,
      idempotencyKey,
      metadata: {
        query,
        vehicle: result.normalizedVehicle,
        sourceCount: result.sources.length,
        providers: Array.from(new Set(result.sources.map(item => item.provider))),
      },
    })

    return apiOk(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiFail(message, 500, 'INTERNAL_ERROR')
  }
}
