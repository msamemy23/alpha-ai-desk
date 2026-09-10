import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'
import { getRouteShop, unauthorized } from '@/lib/api-auth'

export const maxDuration = 300

const TELNYX_BASE = 'https://api.telnyx.com/v2'


async function syncFromActivities(db: any, shopId: string, shopNumber: string) {
    const { data: activities, error } = await db.from('activities').select('*').eq('shop_id', shopId).eq('type', 'call').order('created_at', { ascending: false })
    if (error || !activities?.length) return { synced: 0, error: error?.message }
    const rows = activities.map((a: any) => ({
        call_id: `activity-${a.id}`,
        direction: a.direction || 'unknown',
        shop_id: shopId,
        from_number: a.direction === 'outbound' ? shopNumber : (a.phone || a.customer_name || ''),
        to_number: a.direction === 'inbound' ? shopNumber : (a.phone || a.customer_name || ''),
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
        const { error: uErr } = await db.from('call_history').upsert(batch, { onConflict: 'shop_id,call_id' })
        if (!uErr) inserted += batch.length
        else console.error('Activities upsert error:', uErr)
    }
    return { synced: inserted, total: activities.length }
}

async function syncFromRecordings(db: any, shopId: string, apiKey: string, shopNumber: string, inboundConnection: string) {
    if (!apiKey || !shopNumber || !inboundConnection) return { synced: 0, error: 'No API key' }
    let allRecordings: any[] = []
    let pageNum = 1

    // Use page[number] pagination - Telnyx uses page numbers not cursors
    while (pageNum <= 200) {
        const params = new URLSearchParams({
            'page[size]': '250',
            'page[number]': String(pageNum)
        })
        const res = await fetch(`${TELNYX_BASE}/recordings?${params}`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
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
    const { data: customers } = await db.from('customers').select('id, name, phone').eq('shop_id', shopId)
    const phoneMap = new Map()
    for (const c of (customers || [])) {
        if (c.phone) phoneMap.set(c.phone.replace(/\D/g, '').slice(-10), { id: c.id, name: c.name })
    }

    const rows = recordings.map((r: any) => {
        const isInbound = r.connection_id === inboundConnection
        const from = isInbound ? (r.from || '') : shopNumber
        const to = isInbound ? shopNumber : (r.to || '')
        const callerPhone = isInbound ? from : to
        const clean = callerPhone.replace(/\D/g, '').slice(-10)
        const match = phoneMap.get(clean)
        const durSec = Math.round((r.duration_millis || 0) / 1000)
        return {
            call_id: `rec-${r.call_session_id || r.id}`,
            direction: isInbound ? 'inbound' : 'outbound',
            shop_id: shopId,
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
        const { error } = await db.from('call_history').upsert(batch, { onConflict: 'shop_id,call_id' })
        if (!error) inserted += batch.length
        else console.error('Recording upsert error:', error)
    }
    return { synced: inserted, total: recordings.length, raw_total: allRecordings.length, pages_fetched: pageNum, unique_sessions: Object.keys(sessionMap).length }
}

async function syncFromAiCalls(db: any, shopId: string, shopNumber: string) {
    const { data: aiCalls, error } = await db.from('ai_calls').select('*').eq('shop_id', shopId).order('started_at', { ascending: false })
    if (error || !aiCalls?.length) return { synced: 0, error: error?.message }
    const rows = aiCalls.filter((a: any) => a.started_at).map((a: any) => {
        const ts = new Date(typeof a.started_at === 'number' ? a.started_at : parseInt(a.started_at))
        return {
            call_id: `ai-${a.id}`,
            direction: 'outbound',
            shop_id: shopId,
            from_number: shopNumber,
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
        const { error: uErr } = await db.from('call_history').upsert(batch, { onConflict: 'shop_id,call_id' })
        if (!uErr) inserted += batch.length
        else console.error('AI calls upsert error:', uErr)
    }
    return { synced: inserted, total: aiCalls.length }
}

export async function POST(req: NextRequest) {
    try {
        const url = new URL(req.url)
        const body = await req.json().catch(() => null)
        const auth = await getRouteShop(req, body?.shopId || url.searchParams.get('shop_id'))
        if (!auth) return unauthorized()
        const db = getServiceClient()
        const { data: settings, error: settingsError } = await db.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
        if (settingsError) return NextResponse.json({ error: 'Unable to load shop settings' }, { status: 500 })
        const apiKey = String(settings?.telnyx_api_key || '')
        const shopNumber = String(settings?.telnyx_phone_number || '')
        const inboundConnection = String(settings?.telnyx_connection_id || '')
        if (!apiKey || !shopNumber || !inboundConnection) return NextResponse.json({ error: 'Telnyx sync is not configured for this shop' }, { status: 503 })
        const action = url.searchParams.get('action') || 'sync-all'

        if (action === 'sync') {
            const result = await syncFromActivities(db, auth.shopId, shopNumber)
            return NextResponse.json({ success: !result.error, activities: result }, { status: result.error ? 502 : 200 })
        }
        if (action === 'sync-recordings') {
            const result = await syncFromRecordings(db, auth.shopId, apiKey, shopNumber, inboundConnection)
            return NextResponse.json({ success: !result.error, recordings: result }, { status: result.error ? 502 : 200 })
        }
        if (action === 'sync-ai') {
            const result = await syncFromAiCalls(db, auth.shopId, shopNumber)
            return NextResponse.json({ success: !result.error, aiCalls: result }, { status: result.error ? 502 : 200 })
        }
        if (action === 'sync-all') {
            const [activities, recordings, aiCalls] = await Promise.all([
                syncFromActivities(db, auth.shopId, shopNumber),
                syncFromRecordings(db, auth.shopId, apiKey, shopNumber, inboundConnection),
                syncFromAiCalls(db, auth.shopId, shopNumber),
            ])
            const success = !activities.error && !recordings.error && !aiCalls.error
            return NextResponse.json({ success, activities, recordings, aiCalls }, { status: success ? 200 : 502 })
        }
        if (action === 'match') {
            const { data: calls } = await db.from('call_history').select('id, from_number, to_number').eq('shop_id', auth.shopId).is('customer_id', null)
            const { data: customers } = await db.from('customers').select('id, name, phone').eq('shop_id', auth.shopId)
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
                    await db.from('call_history').update({ customer_id: m.id, matched_customer_name: m.name }).eq('id', call.id).eq('shop_id', auth.shopId)
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
