/**
 * Recording proxy - streams Telnyx recordings to the browser.
 * Accepts: ?url=<direct-url>, ?id=<recording_id>, or ?callId=<ai_call_id>
 * For recording_id: fetches a FRESH download URL from Telnyx API
 * For callId: looks up recording_url from ai_calls table
 * For url: proxies the provided URL directly
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { assertPublicUrl, fetchPublicUrl } from '@/lib/public-url'

const TELNYX_BASE = 'https://api.telnyx.com/v2'
const MAX_RECORDING_BYTES = 50 * 1024 * 1024
const MAX_REDIRECTS = 3

async function getFreshDownloadUrl(recordingId: string, callSessionId: string | undefined, apiKey: string): Promise<string | null> {
  try {
    if (callSessionId) {
      const params = new URLSearchParams({ 'filter[call_session_id]': callSessionId, 'page[size]': '5' })
      const r = await fetch(`${TELNYX_BASE}/recordings?${params}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` }, cache: 'no-store',
      })
      if (r.ok) {
        const d = await r.json()
        const rec = (d.data || []).find((x: any) => x.id === recordingId) || d.data?.[0]
        const url = rec?.download_urls?.mp3 || rec?.download_urls?.wav
        if (url) return url
      }
    }
    const r2 = await fetch(`${TELNYX_BASE}/recordings/${recordingId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }, cache: 'no-store',
    })
    if (r2.ok) {
      const d2 = await r2.json()
      return d2.data?.download_urls?.mp3 || d2.data?.download_urls?.wav || null
    }
    return null
  } catch { return null }
}

function isTelnyxApiUrl(value: string): boolean {
  try { return new URL(value).hostname.toLowerCase() === 'api.telnyx.com' } catch { return false }
}

async function getSafeRecordingUrl(value: string, base?: URL): Promise<URL | null> {
  try {
    const url = await assertPublicUrl(value, base)
    return url.protocol === 'https:' ? url : null
  } catch { return null }
}

async function fetchRecording(url: URL, apiKey: string): Promise<Response | null> {
  let current = url
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    const headers = isTelnyxApiUrl(current.toString()) && apiKey
      ? { Authorization: `Bearer ${apiKey}` }
      : undefined
    const response = await fetchPublicUrl(current, {
      headers,
      signal: AbortSignal.timeout(30000),
      maxBytes: MAX_RECORDING_BYTES,
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || attempt === MAX_REDIRECTS) return null
      const next = await getSafeRecordingUrl(location, current)
      if (!next) return null
      current = next
      continue
    }
    return response
  }
  return null
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const { searchParams } = new URL(req.url)
  const callId = searchParams.get('callId')
  const recordingId = searchParams.get('id')
  const callSessionId = searchParams.get('sessionId')
  const directUrl = searchParams.get('url')
  const { data: settings, error: settingsError } = await getServiceClient().from('settings')
    .select('telnyx_api_key').eq('shop_id', auth.shopId).maybeSingle()
  if (settingsError) return NextResponse.json({ error: 'Shop settings could not be loaded' }, { status: 500 })
  const telnyxKey = String(settings?.telnyx_api_key || '')

  let recordingUrl = directUrl || ''

  // A caller-supplied/stored download URL is fetched without provider
  // credentials. Telnyx auth is only ever sent to Telnyx's exact API host.
  if (recordingId && !recordingUrl) {
    if (!telnyxKey) return NextResponse.json({ error: 'Telnyx is not configured for this shop' }, { status: 503 })
    recordingUrl = await getFreshDownloadUrl(recordingId, callSessionId || undefined, telnyxKey) || ''
  }

  // Option 2: callId - look up from ai_calls table
  if (callId && !recordingUrl) {
    try {
      const { data, error } = await getServiceClient().from('ai_calls')
        .select('recording_url')
        .eq('id', callId)
        .eq('shop_id', auth.shopId)
        .maybeSingle()
      if (error) throw error
      recordingUrl = data?.recording_url || ''
    } catch {
      return NextResponse.json({ error: 'Failed to fetch recording URL' }, { status: 500 })
    }
  }

  if (!recordingUrl) {
    return NextResponse.json({ error: 'No recording URL' }, { status: 404 })
  }
  const safeRecordingUrl = await getSafeRecordingUrl(recordingUrl)
  if (!safeRecordingUrl) {
    return NextResponse.json({ error: 'Recording URL is not allowed' }, { status: 400 })
  }
  recordingUrl = safeRecordingUrl.toString()

  // Proxy the audio
  try {
    let audioRes = await fetchRecording(safeRecordingUrl, telnyxKey)
    // If URL expired and we have recording_id, try getting fresh URL
    if ((!audioRes || !audioRes.ok) && recordingId && telnyxKey) {
      const freshUrl = await getFreshDownloadUrl(recordingId, callSessionId || undefined, telnyxKey)
      const safeFreshUrl = freshUrl ? await getSafeRecordingUrl(freshUrl) : null
      if (safeFreshUrl && safeFreshUrl.toString() !== recordingUrl) {
        recordingUrl = safeFreshUrl.toString()
        audioRes = await fetchRecording(safeFreshUrl, telnyxKey)
      }
    }
    if (!audioRes || !audioRes.ok) {
      return NextResponse.json({ error: 'Recording expired or unavailable' }, { status: 404 })
    }
    const declaredLength = Number(audioRes.headers.get('content-length') || 0)
    if (declaredLength > MAX_RECORDING_BYTES) {
      return NextResponse.json({ error: 'Recording is too large' }, { status: 413 })
    }
    const audioBuffer = await audioRes.arrayBuffer()
    if (audioBuffer.byteLength > MAX_RECORDING_BYTES) {
      return NextResponse.json({ error: 'Recording is too large' }, { status: 413 })
    }
    const contentType = audioRes.headers.get('content-type') || 'audio/mpeg'
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(audioBuffer.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch recording' }, { status: 500 })
  }
}
