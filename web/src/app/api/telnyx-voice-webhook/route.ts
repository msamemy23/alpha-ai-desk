/**
 * Telnyx Voice Webhook — fully inline AI voice agent.
 * State in Supabase (persists across serverless instances).
 * Voice: Telnyx.Natural.abbie (valid, documented Telnyx Natural female voice)
 * Dual-channel recording enabled.
 */

import { NextRequest, NextResponse } from 'next/server'

const TELNYX_API_KEY     = process.env.TELNYX_API_KEY     || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_MODEL           = process.env.AI_MODEL           || 'deepseek/deepseek-v3-1.5'
const SUPABASE_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const TELNYX_BASE        = 'https://api.telnyx.com/v2'

// CONFIRMED VALID voice — Telnyx.Natural.abbie (per official Telnyx docs, March 2026)
// WARNING: 'Telnyx.Natural.astra' does NOT exist — astra is a Rime voice (Rime.ArcanaV3.astra)
// Fallback: 'female' is the basic Telnyx TTS voice (always works)
const VOICE          = 'Telnyx.Natural.abbie'
const VOICE_FALLBACK = 'female'

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function dbGet(callId: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(callId)}&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  )
  const rows = await r.json()
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}

async function dbUpdate(callId: string, patch: Record<string, unknown>) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(callId)}`,
    {
      method:  'PATCH',
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(patch),
    }
  )
}

// ── Telnyx call actions ───────────────────────────────────────────────────────
async function telnyxPost(path: string, body: Record<string, unknown>): Promise<{ok: boolean; data: unknown}> {
  const r = await fetch(`${TELNYX_BASE}${path}`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json()
  return { ok: r.ok, data }
}

/**
 * Speak text on the call.
 * Tries VOICE first, falls back to VOICE_FALLBACK if it fails.
 * Returns true if speak succeeded, false if failed.
 */
async function speak(callId: string, text: string): Promise<boolean> {
  const clean = text.replace(/"/g, "'").slice(0, 3000)

  // Primary voice
  const result = await telnyxPost(`/calls/${callId}/actions/speak`, {
    payload:      clean,
    payload_type: 'text',
    voice:        VOICE,
  })

  if (result.ok) return true

  // Fallback to basic voice if primary fails
  console.error(`[speak] Primary voice ${VOICE} failed:`, JSON.stringify(result.data))
  const fallback = await telnyxPost(`/calls/${callId}/actions/speak`, {
    payload:      clean,
    payload_type: 'text',
    voice:        VOICE_FALLBACK,
  })

  if (fallback.ok) {
    console.log(`[speak] Fallback voice ${VOICE_FALLBACK} succeeded`)
    return true
  }

  console.error(`[speak] Fallback voice also failed:`, JSON.stringify(fallback.data))
  return false
}

// ── OpenRouter AI ─────────────────────────────────────────────────────────────
async function aiChat(messages: Array<{role: string; content: string}>, maxTokens = 150): Promise<string> {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: maxTokens, temperature: 0.7 }),
    })
    const d = await r.json()
    return d?.choices?.[0]?.message?.content?.trim() || ''
  } catch { return '' }
}

// ── Webhook handler ───────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body      = await req.json()
  const eventType = body?.data?.event_type as string
  const payload   = body?.data?.payload    as Record<string, unknown>
  const callId    = payload?.call_control_id as string

  // ── call.answered ───────────────────────────────────────────────────────────
  if (eventType === 'call.answered') {
    // Decode task from client_state
    let task = 'Have a helpful conversation'
    const cs = payload?.client_state as string
    if (cs) {
      try { task = JSON.parse(Buffer.from(cs, 'base64').toString()).task || task } catch { /* ok */ }
    }

    await dbUpdate(callId, { status: 'active', task, greeted: false, processing: true })

    // Start transcription
    await telnyxPost(`/calls/${callId}/actions/transcription_start`, {
      language:             'en',
      transcription_engine: 'B',
      transcription_tracks: 'inbound',
    })

    // Generate greeting with AI
    const greeting = await aiChat([{
      role:    'user',
      content: `You just called someone on behalf of Alpha International Auto Center (Houston TX auto shop).
Task: ${task}
Write a SHORT natural greeting (1-2 sentences max). Warm, friendly, sounds like a real person. Text only.`,
    }], 60) || "Hey there! This is Alpha International Auto Center calling. How are you doing today?"

    // Save transcript
    await dbUpdate(callId, {
      status:       'active',
      greeted:      true,
      processing:   true,
      transcript:   [{ speaker: 'ai', text: greeting }],
      conversation: [{ role: 'assistant', content: greeting }],
    })

    // Speak — if it fails, unlock processing so the call isn't stuck
    const spokOk = await speak(callId, greeting)
    if (!spokOk) {
      await dbUpdate(callId, { processing: false })
    }

    return NextResponse.json('OK')
  }

  // ── call.transcription ──────────────────────────────────────────────────────
  if (eventType === 'call.transcription') {
    const td      = payload?.transcription_data as Record<string, unknown>
    const text    = (td?.transcript as string || '').trim()
    const isFinal = td?.is_final as boolean
    if (!text || !isFinal) return NextResponse.json('OK')

    const state = await dbGet(callId)
    if (!state || state.processing) return NextResponse.json('OK')

    // Supabase returns JSONB as objects already; guard for legacy string format
    const transcript: Array<{speaker: string; text: string}> =
      Array.isArray(state.transcript) ? state.transcript
      : typeof state.transcript === 'string' ? JSON.parse(state.transcript || '[]')
      : []
    const conversation: Array<{role: string; content: string}> =
      Array.isArray(state.conversation) ? state.conversation
      : typeof state.conversation === 'string' ? JSON.parse(state.conversation || '[]')
      : []

    transcript.push({ speaker: 'customer', text })
    await dbUpdate(callId, { processing: true, transcript })

    const system = `You are a phone AI agent calling on behalf of Alpha International Auto Center (auto repair shop, Houston TX, 10710 S Main St, (713) 663-6979).

TASK: ${state.task}

RULES:
- Live phone call. 1-3 sentences MAX. Natural, warm, human.
- When the task is complete, say: "Thank you so much, have a great day!"
- Never reveal you are an AI unless directly asked.`

    const messages = [
      { role: 'system', content: system },
      ...conversation.slice(-8),
      { role: 'user',   content: text },
    ]

    const reply = await aiChat(messages, 120)
    if (reply) {
      transcript.push({ speaker: 'ai', text: reply })
      conversation.push({ role: 'assistant', content: reply })
      await dbUpdate(callId, { transcript, conversation })

      const spokOk = await speak(callId, reply)
      if (!spokOk) {
        // Speak failed — unlock immediately so next transcription can still go through
        await dbUpdate(callId, { processing: false })
      }
    } else {
      await dbUpdate(callId, { processing: false })
    }

    return NextResponse.json('OK')
  }

  // ── call.speak.ended — unlock for next utterance ────────────────────────────
  if (eventType === 'call.speak.ended') {
    await dbUpdate(callId, { processing: false })
    return NextResponse.json('OK')
  }

  // ── call.recording.saved — store recording URL ──────────────────────────────
  if (eventType === 'call.recording.saved') {
    // Telnyx sends recording_urls as { mp3: "https://..." } or just a string
    const urls = payload?.recording_urls
    let recordingUrl = ''
    if (typeof urls === 'string') {
      recordingUrl = urls
    } else if (urls && typeof urls === 'object') {
      recordingUrl = (urls as Record<string, string>).mp3
        || (urls as Record<string, string>).wav
        || Object.values(urls as Record<string, string>)[0]
        || ''
    }
    // Also check top-level payload for public_url (newer Telnyx API)
    if (!recordingUrl && payload?.public_url) {
      recordingUrl = payload.public_url as string
    }
    if (recordingUrl) await dbUpdate(callId, { recording_url: recordingUrl })
    return NextResponse.json('OK')
  }

  // ── call.hangup — generate summary ─────────────────────────────────────────
  if (eventType === 'call.hangup') {
    const state = await dbGet(callId)
    if (!state) return NextResponse.json('OK')

    await dbUpdate(callId, { status: 'ended' })

    const transcript: Array<{speaker: string; text: string}> =
      Array.isArray(state.transcript) ? state.transcript
      : typeof state.transcript === 'string' ? JSON.parse(state.transcript || '[]')
      : []

    if (transcript.length > 0) {
      const lines   = transcript.map(t => `${t.speaker === 'ai' ? 'AI' : 'Person'}: ${t.text}`).join('\n')
      const summary = await aiChat([{
        role:    'user',
        content: `Summarize this call in bullet points.\nTask: ${state.task}\n\nTranscript:\n${lines}`,
      }], 300)
      await dbUpdate(callId, { summary: summary || `Call ended. ${transcript.length} exchanges.`, status: 'ended' })
    }

    return NextResponse.json('OK')
  }

  return NextResponse.json('OK')
}
