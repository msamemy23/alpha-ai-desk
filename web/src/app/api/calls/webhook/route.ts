/**
 * Inbound Call Handler — Alpha International Auto Center
 * Fires when someone calls (713) 663-6979.
 * Acts as an AI receptionist: answers, converses, takes messages.
 * Completely separate from the outbound AI agent (telnyx-voice-webhook).
 */

import { NextRequest, NextResponse } from 'next/server'

const TELNYX_API_KEY     = process.env.TELNYX_API_KEY     || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_MODEL           = process.env.AI_MODEL           || 'deepseek/deepseek-v3.2'
const SUPABASE_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const TELNYX_BASE        = 'https://api.telnyx.com/v2'
const VOICE              = 'Telnyx.Natural.abbie'
const VOICE_FALLBACK     = 'female'

// ── Supabase helpers ───────────────────────────────────────────────────────────
async function dbGet(callId: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(callId)}&limit=1`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  )
  const rows = await r.json()
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}

async function dbUpsert(callId: string, patch: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/ai_calls`, {
    method:  'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify({ id: callId, ...patch }),
  })
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

// ── Telnyx helpers ─────────────────────────────────────────────────────────────
async function telnyxPost(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${TELNYX_BASE}${path}`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: r.ok, data: await r.json() }
}

async function speak(callId: string, text: string): Promise<boolean> {
  const clean = text.replace(/"/g, "'").slice(0, 3000)
  const r = await telnyxPost(`/calls/${callId}/actions/speak`, {
    payload: clean, payload_type: 'text', voice: VOICE,
  })
  if (r.ok) return true
  const fb = await telnyxPost(`/calls/${callId}/actions/speak`, {
    payload: clean, payload_type: 'text', voice: VOICE_FALLBACK,
  })
  return fb.ok
}

async function aiChat(messages: Array<{role: string; content: string}>, maxTokens = 150): Promise<string> {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: maxTokens, temperature: 0.7 }),
    })
    const d = await r.json()
    let text = d?.choices?.[0]?.message?.content?.trim() || ''
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    text = text.replace(/^["']|["']$/g, '').trim()
    text = text.replace(/\([^)]*\)/g, '').trim()
    return text
  } catch { return '' }
}

// ── Main webhook handler ───────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const body      = await req.json()
  const eventType = body?.data?.event_type as string
  const payload   = body?.data?.payload    as Record<string, unknown>
  const callId    = payload?.call_control_id as string

  // ── call.initiated — inbound call ringing ────────────────────────────────────
  if (eventType === 'call.initiated') {
    const direction = payload?.direction as string
    if (direction === 'incoming') {
      // Answer the call immediately
      await telnyxPost(`/calls/${callId}/actions/answer`, {})
    }
    return NextResponse.json('OK')
  }

  // ── call.answered — call connected, greet the caller ─────────────────────────
  if (eventType === 'call.answered') {
    const from = (payload?.from as string) || 'unknown'

    // Create record in Supabase (only columns that exist in the table)
    await dbUpsert(callId, {
      task:       `Inbound call from ${from}. Act as AI receptionist for Alpha International Auto Center.`,
      status:     'active',
      started_at: Date.now(),
      greeted:    false,
      processing: true,
    })

    // Start transcription — 'both' for reliable caller audio capture
    await telnyxPost(`/calls/${callId}/actions/transcription_start`, {
      language:             'en',
      transcription_engine: 'B',
      transcription_tracks: 'both',
      interim_results:      false,
    })

    // Start recording
    await telnyxPost(`/calls/${callId}/actions/record_start`, {
      format:   'mp3',
      channels: 'dual',
    })

    // Generate greeting
    const greeting = await aiChat([{
      role:    'user',
      content: `You are the receptionist for Alpha International Auto Center, an auto repair shop at 10710 S Main St, Houston TX 77025.
A customer is calling. Write a SHORT warm greeting (1-2 sentences). Plain conversational speech only - no markdown, no asterisks, no quotes around the text.`,
    }], 60) || "Thank you for calling Alpha International Auto Center, how can I help you today?"

    await dbUpdate(callId, {
      greeted:      true,
      transcript:   [{ speaker: 'ai', text: greeting }],
      conversation: [{ role: 'assistant', content: greeting }],
    })

    await speak(callId, greeting)

    // Unlock — do NOT rely on call.speak.ended
    await dbUpdate(callId, { processing: false })

    return NextResponse.json('OK')
  }

  // ── call.transcription — customer spoke, AI responds ─────────────────────────
  if (eventType === 'call.transcription') {
    const td      = payload?.transcription_data as Record<string, unknown>
    const text    = (td?.transcript as string || '').trim()
    const isFinal = td?.is_final as boolean
    console.log(`[inbound-webhook] transcription: final=${isFinal} text="${text?.slice(0, 50)}"`)
    if (!text || !isFinal) {
      console.log('[inbound-webhook] SKIP: empty or non-final', { text: text?.slice(0, 30), isFinal })
      return NextResponse.json('OK')
    }

    const state = await dbGet(callId)
    if (!state) { console.log('[inbound-webhook] SKIP: no state'); return NextResponse.json('OK') }
    if (state.processing) { console.log('[inbound-webhook] SKIP: processing=true'); return NextResponse.json('OK') }

    // Lock immediately
    await dbUpdate(callId, { processing: true })

    // Build arrays
    const transcript: Array<{speaker: string; text: string}> =
      Array.isArray(state.transcript) ? [...state.transcript]
      : typeof state.transcript === 'string' ? JSON.parse(state.transcript || '[]')
      : []
    const conversation: Array<{role: string; content: string}> =
      Array.isArray(state.conversation) ? [...state.conversation]
      : typeof state.conversation === 'string' ? JSON.parse(state.conversation || '[]')
      : []

    transcript.push({ speaker: 'customer', text })
    await dbUpdate(callId, { transcript })

    const system = `You are the AI phone receptionist for Alpha International Auto Center, an auto repair shop at 10710 S Main St, Houston TX 77025. Phone: (713) 663-6979. Hours: Mon-Fri 8am-6pm, Sat 9am-3pm.

RULES:
- Live phone call. Keep replies SHORT — 1-3 sentences max. Natural and friendly.
- Help with: appointments, vehicle questions, pricing, directions, hours.
- If caller wants to leave a message, acknowledge you will pass it along.
- Speak like a real, warm human receptionist. Never say you are AI unless directly asked.`

    const messages = [
      { role: 'system', content: system },
      ...conversation.slice(-8),
      { role: 'user',   content: text },
    ]

    const reply = await aiChat(messages, 100)
    if (reply) {
      transcript.push({ speaker: 'ai', text: reply })
      conversation.push({ role: 'assistant', content: reply })
      await dbUpdate(callId, { transcript, conversation })
      await speak(callId, reply)
    }

    await dbUpdate(callId, { processing: false })
    return NextResponse.json('OK')
  }

  // ── call.speak.ended — safety net unlock ─────────────────────────────────────
  if (eventType === 'call.speak.ended') {
    await dbUpdate(callId, { processing: false })
    return NextResponse.json('OK')
  }

  // ── call.recording.saved ─────────────────────────────────────────────────────
  if (eventType === 'call.recording.saved') {
    const urls = payload?.recording_urls
    let recordingUrl = ''
    if (typeof urls === 'string') {
      recordingUrl = urls
    } else if (urls && typeof urls === 'object') {
      recordingUrl = (urls as Record<string, string>).mp3
        || (urls as Record<string, string>).wav
        || Object.values(urls as Record<string, string>)[0] || ''
    }
    if (!recordingUrl && payload?.public_url) recordingUrl = payload.public_url as string
    if (recordingUrl) await dbUpdate(callId, { recording_url: recordingUrl })
    return NextResponse.json('OK')
  }

  // ── call.hangup — generate summary ───────────────────────────────────────────
  if (eventType === 'call.hangup') {
    const state = await dbGet(callId)
    if (!state) return NextResponse.json('OK')
    await dbUpdate(callId, { status: 'ended' })

    const transcript: Array<{speaker: string; text: string}> =
      Array.isArray(state.transcript) ? state.transcript
      : typeof state.transcript === 'string' ? JSON.parse(state.transcript || '[]')
      : []

    if (transcript.length > 0) {
      const lines   = transcript.map(t => `${t.speaker === 'ai' ? 'AI' : 'Caller'}: ${t.text}`).join('\n')
      const summary = await aiChat([{
        role:    'user',
        content: `Summarize this inbound customer call in bullet points.\n\nTranscript:\n${lines}`,
      }], 300)
      await dbUpdate(callId, { summary: summary || `Inbound call ended. ${transcript.length} exchanges.`, status: 'ended' })
    }

    return NextResponse.json('OK')
  }

  return NextResponse.json('OK')
}
