import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { apiOk, apiFail } from '@/lib/api-response'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { getCapabilitySnapshot } from '@/lib/ai/capabilities'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const limited = checkRateLimit(rateLimitKey('ai-capabilities', auth.userId, auth.shopId, ip), 120, 60_000)
  if (!limited.ok) return apiFail('Too many capability requests', 429, 'RATE_LIMITED', { resetAt: limited.resetAt })

  return apiOk(getCapabilitySnapshot())
}
