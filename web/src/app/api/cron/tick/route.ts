import { NextRequest, NextResponse } from 'next/server'
import { hasInternalApiSecret, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { engineDeps, tick } from '@/lib/automation-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// The scheduler's wake-up. Call it as often as the plan allows (every 5 to 15 minutes is ideal) with the cron secret.
// Each call runs whatever automations are due at their stated times in each shop's own clock, then sends anything
// waiting: retries, and messages held back for quiet hours. Calling it twice at once is safe.
async function handle(req: NextRequest) {
  if (!hasInternalApiSecret(req)) return unauthorized()
  const sb = getServiceClient()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin)
  const call = { baseUrl, secret: process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || '' }
  try {
    const report = await tick(sb, engineDeps(sb, baseUrl), call)
    return NextResponse.json({ ok: true, ...report })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'The scheduler could not run.' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
