import { NextRequest } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { apiFail, apiOk, getIdempotencyKey, readJsonObject, requireString } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { searchRepairSources, type RepairVehicle } from '@/lib/repair/sources'

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
