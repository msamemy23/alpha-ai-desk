import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

export const maxDuration = 300

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'

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

    if (action === 'stats') {
      const { count: total } = await db.from('call_history').select('id', { count: 'exact', head: true })
      const { data: sample } = await db.from('call_history').select('call_id, raw_data').limit(2)
      return NextResponse.json({ total_calls: total, sample_call_ids: sample?.map(s => s.call_id) })
    }

    if (action === 'sync') {
      const recordings = await fetchAllTelnyxRecordings()
      if (!recordings.length) return NextResponse.json({ error: 'No recordings returned from Telnyx', synced: 0 })

      // Sample first recording to see structure
      const sample = recordings[0]
      const sampleInfo = {
        id: sample?.id,
        call_leg_id: sample?.call_leg_id,
        call_session_id: sample?.call_session_id,
        has_mp3: !!sample?.download_urls?.mp3,
        mp3_prefix: sample?.download_urls?.mp3?.substring(0, 60),
      }

      let matched = 0
      let notFound = 0

      for (const rec of recordings) {
        const recId = rec.id
        const callLegId = rec.call_leg_id  // Raw UUID like "abc123-..."
        const callSessionId = rec.call_session_id
        const downloadMp3 = rec.download_urls?.mp3
        const downloadWav = rec.download_urls?.wav

        if (!callLegId && !callSessionId) continue

        let callRow: any = null

        // call_history stores call_id as "activity-{UUID}" format from Telnyx detail records
        // Try matching with "activity-" prefix
        if (callLegId) {
          const { data } = await db.from('call_history')
            .select('id, raw_data')
            .eq('call_id', `activity-${callLegId}`)
            .maybeSingle()
          callRow = data
        }

        // Try without prefix (exact UUID match)
        if (!callRow && callLegId) {
          const { data } = await db.from('call_history')
            .select('id, raw_data')
            .eq('call_id', callLegId)
            .maybeSingle()
          callRow = data
        }

        // Try with call_session_id prefixed
        if (!callRow && callSessionId) {
          const { data } = await db.from('call_history')
            .select('id, raw_data')
            .eq('call_id', `activity-${callSessionId}`)
            .maybeSingle()
          callRow = data
        }

        // Try ends-with match (UUID suffix)
        if (!callRow && callLegId) {
          const { data } = await db.from('call_history')
            .select('id, raw_data')
            .ilike('call_id', `%${callLegId}`)
            .maybeSingle()
          callRow = data
        }

        if (callRow) {
          const existingRd = (callRow.raw_data as any) || {}
          const updatedRd = {
            ...existingRd,
            recording_id: recId,
            download_urls: { mp3: downloadMp3 || null, wav: downloadWav || null },
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
        sample_recording: sampleInfo,
        message: `Synced ${matched} recordings to call history. ${notFound} had no matching call.`
      })
    }

    return NextResponse.json({ error: 'Use: sync, stats' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return POST(req) }
