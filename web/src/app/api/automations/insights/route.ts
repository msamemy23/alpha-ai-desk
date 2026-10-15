import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { engineDeps, outcomes, upcoming } from '@/lib/automation-service'

export const dynamic = 'force-dynamic'

// Results in plain numbers (sent, replied, booked, what it brought in) and what is coming in the next 30 days.
export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const days = [7, 30, 90].includes(Number(req.nextUrl.searchParams.get('days'))) ? Number(req.nextUrl.searchParams.get('days')) : 30
  const sb = getServiceClient()
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.nextUrl.origin)
  try {
    const [results, soon] = await Promise.all([outcomes(sb, auth.shopId, days), upcoming(sb, engineDeps(sb, baseUrl), auth.shopId)])
    return NextResponse.json({ ok: true, results, upcoming: soon })
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'The results could not be loaded.' }, { status: 500 })
  }
}
