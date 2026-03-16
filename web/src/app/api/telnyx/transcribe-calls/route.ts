import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

export const maxDuration = 300

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'

async function transcribeViaWhisper(downloadUrl: string): Promise<{ text: string | null; error?: string }> {
  try {
    if (!OPENAI_API_KEY) return { text: null, error: 'NO_OPENAI_KEY' }
    // Download audio - try without auth (S3 public), then with Telnyx auth
    let audioRes = await fetch(downloadUrl)
    if (!audioRes.ok) {
      audioRes = await fetch(downloadUrl, {
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
      })
    }
    if (!audioRes.ok) return { text: null, error: `DOWNLOAD_FAILED_${audioRes.status}` }
    const audioBuffer = await audioRes.arrayBuffer()
    if (audioBuffer.byteLength < 1000) return { text: null, error: `AUDIO_TOO_SMALL_${audioBuffer.byteLength}` }
    const ext = downloadUrl.includes('.wav') ? 'wav' : 'mp3'
    const mime = ext === 'wav' ? 'audio/wav' : 'audio/mpeg'
    const audioBlob = new Blob([audioBuffer], { type: mime })
    const formData = new FormData()
    formData.append('file', audioBlob, `recording.${ext}`)
    formData.append('model', 'whisper-1')
    formData.append('language', 'en')
    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    })
    if (!whisperRes.ok) {
      const errText = await whisperRes.text()
      return { text: null, error: `WHISPER_${whisperRes.status}_${errText.substring(0, 100)}` }
    }
    const data = await whisperRes.json()
    return { text: data.text || null }
  } catch (e: any) {
    return { text: null, error: `EXCEPTION_${e.message}` }
  }
}

async function scoreLeadFromTranscript(transcript: string): Promise<{
  lead_score: string; lead_reasoning: string; service_needed: string;
  caller_sentiment: string; key_quotes: string;
}> {
  const empty = { lead_score: 'unknown', lead_reasoning: '', service_needed: '', caller_sentiment: '', key_quotes: '' }
  if (!OPENAI_API_KEY || !transcript || transcript.length < 20) return { ...empty, lead_reasoning: 'Transcript too short' }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: 'You are an AI for Alpha International Auto Center (Houston TX auto shop). Analyze call transcripts. Respond JSON only: lead_score (hot/warm/cold), lead_reasoning, service_needed, caller_sentiment (positive/neutral/frustrated/spam), key_quotes'
        }, {
          role: 'user', content: `Analyze:\n\n${transcript.substring(0, 3000)}`
        }],
        temperature: 0.3, max_tokens: 500, response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) return { ...empty, lead_reasoning: 'AI scoring failed' }
    const data = await res.json()
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    return {
      lead_score: parsed.lead_score || 'unknown', lead_reasoning: parsed.lead_reasoning || '',
      service_needed: parsed.service_needed || '', caller_sentiment: parsed.caller_sentiment || '',
      key_quotes: parsed.key_quotes || '',
    }
  } catch (e: any) { return { ...empty, lead_reasoning: e.message } }
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'batch'
    const limit = parseInt(url.searchParams.get('limit') || '10')
    const db = getServiceClient()

    if (action === 'debug') {
      // Debug: try one call and return full error chain
      const { data: calls } = await db.from('call_history')
        .select('id, raw_data').is('transcript', null)
        .not('raw_data', 'is', null).limit(1)
      if (!calls?.length) return NextResponse.json({ error: 'No calls to debug' })
      const call = calls[0]
      const rd = call.raw_data as any
      const info: any = {
        id: call.id,
        has_recording_id: !!rd?.recording_id,
        recording_id: rd?.recording_id,
        has_mp3: !!rd?.download_urls?.mp3,
        has_wav: !!rd?.download_urls?.wav,
        mp3_url_prefix: rd?.download_urls?.mp3?.substring(0, 60),
        wav_url_prefix: rd?.download_urls?.wav?.substring(0, 60),
        has_openai_key: !!OPENAI_API_KEY,
        openai_key_prefix: OPENAI_API_KEY?.substring(0, 8),
        has_telnyx_key: !!TELNYX_API_KEY,
      }
      // Try download
      const dlUrl = rd?.download_urls?.mp3 || rd?.download_urls?.wav
      if (dlUrl) {
        try {
          const dlRes = await fetch(dlUrl)
          info.download_status = dlRes.status
          info.download_ok = dlRes.ok
          if (dlRes.ok) {
            const buf = await dlRes.arrayBuffer()
            info.download_size = buf.byteLength
          }
        } catch (e: any) { info.download_error = e.message }
      }
      // Try Whisper
      if (dlUrl) {
        const whisperResult = await transcribeViaWhisper(dlUrl)
        info.whisper_result = whisperResult
      }
      // Try fresh URL from Telnyx
      if (rd?.recording_id) {
        try {
          const tRes = await fetch(`${TELNYX_BASE}/recordings/${rd.recording_id}`, {
            headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
          })
          info.telnyx_api_status = tRes.status
          if (tRes.ok) {
            const tData = await tRes.json()
            info.telnyx_fresh_mp3 = tData.data?.download_urls?.mp3?.substring(0, 60)
          } else {
            info.telnyx_api_error = await tRes.text()
          }
        } catch (e: any) { info.telnyx_api_error = e.message }
      }
      return NextResponse.json(info)
    }

    if (action === 'batch') {
      const { data: calls, error } = await db.from('call_history')
        .select('id, call_id, raw_data, transcript')
        .is('transcript', null).not('raw_data', 'is', null)
        .order('start_time', { ascending: false }).limit(limit)
      if (error || !calls?.length) return NextResponse.json({ success: true, processed: 0, remaining: 0, error: error?.message })

      let transcribed = 0, scored = 0
      const results: any[] = []

      for (const call of calls) {
        const rd = call.raw_data as any
        const dlUrl = rd?.download_urls?.mp3 || rd?.download_urls?.wav
        if (!dlUrl) { results.push({ id: call.id, status: 'no_download_url' }); continue }

        // Go straight to Whisper with stored URL
        const { text: transcript, error: whisperErr } = await transcribeViaWhisper(dlUrl)

        if (transcript) {
          const scoring = await scoreLeadFromTranscript(transcript)
          await db.from('call_history').update({
            transcript, lead_score: scoring.lead_score, lead_reasoning: scoring.lead_reasoning,
            service_needed: scoring.service_needed, caller_sentiment: scoring.caller_sentiment,
            key_quotes: scoring.key_quotes, transcribed_at: new Date().toISOString(),
          }).eq('id', call.id)
          transcribed++; scored++
          results.push({ id: call.id, lead_score: scoring.lead_score, service: scoring.service_needed })
        } else {
          await db.from('call_history').update({
            transcript: '[transcription_failed]', transcribed_at: new Date().toISOString(),
          }).eq('id', call.id)
          results.push({ id: call.id, status: 'failed', error: whisperErr })
        }
      }

      const { count } = await db.from('call_history').select('id', { count: 'exact', head: true }).is('transcript', null).not('raw_data', 'is', null)
      return NextResponse.json({ success: true, processed: calls.length, transcribed, scored, remaining: count || 0, results })
    }

    if (action === 'retry-failed') {
      const { data, error } = await db.from('call_history')
        .update({ transcript: null, transcribed_at: null })
        .eq('transcript', '[transcription_failed]').select('id')
      return NextResponse.json({ success: !error, reset: data?.length || 0 })
    }

    if (action === 'stats') {
      const { count: total } = await db.from('call_history').select('id', { count: 'exact', head: true })
      const { count: withTranscript } = await db.from('call_history').select('id', { count: 'exact', head: true }).not('transcript', 'is', null).neq('transcript', '[transcription_failed]')
      const { count: withScore } = await db.from('call_history').select('id', { count: 'exact', head: true }).not('lead_score', 'is', null).neq('lead_score', 'unknown')
      const { count: hot } = await db.from('call_history').select('id', { count: 'exact', head: true }).eq('lead_score', 'hot')
      const { count: warm } = await db.from('call_history').select('id', { count: 'exact', head: true }).eq('lead_score', 'warm')
      const { count: cold } = await db.from('call_history').select('id', { count: 'exact', head: true }).eq('lead_score', 'cold')
      const { count: pending } = await db.from('call_history').select('id', { count: 'exact', head: true }).is('transcript', null).not('raw_data', 'is', null)
      const { count: failed } = await db.from('call_history').select('id', { count: 'exact', head: true }).eq('transcript', '[transcription_failed]')
      return NextResponse.json({ total, withTranscript, withScore, hot, warm, cold, pending, failed })
    }

    return NextResponse.json({ error: 'Use: batch, debug, retry-failed, stats' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return POST(req) }
