/**
 * Recording proxy — streams the Telnyx recording to the browser.
 * Telnyx presigned S3 URLs expire in 10 minutes. This proxy fetches the
 * recording server-side and streams it to the client so the browser
 * can play it any time (as long as the Supabase URL is still valid).
 *
 * Usage: GET /api/recording-proxy?url=<encoded-recording-url>
 */

import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const callId = searchParams.get('callId')
  const directUrl = searchParams.get('url')

  let recordingUrl = directUrl || ''

  // If callId provided, fetch fresh recording URL from Supabase
  if (callId && !recordingUrl) {
    try {
      const r = await fetch(
        `${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(callId)}&select=recording_url&limit=1`,
        { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
      )
      const rows = await r.json()
      recordingUrl = rows?.[0]?.recording_url || ''
    } catch {
      return NextResponse.json({ error: 'Failed to fetch recording URL' }, { status: 500 })
    }
  }

  if (!recordingUrl) {
    return NextResponse.json({ error: 'No recording URL' }, { status: 404 })
  }

  // Proxy the audio
  try {
    const audioRes = await fetch(recordingUrl)
    if (!audioRes.ok) {
      return NextResponse.json({ error: 'Recording expired or unavailable' }, { status: 404 })
    }
    const audioBuffer = await audioRes.arrayBuffer()
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.byteLength),
        'Cache-Control': 'public, max-age=86400', // cache 24h
        'Content-Disposition': `attachment; filename="call-recording.mp3"`,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to stream recording' }, { status: 500 })
  }
}
