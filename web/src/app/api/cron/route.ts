import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const CRON_SECRET = process.env.CRON_SECRET || ''
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'

async function callApi(path: string, body?: Record<string, unknown>) {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : '{}',
    })
    return await res.json()
  } catch (e) {
    console.error(`Cron call to ${path} failed:`, e)
    return { error: (e as Error).message }
  }
}

// GET handler for Vercel Cron
export async function GET(req: NextRequest) {
  // Verify cron secret if set
  if (CRON_SECRET && req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, unknown> = {}

  // 1. Auto-scan competitors for unhappy reviews -> leads
  results.scan_competitors = await callApi('/api/growth/scan-competitors', {
    query: 'auto repair shop Houston TX',
    radius: 15000
  })

  // 2. Auto-scan social media for car trouble posts -> leads  
  results.scan_social = await callApi('/api/growth/scan-social', {})

  // 3. Follow up on pending leads (auto-SMS)
  results.follow_ups = await callApi('/api/growth/capture', {
    action: 'follow_up_pending'
  })

  // 4. Run scheduled automations
  results.automations = await callApi('/api/automations', {})

  // 5. Send review requests to recent customers who haven't been asked
  results.reviews = await callApi('/api/growth/reviews', {})

  // Log the cron run
  await supabase.from('growth_scans').upsert({
    id: 'last_cron_run',
    type: 'cron',
    data: results,
    scanned_at: new Date().toISOString()
  })

  return NextResponse.json({
    success: true,
    ran_at: new Date().toISOString(),
    results
  })
}
