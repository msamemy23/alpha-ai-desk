import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'
import { flushAuditLogOutbox } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'

function getBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'https://alpha-ai-desk.vercel.app'
}

async function callApi(path: string, body: Record<string, unknown> = {}) {
  const baseUrl = getBaseUrl()
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || ''
  if (!secret) return { ok: false, error: 'Internal cron secret is not configured' }
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    const text = await res.text()
    let data: Record<string, unknown>
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      return { ok: false, status: res.status, error: `Non-JSON response from ${path}`, preview: text.slice(0, 200) }
    }
    return { ...data, ok: res.ok && data.ok !== false && data.success !== false, status: res.status }
  } catch (e) {
    console.error(`Cron call to ${path} failed:`, e)
    return { ok: false, error: (e as Error).message }
  }
}

async function callForEachShop(path: string, body: Record<string, unknown> = {}) {
  const db = getServiceClient()
  const { data: shops, error } = await db.from('shop_profiles').select('id').order('created_at', { ascending: true })
  if (error) return { ok: false, error: `Could not load shops: ${error.message}`, results: [] }

  const results = await Promise.all((shops || []).map(async (shop: { id: string }) => ({
    shopId: shop.id,
    ...(await callApi(path, { ...body, shopId: shop.id })),
  })))
  return {
    ok: results.every(result => result.ok !== false),
    results,
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET env var is not configured' }, { status: 401 })
  }
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Record<string, unknown> = {}

  // Repair audit records that were queued after a transient database failure,
  // and make abandoned AI mutations explicitly uncertain before they can be
  // retried. Both operations are service-only and tenant-scoped in storage.
  results.audit_outbox = await flushAuditLogOutbox(100)
  const db = getServiceClient()
  const now = new Date().toISOString()
  const { data: expiredAiOperations, error: aiLeaseError } = await db
    .from('ai_action_operations')
    .update({
      status: 'unknown',
      error: 'AI action lease expired; outcome requires reconciliation',
      updated_at: now,
      lease_expires_at: null,
      heartbeat_at: now,
    })
    .eq('status', 'running')
    .lt('lease_expires_at', now)
    .select('id')
  results.ai_action_reconciliation = {
    ok: !aiLeaseError,
    expired: expiredAiOperations?.length || 0,
    ...(aiLeaseError ? { error: aiLeaseError.message } : {}),
  }

  // Every tenant-aware worker receives one explicit shop id. No worker may
  // silently fall back to the first shop or to global credentials.
  results.sync_calls = await callForEachShop('/api/telnyx/sync-calls?action=sync-all')
  results.scan_competitors = await callForEachShop('/api/growth/scan-competitors', {
    query: 'auto repair shop',
    radius: 15000,
  })
  results.follow_ups = await callForEachShop('/api/growth/capture', { action: 'follow_up_pending' })

  // These workers fan out internally because they own their per-shop schedule.
  results.custom_automations = await callApi('/api/automations', { action: 'check_due' })
  results.system_automations = await callApi('/api/system-automations', { action: 'run_all_due' })
  results.scheduled_messages = await callApi('/api/scheduled-messages/dispatch')

  results.transcribe_calls = await callForEachShop('/api/telnyx/transcribe-calls?action=batch', { limit: 10 })
  results.score_leads = await callForEachShop('/api/telnyx/transcribe-calls?action=score', { limit: 20 })

  const ok = Object.values(results).every((result) => (result as { ok?: boolean })?.ok !== false)
  return NextResponse.json({ success: ok, ran_at: new Date().toISOString(), results }, { status: ok ? 200 : 502 })
}
