import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

export const maxDuration = 300

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'

async function getRecordingTranscription(recordingId: string): Promise<string | null> {
  try {
    // Check if Telnyx already has a transcription
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
      headers: {
        'Authorization': `Bearer ${TELNYX_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ language: 'en' }),
    })
    if (!createRes.ok) return null
    // Wait and poll for transcription
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 5000))
      const pollRes = await fetch(`${TELNYX_BASE}/recordings/${recordingId}/transcriptions`, {
        headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
      })
      if (pollRes.ok) {
        const pollData = await pollRes.json()
        if (pollData.data?.length > 0 && pollData.data[0].text) {
          return pollData.data[0].text
        }
      }
    }
    return null
  } catch (e) {
    console.error('Transcription error:', e)
    return null
  }
}

async function transcribeViaWhisper(downloadUrl: string): Promise<string | null> {
  try {
    if (!OPENAI_API_KEY) return null
    // Download the recording
    const audioRes = await fetch(downloadUrl, {
      headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}` },
    })
    if (!audioRes.ok) return null
    const audioBlob = await audioRes.blob()
    const formData = new FormData()
    formData.append('file', audioBlob, 'recording.wav')
    formData.append('model', 'whisper-1')
    formData.append('language', 'en')
    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: formData,
    })
    if (!whisperRes.ok) return null
    const whisperData = await whisperRes.json()
    return whisperData.text || null
  } catch (e) {
    console.error('Whisper error:', e)
    return null
  }
}

async function scoreLeadFromTranscript(transcript: string): Promise<{
  lead_score: string
  lead_reasoning: string
  service_needed: string
  caller_sentiment: string
  key_quotes: string
}> {
  if (!OPENAI_API_KEY || !transcript || transcript.length < 20) {
    return { lead_score: 'unknown', lead_reasoning: 'Transcript too short', service_needed: '', caller_sentiment: '', key_quotes: '' }
  }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `You are an AI assistant for Alpha International Auto Center, an auto repair shop in Houston TX. Analyze call transcripts and score leads. Respond in JSON only with these fields:
- lead_score: "hot" (ready to book/bring car in/asked about availability), "warm" (interested but shopping around/asking prices), or "cold" (spam/wrong number/existing customer checking status/robocall)
- lead_reasoning: Brief explanation of why this score (1-2 sentences)
- service_needed: What auto service they need (e.g., "brake pads", "oil change", "transmission repair", "unknown")
- caller_sentiment: "positive", "neutral", "frustrated", or "spam"
- key_quotes: 1-2 important quotes from the caller that reveal their intent (max 50 words total)`
        }, {
          role: 'user',
          content: `Analyze this auto repair shop call transcript:\n\n${transcript.substring(0, 3000)}`
        }],
        temperature: 0.3,
        max_tokens: 500,
      }),
    })
    if (!res.ok) return { lead_score: 'unknown', lead_reasoning: 'AI scoring failed', service_needed: '', caller_sentiment: '', key_quotes: '' }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || ''
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        lead_score: parsed.lead_score || 'unknown',
        lead_reasoning: parsed.lead_reasoning || '',
        service_needed: parsed.service_needed || '',
        caller_sentiment: parsed.caller_sentiment || '',
        key_quotes: parsed.key_quotes || '',
      }
    }
    return { lead_score: 'unknown', lead_reasoning: content, service_needed: '', caller_sentiment: '', key_quotes: '' }
  } catch (e: any) {
    return { lead_score: 'unknown', lead_reasoning: e.message, service_needed: '', caller_sentiment: '', key_quotes: '' }
  }
}

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action') || 'batch'
    const limit = parseInt(url.searchParams.get('limit') || '10')
    const db = getServiceClient()

    if (action === 'batch') {
      // Get calls that have recordings but no transcript
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

      let transcribed = 0
      let scored = 0
      const results: any[] = []

      for (const call of calls) {
        const rawData = call.raw_data as any
        if (!rawData?.recording_id && !rawData?.download_urls) continue

        let transcript: string | null = null

        // Try Telnyx transcription first
        if (rawData.recording_id) {
          transcript = await getRecordingTranscription(rawData.recording_id)
        }

        // Fallback to Whisper if Telnyx fails
        if (!transcript && rawData.download_urls?.wav) {
          transcript = await transcribeViaWhisper(rawData.download_urls.wav)
        }
        if (!transcript && rawData.download_urls?.mp3) {
          transcript = await transcribeViaWhisper(rawData.download_urls.mp3)
        }

        if (transcript) {
          // Score the lead
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

          if (!updateErr) {
            transcribed++
            scored++
            results.push({ id: call.id, lead_score: scoring.lead_score, service: scoring.service_needed })
          }
        } else {
          // Mark as attempted so we don't retry forever
          await db.from('call_history').update({
            transcript: '[transcription_failed]',
            transcribed_at: new Date().toISOString(),
          }).eq('id', call.id)
          results.push({ id: call.id, status: 'transcription_failed' })
        }
      }

      // Count remaining
      const { count } = await db.from('call_history').select('id', { count: 'exact', head: true }).is('transcript', null).not('raw_data', 'is', null)

      return NextResponse.json({
        success: true,
        processed: calls.length,
        transcribed,
        scored,
        remaining: count || 0,
        results,
      })
    }

    if (action === 'score-only') {
      // Re-score calls that have transcripts but no lead_score
      const { data: calls } = await db
        .from('call_history')
        .select('id, transcript')
        .is('lead_score', null)
        .not('transcript', 'is', null)
        .neq('transcript', '[transcription_failed]')
        .limit(limit)

      if (!calls?.length) return NextResponse.json({ success: true, scored: 0 })

      let scored = 0
      for (const call of calls) {
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

    if (action === 'stats') {
      const { count: total } = await db.from('call_history').select('id', { count: 'exact', head: true })
      const { count: withTranscript } = await db.from('call_history').select('id', { count: 'exact', head: true }).not('transcript', 'is', null).neq('transcript', '[transcription_failed]')
      const { count: withScore } = await db.from('call_history').select('id', { count: 'exact', head: true }).not('lead_score', 'is', null).neq('lead_score', 'unknown')
      const { count: hot } = await db.from('call_history').select('id', { count: 'exact', head: true }).eq('lead_score', 'hot')
      const { count: warm } = await db.from('call_history').select('id', { count: 'exact', head: true }).eq('lead_score', 'warm')
      const { count: cold } = await db.from('call_history').select('id', { count: 'exact', head: true }).eq('lead_score', 'cold')
      const { count: pending } = await db.from('call_history').select('id', { count: 'exact', head: true }).is('transcript', null).not('raw_data', 'is', null)
      return NextResponse.json({ total, withTranscript, withScore, hot, warm, cold, pending })
    }

    return NextResponse.json({ error: 'Unknown action. Use: batch, score-only, stats' }, { status: 400 })
  } catch (e: any) {
    console.error('Transcribe error:', e)
    return NextResponse.json({ error: e.message || 'Transcription failed' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) { return POST(req) }
