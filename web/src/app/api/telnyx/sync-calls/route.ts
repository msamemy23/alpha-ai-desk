import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

export const maxDuration = 60

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'
const SHOP_NUMBER = '+17136636979'

// Sync call_history from local activities table
async function syncFromActivities(db: any) {
    const { data: activities, error } = await db
        .from('activities')
        .select('*')
        .eq('type', 'call')
        .order('created_at', { ascending: false })
    if (error || !activities?.length) return { synced: 0, error: error?.message }
    const rows = activities.map((a: any) => ({
        call_id: a.id,
        direction: a.direction || 'unknown',
        from_number: a.direction === 'outbound' ? SHOP_NUMBER : (a.phone || ''),
        to_number: a.direction === 'inbound' ? SHOP_NUMBER : (a.phone || ''),
        duration_secs: a.duration || 0,
        status: 'completed',
        start_time: a.created_at,
        customer_id: a.customer_id || null,
        matched_customer_name: a.customer_name || null,
        raw_data: { source: 'activities', activity_id: a.id, notes: a.notes, has_recording: a.has_recording, recording_url: a.recording_url },
    }))
    let inserted = 0
    for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100)
        const { error: uErr } = await db.from('call_history').upsert(batch, { onConflict: 'call_id' })
        if (!uErr) inserted += batch.length
        else console.error('Activities upsert error:', uErr)
    }
    return { synced: inserted, total: activities.length }
}

// Request a CDR batch report from Telnyx (async, returns report ID)
async function requestCDRReport(startDate: string, endDate: string) {
    if (!TELNYX_API_KEY) return null
    try {
        const res = await fetch(`${TELNYX_BASE}/legacy_reporting/batch_detail_records/voice`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                start_time: startDate,
                end_time: endDate,
                source: 'call-control',
                record_types: [1, 2],
                call_types: [1, 2],
            }),
        })
        if (!res.ok) {
            const txt = await res.text()
            console.error('CDR report request error:', res.status, txt)
            return { error: txt, status: res.status }
        }
        return await res.json()
    } catch (e: any) {
        return { error: e.message }
    }
}

// Check CDR report status and download if ready
async function checkCDRReport(reportId: string) {
    if (!TELNYX_API_KEY) return null
    try {
        const res = await fetch(`${TELNYX_BASE}/legacy_reporting/batch_detail_records/voice/${reportId}`, {
            headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
        })
        if (!res.ok) return { error: `Status ${res.status}` }
        return await res.json()
    } catch (e: any) {
        return { error: e.message }
    }
}

export async function POST(req: NextRequest) {
    try {
        const url = new URL(req.url)
        const action = url.searchParams.get('action') || 'sync'
        const db = getServiceClient()

        // Action: sync from activities table
        if (action === 'sync') {
            const result = await syncFromActivities(db)
            return NextResponse.json({ success: true, ...result })
        }

        // Action: request a CDR batch report from Telnyx
        if (action === 'cdr-request') {
            const start = url.searchParams.get('start') || '2026-01-01T00:00:00Z'
            const end = url.searchParams.get('end') || new Date().toISOString()
            const result = await requestCDRReport(start, end)
            return NextResponse.json({ success: true, result })
        }

        // Action: check CDR report status
        if (action === 'cdr-check') {
            const reportId = url.searchParams.get('report_id')
            if (!reportId) return NextResponse.json({ error: 'report_id required' }, { status: 400 })
            const result = await checkCDRReport(reportId)
            return NextResponse.json({ success: true, result })
        }

        // Action: match phone numbers to customers
        if (action === 'match') {
            const { data: calls } = await db.from('call_history').select('id, from_number, to_number').is('customer_id', null)
            const { data: customers } = await db.from('customers').select('id, name, phone')
            if (!calls?.length || !customers?.length) return NextResponse.json({ matched: 0 })
            const phoneMap = new Map()
            for (const c of customers) {
                if (c.phone) phoneMap.set(c.phone.replace(/\D/g, '').slice(-10), { id: c.id, name: c.name })
            }
            let matched = 0
            for (const call of calls) {
                const fc = (call.from_number || '').replace(/\D/g, '').slice(-10)
                const tc = (call.to_number || '').replace(/\D/g, '').slice(-10)
                const m = phoneMap.get(fc) || phoneMap.get(tc)
                if (m) {
                    await db.from('call_history').update({ customer_id: m.id, matched_customer_name: m.name }).eq('id', call.id)
                    matched++
                }
            }
            return NextResponse.json({ success: true, matched, total: calls.length })
        }

        return NextResponse.json({ error: 'Unknown action. Use: sync, cdr-request, cdr-check, match' }, { status: 400 })
    } catch (e: any) {
        console.error('Telnyx sync error:', e)
        return NextResponse.json({ error: e.message || 'Sync failed' }, { status: 500 })
    }
}

export async function GET(req: NextRequest) { return POST(req) }