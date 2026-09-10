import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { DEFAULT_OPENROUTER_MODEL, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const body = await req.json().catch(() => null)
    const recordingId = typeof body?.recording_id === 'string' ? body.recording_id.trim().slice(0, 200) : ''
    if (!recordingId) return NextResponse.json({ ok: false, error: 'Missing recording_id' }, { status: 400 })

    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings')
      .select('shop_name,shop_phone,telnyx_api_key,ai_api_key,ai_base_url,ai_model')
      .eq('shop_id', auth.shopId)
      .maybeSingle()
    if (settingsError) return NextResponse.json({ ok: false, error: 'Shop settings could not be loaded' }, { status: 500 })
    const telnyxKey = String(settings?.telnyx_api_key || '')
    if (!telnyxKey) return NextResponse.json({ ok: false, error: 'Telnyx is not configured for this shop' }, { status: 503 })

    // Get a fresh recording URL from the shop's Telnyx account.
    const recRes = await fetch(`https://api.telnyx.com/v2/recordings/${encodeURIComponent(recordingId)}`, {
      headers: { Authorization: `Bearer ${telnyxKey}` },
      signal: AbortSignal.timeout(15000),
    })
    const recData = await recRes.json().catch(() => ({}))
    if (!recRes.ok) return NextResponse.json({ ok: false, error: recData?.errors?.[0]?.detail || `Telnyx returned ${recRes.status}` }, { status: 502 })
    const recording = recData.data
    const audioUrl = recording?.download_urls?.mp3 || recording?.download_urls?.wav
    if (!audioUrl) return NextResponse.json({ ok: false, error: 'No audio URL available' }, { status: 404 })

    const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(30000) })
    if (!audioRes.ok) return NextResponse.json({ ok: false, error: 'Failed to download audio' }, { status: 502 })
    const audioBuffer = await audioRes.arrayBuffer()
    const isWav = !recording.download_urls?.mp3
    const mimeType = isWav ? 'audio/wav' : 'audio/mpeg'

    const formData = new FormData()
    formData.append('file', new Blob([audioBuffer], { type: mimeType }), isWav ? 'recording.wav' : 'recording.mp3')
    formData.append('model', 'distil-whisper/distil-large-v2')
    const transcribeRes = await fetch('https://api.telnyx.com/v2/ai/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${telnyxKey}` },
      body: formData,
      signal: AbortSignal.timeout(30000),
    })
    const transcribeData = await transcribeRes.json().catch(() => ({}))
    const transcript = transcribeRes.ok && typeof transcribeData.text === 'string'
      ? transcribeData.text
      : '[Audio recording - transcription unavailable]'

    const from = recording.from || 'Unknown'
    const to = recording.to || 'Unknown'
    const duration = Math.round((recording.duration_millis || 0) / 1000)
    const aiKey = String(settings?.ai_api_key || '')
    if (!aiKey) return NextResponse.json({ ok: false, error: 'AI is not configured for this shop' }, { status: 503 })
    const aiBaseUrl = normalizeAiBaseUrl(settings?.ai_base_url)
    const aiModel = normalizeAiModel(settings?.ai_model || DEFAULT_OPENROUTER_MODEL, aiBaseUrl)
    const summaryRes = await fetch(`${aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aiKey}`,
        'Content-Type': 'application/json',
        ...(aiBaseUrl.includes('openrouter.ai') ? { 'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://alpha-ai-desk.vercel.app' } : {}),
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          {
            role: 'system',
            content: `You are summarizing a phone call to ${settings?.shop_name || 'an auto repair shop'}. Summarize in 2-4 bullet points: what the caller wanted, what was discussed, and any action items or outcomes. Be concise and professional. If the transcript is unavailable or too short, say "Brief call - no meaningful conversation detected."`,
          },
          { role: 'user', content: `Call from ${from} to ${to}, duration: ${duration} seconds.\n\nTranscript:\n${transcript}` },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(30000),
    })
    const summaryData = await summaryRes.json().catch(() => ({}))
    if (!summaryRes.ok) return NextResponse.json({ ok: false, error: summaryData?.error?.message || `AI provider returned ${summaryRes.status}` }, { status: 502 })
    const summary = summaryData?.choices?.[0]?.message?.content?.trim()
    if (!summary) return NextResponse.json({ ok: false, error: 'AI did not return a summary' }, { status: 502 })

    return NextResponse.json({ ok: true, summary, transcript })
  } catch (e: unknown) {
    console.error('[recording-summary] error:', e)
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Recording summary failed' }, { status: 500 })
  }
}
