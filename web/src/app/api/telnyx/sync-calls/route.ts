import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

export const maxDuration = 60

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'

async function fetchPage(startDate: string, endDate: string, pageNum: number) {
  const params = new URLSearchParams({
    'filter[start_time][gte]': startDate,
    'filter[start_time][lte]': endDate,
    'page[number]': String(pageNum),
    'page[size]': '250',
  })
  const res = await fetch(`${TELNYX_BASE}/call_events?${params}`, {
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
  })
  if (!res.ok) {
    const p2 = new URLSearchParams({
      'filter[record_type]': 'call',
      'filter[date_range][start_date]': startDate,
      'filter[date_range][end_date]': endDate,
      'page[number]': String(pageNum),
      'page[size]': '250',
    })
    const r2 = await fetch(`${TELNYX_BASE}/detail_records?${p2}`, {
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    })
    if (!r2.ok) return { data: [], meta: { total_pages: 0 } }
    return r2.json()
  }
  return res.json()
}

export async function POST(req: NextRequest) {
  if (!TELNYX_API_KEY) return NextResponse.json({ error: 'No API key' }, { status: 500 })
  try {
    let body: any = {}; try { body = await req.json() } catch {}
    const db = getServiceClient()
    const now = new Date()
    // Default: sync 1 month chunks starting from 2024-01-01
    let startD = body.start_date || '2024-01-01T00:00:00Z'
    let endD = body.end_date || now.toISOString()
    // If no explicit end, cap at 1 month from start
    if (!body.end_date) {
      const s = new Date(startD)
      const e = new Date(s)
      e.setMonth(e.getMonth() + 1)
      if (e < now) endD = e.toISOString()
    }
    let allRecords: any[] = []
    let page = 1
    const MAX_PAGES = 3
    while (page <= MAX_PAGES) {
      const result = await fetchPage(startD, endD, page)
      const records = result.data || []
      if (!records.length) break
      allRecords = allRecords.concat(records)
      const tp = result.meta?.total_pages || 1
      if (page >= tp) break
      page++
    }
    // Match customers
    const { data: customers } = await db.from('customers').select('id, name, phone')
    const phoneMap = new Map()
    for (const c of (customers || [])) {
      if (c.phone) phoneMap.set(c.phone.replace(/\D/g, '').slice(-10), { id: c.id, name: c.name })
    }
    const rows = allRecords.map((r: any) => {
      const from = r.from || r.origination_number || r.cli || ''
      const to = r.to || r.terminating_number || r.cld || ''
      const fc = from.replace(/\D/g, '').slice(-10)
      const tc = to.replace(/\D/g, '').slice(-10)
      const m = phoneMap.get(fc) || phoneMap.get(tc) || null
      return {
        call_id: r.id || r.call_session_id || `${from}-${to}-${r.start_time || Date.now()}`,
        direction: r.direction || 'unknown',
        from_number: from, to_number: to,
        duration_secs: r.call_duration || r.duration || 0,
        billable_secs: r.billable_time || 0,
        status: r.hangup_cause || r.status || 'completed',
        start_time: r.start_time || r.start_timestamp_utc || null,
        end_time: r.end_time || r.end_timestamp || null,
        customer_id: m?.id || null,
        matched_customer_name: m?.name || null,
        raw_data: r,
      }
    })
    let inserted = 0
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100)
      const { error } = await db.from('call_history').upsert(batch, { onConflict: 'call_id', ignoreDuplicates: true })
      if (!error) inserted += batch.length
    }
    // Calculate next chunk
    const nextStart = new Date(endD)
    const hasMore = nextStart < now
    return NextResponse.json({
      success: true, fetched: allRecords.length, inserted,
      range: { start: startD, end: endD },
      hasMore, nextStart: hasMore ? nextStart.toISOString() : null
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Sync failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return POST(req) }