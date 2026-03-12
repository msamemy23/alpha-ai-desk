import { NextResponse } from 'next/server'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const INBOUND_CONNECTION = '2786787533428623349'

export async function GET() {
  try {
    let allRecordings: any[] = []
    let cursor: string | null = null
    let pages = 0
    const maxPages = 10 // Safety limit

    do {
      const params = new URLSearchParams({ 'page[size]': '250' })
      if (cursor) params.set('page[after]', cursor)

      const res = await fetch(`https://api.telnyx.com/v2/recordings?${params}`, {
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
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
    const inbound = allRecordings.filter((rec: any) => rec.connection_id === INBOUND_CONNECTION)

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
