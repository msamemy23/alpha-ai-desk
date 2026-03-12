import { NextResponse } from 'next/server'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''

export async function GET() {
  try {
    const res = await fetch('https://api.telnyx.com/v2/recordings?page[size]=50', {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
      // Don't cache — we need fresh signed URLs every time
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`Telnyx API error: ${res.status}`)
    const data = await res.json()

    // Group recordings by call_session_id to deduplicate
    // (Telnyx creates multiple recording entries per call: one per initiator type)
    // Pick the best one per session (prefer mp3, prefer StartCallRecordingAPI or OutboundAPI)
    const sessionMap: Record<string, any> = {}
    for (const rec of (data.data || [])) {
      const sid = rec.call_session_id || rec.id
      const existing = sessionMap[sid]
      const hasMp3 = !!rec.download_urls?.mp3
      const existingHasMp3 = existing && !!existing.download_urls?.mp3

      if (!existing || (hasMp3 && !existingHasMp3)) {
        sessionMap[sid] = rec
      }
    }

    const recordings = Object.values(sessionMap)
      .sort((a: any, b: any) => new Date(b.recording_started_at).getTime() - new Date(a.recording_started_at).getTime())

    return NextResponse.json({ recordings })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message, recordings: [] }, { status: 500 })
  }
}
