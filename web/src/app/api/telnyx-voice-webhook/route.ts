/**
 * Telnyx Voice Webhook — handles all AI voice call events inline.
 * No external server. Telnyx Natural TTS (instant, ~200ms).
 * Flow: call.answered → greet → call.transcription → AI response → speak → repeat
 */

import { NextRequest, NextResponse } from 'next/server'
import { callStateStore, type CallState } from '@/lib/call-state'

const TELNYX_API_KEY     = process.env.TELNYX_API_KEY     || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_MODEL           = process.env.AI_MODEL           || 'deepseek/deepseek-v3-1.5'
const TELNYX_BASE        = 'https://api.telnyx.com/v2'

// Best warm female Telnyx Natural voice — instant, runs on Telnyx's GPUs
const VOICE = 'Telnyx.Natural.astra'

function telnyxPost(path: string, body: Record<string, unknown>) {
  return fetch(`${TELNYX_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function speak(callId: string, text: string) {
  await telnyxPost(`/calls/${callId}/actions/speak`, {
    payload:      text.replace(/"/g, "'"),
    payload_type: 'text',
    voice:        VOICE,
  })
}

async function aiChat(messages: Array<{role: string; content: string}>, maxTokens = 150): Promise<string> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:       AI_MODEL,
        messages,
        max_tokens:  maxTokens,
        temperature: 0.7,
      }),
    })
    const d = await res.json()
    return d?.choices?.[0]?.message?.content?.trim() || ''
  } catch {
    return ''
  }
}

function findState(callId: string): CallState | undefined {
  const direct = callStateStore.get(callId)
  if (direct) return direct
  const prefix = callId.slice(0, 20)
  for (const [k, v] of Array.from(callStateStore.entries())) {
    if (k.slice(0, 20) === prefix) return v
  }
  return undefined
}

export async function POST(req: NextRequest) {
  const body      = await req.json()
  const eventType = body?.data?.event_type as string
  const payload   = body?.data?.payload    as Record<string, unknown>
  const callId    = payload?.call_control_id as string

  // ── call.answered ─────────────────────────────────────────────────────────
  if (eventType === 'call.answered') {
    let task = 'Have a helpful conversation'
    const cs = payload?.client_state as string
    if (cs) {
      try { task = JSON.parse(Buffer.from(cs, 'base64').toString()).task || task } catch { /* ok */ }
    }

    const state: CallState = {
      task,
      conversation: [],
      transcript:   [],
      greeted:      false,
      processing:   true,
      startedAt:    Date.now(),
      status:       'active',
    }
    callStateStore.set(callId, state)

    // Start transcription immediately
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

Write a SHORT natural greeting (1-2 sentences). Warm, friendly, sounds like a real person. Text only.`,
    }], 60) || "Hey there! This is Alpha International Auto Center calling. How are you doing today?"

    state.greeted = true
    state.transcript.push({ speaker: 'ai',   text: greeting })
    state.conversation.push({ role: 'assistant', content: greeting })
    await speak(callId, greeting)
  }

  // ── call.transcription ────────────────────────────────────────────────────
  else if (eventType === 'call.transcription') {
    const state = findState(callId)
    if (!state) return NextResponse.json('OK')

    const td      = payload?.transcription_data as Record<string, unknown>
    const text    = (td?.transcript as string || '').trim()
    const isFinal = td?.is_final as boolean

    if (!text || !isFinal || state.processing) return NextResponse.json('OK')

    state.transcript.push({ speaker: 'customer', text })
    state.processing = true

    const system = `You are a phone AI agent calling on behalf of Alpha International Auto Center (auto repair shop, Houston TX, 10710 S Main St, (713) 663-6979).

TASK: ${state.task}

RULES:
- This is a live phone call. Keep replies to 1-3 sentences MAX.
- Sound natural and warm, like a real person.
- When the task is complete, say: "Thank you so much, have a great day!"
- Never reveal you are an AI unless directly asked.`

    const messages = [
      { role: 'system',    content: system },
      ...state.conversation.slice(-8),
      { role: 'user',      content: text },
    ]

    const reply = await aiChat(messages, 120)
    if (reply) {
      state.transcript.push({ speaker: 'ai', text: reply })
      state.conversation.push({ role: 'assistant', content: reply })
      await speak(callId, reply)
    } else {
      state.processing = false
    }
  }

  // ── call.speak.ended — unlock so next transcription can trigger response ──
  else if (eventType === 'call.speak.ended') {
    const state = findState(callId)
    if (state) state.processing = false
  }

  // ── call.hangup ───────────────────────────────────────────────────────────
  else if (eventType === 'call.hangup') {
    const state = findState(callId)
    if (state) {
      state.status = 'ended'
      generateSummary(callId, state).catch(() => {})
    }
  }

  return NextResponse.json('OK')
}

async function generateSummary(callId: string, state: CallState) {
  const lines = state.transcript
    .map(t => `${t.speaker === 'ai' ? 'AI' : 'Person'}: ${t.text}`)
    .join('\n')
  const summary = await aiChat([{
    role:    'user',
    content: `Summarize this call in bullet points.\nTask: ${state.task}\n\nTranscript:\n${lines}`,
  }], 300)
  const s = callStateStore.get(callId)
  if (s) s.summary = summary || `Call ended. ${state.transcript.length} exchanges.`
}
