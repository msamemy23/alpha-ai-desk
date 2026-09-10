import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'


export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) return NextResponse.json({ error: 'Unable to load shop settings', recordings: [] }, { status: 500 })
    const apiKey = String(settings?.telnyx_api_key || '')
    const inboundConnection = String(settings?.telnyx_connection_id || '')
    if (!apiKey || !inboundConnection) return NextResponse.json({ error: 'Telnyx recordings are not configured for this shop', recordings: [] }, { status: 503 })
    let allRecordings: any[] = []
    let cursor: string | null = null
    let pages = 0
    const maxPages = 10 // Safety limit

    do {
      const params = new URLSearchParams({ 'page[size]': '250' })
      if (cursor) params.set('page[after]', cursor)

      const res = await fetch(`https://api.telnyx.com/v2/recordings?${params}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`Telnyx API error: ${res.status}`)
      const data = await res.json()
      const pageRecs = data.data || []
      allRecordings.push(...pageRecs)

      cursor = data.meta?.cursors?.after || null
      pages++
    } while (cursor && pages < maxPages)

    // Filter to only inbound recordings (AI assistant handled calls)
    const inbound = allRecordings.filter((rec: any) => rec.connection_id === inboundConnection)

    // Deduplicate by call_session_id — pick the one with longest duration
    const sessionMap: Record<string, any> = {}
    for (const rec of inbound) {
      const sid = rec.call_session_id || rec.id
      const existing = sessionMap[sid]
      if (!existing || (rec.duration_millis || 0) > (existing.duration_millis || 0)) {
        sessionMap[sid] = rec
      }
    }

    const recordings = Object.values(sessionMap)
      .filter((r: any) => (r.duration_millis || 0) > 2000)
      .sort((a: any, b: any) => new Date(b.recording_started_at).getTime() - new Date(a.recording_started_at).getTime())

    return NextResponse.json({ recordings, total: recordings.length })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message, recordings: [] }, { status: 500 })
  }
}
