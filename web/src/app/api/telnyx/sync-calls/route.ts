import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

export const maxDuration = 60

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'

async function fetchCallRecords(startDate: string, endDate: string, pageNum: number) {
  const params = new URLSearchParams({
    'filter[record_type]': 'call',
    'filter[date_range][start_date]': startDate.split('T')[0],
    'filter[date_range][end_date]': endDate.split('T')[0],
    'page[number]': String(pageNum),
    'page[size]': '250',
  })
  const res = await fetch(`${TELNYX_BASE}/detail_records?${params}`, {
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    console.error('Telnyx detail_records error:', res.status, await res.text())
    return { data: [], meta: { total_pages: 0, total_results: 0 } }
  }
  return res.json()
}

export async function POST(req: NextRequest) {
  if (!TELNYX_API_KEY) return NextResponse.json({ error: 'No API key' }, { status: 500 })
  try {
    const url = new URL(req.url)
    let body: any = {}; try { body = await req.json() } catch {}
    if (url.searchParams.get('start')) body.start_date = url.searchParams.get('start')
    if (url.searchParams.get('end')) body.end_date = url.searchParams.get('end')
    const db = getServiceClient()
    const now = new Date()
    let startD = body.start_date || '2024-01-01'
    let endD = body.end_date || now.toISOString().split('T')[0]
    if (!body.end_date) {
      const s = new Date(startD)
      const e = new Date(s)
      e.setMonth(e.getMonth() + 1)
      if (e < now) endD = e.toISOString().split('T')[0]
    }
    let allRecords: any[] = []
    let page = 1
    const MAX_PAGES = 20
    while (page <= MAX_PAGES) {
      const result = await fetchCallRecords(startD, endD, page)
      const records = result.data || []
      if (!records.length) break
      allRecords = allRecords.concat(records)
      const tp = result.meta?.total_pages || 1
      if (page >= tp) break
      page++
      await new Promise(r => setTimeout(r, 100))
    }
    const { data: customers } = await db.from('customers').select('id, name, phone')
    const phoneMap = new Map()
    for (const c of (customers || [])) {
      if (c.phone) phoneMap.set(c.phone.replace(/\D/g, '').slice(-10), { id: c.id, name: c.name })
    }
    const rows = allRecords.map((r: any) => {
      const from = r.cli || r.from || r.origination_number || ''
      const to = r.cld || r.to || r.terminating_number || ''
      const fc = from.replace(/\D/g, '').slice(-10)
      const tc = to.replace(/\D/g, '').slice(-10)
      const m = phoneMap.get(fc) || phoneMap.get(tc) || null
      return {
        call_id: r.uuid || r.id || r.call_session_id || `${from}-${to}-${r.created_at || Date.now()}`,
        direction: r.direction || 'unknown',
        from_number: from, to_number: to,
        duration_secs: parseFloat(r.call_duration || r.duration || '0') || 0,
        billable_secs: parseFloat(r.billable_time || r.billable_duration || '0') || 0,
        status: r.hangup_cause || r.status || 'completed',
        start_time: r.start_timestamp || r.created_at || null,
        end_time: r.answer_timestamp || r.completed_at || null,
        answer_time: r.answer_timestamp || null,
        from_city: r.origination_city || null,
        from_state: r.origination_state || null,
        cost: r.cost || r.rate || null,
        hangup_cause: r.hangup_cause || null,
        connection_id: r.connection_id || null,
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
      else console.error('Upsert error:', error)
    }
    const nextStart = endD
    const hasMore = new Date(endD) < now
    return NextResponse.json({
      success: true, fetched: allRecords.length, inserted,
      range: { start: startD, end: endD },
      hasMore, nextStart: hasMore ? nextStart : null,
      totalPages: page - 1
    })
  } catch (e: any) {
    console.error('Telnyx sync error:', e)
    return NextResponse.json({ error: e.message || 'Sync failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return POST(req) }