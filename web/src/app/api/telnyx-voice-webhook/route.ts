/**
 * Telnyx Voice Webhook — AI voice agent v4.6
 * - Returns 200 IMMEDIATELY to Telnyx, uses waitUntil() to keep async work alive
 * - Engine A with interim filtering in code
 * - DeepSeek Chat v3
 * - Barge-in, Alpha Auto Center script, not-interested handling
 * - Instant filler phrases before AI response to reduce perceived latency
 */

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'

const TELNYX_API_KEY     = process.env.TELNYX_API_KEY     || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const SUPABASE_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const TELNYX_BASE        = 'https://api.telnyx.com/v2'

// ── Filler phrases (reduce perceived latency) ───────────────────────────────
const FILLER_PHRASES = [
  'Mmhmm', 'Yeah for sure', 'Oh gotcha', 'Right right',
  'Yeah', 'Oh okay', 'Sure sure', 'Gotcha',
]
function randomFiller(): string {
  return FILLER_PHRASES[Math.floor(Math.random() * FILLER_PHRASES.length)]
}

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

async function dbUpsert(callId: string, data: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/ai_calls`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ id: callId, ...data }),
  })
}

async function dbPatch(callId: string, patch: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(callId)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  })
}

// ── Telnyx ────────────────────────────────────────────────────────────────────
async function telnyxPost(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${TELNYX_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: r.ok, status: r.status, data: await r.json() }
}

async function speak(callId: string, text: string) {
  const clean = text.replace(/"/g, "'").slice(0, 3000)
  await dbPatch(callId, { is_speaking: true, last_spoke_at: Date.now() })
  const r = await telnyxPost(`/calls/${callId}/actions/speak`, {
    payload: clean, payload_type: 'text', voice: VOICE,
  })
  if (!r.ok) {
    await telnyxPost(`/calls/${callId}/actions/speak`, {
      payload: clean, payload_type: 'text', voice: VOICE_FB,
    })
  }
}

// ── DeepSeek via OpenRouter ───────────────────────────────────────────────────
async function aiChat(messages: Array<{ role: string; content: string }>, maxTokens = 120): Promise<string> {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://alpha-ai-desk.vercel.app',
      },
      body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: maxTokens, temperature: 0.7 }),
    })
    const d = await r.json()
    let text: string = d?.choices?.[0]?.message?.content?.trim() || ''
    // Strip markdown / stage directions
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    text = text.replace(/^["']|["']$/g, '').trim()
    text = text.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()
    text = text.replace(/\b(laughs|chuckles|pauses|sighs|warmly|cheerfully|gently|softly|nodding|click)\b/gi, '').trim()
    text = text.replace(/^[-•*#]+\s*/gm, '').trim()
    text = text.replace(/  +/g, ' ').trim()
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

// ── Alpha Auto Center system prompt ──────────────────────────────────────────
const ALPHA_SYSTEM = `You are Sam, an outbound salesperson calling local Houston customers for Alpha International Auto Center at 10710 South Main Street, Houston Texas. Phone: seven one three six six three six nine seven nine.

YOUR JOB: Sell oil changes. Be friendly, confident, and persuasive.

OIL CHANGE PRICES:
- Regular oil: thirty-four dollars and ninety-nine cents
- House synthetic: forty-four dollars and ninety-nine cents
- Valvoline full synthetic: fifty-four dollars and ninety-nine cents
- All prices include up to five quarts. Additional quarts cost extra.

OTHER SERVICES (only if asked): brakes, diagnostics, suspension, AC, engine, transmission, state inspections, paint and body.

REBUTTALS (use one per objection, then accept gracefully if they still say no):
- "I already have a place" → "That's cool, we just want a chance to earn your business. A lot of our regulars said the same thing before they tried us. We're fast, affordable, and right here on Main Street. Can we get you in this week?"
- "Not due yet" → "Perfect timing — gives you a chance to try us out. Can we go ahead and get you on the schedule? This week or next?"
- "Too expensive" → "I hear you — thirty-four ninety-nine including up to five quarts is honestly one of the best deals in Houston. What were you paying before?"
- "Busy" → "I get it, we're quick — most oil changes done in under thirty minutes. Morning or afternoon work better?"
- "Just text me" → "Absolutely, but real quick — do you have a day this week that works even tentatively? Thursday or Friday?"

CLOSING: Always try to get a specific day. "Can I put you down for [day]? Even tentatively, just so we hold a spot."

RULES:
- YOU called THEM. Never say "Thanks for calling."
- 1-3 sentences max per reply. Short and punchy.
- Wait for them to finish. Never answer your own questions.
- If "not interested" or "no thanks": give ONE rebuttal, then if still no → "No problem, have a great day!" and stop.
- If they say "hold on" or "one sec" → say "Of course, take your time." and wait.
- Spoken words only. No markdown, no bullets, no stage directions.`

// ── Handle call.answered asynchronously ──────────────────────────────────────
async function handleAnswered(callId: string, task: string) {
  try {
    const isAlpha = /alpha|oil.?change|auto.?center/i.test(task)

    // Upsert row
    await dbUpsert(callId, {
      status: 'active', task,
      greeted: false, processing: true,
      is_speaking: false, script_stage: 0,
      objection_count: 0,
      started_at: new Date().toISOString(),
    })

    // Start transcription — Engine A fires reliably
    await telnyxPost(`/calls/${callId}/actions/transcription_start`, {
      language: 'en',
      transcription_engine: 'A',
      transcription_tracks: 'inbound',
      interim_results: true,
    })

    // Start recording
    await telnyxPost(`/calls/${callId}/actions/record_start`, {
      format: 'mp3', channels: 'dual', play_beep: false,
    })

    // Build greeting
    const greetingPrompt = isAlpha
      ? `${ALPHA_SYSTEM}\n\nSay your opening line to a Houston customer. One punchy sentence.\nYOU called THEM — never say "Thanks for calling".\nExample: "Hey, this is Sam from Alpha International Auto Center — quick question, when was your last oil change?"`
      : `You are making an outbound call. Task: "${task}"\nSay your opening line — 1-2 natural sentences. YOU called THEM. Never say "Thanks for calling". No markdown. You can call yourself Sam.`

    const greeting = await aiChat([{ role: 'system', content: greetingPrompt }], 60) ||
      "Hey, this is Sam from Alpha International Auto Center — quick question, when was your last oil change?"

    const transcript   = [{ speaker: 'ai', text: greeting }]
    const conversation = [{ role: 'assistant', content: greeting }]

    await dbPatch(callId, { greeted: true, transcript, conversation })
    await speak(callId, greeting)
    await dbPatch(callId, { processing: false, is_speaking: false })

    console.log(`[answered] greeted ${callId.slice(0,25)}: ${greeting.slice(0,60)}`)
  } catch (e) {
    console.error('[handleAnswered] error:', e)
    await dbPatch(callId, { processing: false })
  }
}

// ── Handle transcription asynchronously ──────────────────────────────────────
async function handleTranscription(callId: string, text: string, isFinal: boolean) {
  try {
    const state = await dbGet(callId)
    if (!state) return

    // Barge-in: stop AI if caller speaks 2+ words while AI is talking
    if (state.is_speaking && text.split(' ').length >= 2) {
      await telnyxPost(`/calls/${callId}/actions/playback_stop`, { stop: 'all' })
      await dbPatch(callId, { is_speaking: false })
      await new Promise(res => setTimeout(res, 300))
    }

    // Only process final transcriptions for AI reply
    if (!isFinal) return
    if (state.processing) return

    // Echo guard — ignore AI's own speech bleeding back
    const lastSpoke = (state.last_spoke_at as number) || 0
    if (Date.now() - lastSpoke < 2000) return
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    const recentAi = (Array.isArray(state.transcript) ? state.transcript : [])
      .filter((l: { speaker: string }) => l.speaker === 'ai').slice(-3)
    const isEcho = recentAi.some((l: { text: string }) => {
      const na = norm(l.text); const nt = norm(text)
      if (nt.split(' ').length < 4) return false
      return na.includes(nt) || nt.includes(na.slice(0, 40))
    })
    if (isEcho) return

    await dbPatch(callId, { processing: true })

    const transcript: Array<{ speaker: string; text: string }> =
      Array.isArray(state.transcript) ? [...state.transcript] : []
    const conversation: Array<{ role: string; content: string }> =
      Array.isArray(state.conversation) ? [...state.conversation] : []

    transcript.push({ speaker: 'customer', text })
    await dbPatch(callId, { transcript })

    const objectionCount = (state.objection_count as number) || 0
    const isHardNo = /not interested|do not call|take me off|remove me|stop calling/i.test(text)
    const isSoftNo = /no thank|no thanks|can.?t right now|not right now|maybe later|not today|not looking/i.test(text)
    const isAlpha = /alpha|oil.?change|auto.?center/i.test(state.task || '')

    // Hard no / end-of-call — skip filler, go straight to goodbye
    if (isHardNo || (isSoftNo && objectionCount >= 1)) {
      const bye = 'No problem at all — I appreciate your time. Have a great day!'
      transcript.push({ speaker: 'ai', text: bye })
      conversation.push({ role: 'assistant', content: bye })
      await dbPatch(callId, { transcript, conversation, processing: false })
      await speak(callId, bye)
      await dbPatch(callId, { is_speaking: false })
      return
    }

    // Fire a filler phrase to reduce perceived latency
    // Skip filler for very short inputs (1 word) — they deserve a direct response
    const wordCount = text.trim().split(/\s+/).length
    if (wordCount > 1) {
      const filler = randomFiller()
      // Fire-and-forget — don't await, just give it a head start
      speak(callId, filler)
      // Small delay so filler starts playing before AI response overwrites it
      await new Promise(res => setTimeout(res, 400))
    }

    const systemPrompt = isAlpha
      ? `${ALPHA_SYSTEM}\n\nThe customer just said: "${text}"\nRespond naturally. 1-3 sentences max. Spoken words only.`
      : `You are on a live phone call. Task: "${state.task}"\n\nRULES:\n- Answer their question if they asked one.\n- HOLD phrases → say "Of course, take your time."\n- 1-3 sentences max. Natural spoken words. No markdown.`

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
      await dbPatch(callId, { transcript, conversation, objection_count: newObjCount })
      await speak(callId, reply)
    }

    await dbPatch(callId, { processing: false, is_speaking: false })
  } catch (e) {
    console.error('[handleTranscription] error:', e)
    await dbPatch(callId, { processing: false })
  }
}

// ── Main webhook — return 200 IMMEDIATELY then process ───────────────────────
export async function POST(req: NextRequest) {
  const body      = await req.json()
  const eventType = body?.data?.event_type as string
  const payload   = body?.data?.payload    as Record<string, unknown>
  const callId    = payload?.call_control_id as string

  console.log(`[webhook] ${eventType} ${callId?.slice(0,25)}`)

  // Version check
  if (eventType === 'version') return NextResponse.json({ v: 'v4.6-filler' })

  // ── call.answered ─────────────────────────────────────────────────────────
  if (eventType === 'call.answered') {
    let task = 'Alpha Auto Center oil change call'
    const cs = payload?.client_state as string
    if (cs) {
      try { task = JSON.parse(Buffer.from(cs, 'base64').toString()).task || task } catch { /* ok */ }
    }
    // Fire async — return 200 immediately, waitUntil keeps the function alive
    waitUntil(handleAnswered(callId, task))
    return NextResponse.json('OK')
  }

  // ── call.speak.ended ──────────────────────────────────────────────────────
  if (eventType === 'call.speak.ended') {
    waitUntil(dbPatch(callId, { is_speaking: false, processing: false }))
    return NextResponse.json('OK')
  }

  // ── call.transcription ────────────────────────────────────────────────────
  if (eventType === 'call.transcription') {
    const td      = payload?.transcription_data as Record<string, unknown>
    const text    = (td?.transcript as string || '').trim()
    const isFinal = td?.is_final as boolean
    if (text) {
      // Fire async — return 200 immediately, waitUntil keeps the function alive
      waitUntil(handleTranscription(callId, text, isFinal))
    }
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
    if (url) waitUntil(dbPatch(callId, { recording_url: url }))
    return NextResponse.json('OK')
  }

  // ── call.hangup ───────────────────────────────────────────────────────────
  if (eventType === 'call.hangup') {
    waitUntil(dbPatch(callId, { status: 'ended', is_speaking: false, processing: false }))
    // Generate summary async — waitUntil keeps the function alive
    waitUntil((async () => {
      const state = await dbGet(callId)
      if (!state) return
      const transcript: Array<{ speaker: string; text: string }> =
        Array.isArray(state.transcript) ? state.transcript : []
      if (transcript.length > 1) {
        const lines = transcript.map((t: { speaker: string; text: string }) =>
          `${t.speaker === 'ai' ? 'AI' : 'Person'}: ${t.text}`).join('\n')
        const summary = await aiChat([{
          role: 'user',
          content: `Summarize this call in 3-5 bullet points.\nTask: ${state.task}\n\nTranscript:\n${lines}`,
        }], 200)
        await dbPatch(callId, { summary: summary || `Call ended. ${transcript.length} exchanges.`, status: 'ended' })
      }
    })())
    return NextResponse.json('OK')
  }

  return NextResponse.json('OK')
}
