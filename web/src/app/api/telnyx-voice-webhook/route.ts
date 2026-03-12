/**
 * Telnyx Voice Webhook — AI voice agent v4.0
 * - DeepSeek Chat v3 (fast, reliable)
 * - Engine B final-only transcription (no flooding)
 * - Barge-in via playback_stop
 * - "Not interested" → one rebuttal → graceful exit
 * - Outbound greeting (never says "Thanks for calling")
 * - Alpha Auto Center oil change script embedded
 */

import { NextRequest, NextResponse } from 'next/server'

const TELNYX_API_KEY     = process.env.TELNYX_API_KEY     || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const SUPABASE_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY     || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const TELNYX_BASE        = 'https://api.telnyx.com/v2'

// DeepSeek — fast and reliable
const AI_MODEL = 'deepseek/deepseek-chat-v3-0324'
const VOICE    = 'Telnyx.Natural.abbie'
const VOICE_FB = 'female'

// ── Supabase ──────────────────────────────────────────────────────────────────
async function dbGet(callId: string) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(callId)}&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  const rows = await r.json()
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}

async function dbUpdate(callId: string, patch: Record<string, unknown>) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(callId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    }
  )
}

// ── Telnyx ────────────────────────────────────────────────────────────────────
async function telnyxPost(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${TELNYX_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: r.ok, data: await r.json() }
}

async function stopSpeaking(callId: string) {
  await telnyxPost(`/calls/${callId}/actions/playback_stop`, { stop: 'all' })
}

async function speak(callId: string, text: string): Promise<boolean> {
  const clean = text.replace(/"/g, "'").slice(0, 3000)
  await dbUpdate(callId, { is_speaking: true, last_spoke_at: Date.now() })
  const r = await telnyxPost(`/calls/${callId}/actions/speak`, {
    payload: clean, payload_type: 'text', voice: VOICE,
  })
  if (!r.ok) {
    const fb = await telnyxPost(`/calls/${callId}/actions/speak`, {
      payload: clean, payload_type: 'text', voice: VOICE_FB,
    })
    if (!fb.ok) { await dbUpdate(callId, { is_speaking: false }); return false }
  }
  return true
}

// ── DeepSeek via OpenRouter ───────────────────────────────────────────────────
async function aiChat(
  messages: Array<{ role: string; content: string }>,
  maxTokens = 150
): Promise<string> {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://alpha-ai-desk.vercel.app',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    })
    const d = await r.json()
    let text: string = d?.choices?.[0]?.message?.content?.trim() || ''

    // Strip everything that shouldn't be spoken
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    text = text.replace(/^["']|["']$/g, '').trim()
    text = text.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()
    text = text.replace(/\b(laughs|chuckles|pauses|sighs|warmly|cheerfully|gently|softly|nodding|click)\b/gi, '').trim()
    text = text.replace(/^[-•*#]+\s*/gm, '').trim()
    text = text.replace(/  +/g, ' ').trim()

    // Collapse multi-line — only keep first clean paragraph
    const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
    if (lines.length > 1) {
      const leak = lines[1].startsWith('-') || lines[1].length < 20 ||
        /^(speak|note|after|end|call|task|stage|step|next|if)/i.test(lines[1])
      text = leak ? lines[0] : lines.slice(0, 3).join(' ')
    }

    return text.trim()
  } catch (e) {
    console.error('[aiChat] error:', e)
    return ''
  }
}

// ── Script parsing ────────────────────────────────────────────────────────────
function parseScript(task: string): string[] | null {
  const pipeMatch = task.match(/SCRIPT:\s*(.+)/i)
  if (pipeMatch && pipeMatch[1].includes('|')) {
    return pipeMatch[1].split('|').map((s: string) => s.trim()).filter(Boolean)
  }
  return null
}

// ── Alpha Auto script ─────────────────────────────────────────────────────────
const ALPHA_SYSTEM = `You are Sam, an outbound salesperson calling local Houston customers for Alpha International Auto Center at 10710 South Main Street, Houston Texas. Phone: seven one three six six three six nine seven nine.

YOUR JOB: Sell oil changes. Be friendly, confident, and persuasive — always be closing.

OIL CHANGE PRICES:
- Regular oil: thirty-four dollars and ninety-nine cents
- House synthetic: forty-four dollars and ninety-nine cents  
- Valvoline full synthetic: fifty-four dollars and ninety-nine cents
- All prices include up to five quarts. Additional quarts cost extra.

OTHER SERVICES (only mention if asked): brakes, diagnostics, suspension, air conditioning, engine work, transmission, state inspections, paint and body work.

REBUTTALS (use one per objection, then accept gracefully if they still say no):
- "I already have a place" → "That's cool, we just want a chance to earn your business. A lot of our regulars said the same thing before they tried us. We're fast, affordable, and right here on Main Street. Can we get you in this week?"
- "I'm not due yet" → "Perfect timing — that gives you a chance to try us out before you need it. We can go ahead and get you on the schedule. Would this week or next work better?"
- "That's too much" → "I hear you — thirty-four ninety-nine including up to five quarts is honestly one of the best deals in Houston. What were you paying before?"
- "I'm busy" → "I get it, we're quick — most oil changes done in under thirty minutes. Morning or afternoon work better for you?"
- "Just text me" → "Absolutely, but real quick — do you have a day this week that works, even tentatively? What about Thursday or Friday?"

CLOSING: Always try to get a specific day. "Can I put you down for [day]? Even tentatively, just so we hold a spot."

RULES:
- YOU called THEM. Never say "Thanks for calling."
- 1-3 sentences max per reply. Short and punchy.
- Wait for them to finish before replying. Never answer your own questions.
- If they say "not interested" or "no thanks": give ONE rebuttal, then if they still say no, say "No problem, have a great day!" and end.
- If they ask a question, answer it directly first, then get back to selling.
- Spoken words only. No markdown, no bullets, no stage directions, no brackets.`

// ── Webhook ───────────────────────────────────────────────────────────────────
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

    const stages = parseScript(task)
    const isAlpha = /alpha|oil.?change|auto.?center/i.test(task)

    await dbUpdate(callId, {
      status: 'active', task,
      greeted: false, processing: false,
      is_speaking: false, script_stage: 0,
      objection_count: 0,
    })

    // Engine B — accurate, final-only. No interim flooding.
    await telnyxPost(`/calls/${callId}/actions/transcription_start`, {
      language: 'en',
      transcription_engine: 'B',
      transcription_tracks: 'inbound',
    })

    // Recording
    await telnyxPost(`/calls/${callId}/actions/record_start`, {
      format: 'mp3', channels: 'dual', play_beep: false,
    })

    await dbUpdate(callId, { processing: true })

    // Build greeting prompt
    let greetingPrompt: string
    if (stages) {
      greetingPrompt = `You are making an outbound call. Say this opener out loud: "${stages[0]}"
One or two natural sentences. YOU called THEM — never say "Thanks for calling". No markdown, no brackets.`
    } else if (isAlpha) {
      greetingPrompt = `${ALPHA_SYSTEM}

Say your opening line to a local Houston customer. One punchy sentence. Get their attention.
YOU called THEM — never say "Thanks for calling".
Example: "Hey, this is Sam from Alpha International Auto Center — quick question, when was your last oil change?"`
    } else {
      greetingPrompt = `You are making an outbound call. Task: "${task}"
Say your opening line — 1-2 natural sentences. YOU called THEM. Never say "Thanks for calling".
No markdown, no brackets. You can call yourself Sam.`
    }

    const greeting = await aiChat([{ role: 'system', content: greetingPrompt }], 60) ||
      `Hey, this is Sam from Alpha International Auto Center — quick question, when was your last oil change?`

    const transcript   = [{ speaker: 'ai', text: greeting }]
    const conversation = [{ role: 'assistant', content: greeting }]
    await dbUpdate(callId, { greeted: true, transcript, conversation })
    await speak(callId, greeting)
    await dbUpdate(callId, { processing: false, is_speaking: false })

    return NextResponse.json('OK')
  }

  // ── call.speak.ended ──────────────────────────────────────────────────────
  if (eventType === 'call.speak.ended') {
    await dbUpdate(callId, { is_speaking: false, processing: false })
    return NextResponse.json('OK')
  }

  // ── call.transcription ────────────────────────────────────────────────────
  if (eventType === 'call.transcription') {
    const td      = payload?.transcription_data as Record<string, unknown>
    const text    = (td?.transcript as string || '').trim()
    const isFinal = td?.is_final as boolean

    if (!text) return NextResponse.json('OK')

    const state = await dbGet(callId)
    if (!state) return NextResponse.json('OK')

    // Barge-in: stop AI if caller speaks with 2+ words
    if (state.is_speaking && text.split(' ').length >= 2) {
      console.log('[barge-in]', text.slice(0, 50))
      await stopSpeaking(callId)
      await dbUpdate(callId, { is_speaking: false })
      await new Promise(res => setTimeout(res, 400))
    }

    // ONLY process final transcriptions for AI replies
    if (!isFinal) return NextResponse.json('OK')
    if (state.processing) return NextResponse.json('OK')

    // Echo guard
    const lastSpoke = (state.last_spoke_at as number) || 0
    if (Date.now() - lastSpoke < 2000) {
      console.log('[echo-guard cooldown]', text.slice(0, 50))
      return NextResponse.json('OK')
    }
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    const recentAi = (Array.isArray(state.transcript) ? state.transcript : [])
      .filter((l: { speaker: string }) => l.speaker === 'ai').slice(-3)
    const isEcho = recentAi.some((l: { text: string }) => {
      const na = norm(l.text); const nt = norm(text)
      if (nt.split(' ').length < 4) return false
      return na.includes(nt) || nt.includes(na.slice(0, 40))
    })
    if (isEcho) { console.log('[echo-guard text]', text.slice(0, 50)); return NextResponse.json('OK') }

    await dbUpdate(callId, { processing: true })

    const transcript: Array<{ speaker: string; text: string }> =
      Array.isArray(state.transcript) ? [...state.transcript]
      : typeof state.transcript === 'string' ? JSON.parse(state.transcript || '[]') : []
    const conversation: Array<{ role: string; content: string }> =
      Array.isArray(state.conversation) ? [...state.conversation]
      : typeof state.conversation === 'string' ? JSON.parse(state.conversation || '[]') : []

    transcript.push({ speaker: 'customer', text })
    await dbUpdate(callId, { transcript })

    const objectionCount = (state.objection_count as number) || 0

    // Hard no — always let go gracefully
    const isHardNo = /not interested|do not call|take me off|remove me|stop calling/i.test(text)
    // Soft no — give rebuttal once, then let go
    const isSoftNo = /no thank|no thanks|can.?t right now|not right now|maybe later|not today|not looking/i.test(text)

    if (isHardNo || (isSoftNo && objectionCount >= 1)) {
      const bye = 'No problem at all — I appreciate your time. Have a great day!'
      transcript.push({ speaker: 'ai', text: bye })
      conversation.push({ role: 'assistant', content: bye })
      await dbUpdate(callId, { transcript, conversation, processing: false })
      await speak(callId, bye)
      await dbUpdate(callId, { is_speaking: false })
      return NextResponse.json('OK')
    }

    // Script stage context
    const stages      = parseScript(state.task || '')
    const scriptStage = (state.script_stage as number) || 0
    let stageCtx = ''
    if (stages && stages.length > 0) {
      const cur  = stages[Math.min(scriptStage, stages.length - 1)]
      const next = scriptStage + 1 < stages.length ? stages[scriptStage + 1] : null
      stageCtx = `\nCurrent script stage ${scriptStage + 1}/${stages.length}: "${cur}"${next ? `\nNext stage when done: "${next}"` : '\nFinal stage — wrap up.'}`
    }

    const isAlpha = /alpha|oil.?change|auto.?center/i.test(state.task || '')

    const systemPrompt = isAlpha
      ? `${ALPHA_SYSTEM}${stageCtx}

The customer just said: "${text}"
Respond naturally. If they said "not interested", give ONE rebuttal from the script above, then stop pushing.
1-3 sentences max. Spoken words only.`
      : `You are on a live phone call. Task: "${state.task}"${stageCtx}

RULES:
- Answer their question if they asked one — don't skip it.
- HOLD phrases ("hold on", "one sec") → say "Of course, take your time." and wait.
- Backchannel ("mm-hmm", "yeah", "ok") → they're still listening, keep going.
- 1-3 sentences max. Natural spoken words. No markdown, no brackets.`

    const messages = [
      { role: 'system', content: systemPrompt },
      ...conversation.slice(-10),
      { role: 'user', content: text },
    ]

    const reply = await aiChat(messages, 100)

    if (reply) {
      transcript.push({ speaker: 'ai', text: reply })
      conversation.push({ role: 'assistant', content: reply })

      const newObjCount = isSoftNo ? objectionCount + 1 : objectionCount
      let newStage = scriptStage
      if (stages && stages.length > 0 && /great|perfect|sounds good|moving on/i.test(reply)) {
        newStage = Math.min(scriptStage + 1, stages.length - 1)
      }

      await dbUpdate(callId, { transcript, conversation, script_stage: newStage, objection_count: newObjCount })
      await speak(callId, reply)
    }

    await dbUpdate(callId, { processing: false, is_speaking: false })
    return NextResponse.json('OK')
  }

  // ── call.recording.saved ──────────────────────────────────────────────────
  if (eventType === 'call.recording.saved') {
    const urls = payload?.recording_urls
    let url = ''
    if (typeof urls === 'string') url = urls
    else if (urls && typeof urls === 'object') {
      url = (urls as Record<string, string>).mp3
        || (urls as Record<string, string>).wav
        || Object.values(urls as Record<string, string>)[0] || ''
    }
    if (!url && payload?.public_url) url = payload.public_url as string
    if (url) await dbUpdate(callId, { recording_url: url })
    return NextResponse.json('OK')
  }

  // ── call.hangup ───────────────────────────────────────────────────────────
  if (eventType === 'call.hangup') {
    const state = await dbGet(callId)
    if (!state) return NextResponse.json('OK')
    await dbUpdate(callId, { status: 'ended', is_speaking: false })

    const transcript: Array<{ speaker: string; text: string }> =
      Array.isArray(state.transcript) ? state.transcript
      : typeof state.transcript === 'string' ? JSON.parse(state.transcript || '[]') : []

    if (transcript.length > 1) {
      const lines   = transcript.map((t: { speaker: string; text: string }) =>
        `${t.speaker === 'ai' ? 'AI' : 'Person'}: ${t.text}`).join('\n')
      const summary = await aiChat([{
        role: 'user',
        content: `Summarize this call in 3-5 bullet points.\nTask: ${state.task}\n\nTranscript:\n${lines}`,
      }], 200)
      await dbUpdate(callId, { summary: summary || `Call ended. ${transcript.length} exchanges.`, status: 'ended' })
    }
    return NextResponse.json('OK')
  }

  return NextResponse.json('OK')
}
