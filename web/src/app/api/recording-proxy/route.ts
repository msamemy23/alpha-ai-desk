/**
 * Recording proxy - streams Telnyx recordings to the browser.
 * Accepts: ?url=<direct-url>, ?id=<recording_id>, or ?callId=<ai_call_id>
 * For recording_id: fetches a FRESH download URL from Telnyx API
 * For callId: looks up recording_url from ai_calls table
 * For url: proxies the provided URL directly
 */

import { NextRequest, NextResponse } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'

async function getFreshDownloadUrl(recordingId: string, callSessionId?: string): Promise<string | null> {
  try {
    if (callSessionId) {
      const params = new URLSearchParams({ 'filter[call_session_id]': callSessionId, 'page[size]': '5' })
      const r = await fetch(`${TELNYX_BASE}/recordings?${params}`, {
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` }, cache: 'no-store',
      })
      if (r.ok) {
        const d = await r.json()
        const rec = (d.data || []).find((x: any) => x.id === recordingId) || d.data?.[0]
        const url = rec?.download_urls?.mp3 || rec?.download_urls?.wav
        if (url) return url
      }
    }
    const r2 = await fetch(`${TELNYX_BASE}/recordings/${recordingId}`, {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` }, cache: 'no-store',
    })
    if (r2.ok) {
      const d2 = await r2.json()
      return d2.data?.download_urls?.mp3 || d2.data?.download_urls?.wav || null
    }
    return null
  } catch { return null }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const callId = searchParams.get('callId')
  const recordingId = searchParams.get('id')
  const callSessionId = searchParams.get('sessionId')
  const directUrl = searchParams.get('url')

  let recordingUrl = directUrl || ''

  // Option 1: recording_id - get fresh URL from Telnyx API
  if (recordingId && !recordingUrl && TELNYX_API_KEY) {
    recordingUrl = await getFreshDownloadUrl(recordingId, callSessionId || undefined) || ''
  }

  // Option 2: callId - look up from ai_calls table
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
    let audioRes = await fetch(recordingUrl, { cache: 'no-store' })
    if (!audioRes.ok && TELNYX_API_KEY) {
      audioRes = await fetch(recordingUrl, {
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` }, cache: 'no-store',
      })
    }
    // If URL expired and we have recording_id, try getting fresh URL
    if (!audioRes.ok && recordingId && TELNYX_API_KEY) {
      const freshUrl = await getFreshDownloadUrl(recordingId, callSessionId || undefined)
      if (freshUrl && freshUrl !== recordingUrl) {
        audioRes = await fetch(freshUrl, { cache: 'no-store' })
        if (!audioRes.ok) {
          audioRes = await fetch(freshUrl, {
            headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` }, cache: 'no-store',
          })
        }
      }
    }
    if (!audioRes.ok) {
      return NextResponse.json({ error: 'Recording expired or unavailable' }, { status: 404 })
    }
    const audioBuffer = await audioRes.arrayBuffer()
    const contentType = audioRes.headers.get('content-type') || 'audio/mpeg'
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(audioBuffer.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch recording' }, { status: 500 })
  }
}
