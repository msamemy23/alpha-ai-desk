import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

export const maxDuration = 300

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-r1'
const TELNYX_BASE = 'https://api.telnyx.com/v2'


// Transcribe audio via OpenRouter (audio-capable model)
async function transcribeViaOpenRouter(downloadUrl: string): Promise<string | null> {
  try {
    if (!OPENROUTER_API_KEY) return null
    let audioRes = await fetch(downloadUrl)
    if (!audioRes.ok) audioRes = await fetch(downloadUrl, { headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` } })
    if (!audioRes.ok) return null
    const buf = await audioRes.arrayBuffer()
    const base64Audio = Buffer.from(buf).toString('base64')
    const dataUrl = `data:audio/wav;base64,${base64Audio}`
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://alpha-ai-desk.vercel.app',
        'X-Title': 'Alpha AI Desk',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini-audio-preview',
        messages: [{
          role: 'user',
          content: [
            { type: 'input_audio', input_audio: { data: base64Audio, format: 'wav' } },
            { type: 'text', text: 'Transcribe this audio recording word for word. Return ONLY the transcription text, nothing else.' }
          ]
        }],
        max_tokens: 4000,
      }),
    })
    if (!res.ok) {
      const errText = await res.text()
      console.error('OpenRouter transcription error:', res.status, errText)
      return null
    }
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content?.trim()
    return text && text.length > 5 ? text : null
  } catch (e: any) {
    console.error('transcribeViaOpenRouter error:', e.message)
    return null
  }
}

// Score lead using OpenRouter DeepSeek
async function scoreLeadFromTranscript(transcript: string): Promise<{
  lead_score: string; lead_reasoning: string; service_needed: string;
  caller_sentiment: string; key_quotes: string;
}> {
  const empty = { lead_score: 'unknown', lead_reasoning: '', service_needed: '', caller_sentiment: '', key_quotes: '' }
  if (!OPENROUTER_API_KEY || !transcript || transcript.length < 20) return { ...empty, lead_reasoning: 'Transcript too short' }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://alpha-ai-desk.vercel.app',
        'X-Title': 'Alpha AI Desk'
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: 'You are an AI for Alpha International Auto Center (Houston TX auto shop). Analyze call transcripts and return JSON only with these fields: lead_score (hot/warm/cold), lead_reasoning (1-2 sentences), service_needed (e.g. oil change, transmission, brakes), caller_sentiment (positive/neutral/frustrated/spam), key_quotes (short memorable quote from caller). Hot = ready to book/urgent repair. Warm = interested but not committed. Cold = price shopping/wrong number/spam.'
        }, {
          role: 'user',
          content: `Analyze this call transcript from Alpha International Auto Center and return JSON:\n\n${transcript.substring(0, 3000)}`
        }],
        temperature: 0.1,
        max_tokens: 600,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) return { ...empty, lead_reasoning: `AI error: ${res.status}` }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    const jsonStr = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    const parsed = JSON.parse(jsonStr || '{}')
    return {
      lead_score: parsed.lead_score || 'unknown',
      lead_reasoning: parsed.lead_reasoning || '',
      service_needed: parsed.service_needed || '',
      caller_sentiment: parsed.caller_sentiment || '',
      key_quotes: parsed.key_quotes || '',
    }
  } catch (e: any) { return { ...empty, lead_reasoning: e.message } }
}

// Fetch transcription from Telnyx
async function getTelnyxTranscription(recordingId: string): Promise<{ text: string | null; error?: string }> {
  try {
    const res = await fetch(`${TELNYX_BASE}/recordings/${recordingId}/transcriptions`, {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
    })
    if (!res.ok) return { text: null, error: `TELNYX_${res.status}` }
    const data = await res.json()
    const transcription = data.data?.[0]
    if (!transcription) return { text: null, error: 'NO_TRANSCRIPTION' }
    if (transcription.status !== 'completed') return { text: null, error: `STATUS_${transcription.status}` }
    return { text: transcription.transcription_text || null }
  } catch (e: any) {
    return { text: null, error: e.message }
  }
}

// Request Telnyx to transcribe a recording
async function requestTelnyxTranscription(recordingId: string): Promise<boolean> {
  try {
    const res = await fetch(`${TELNYX_BASE}/recordings/${recordingId}/transcriptions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ language_code: 'en-US' }),
    })
    return res.ok || res.status === 409
  } catch { return false }
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'batch'
    const limit = parseInt(url.searchParams.get('limit') || '10')
    const db = getServiceClient()

    if (action === 'debug') {
      const { data: calls } = await db.from('call_history')
        .select('id, call_id, raw_data').is('transcript', null)
        .not('raw_data', 'is', null).limit(1)
      if (!calls?.length) return NextResponse.json({ error: 'No calls to debug' })
      const call = calls[0]
      const rd = call.raw_data as any
      return NextResponse.json({
        id: call.id,
        has_recording_id: !!rd?.recording_id,
        recording_id: rd?.recording_id,
        has_mp3: !!rd?.download_urls?.mp3,
        has_wav: !!rd?.download_urls?.wav,
        has_openrouter_key: !!OPENROUTER_API_KEY,
        openrouter_key_prefix: OPENROUTER_API_KEY?.substring(0, 8),
        ai_model: AI_MODEL,
        has_telnyx_key: !!TELNYX_API_KEY,
        raw_data_keys: rd ? Object.keys(rd) : [],
      })
    }

    if (action === 'score') {
      const { data: calls } = await db.from('call_history')
        .select('id, transcript')
        .not('transcript', 'is', null)
        .neq('transcript', '[transcription_failed]')
        .is('lead_score', null)
        .limit(limit)
      if (!calls?.length) return NextResponse.json({ success: true, scored: 0, message: 'No calls need scoring' })
      let scored = 0
      for (const call of calls) {
        if (!call.transcript) continue
        const scoring = await scoreLeadFromTranscript(call.transcript)
        await db.from('call_history').update({
          lead_score: scoring.lead_score,
          lead_reasoning: scoring.lead_reasoning,
          service_needed: scoring.service_needed,
          caller_sentiment: scoring.caller_sentiment,
          key_quotes: scoring.key_quotes,
        }).eq('id', call.id)
        scored++
      }
      return NextResponse.json({ success: true, scored })
    }

    if (action === 'batch') {
      const { data: calls, error } = await db.from('call_history')
        .select('id, call_id, raw_data, transcript')
        .is('transcript', null)
        .not('raw_data', 'is', null)
        .order('start_time', { ascending: false })
        .limit(limit)
      if (error || !calls?.length) return NextResponse.json({ success: true, processed: 0, remaining: 0, error: error?.message })
      let transcribed = 0, scored = 0
      const results: any[] = []
      for (const call of calls) {
        const rd = call.raw_data as any
        const recordingId = rd?.recording_id
              // Try download URL first via OpenRouter (most reliable)
        const wavUrl = rd?.download_urls?.wav || rd?.download_urls?.mp3
        let transcript: string | null = null
        let transcriptError: string | undefined
        if (wavUrl) {
          transcript = await transcribeViaOpenRouter(wavUrl)
        }
        // Fallback: try Telnyx native transcription
        if (!transcript && recordingId) {
          const { text, error: telErr } = await getTelnyxTranscription(recordingId)
          if (text) transcript = text
          else transcriptError = telErr
        }
        if (!transcript && !wavUrl && !recordingId) {
          results.push({ id: call.id, status: 'no_audio_source' })
          continue
        }
                if (!transcript) {
          if (recordingId) await requestTelnyxTranscription(recordingId)
          results.push({ id: call.id, status: 'transcription_pending', error: transcriptError })
          continue
        }
        }
        if (transcript) {
          const scoring = await scoreLeadFromTranscript(transcript)
          await db.from('call_history').update({
            transcript,
            lead_score: scoring.lead_score,
            lead_reasoning: scoring.lead_reasoning,
            service_needed: scoring.service_needed,
            caller_sentiment: scoring.caller_sentiment,
            key_quotes: scoring.key_quotes,
            transcribed_at: new Date().toISOString(),
          }).eq('id', call.id)
          transcribed++; scored++
          results.push({ id: call.id, lead_score: scoring.lead_score, service: scoring.service_needed })
        } else {
          results.push({ id: call.id, status: 'transcription_pending', error: transcriptError })
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

    return NextResponse.json({ error: 'Use: batch, score, debug, retry-failed, stats' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return POST(req) }
