import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

export const maxDuration = 300

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'

// Get fresh download URL from Telnyx API (stored S3 URLs expire)
async function getFreshDownloadUrl(recordingId: string): Promise<string | null> {
  try {
    const res = await fetch(`${TELNYX_BASE}/recordings/${recordingId}`, {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.download_urls?.mp3 || data.data?.download_urls?.wav || null
  } catch (e) {
    console.error('Failed to get fresh download URL:', e)
    return null
  }
}

async function getRecordingTranscription(recordingId: string): Promise<string | null> {
  try {
    const res = await fetch(`${TELNYX_BASE}/recordings/${recordingId}/transcriptions`, {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
    })
    if (res.ok) {
      const data = await res.json()
      if (data.data?.length > 0 && data.data[0].text) {
        return data.data[0].text
      }
    }
    // Request new transcription
    const createRes = await fetch(`${TELNYX_BASE}/recordings/${recordingId}/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: 'en' }),
    })
    if (!createRes.ok) return null
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const pollRes = await fetch(`${TELNYX_BASE}/recordings/${recordingId}/transcriptions`, {
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
      })
      if (pollRes.ok) {
        const pollData = await pollRes.json()
        if (pollData.data?.length > 0 && pollData.data[0].text) return pollData.data[0].text
      }
    }
    return null
  } catch (e) {
    console.error('Telnyx transcription error:', e)
    return null
  }
}

async function transcribeViaWhisper(downloadUrl: string): Promise<string | null> {
  try {
    if (!OPENAI_API_KEY) return null
    // Try without auth first (fresh URLs), then with Telnyx auth
    let audioRes = await fetch(downloadUrl)
    if (!audioRes.ok) {
      audioRes = await fetch(downloadUrl, {
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
      })
    }
    if (!audioRes.ok) {
      console.error('Download failed:', audioRes.status, downloadUrl.substring(0, 80))
      return null
    }
    const audioBuffer = await audioRes.arrayBuffer()
    if (audioBuffer.byteLength < 1000) {
      console.error('Audio too small:', audioBuffer.byteLength)
      return null
    }
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mp3' })
    const formData = new FormData()
    formData.append('file', audioBlob, 'recording.mp3')
    formData.append('model', 'whisper-1')
    formData.append('language', 'en')
    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    })
    if (!whisperRes.ok) {
      console.error('Whisper error:', whisperRes.status, await whisperRes.text())
      return null
    }
    const whisperData = await whisperRes.json()
    return whisperData.text || null
  } catch (e) {
    console.error('Whisper error:', e)
    return null
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
          content: `You are an AI assistant for Alpha International Auto Center, an auto repair shop in Houston TX. Analyze call transcripts and score leads. Respond in JSON only:\n- lead_score: "hot" (ready to book/bring car in), "warm" (interested/asking prices), "cold" (spam/wrong number/robocall)\n- lead_reasoning: Brief explanation (1-2 sentences)\n- service_needed: What service they need\n- caller_sentiment: "positive", "neutral", "frustrated", or "spam"\n- key_quotes: 1-2 important caller quotes (max 50 words)`
        }, {
          role: 'user', content: `Analyze this call transcript:\n\n${transcript.substring(0, 3000)}`
        }],
        temperature: 0.3, max_tokens: 500, response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) return { ...empty, lead_reasoning: 'AI scoring failed' }
    const data = await res.json()
    const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    return {
      lead_score: parsed.lead_score || 'unknown',
      lead_reasoning: parsed.lead_reasoning || '',
      service_needed: parsed.service_needed || '',
      caller_sentiment: parsed.caller_sentiment || '',
      key_quotes: parsed.key_quotes || '',
    }
  } catch (e: any) {
    return { ...empty, lead_reasoning: e.message }
  }
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'batch'
    const limit = parseInt(url.searchParams.get('limit') || '10')
    const db = getServiceClient()

    if (action === 'batch') {
      const { data: calls, error } = await db
        .from('call_history')
        .select('id, call_id, raw_data, transcript')
        .is('transcript', null)
        .not('raw_data', 'is', null)
        .order('start_time', { ascending: false })
        .limit(limit)

      if (error || !calls?.length) {
        return NextResponse.json({ success: true, processed: 0, remaining: 0, error: error?.message })
      }

      let transcribed = 0, scored = 0
      const results: any[] = []

      for (const call of calls) {
        const rawData = call.raw_data as any
        const recordingId = rawData?.recording_id
        if (!recordingId) {
          results.push({ id: call.id, status: 'no_recording_id' })
          continue
        }

        let transcript: string | null = null

        // Try Telnyx native transcription first
        transcript = await getRecordingTranscription(recordingId)

        // Fallback: get FRESH download URL from Telnyx API then Whisper
        if (!transcript) {
          const freshUrl = await getFreshDownloadUrl(recordingId)
          if (freshUrl) {
            transcript = await transcribeViaWhisper(freshUrl)
          }
        }

        if (transcript) {
          const scoring = await scoreLeadFromTranscript(transcript)
          const { error: updateErr } = await db.from('call_history').update({
            transcript,
            lead_score: scoring.lead_score,
            lead_reasoning: scoring.lead_reasoning,
            service_needed: scoring.service_needed,
            caller_sentiment: scoring.caller_sentiment,
            key_quotes: scoring.key_quotes,
            transcribed_at: new Date().toISOString(),
          }).eq('id', call.id)
          if (!updateErr) { transcribed++; scored++ }
          results.push({ id: call.id, lead_score: scoring.lead_score, service: scoring.service_needed })
        } else {
          await db.from('call_history').update({
            transcript: '[transcription_failed]',
            transcribed_at: new Date().toISOString(),
          }).eq('id', call.id)
          results.push({ id: call.id, status: 'transcription_failed' })
        }
      }

      const { count } = await db.from('call_history').select('id', { count: 'exact', head: true }).is('transcript', null).not('raw_data', 'is', null)
      return NextResponse.json({ success: true, processed: calls.length, transcribed, scored, remaining: count || 0, results })
    }

    if (action === 'retry-failed') {
      const { data: updated, error } = await db
        .from('call_history')
        .update({ transcript: null, transcribed_at: null })
        .eq('transcript', '[transcription_failed]')
        .select('id')
      return NextResponse.json({ success: !error, reset: updated?.length || 0 })
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

    return NextResponse.json({ error: 'Use: batch, retry-failed, stats' }, { status: 400 })
  } catch (e: any) {
    console.error('Transcribe error:', e)
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return POST(req) }
