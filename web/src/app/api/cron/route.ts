import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

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
  // Always require CRON_SECRET — if not set, route is disabled for safety
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET env var is not configured' }, { status: 401 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getServiceClient()
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

  // Step 4: Run custom prompt automations (user-created ones)
  results.custom_automations = await callApi('/api/automations', { action: 'check_due' })

  // Step 5: Run ALL enabled system automations (review requests, follow-ups, reminders, etc.)
  results.system_automations = await callApi('/api/system-automations', { action: 'run_all_due' })

  // Step 6: Batch transcribe calls and score leads (processes 10 at a time)
  results.transcribe_calls = await callApi('/api/telnyx/transcribe-calls?action=batch&limit=10', {})

  // Step 7: Score any transcribed calls that don't have lead scores yet
  results.score_leads = await callApi('/api/telnyx/transcribe-calls?action=score&limit=20', {})

  await supabase.from('growth_scans').upsert({
    id: 'last_cron_run',
    type: 'cron',
    data: results,
    scanned_at: new Date().toISOString()
  })

  return NextResponse.json({ success: true, ran_at: new Date().toISOString(), results })
}
