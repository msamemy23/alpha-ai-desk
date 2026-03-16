import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

export const maxDuration = 300

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'
const SHOP_NUMBER = '+17136636979'
const INBOUND_CONNECTION = '2786787533428623349'

async function syncFromActivities(db: any) {
    const { data: activities, error } = await db.from('activities').select('*').eq('type', 'call').order('created_at', { ascending: false })
    if (error || !activities?.length) return { synced: 0, error: error?.message }
    const rows = activities.map((a: any) => ({
        call_id: `activity-${a.id}`,
        direction: a.direction || 'unknown',
        from_number: a.direction === 'outbound' ? SHOP_NUMBER : (a.phone || a.customer_name || ''),
        to_number: a.direction === 'inbound' ? SHOP_NUMBER : (a.phone || a.customer_name || ''),
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

async function syncFromRecordings(db: any) {
    if (!TELNYX_API_KEY) return { synced: 0, error: 'No API key' }
    let allRecordings: any[] = []
    let pageNum = 1

    // Use page[number] pagination - Telnyx uses page numbers not cursors
    while (pageNum <= 200) {
        const params = new URLSearchParams({
            'page[size]': '250',
            'page[number]': String(pageNum)
        })
        const res = await fetch(`${TELNYX_BASE}/recordings?${params}`, {
            headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
            cache: 'no-store',
        })
        if (!res.ok) return { synced: 0, error: `Telnyx API error: ${res.status}`, pages_fetched: pageNum - 1, raw_total: allRecordings.length }
        const data = await res.json()
        const pageRecs = data.data || []
        allRecordings.push(...pageRecs)
        
        // Stop if we got fewer than requested (last page)
        if (pageRecs.length < 250) break
        pageNum++
    }

    // Deduplicate by call_session_id, keep longest
    const sessionMap: Record<string, any> = {}
    for (const rec of allRecordings) {
        const sid = rec.call_session_id || rec.id
        const existing = sessionMap[sid]
        if (!existing || (rec.duration_millis || 0) > (existing.duration_millis || 0)) {
            sessionMap[sid] = rec
        }
    }
    const recordings = Object.values(sessionMap).filter((r: any) => (r.duration_millis || 0) > 2000)

    // Get customer phone map
    const { data: customers } = await db.from('customers').select('id, name, phone')
    const phoneMap = new Map()
    for (const c of (customers || [])) {
        if (c.phone) phoneMap.set(c.phone.replace(/\D/g, '').slice(-10), { id: c.id, name: c.name })
    }

    const rows = recordings.map((r: any) => {
        const isInbound = r.connection_id === INBOUND_CONNECTION
        const from = isInbound ? (r.from || '') : SHOP_NUMBER
        const to = isInbound ? SHOP_NUMBER : (r.to || '')
        const callerPhone = isInbound ? from : to
        const clean = callerPhone.replace(/\D/g, '').slice(-10)
        const match = phoneMap.get(clean)
        const durSec = Math.round((r.duration_millis || 0) / 1000)
        return {
            call_id: `rec-${r.call_session_id || r.id}`,
            direction: isInbound ? 'inbound' : 'outbound',
            from_number: from,
            to_number: to,
            duration_secs: durSec,
            status: 'completed',
            start_time: r.recording_started_at || r.created_at,
            end_time: r.recording_ended_at || null,
            customer_id: match?.id || null,
            matched_customer_name: match?.name || null,
            raw_data: {
                source: 'telnyx_recording',
                recording_id: r.id,
                call_leg_id: r.call_leg_id,
                call_session_id: r.call_session_id,
                channels: r.channels,
                download_urls: r.download_urls,
                connection_id: r.connection_id,
            },
        }
    })

    let inserted = 0
    for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100)
        const { error } = await db.from('call_history').upsert(batch, { onConflict: 'call_id' })
        if (!error) inserted += batch.length
        else console.error('Recording upsert error:', error)
    }
    return { synced: inserted, total: recordings.length, raw_total: allRecordings.length, pages_fetched: pageNum, unique_sessions: Object.keys(sessionMap).length }
}

async function syncFromAiCalls(db: any) {
    const { data: aiCalls, error } = await db.from('ai_calls').select('*').order('started_at', { ascending: false })
    if (error || !aiCalls?.length) return { synced: 0, error: error?.message }
    const rows = aiCalls.filter((a: any) => a.started_at).map((a: any) => {
        const ts = new Date(typeof a.started_at === 'number' ? a.started_at : parseInt(a.started_at))
        return {
            call_id: `ai-${a.id}`,
            direction: 'outbound',
            from_number: SHOP_NUMBER,
            to_number: '',
            duration_secs: 0,
            status: a.status || 'unknown',
            start_time: ts.toISOString(),
            customer_id: null,
            matched_customer_name: null,
            raw_data: { source: 'ai_calls', ai_call_id: a.id, task: a.task, status: a.status, transcript: a.transcript, summary: a.summary },
        }
    })
    let inserted = 0
    for (let i = 0; i < rows.length; i += 100) {
        const batch = rows.slice(i, i + 100)
        const { error: uErr } = await db.from('call_history').upsert(batch, { onConflict: 'call_id' })
        if (!uErr) inserted += batch.length
        else console.error('AI calls upsert error:', uErr)
    }
    return { synced: inserted, total: aiCalls.length }
}

export async function POST(req: NextRequest) {
    try {
        const url = new URL(req.url)
        const action = url.searchParams.get('action') || 'sync-all'
        const db = getServiceClient()

        if (action === 'sync') {
            return NextResponse.json({ success: true, activities: await syncFromActivities(db) })
        }
        if (action === 'sync-recordings') {
            return NextResponse.json({ success: true, recordings: await syncFromRecordings(db) })
        }
        if (action === 'sync-ai') {
            return NextResponse.json({ success: true, aiCalls: await syncFromAiCalls(db) })
        }
        if (action === 'sync-all') {
            const [activities, recordings, aiCalls] = await Promise.all([
                syncFromActivities(db),
                syncFromRecordings(db),
                syncFromAiCalls(db),
            ])
            return NextResponse.json({ success: true, activities, recordings, aiCalls })
        }
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
        return NextResponse.json({ error: 'Unknown action. Use: sync-all, sync, sync-recordings, sync-ai, match' }, { status: 400 })
    } catch (e: any) {
        console.error('Sync error:', e)
        return NextResponse.json({ error: e.message || 'Sync failed' }, { status: 500 })
    }
}

export async function GET(req: NextRequest) { return POST(req) }
