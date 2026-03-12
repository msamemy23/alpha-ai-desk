/**
 * Background AI Turn Processor
 * Called fire-and-forget by telnyx-voice-webhook when a transcription arrives.
 * Handles: AI reply generation + Telnyx speak + Supabase update.
 * Runs independently so the webhook can return 200 to Telnyx in <1s.
 */

import { NextRequest, NextResponse } from 'next/server'

const TELNYX_API_KEY     = process.env.TELNYX_API_KEY     || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_MODEL           = process.env.AI_MODEL           || 'deepseek/deepseek-chat-v3-0324'
const SUPABASE_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const TELNYX_BASE        = 'https://api.telnyx.com/v2'
const VOICE              = 'Telnyx.Natural.abbie'
const VOICE_FALLBACK     = 'female'

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

async function telnyxPost(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${TELNYX_BASE}${path}`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: r.ok, data: await r.json() }
}

async function speak(callId: string, text: string) {
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

async function aiChat(messages: Array<{role: string; content: string}>, maxTokens = 120): Promise<string> {
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

export async function POST(req: NextRequest) {
  let parsedCallId = ''
  try {
    const { callId, text, state } = await req.json()
    parsedCallId = callId || ''
    if (!callId || !text || !state) return NextResponse.json({ ok: false })

    // Rebuild arrays (JSONB comes as objects, guard legacy string format)
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
      await speak(callId, reply)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[ai-process-turn] error:', err)
    return NextResponse.json({ ok: false })
  } finally {
    // Always unlock — even if we crash above
    if (parsedCallId) {
      try { await dbUpdate(parsedCallId, { processing: false }) } catch { /* ignore */ }
    }
  }
}
