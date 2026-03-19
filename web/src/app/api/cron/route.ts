import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const CRON_SECRET = process.env.CRON_SECRET || ''

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'https://alpha-ai-desk.vercel.app'
}

async function callApi(path: string, body?: Record<string, unknown>) {
  const baseUrl = getBaseUrl()
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : '{}',
    })
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      return { status: res.status, error: `Non-JSON response from ${path}`, preview: text.slice(0, 200) }
    }
  } catch (e) {
    console.error(`Cron call to ${path} failed:`, e)
    return { error: (e as Error).message }
  }
}

export async function GET(req: NextRequest) {
  if (CRON_SECRET && req.headers.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, unknown> = {}

  // Step 1: Sync calls from Telnyx recordings + activities + AI calls into call_history
  results.sync_calls = await callApi('/api/telnyx/sync-calls?action=sync-all', {})

  // Step 2: Scan competitors for growth leads
  results.scan_competitors = await callApi('/api/growth/scan-competitors', {
    query: 'auto repair shop Houston TX',
    radius: 15000
  })

  // Step 3: Process follow-ups
  results.follow_ups = await callApi('/api/growth/capture', { action: 'follow_up_pending' })

  // Step 4: Run automations
  results.automations = await callApi('/api/automations', {})

  // Step 5: Batch transcribe calls and score leads (processes 10 at a time)
  results.transcribe_calls = await callApi('/api/telnyx/transcribe-calls?action=batch&limit=10', {})

  // Step 6: Score any transcribed calls that don't have lead scores yet
  results.score_leads = await callApi('/api/telnyx/transcribe-calls?action=score&limit=20', {})

  await supabase.from('growth_scans').upsert({
    id: 'last_cron_run',
    type: 'cron',
    data: results,
    scanned_at: new Date().toISOString()
  })

  return NextResponse.json({ success: true, ran_at: new Date().toISOString(), results })
}
