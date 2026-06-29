import { NextRequest } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { apiFail, apiOk, getIdempotencyKey, readJsonObject, requireString } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { readRepairManualPage, readRepairManualPageDrilled } from '@/lib/repair/sources'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const limited = checkRateLimit(rateLimitKey('repair-manual', auth.userId, auth.shopId, ip), 40, 60_000)
    if (!limited.ok) return apiFail('Too many manual preview requests', 429, 'RATE_LIMITED', { resetAt: limited.resetAt })

    const parsedBody = await readJsonObject(req)
    if (!parsedBody.ok) return apiFail(parsedBody.error, 400, 'BAD_REQUEST')
    const urlValue = requireString(parsedBody.body, 'url', 'Manual URL')
    if (!urlValue.ok) return apiFail(urlValue.error, 400, 'BAD_REQUEST')

    const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'repair-manual', urlValue.value])
    // When the caller passes a query, auto-drill the folder down to the page that
    // actually has the diagram instead of stopping at the directory link list.
    const drillQuery = typeof parsedBody.body.query === 'string' ? parsedBody.body.query.trim() : ''
    const result = drillQuery
      ? await readRepairManualPageDrilled(urlValue.value, drillQuery)
      : await readRepairManualPage(urlValue.value)

    await writeAuditLog({
      shopId: auth.shopId,
      userId: auth.userId,
      action: 'repair.manual.preview',
      targetType: 'repair_manual',
      permission: 'read',
      approved: true,
      idempotencyKey,
      metadata: {
        provider: result.provider,
        url: result.url,
        title: result.title,
        linkCount: result.links.length,
        sectionCount: result.sections.length,
      },
    })

    return apiOk(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    const status = /Only CHARM and LEMON/i.test(message) ? 400 : 500
    return apiFail(message, status, status === 400 ? 'BAD_REQUEST' : 'INTERNAL_ERROR')
  }
}
