import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

export const maxDuration = 300

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'

// Fetch all recordings from Telnyx with pagination
async function fetchAllTelnyxRecordings(): Promise<any[]> {
  const all: any[] = []
  let url: string | null = `${TELNYX_BASE}/recordings?page[size]=250`
  let pages = 0
  while (url && pages < 20) {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
    })
    if (!res.ok) break
    const data = await res.json()
    const items = data.data || []
    all.push(...items)
    // Telnyx cursor pagination
    const after = data.meta?.cursors?.after
    url = after ? `${TELNYX_BASE}/recordings?page[size]=250&page[after]=${after}` : null
    pages++
  }
  return all
}

export async function POST(req: NextRequest) {
  try {
    if (!TELNYX_API_KEY) return NextResponse.json({ error: 'TELNYX_API_KEY not set' }, { status: 400 })
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'sync'

    const db = getServiceClient()

    // STATS: show recording sync status
    if (action === 'stats') {
      const { count: total } = await db.from('call_history').select('id', { count: 'exact', head: true })
      const { count: withRecording } = await db
        .from('call_history')
        .select('id', { count: 'exact', head: true })
        .not('raw_data->recording_id', 'is', null)
      return NextResponse.json({ total_calls: total, calls_with_recording_id: withRecording })
    }

    // SYNC: fetch recordings from Telnyx, match to call_history by call_leg_id or timing
    if (action === 'sync') {
      const recordings = await fetchAllTelnyxRecordings()
      if (!recordings.length) return NextResponse.json({ error: 'No recordings returned from Telnyx', synced: 0 })

      let matched = 0
      let notFound = 0

      for (const rec of recordings) {
        const recId = rec.id
        const callLegId = rec.call_leg_id
        const callSessionId = rec.call_session_id
        const downloadMp3 = rec.download_urls?.mp3
        const downloadWav = rec.download_urls?.wav
        const startedAt = rec.started_at
        const durationMs = rec.duration_millis

        if (!callLegId && !callSessionId) continue

        // Try to find matching call by call_leg_id (stored as call_id in call_history)
        // Telnyx call logs use call_leg_id as the ID
        let callRow: any = null

        if (callLegId) {
          const { data } = await db.from('call_history')
            .select('id, raw_data')
            .eq('call_id', callLegId)
            .maybeSingle()
          callRow = data
        }

        // Also try matching by call_session_id
        if (!callRow && callSessionId) {
          const { data } = await db.from('call_history')
            .select('id, raw_data')
            .eq('call_id', callSessionId)
            .maybeSingle()
          callRow = data
        }

        // Try partial match on call_id containing the leg ID
        if (!callRow && callLegId) {
          const { data } = await db.from('call_history')
            .select('id, raw_data')
            .ilike('call_id', `%${callLegId.substring(0, 20)}%`)
            .maybeSingle()
          callRow = data
        }

        if (callRow) {
          // Update raw_data with recording info
          const existingRd = (callRow.raw_data as any) || {}
          const updatedRd = {
            ...existingRd,
            recording_id: recId,
            download_urls: {
              mp3: downloadMp3 || null,
              wav: downloadWav || null,
            },
            recording_started_at: startedAt,
            recording_duration_ms: durationMs,
          }
          await db.from('call_history').update({ raw_data: updatedRd }).eq('id', callRow.id)
          matched++
        } else {
          notFound++
        }
      }

      return NextResponse.json({
        success: true,
        total_recordings_fetched: recordings.length,
        matched_to_calls: matched,
        not_found: notFound,
        message: `Synced ${matched} recordings to call history. ${notFound} recordings had no matching call.`
      })
    }

    return NextResponse.json({ error: 'Use: sync, stats' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return POST(req) }
