type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetAt: number
}

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs
    buckets.set(key, { count: 1, resetAt })
    return { ok: true, remaining: Math.max(0, limit - 1), resetAt }
  }

  if (existing.count >= limit) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt }
  }

  existing.count += 1
  return { ok: true, remaining: Math.max(0, limit - existing.count), resetAt: existing.resetAt }
}

export function rateLimitKey(scope: string, userId?: string, shopId?: string, ip?: string) {
  return [scope, shopId || 'no-shop', userId || ip || 'anonymous'].join(':')
}
