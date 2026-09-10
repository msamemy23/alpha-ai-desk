import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'
import { getRouteShop, unauthorized } from '@/lib/api-auth'

export const maxDuration = 300

const TELNYX_BASE = 'https://api.telnyx.com/v2'


async function fetchAllTelnyxRecordings(apiKey: string): Promise<any[]> {
  const all: any[] = []
  let url: string | null = `${TELNYX_BASE}/recordings?page[size]=250`
  let pages = 0
  while (url && pages < 20) {
    const res: Response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
    if (!res.ok) break
    const data: { data?: unknown[]; meta?: { cursors?: { after?: string } } } = await res.json()
    const items = data.data || []
    all.push(...items)
    const after: string | undefined = data.meta?.cursors?.after
    url = after ? `${TELNYX_BASE}/recordings?page[size]=250&page[after]=${after}` : null
    pages++
  }
  return all
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
    if (!apiKey) return NextResponse.json({ error: 'Telnyx is not configured for this shop' }, { status: 503 })
    const action = url.searchParams.get('action') || 'sync'

    if (action === 'stats') {
      const { count: total } = await db.from('call_history').select('id', { count: 'exact', head: true }).eq('shop_id', auth.shopId)
      const { data: sample } = await db.from('call_history').select('call_id').eq('shop_id', auth.shopId).limit(5)
      return NextResponse.json({ total_calls: total, sample_call_ids: sample?.map(s => s.call_id) })
    }

    if (action === 'sync') {
      const recordings = await fetchAllTelnyxRecordings(apiKey)
      if (!recordings.length) return NextResponse.json({ error: 'No recordings returned from Telnyx', synced: 0 })

      // Show sample for debugging
      const sampleRec = recordings[0]
      const sampleInfo = {
        id: sampleRec?.id,
        call_leg_id: sampleRec?.call_leg_id,
        call_session_id: sampleRec?.call_session_id,
        has_mp3: !!sampleRec?.download_urls?.mp3,
        // DB call_ids look like: rec-{call_session_id} or activity-{call_leg_id}
        // Try: rec-{call_session_id}
        predicted_call_id: sampleRec?.call_session_id ? `rec-${sampleRec.call_session_id}` : null,
      }

      let matched = 0
      let notFound = 0

      for (const rec of recordings) {
        const recId = rec.id
        const callLegId = rec.call_leg_id
        const callSessionId = rec.call_session_id
        const downloadMp3 = rec.download_urls?.mp3
        const downloadWav = rec.download_urls?.wav

        if (!callLegId && !callSessionId) continue

        let callRow: any = null

        // Primary match: DB call_id = "rec-{call_session_id}"
        if (callSessionId) {
          const { data } = await db.from('call_history')
            .select('id, raw_data')
            .eq('shop_id', auth.shopId)
            .eq('call_id', `rec-${callSessionId}`)
            .maybeSingle()
          callRow = data
        }

        // Try: DB call_id = "rec-{call_leg_id}"
        if (!callRow && callLegId) {
          const { data } = await db.from('call_history')
            .select('id, raw_data')
            .eq('shop_id', auth.shopId)
            .eq('call_id', `rec-${callLegId}`)
            .maybeSingle()
          callRow = data
        }

        // Try: exact UUID match (no prefix)
        if (!callRow && callLegId) {
          const { data } = await db.from('call_history')
            .select('id, raw_data')
            .eq('call_id', callLegId)
            .eq('shop_id', auth.shopId)
            .maybeSingle()
          callRow = data
        }

        // Try: activity- prefix
        if (!callRow && callLegId) {
          const { data } = await db.from('call_history')
            .select('id, raw_data')
            .eq('call_id', `activity-${callLegId}`)
            .eq('shop_id', auth.shopId)
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
          await db.from('call_history').update({ raw_data: updatedRd }).eq('id', callRow.id).eq('shop_id', auth.shopId)
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
