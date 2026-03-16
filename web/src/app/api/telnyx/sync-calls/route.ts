import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'

async function fetchCDRPage(startDate: string, endDate: string, pageNum: number, pageSize = 250) {
  const params = new URLSearchParams({
    'filter[start_time][gte]': startDate,
    'filter[start_time][lte]': endDate,
    'page[number]': String(pageNum),
    'page[size]': String(pageSize),
  })
  const res = await fetch(`${TELNYX_BASE}/call_events?${params}`, {
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
  })
  if (!res.ok) {
    const params2 = new URLSearchParams({
      'filter[record_type]': 'call',
      'filter[date_range][start_date]': startDate,
      'filter[date_range][end_date]': endDate,
      'page[number]': String(pageNum),
      'page[size]': String(pageSize),
    })
    const res2 = await fetch(`${TELNYX_BASE}/detail_records?${params2}`, {
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    })
    if (!res2.ok) return { data: [], meta: { total_pages: 0, total_results: 0 } }
    return res2.json()
  }
  return res.json()
}

async function fetchCDRReport(startDate: string, endDate: string) {
  const res = await fetch(`${TELNYX_BASE}/reports/cdr_requests`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      start_time: startDate,
      end_time: endDate,
      connections: [],
      record_types: [1, 2],
      include_message_body: false,
    }),
  })
  if (!res.ok) return null
  return res.json()
}

async function searchDetailRecords(startDate: string, endDate: string, cursor?: string) {
  const body: any = {
    filter: {
      record_type: 'call',
      date_range: { start_date: startDate, end_date: endDate },
    },
    page: { size: 250 },
  }
  if (cursor) body.page.after = cursor
  const res = await fetch(`${TELNYX_BASE}/detail_records/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { data: [], meta: {} }
  return res.json()
}

export async function POST(req: NextRequest) {
  if (!TELNYX_API_KEY) return NextResponse.json({ error: 'No Telnyx API key' }, { status: 500 })
  try {
    const { start_date, end_date, mode = 'incremental' } = await req.json()
    const db = getServiceClient()
    const now = new Date().toISOString()
    let startD = start_date || '2024-01-01T00:00:00Z'
    let endD = end_date || now
    if (mode === 'incremental') {
      const { data: lastSync } = await db.from('telnyx_sync_log').select('end_date').eq('status', 'complete').order('end_date', { ascending: false }).limit(1)
      if (lastSync?.[0]?.end_date) startD = lastSync[0].end_date
    }
    await db.from('telnyx_sync_log').insert({ sync_type: mode, start_date: startD, end_date: endD, status: 'running', records_fetched: 0, records_inserted: 0 })
    let allRecords: any[] = []
    let cursor: string | undefined
    let pageCount = 0
    const MAX_PAGES = 100
    while (pageCount < MAX_PAGES) {
      const result = await searchDetailRecords(startD, endD, cursor)
      const records = result.data || []
      if (!records.length) break
      allRecords = allRecords.concat(records)
      pageCount++
      cursor = result.meta?.next_cursor || result.meta?.after
      if (!cursor) break
      await new Promise(r => setTimeout(r, 200))
    }
    if (!allRecords.length) {
      let page = 1
      while (page <= MAX_PAGES) {
        const result = await fetchCDRPage(startD, endD, page, 250)
        const records = result.data || []
        if (!records.length) break
        allRecords = allRecords.concat(records)
        const totalPages = result.meta?.total_pages || 1
        if (page >= totalPages) break
        page++
        await new Promise(r => setTimeout(r, 200))
      }
    }
    const { data: customers } = await db.from('customers').select('id, name, phone')
    const phoneMap = new Map<string, { id: string; name: string }>()
    for (const c of (customers || [])) {
      if (c.phone) {
        const clean = c.phone.replace(/\D/g, '').slice(-10)
        phoneMap.set(clean, { id: c.id, name: c.name })
      }
    }
    const rows = allRecords.map((r: any) => {
      const from = r.origination_number || r.from || r.cli || ''
      const to = r.terminating_number || r.to || r.cld || ''
      const fromClean = from.replace(/\D/g, '').slice(-10)
      const toClean = to.replace(/\D/g, '').slice(-10)
      const matchedCustomer = phoneMap.get(fromClean) || phoneMap.get(toClean) || null
      return {
        call_id: r.id || r.call_session_id || r.sip_call_id || `${from}-${to}-${r.start_timestamp_utc || r.start_time || Date.now()}`,
        direction: r.direction || (r.record_type === 1 ? 'inbound' : 'outbound'),
        from_number: from,
        to_number: to,
        duration_secs: r.call_duration || r.duration || r.billable_time || 0,
        billable_secs: r.billable_time || r.billable_duration || 0,
        status: r.hangup_cause || r.status || 'completed',
        start_time: r.start_timestamp_utc || r.start_time || null,
        end_time: r.end_timestamp || r.end_time || null,
        answer_time: r.answer_timestamp || null,
        from_city: r.origination_city || r.from_city || null,
        from_state: r.origination_state || r.from_state || null,
        from_country: r.origination_country || null,
        to_city: r.terminating_city || null,
        to_state: r.terminating_state || null,
        cost: r.cost || r.rate || null,
        hangup_cause: r.hangup_code || r.hangup_cause || null,
        connection_id: r.connection_id || null,
        tags: r.tags || null,
        customer_id: matchedCustomer?.id || null,
        matched_customer_name: matchedCustomer?.name || null,
        raw_data: r,
      }
    })
    let inserted = 0
    const BATCH = 100
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH)
      const { error } = await db.from('call_history').upsert(batch, { onConflict: 'call_id', ignoreDuplicates: true })
      if (!error) inserted += batch.length
    }
    await db.from('telnyx_sync_log').update({ status: 'complete', records_fetched: allRecords.length, records_inserted: inserted }).eq('status', 'running').order('created_at', { ascending: false }).limit(1)
    return NextResponse.json({ success: true, total_fetched: allRecords.length, total_inserted: inserted, pages_scanned: pageCount || 'fallback', date_range: { start: startD, end: endD } })
  } catch (e: any) {
    console.error('Telnyx sync error:', e)
    return NextResponse.json({ error: e.message || 'Sync failed' }, { status: 500 })
  }
}

  export async function GET(req: NextRequest) {
  return POST(req)
}