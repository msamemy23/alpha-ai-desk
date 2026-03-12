/**
 * Telnyx Voice Webhook — AI voice agent v3.0
 *
 * Fixes in this version:
 * - Engine B (no interim results) — AI only responds to FINAL transcriptions
 * - Barge-in uses is_speaking flag to stop playback when caller speaks
 * - "Not interested" / negative responses are handled gracefully (one soft rebuttal, then accept)
 * - Script stage tracking preserved
 * - Claude 3.7 Sonnet thinking for reasoning
 */

import { NextRequest, NextResponse } from 'next/server'

const TELNYX_API_KEY     = process.env.TELNYX_API_KEY     || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const SUPABASE_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY     || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const TELNYX_BASE        = 'https://api.telnyx.com/v2'

const AI_MODEL = 'anthropic/claude-3.7-sonnet:thinking'
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

  const result = await telnyxPost(`/calls/${callId}/actions/speak`, {
    payload: clean,
    payload_type: 'text',
    voice: VOICE,
  })

  if (!result.ok) {
    const fb = await telnyxPost(`/calls/${callId}/actions/speak`, {
      payload: clean,
      payload_type: 'text',
      voice: VOICE_FB,
    })
    if (!fb.ok) {
      await dbUpdate(callId, { is_speaking: false })
      return false
    }
  }
  return true
}

// ── Claude 3.7 (thinking) ─────────────────────────────────────────────────────
async function aiChat(
  messages: Array<{ role: string; content: string }>,
  maxTokens = 200
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
    const choice = d?.choices?.[0]?.message
    let text = ''

    if (Array.isArray(choice?.content)) {
      text = choice.content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join(' ')
        .trim()
    } else {
      text = choice?.content?.trim() || ''
    }

    // Clean output — strip everything that shouldn't be spoken
    text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim()
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    text = text.replace(/^["']|["']$/g, '').trim()
    text = text.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()
    text = text.replace(/\b(laughs|chuckles|pauses|sighs|warmly|cheerfully|gently|softly|nodding)\b/gi, '').trim()
    text = text.replace(/^[-•*#]+\s*/gm, '').trim()
    text = text.replace(/  +/g, ' ').trim()

    // Collapse multi-line leaked instructions
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length > 1) {
      const leak = lines[1].startsWith('-') || lines[1].length < 20 ||
        /^(speak|note|after|end|call|task|stage|step|next)/i.test(lines[1])
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
    return pipeMatch[1].split('|').map(s => s.trim()).filter(Boolean)
  }
  const numbered = task.match(/SCRIPT:\s*\n([\s\S]+)/i)
  if (numbered) {
    const stages = numbered[1].match(/\d+\.\s*(.+)/g)
    if (stages && stages.length > 1) {
      return stages.map(s => s.replace(/^\d+\.\s*/, '').trim())
    }
  }
  return null
}

// ── Alpha Auto Center script context ─────────────────────────────────────────
const ALPHA_SCRIPT = `
== ALPHA INTERNATIONAL AUTO CENTER — OUTBOUND SALES SCRIPT ==

BUSINESS: Alpha International Auto Center, ten thousand seven hundred ten South Main Street, Houston, Texas, seven seven zero two five. Phone: seven one three, six six three, six nine seven nine.

MAIN OFFER — OIL CHANGES:
- Regular oil: thirty-four dollars and ninety-nine cents
- House synthetic oil: forty-four dollars and ninety-nine cents
- Valvoline full synthetic: fifty-four dollars and ninety-nine cents
- All prices include up to five quarts. Additional quarts cost extra.
- We are fast, affordable, and convenient — right here in Houston.

OTHER SERVICES (mention briefly as added value, only detail if asked):
Brakes, diagnostics, suspension, air conditioning repair, engine work, transmission work, state inspections, and paint and body work.

OBJECTION REBUTTALS (use ONE rebuttal per objection, then accept gracefully if they still say no):

"I already have a place":
Say: "That's totally fine, we just ask for a chance to earn your business. A lot of our customers said the same thing before they tried us — and now they're regulars. We make it easy and affordable. Can we get you in this week?"

"I'm not due yet":
Say: "Perfect timing then — that gives you a chance to come check us out before you need it. We can go ahead and get you on the schedule so when you are due, you're already set. Would this week or next work better?"

"That's too much" / price objection:
Say: "I hear you — and honestly, thirty-four ninety-nine for a full oil change including up to five quarts is one of the best deals in Houston. We don't cut corners. What price were you paying before?"

"I'm busy":
Say: "I totally get it. We're quick — most oil changes are done in under thirty minutes. We work around your schedule. What time of day works best for you, morning or afternoon?"

"What else do y'all do?":
Say: "We do a lot more than oil changes. We handle brakes, diagnostics, suspension, air conditioning, engine work, transmission, state inspections, and paint and body work. We're a full-service shop. But our best deal right now is definitely the oil change — want to start there?"

"Just text me":
Say: "Absolutely, I can do that. But real quick before I let you go — do you have a day this week that works, even tentatively? That way I'm not just sending a text into the void. What about Thursday or Friday?"

CLOSING:
Always try to get a commitment — a specific day, even tentative.
Strong close: "So can I put you down for [day]? Even if it's tentative, I want to make sure we hold a spot for you."
If they agree: "Perfect, we'll see you then. Address is ten thousand seven hundred ten South Main, right off Main Street. Any questions, call us at seven one three, six six three, six nine seven nine."

TONE: Friendly, confident, and always be selling. Sound like a real local salesperson — not a robot. Be persistent but not pushy. One rebuttal per objection max. If they firmly say no after your rebuttal, thank them and let them go gracefully.
`

// ── Webhook handler ───────────────────────────────────────────────────────────
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

    await dbUpdate(callId, {
      status: 'active', task,
      greeted: false, processing: false,
      is_speaking: false, script_stage: 0,
    })

    // Engine B = accurate, final-only transcriptions. No interim flooding.
    await telnyxPost(`/calls/${callId}/actions/transcription_start`, {
      language: 'en',
      transcription_engine: 'B',
      transcription_tracks: 'inbound',
    })

    // Start recording
    await telnyxPost(`/calls/${callId}/actions/record_start`, {
      format: 'mp3', channels: 'dual', play_beep: false,
    })

    await dbUpdate(callId, { processing: true })

    // Determine if this is the Alpha Auto Center sales call
    const isAlphaScript = /alpha|oil change|auto center|SCRIPT:/i.test(task)

    const greetingPrompt = stages
      ? `You are making an outbound sales call. Stage 1 of ${stages.length}: "${stages[0]}"
Say ONLY this opener out loud — 1-2 natural sentences. YOU are calling THEM. No "Thanks for calling". No markdown. No brackets.`
      : isAlphaScript
      ? `${ALPHA_SCRIPT}
You are calling a local Houston customer to offer an oil change deal.
Say your opening line — friendly, confident, 1-2 sentences. Get their attention immediately.
YOU are calling THEM. Do NOT say "Thanks for calling". Speak naturally like a real salesperson.`
      : `You are making an outbound call. Task: "${task}"
Say your opening line — 1-2 sentences, natural and direct.
YOU are calling THEM. Do NOT say "Thanks for calling". No markdown, no brackets. You can call yourself Sam.`

    const greeting = await aiChat([{ role: 'system', content: greetingPrompt }], 80) ||
      `Hey, this is Sam calling from Alpha International Auto Center — do you have a quick second?`

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

    // ── BARGE-IN: stop AI speech when caller speaks ───────────────────────
    if (state.is_speaking && text.split(' ').length >= 2) {
      console.log('[barge-in] stopping AI, caller said:', text.slice(0, 60))
      await stopSpeaking(callId)
      await dbUpdate(callId, { is_speaking: false })
      await new Promise(r => setTimeout(r, 400))
    }

    // Only generate AI reply on FINAL transcriptions — not partials
    if (!isFinal) return NextResponse.json('OK')

    // Already processing
    if (state.processing) return NextResponse.json('OK')

    // Echo guard — cooldown after AI spoke
    const lastSpoke = (state.last_spoke_at as number) || 0
    if (Date.now() - lastSpoke < 2000) {
      console.log('[echo-guard] dropped:', text.slice(0, 60))
      return NextResponse.json('OK')
    }

    // Text echo guard
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    const normText = normalize(text)
    const recentAi = (Array.isArray(state.transcript) ? state.transcript : [])
      .filter((l: { speaker: string }) => l.speaker === 'ai').slice(-3)
    const isEcho = recentAi.some((l: { text: string }) => {
      const normAi = normalize(l.text)
      if (normText.split(' ').length < 4) return false
      return normAi.includes(normText) || normText.includes(normAi.slice(0, 40))
    })
    if (isEcho) {
      console.log('[echo-guard] text match dropped:', text.slice(0, 60))
      return NextResponse.json('OK')
    }

    await dbUpdate(callId, { processing: true })

    const transcript: Array<{ speaker: string; text: string }> =
      Array.isArray(state.transcript) ? [...state.transcript]
      : typeof state.transcript === 'string' ? JSON.parse(state.transcript || '[]') : []
    const conversation: Array<{ role: string; content: string }> =
      Array.isArray(state.conversation) ? [...state.conversation]
      : typeof state.conversation === 'string' ? JSON.parse(state.conversation || '[]') : []

    transcript.push({ speaker: 'customer', text })
    await dbUpdate(callId, { transcript })

    // ── Detect hard hang-up / not interested ─────────────────────────────
    const isHardNo = /not interested|do not call|take me off|remove me|stop calling|goodbye|bye|hang up/i.test(text)
    const isSoftNo = /no thank|no thanks|cant right now|can't right now|not right now|maybe later|not today/i.test(text)
    const objectionCount = (state.objection_count as number) || 0

    // If they already had one rebuttal and still say no — let them go
    if ((isHardNo || (isSoftNo && objectionCount >= 1))) {
      const farewell = 'No problem at all — I appreciate your time. Have a great day!'
      transcript.push({ speaker: 'ai', text: farewell })
      conversation.push({ role: 'assistant', content: farewell })
      await dbUpdate(callId, { transcript, conversation, processing: false })
      await speak(callId, farewell)
      await dbUpdate(callId, { is_speaking: false })
      return NextResponse.json('OK')
    }

    // Script stage context
    const stages      = parseScript(state.task || '')
    const scriptStage = (state.script_stage as number) || 0
    let scriptContext = ''

    if (stages && stages.length > 0) {
      const current = stages[Math.min(scriptStage, stages.length - 1)]
      const next    = scriptStage + 1 < stages.length ? stages[scriptStage + 1] : null
      scriptContext = `
== SCRIPT STAGE ${scriptStage + 1} of ${stages.length} ==
Current goal: "${current}"
${next ? `Next stage (transition to this when current is done): "${next}"` : 'Final stage — wrap up and close.'}
Complete current stage before moving on. Never skip stages.`
    }

    // Determine if Alpha Auto Center sales call
    const isAlphaCall = /alpha|oil change|auto center|SCRIPT:/i.test(state.task || '')

    const system = isAlphaCall
      ? `${ALPHA_SCRIPT}
${scriptContext}

You are on a live phone call following the Alpha Auto Center sales script above.
The customer just said: "${text}"

CRITICAL RULES:
- WAIT for them to finish speaking before you reply. NEVER talk over them.
- If they ask a question, ANSWER their question first, then sell.
- If they say "not interested" or "no thanks", use ONE rebuttal from the script, then accept if they still say no.
- If they said "not interested" already in this conversation and you already gave a rebuttal, let them go gracefully.
- 1-3 sentences max. Spoken words only. Natural, confident, friendly.
- No markdown, no bullets, no stage directions, no brackets.`
      : `You are on a live phone call. Task: "${state.task}"
${scriptContext}

CRITICAL RULES:
- WAIT for them to actually finish speaking before replying.
- ANSWER their question if they asked one — don't ignore it.
- "Not interested" = ONE soft rebuttal, then let them go if still no.
- HOLD/WAIT phrases = say "Of course, take your time" and wait silently.
- Backchannel words (mm-hmm, yeah, ok) = they are listening, not answering your question yet.
- 1-3 sentences max. No markdown. No stage directions. Natural human speech.`

    const messages = [
      { role: 'system', content: system },
      ...conversation.slice(-10),
      { role: 'user', content: text },
    ]

    const reply = await aiChat(messages, 120)

    if (reply) {
      transcript.push({ speaker: 'ai', text: reply })
      conversation.push({ role: 'assistant', content: reply })

      // Track objection count for soft-no handling
      const newObjCount = isSoftNo ? objectionCount + 1 : objectionCount

      // Advance script stage if appropriate
      let newStage = scriptStage
      if (stages && stages.length > 0) {
        const advanceTriggers = /great|perfect|sounds good|moving on|let me tell you|speaking of|also wanted|can I also/i
        if (advanceTriggers.test(reply)) {
          newStage = Math.min(scriptStage + 1, stages.length - 1)
        }
      }

      await dbUpdate(callId, {
        transcript, conversation,
        script_stage: newStage,
        objection_count: newObjCount,
      })
      await speak(callId, reply)
    }

    await dbUpdate(callId, { processing: false, is_speaking: false })
    return NextResponse.json('OK')
  }

  // ── call.recording.saved ──────────────────────────────────────────────────
  if (eventType === 'call.recording.saved') {
    const urls = payload?.recording_urls
    let recordingUrl = ''
    if (typeof urls === 'string') recordingUrl = urls
    else if (urls && typeof urls === 'object') {
      recordingUrl = (urls as Record<string, string>).mp3
        || (urls as Record<string, string>).wav
        || Object.values(urls as Record<string, string>)[0] || ''
    }
    if (!recordingUrl && payload?.public_url) recordingUrl = payload.public_url as string
    if (recordingUrl) await dbUpdate(callId, { recording_url: recordingUrl })
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

    if (transcript.length > 0) {
      const lines   = transcript.map(t => `${t.speaker === 'ai' ? 'AI' : 'Person'}: ${t.text}`).join('\n')
      const summary = await aiChat([{
        role: 'user',
        content: `Summarize this sales call in 3-5 bullet points. Be concise.\nTask: ${state.task}\n\nTranscript:\n${lines}`,
      }], 250)
      await dbUpdate(callId, { summary: summary || `Call ended. ${transcript.length} exchanges.`, status: 'ended' })
    }

    return NextResponse.json('OK')
  }

  return NextResponse.json('OK')
}
