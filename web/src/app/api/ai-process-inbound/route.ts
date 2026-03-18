/**
 * Background AI Turn Processor — INBOUND calls
 * Called fire-and-forget from /api/calls/webhook when a customer speaks.
 * Generates AI receptionist reply and speaks it on the call.
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
    return d?.choices?.[0]?.message?.content?.trim() || ''
  } catch { return '' }
}

export async function POST(req: NextRequest) {
  let parsedCallId = ''
  try {
    const { callId, text, state } = await req.json()
    parsedCallId = callId || ''
    if (!callId || !text || !state) return NextResponse.json({ ok: false })

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

    const reply = await aiChat(messages, 120)
    if (reply) {
      transcript.push({ speaker: 'ai', text: reply })
      conversation.push({ role: 'assistant', content: reply })
      await dbUpdate(callId, { transcript, conversation })
      await speak(callId, reply)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[ai-process-inbound] error:', err)
    return NextResponse.json({ ok: false })
  } finally {
    if (parsedCallId) {
      try { await dbUpdate(parsedCallId, { processing: false }) } catch { /* ignore */ }
    }
  }
}
