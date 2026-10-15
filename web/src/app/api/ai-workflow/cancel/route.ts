import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { requestCancel } from '@/lib/ai/run-control'

export const dynamic = 'force-dynamic'

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-zA-Z0-9._:-]{1,120}$/.test(id)

/**
 * Stop for the assistant. Records that this conversation turn should stop
 * planning. It cancels thinking and look-ups only; a change the owner has
 * already approved is never interrupted half way.
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!checkRateLimit(rateLimitKey('ai-workflow-cancel', auth.shopId, auth.userId), 60, 60_000).ok) {
    return NextResponse.json({ ok: false, error: 'Too many requests. Wait a moment.' }, { status: 429 })
  }
  const body: unknown = await req.json().catch(() => null)
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  if (!validId(record.sessionId) || !validId(record.turnId)) {
    return NextResponse.json({ ok: false, error: 'A valid sessionId and turnId are required' }, { status: 400 })
  }
  const result = await requestCancel(getServiceClient(), { shopId: auth.shopId, userId: auth.userId, sessionId: record.sessionId, turnId: record.turnId })
  return NextResponse.json({ ok: true, stored: result.stored }, { headers: { 'Cache-Control': 'no-store' } })
}
