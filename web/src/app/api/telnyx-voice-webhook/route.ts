/**
 * Telnyx Voice Webhook — fully inline AI voice agent.
 * State in Supabase (persists across serverless instances).
 * Voice: Telnyx.Natural.abbie (valid, documented Telnyx Natural female voice)
 * Dual-channel recording enabled.
 */

import { NextRequest, NextResponse } from 'next/server'

const TELNYX_API_KEY     = process.env.TELNYX_API_KEY     || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_MODEL           = process.env.AI_MODEL           || 'deepseek/deepseek-chat-v3-0324'
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
    let text = d?.choices?.[0]?.message?.content?.trim() || ''
    // Strip markdown bold/italic
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    // Strip surrounding quotes
    text = text.replace(/^["']|["']$/g, '').trim()
    // Strip parenthetical stage directions: (laughs), (End call warmly.), etc.
    text = text.replace(/\([^)]*\)/g, '').trim()
    // Strip bracketed stage directions: [End call], [hangs up], [After hold:], etc.
    text = text.replace(/\[[^\]]*\]/g, '').trim()
    // Strip markdown-style headers, bullets, dashes at line start
    text = text.replace(/^[-•*#]+\s*/gm, '').trim()
    // Strip bare stage directions without brackets: "laughs", "chuckles", "pauses", "warmly", etc.
    text = text.replace(/\b(laughs|chuckles|pauses|sighs|smiles|warmly|cheerfully|gently|softly|nodding|hangs up|ends call)\b/gi, '').trim()
    // Collapse multiple spaces left by removals
    text = text.replace(/  +/g, ' ').trim()
    // If the AI produced a multi-line response with newlines, collapse to first clean line only
    // (prevents the AI from outputting scripts/instructions as speech)
    const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
    // Only use first line if second line looks like a meta comment (starts with -, or is short)
    if (lines.length > 1) {
      // Check if it looks like a genuine multi-sentence reply or a leaked instruction
      const secondIsInstruction = lines[1].startsWith('-') || lines[1].length < 20 || /^(speak|note|after|end|call|task|the only)/i.test(lines[1])
      if (secondIsInstruction) {
        text = lines[0]
      } else {
        // Join natural multi-sentence replies
        text = lines.slice(0, 3).join(' ')
      }
    }
    return text.trim()
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

    // Start as NOT processing — greeting will unlock itself after speaking
    await dbUpdate(callId, { status: 'active', task, greeted: false, processing: false })

    // Start transcription
    await telnyxPost(`/calls/${callId}/actions/transcription_start`, {
      language:             'en',
      transcription_engine: 'B',
      transcription_tracks: 'inbound',
    })

    // Lock for greeting generation
    await dbUpdate(callId, { processing: true })

    // Generate greeting — task is the ONLY thing that matters
    const greeting = await aiChat([{
      role:    'system',
      content: `You are CALLING someone (outbound call). Say your opening line out loud to accomplish this task: "${task}"

CRITICAL RULES:
- YOU are calling THEM. Do NOT say "Thanks for calling" — that is for inbound calls.
- Do NOT say "How can I help you" — you are the one calling with a purpose.
- Do NOT introduce yourself as a receptionist.
- Do NOT use [brackets], (parentheses), stage directions, or markdown.
- 1-2 short sentences ONLY — exactly what you would say when someone picks up.
- If personal task: speak naturally like a real person calling a friend.
- If shop task: mention Alpha International Auto Center naturally. You can call yourself Sam.
- Output ONLY the spoken words. Nothing else. NEVER use placeholder text like [Your Name] or [Name].`,
    }], 80) || `Hey, calling from Alpha International Auto Center — ${task}`

    // Save transcript
    await dbUpdate(callId, {
      status:       'active',
      greeted:      true,
      transcript:   [{ speaker: 'ai', text: greeting }],
      conversation: [{ role: 'assistant', content: greeting }],
    })

    // Speak greeting
    await speak(callId, greeting)

    // CRITICAL: Always unlock after greeting speak — do NOT rely on call.speak.ended
    // Store last_spoke_at so transcription handler can ignore echoes for a few seconds
    await dbUpdate(callId, { processing: false, last_spoke_at: Date.now() })

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

    // ── Echo / self-reply guard ──────────────────────────────────────────────
    // The AI's own TTS audio bleeds into the inbound mic and gets transcribed
    // back as if the other person said it. Detect and drop these.
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    const normText = normalize(text)
    const recentAiLines: Array<{speaker: string; text: string}> =
      Array.isArray(state.transcript) ? state.transcript : []
    const isEcho = recentAiLines
      .filter(l => l.speaker === 'ai')
      .slice(-3) // only check last 3 AI lines
      .some(l => {
        const normAi = normalize(l.text)
        // If transcribed text is a substring of what AI just said (or vice versa)
        // and it's more than 6 words, it's almost certainly an echo
        const words = normText.split(' ').length
        if (words < 4) return false // too short to be a reliable match
        return normAi.includes(normText) || normText.includes(normAi.slice(0, 40))
      })
    if (isEcho) {
      console.log('[transcription] dropped echo:', text.slice(0, 60))
      return NextResponse.json('OK')
    }

    // Hard cooldown: ignore transcription for 2.5s after AI finishes speaking
    // This catches partial echoes the text-match guard might miss
    const lastSpoke = (state.last_spoke_at as number) || 0
    if (Date.now() - lastSpoke < 2500) {
      console.log('[transcription] dropped — too soon after AI spoke:', text.slice(0, 60))
      return NextResponse.json('OK')
    }

    // Lock immediately so concurrent transcription events don't double-fire
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

    const system = `You are on a live phone call. Your task is:
"${state.task}"

FOLLOW THE TASK EXACTLY. Stay focused on it throughout the entire call.

== SITUATIONAL AWARENESS (read carefully) ==

HOLD / WAIT situations:
- If they say "hold on", "one second", "let me check", "give me a minute", "hold please", "hang on" — say "Of course, take your time" and then WAIT SILENTLY. Do NOT keep talking. Do NOT ask questions. Just wait for them to come back.
- When they come back, continue from where you left off. Do not restart.

SILENCE:
- If they go quiet, do NOT fill the silence by answering your own questions or making things up. Just wait.
- Only speak when THEY have actually said something to you.

BACKCHANNEL (mm-hmm, ok, yeah, sure, right, uh-huh):
- These are NOT answers. They just mean keep going or they are listening.
- Do not treat "ok" or "yeah" as a full response to a question you asked.

QUESTIONS you ask:
- After asking a question, STOP TALKING and wait for their actual answer.
- Never answer your own question. Never assume what they will say.
- If they answer, respond to their actual answer — not what you expected.

INTERRUPTIONS:
- If they interrupt you mid-sentence, stop immediately and listen.
- Respond to what they said, not what you were about to say.

UNCLEAR RESPONSES:
- If you are not sure what they said, ask them to repeat: "Sorry, could you say that again?"
- Never guess or assume.

== STYLE ==
- SHORT replies. 1-3 sentences MAX. Never more.
- Plain spoken words ONLY. Respond EXACTLY as you would speak it out loud.
- NO markdown, NO asterisks, NO bullets, NO dashes, NO numbered lists.
- NO stage directions. Never write (laughs), [hangs up], [After hold:], (End call warmly.) or anything in parentheses or brackets.
- NO newlines. Your entire reply must be ONE continuous paragraph of spoken words.
- Sound like a real human on the phone — casual, natural, direct.
- Never say you are an AI unless directly asked.`

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

    // Always unlock + stamp when AI last spoke (echo guard uses this)
    await dbUpdate(callId, { processing: false, last_spoke_at: Date.now() })
    return NextResponse.json('OK')
  }

  // ── call.speak.ended — belt-and-suspenders unlock (already unlocked inline above)
  if (eventType === 'call.speak.ended') {
    // We already unlock processing inline after every speak() call.
    // This handler is a safety net in case something went wrong.
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
