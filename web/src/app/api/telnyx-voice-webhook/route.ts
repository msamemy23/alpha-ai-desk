/**
 * Telnyx Voice Webhook — AI voice agent
 *
 * Upgrades in this version:
 * 1. Claude 3.7 Sonnet (thinking) — reasons before replying, handles complex calls
 * 2. Barge-in — calls playback_stop the instant caller speaks while AI is talking
 * 3. is_speaking flag — tracked in Supabase, drives barge-in decision
 * 4. Script stage tracking — structured scripts are parsed into stages; AI always
 *    knows exactly where it is and what comes next
 */

import { NextRequest, NextResponse } from 'next/server'

const TELNYX_API_KEY     = process.env.TELNYX_API_KEY     || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const SUPABASE_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL  || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_KEY      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const TELNYX_BASE        = 'https://api.telnyx.com/v2'

// Claude 3.7 Sonnet with thinking — reasons silently, only outputs spoken words
const AI_MODEL  = 'anthropic/claude-3.7-sonnet:thinking'
const VOICE     = 'Telnyx.Natural.abbie'
const VOICE_FB  = 'female'

// ── Supabase helpers ──────────────────────────────────────────────────────────
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
      method:  'PATCH',
      headers: {
        apikey:          SUPABASE_KEY,
        Authorization:   `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(patch),
    }
  )
}

// ── Telnyx helpers ────────────────────────────────────────────────────────────
async function telnyxPost(path: string, body: Record<string, unknown>) {
  const r = await fetch(`${TELNYX_BASE}${path}`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  return { ok: r.ok, data: await r.json() }
}

/** Stop TTS mid-sentence (barge-in) */
async function stopSpeaking(callId: string) {
  await telnyxPost(`/calls/${callId}/actions/playback_stop`, { stop: 'all' })
  // Also try speak stop path
  await fetch(`${TELNYX_BASE}/calls/${callId}/actions/speak`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
  }).catch(() => {/* ignore */})
}

/** Speak text — sets is_speaking true before, false after */
async function speak(callId: string, text: string): Promise<boolean> {
  const clean = text.replace(/"/g, "'").slice(0, 3000)
  await dbUpdate(callId, { is_speaking: true })

  const result = await telnyxPost(`/calls/${callId}/actions/speak`, {
    payload:      clean,
    payload_type: 'text',
    voice:        VOICE,
  })

  if (!result.ok) {
    console.error('[speak] primary voice failed, trying fallback')
    const fb = await telnyxPost(`/calls/${callId}/actions/speak`, {
      payload:      clean,
      payload_type: 'text',
      voice:        VOICE_FB,
    })
    if (!fb.ok) {
      await dbUpdate(callId, { is_speaking: false })
      return false
    }
  }

  // Unlock after the speak API call returns (TTS is now playing)
  // We keep is_speaking=true until call.speak.ended fires OR barge-in fires
  await dbUpdate(callId, { last_spoke_at: Date.now() })
  return true
}

// ── Claude 3.7 Sonnet (thinking) ──────────────────────────────────────────────
async function aiChat(
  messages: Array<{ role: string; content: string }>,
  maxTokens = 300
): Promise<string> {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://alpha-ai-desk.vercel.app',
      },
      body: JSON.stringify({
        model:      AI_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
        // thinking is automatically handled by OpenRouter for :thinking variant
      }),
    })
    const d = await r.json()

    let text = ''
    const choice = d?.choices?.[0]?.message

    // Claude thinking returns content as array of blocks OR plain string
    if (Array.isArray(choice?.content)) {
      // Extract only text blocks (thinking blocks are automatically excluded by OpenRouter)
      text = choice.content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join(' ')
        .trim()
    } else {
      text = choice?.content?.trim() || ''
    }

    // Strip thinking tags just in case they leak through
    text = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim()
    // Strip markdown
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    // Strip surrounding quotes
    text = text.replace(/^["']|["']$/g, '').trim()
    // Strip parenthetical/bracketed stage directions
    text = text.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()
    // Strip bare stage direction words
    text = text.replace(/\b(laughs|chuckles|pauses|sighs|warmly|cheerfully|gently|softly|nodding|hangs up|ends call)\b/gi, '').trim()
    // Strip markdown bullets/headers
    text = text.replace(/^[-•*#]+\s*/gm, '').trim()
    // Collapse extra spaces
    text = text.replace(/  +/g, ' ').trim()
    // Collapse to first meaningful block if AI leaked instructions
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
    if (lines.length > 1) {
      const secondIsInstruction = lines[1].startsWith('-') || lines[1].length < 20 ||
        /^(speak|note|after|end|call|task|the only)/i.test(lines[1])
      text = secondIsInstruction ? lines[0] : lines.slice(0, 3).join(' ')
    }

    return text.trim()
  } catch (e) {
    console.error('[aiChat] error:', e)
    return ''
  }
}

// ── Script parsing ────────────────────────────────────────────────────────────
/**
 * Detect if task contains a structured script.
 * Supported formats:
 *   SCRIPT: [opener] | [pitch] | [close]       <- pipe-delimited stages
 *   SCRIPT:\n1. opener\n2. pitch\n3. close      <- numbered list
 *   Just a plain task string                   <- no stages, freeform
 */
function parseScript(task: string): string[] | null {
  // Pipe-delimited: "SCRIPT: opener | pitch | close"
  const pipeMatch = task.match(/SCRIPT:\s*(.+)/i)
  if (pipeMatch && pipeMatch[1].includes('|')) {
    return pipeMatch[1].split('|').map(s => s.trim()).filter(Boolean)
  }
  // Numbered list: "SCRIPT:\n1. ...\n2. ..."
  const numbered = task.match(/SCRIPT:\s*\n([\s\S]+)/i)
  if (numbered) {
    const stages = numbered[1].match(/\d+\.\s*(.+)/g)
    if (stages && stages.length > 1) {
      return stages.map(s => s.replace(/^\d+\.\s*/, '').trim())
    }
  }
  return null
}

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

    // Parse script stages if present
    const stages = parseScript(task)

    await dbUpdate(callId, {
      status:       'active',
      task,
      greeted:      false,
      processing:   false,
      is_speaking:  false,
      script_stage: 0,
    })

    // Start transcription (engine A for interim results = faster barge-in detection)
    await telnyxPost(`/calls/${callId}/actions/transcription_start`, {
      language:             'en',
      transcription_engine: 'A',
      transcription_tracks: 'inbound',
      interim_results:      true,
    })

    // Start recording
    await telnyxPost(`/calls/${callId}/actions/record_start`, {
      format:     'mp3',
      channels:   'dual',
      play_beep:  false,
    })

    await dbUpdate(callId, { processing: true })

    // Generate greeting
    const greetingSystem = stages
      ? `You are making an outbound phone call. This is stage 1 of ${stages.length} in your script.
Stage 1 (opener): "${stages[0]}"
Say ONLY the opener — spoken out loud, naturally. 1-2 sentences max.
YOU are calling THEM. Do NOT say "Thanks for calling". No markdown, no stage directions, no brackets.`
      : `You are making an outbound phone call. Your task: "${task}"
Say your opening line out loud. 1-2 sentences max.
YOU are calling THEM. Do NOT say "Thanks for calling". No markdown, no stage directions.
You can call yourself Sam if needed. NEVER use [Your Name] placeholder.`

    const greeting = await aiChat([{ role: 'system', content: greetingSystem }], 80) ||
      `Hey, calling from Alpha International Auto Center — ${stages ? stages[0] : task}`

    const transcript   = [{ speaker: 'ai', text: greeting }]
    const conversation = [{ role: 'assistant', content: greeting }]

    await dbUpdate(callId, { greeted: true, transcript, conversation })
    await speak(callId, greeting)
    await dbUpdate(callId, { processing: false, is_speaking: false })

    return NextResponse.json('OK')
  }

  // ── call.speak.ended — AI finished speaking naturally ─────────────────────
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

    // ── BARGE-IN: if AI is speaking and caller says something real, stop it ──
    if (state.is_speaking) {
      // Only barge-in on meaningful speech (not noise / single words)
      if (text.split(' ').length >= 2) {
        console.log('[barge-in] stopping AI speech, caller said:', text.slice(0, 60))
        await stopSpeaking(callId)
        await dbUpdate(callId, { is_speaking: false })
        // Small pause to let audio stop before we process
        await new Promise(r => setTimeout(r, 300))
      } else {
        return NextResponse.json('OK') // too short, ignore
      }
    }

    // Only process final transcriptions for the actual AI reply
    if (!isFinal) return NextResponse.json('OK')

    // Already processing another turn
    if (state.processing) return NextResponse.json('OK')

    // ── Echo guard ────────────────────────────────────────────────────────────
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    const normText  = normalize(text)
    const lastSpoke = (state.last_spoke_at as number) || 0

    if (Date.now() - lastSpoke < 2000) {
      console.log('[transcription] cooldown echo dropped:', text.slice(0, 60))
      return NextResponse.json('OK')
    }

    const recentAi = (Array.isArray(state.transcript) ? state.transcript : [])
      .filter((l: { speaker: string }) => l.speaker === 'ai').slice(-3)
    const isEcho = recentAi.some((l: { text: string }) => {
      const normAi = normalize(l.text)
      const words  = normText.split(' ').length
      if (words < 4) return false
      return normAi.includes(normText) || normText.includes(normAi.slice(0, 40))
    })
    if (isEcho) {
      console.log('[transcription] text echo dropped:', text.slice(0, 60))
      return NextResponse.json('OK')
    }

    // Lock
    await dbUpdate(callId, { processing: true })

    const transcript: Array<{ speaker: string; text: string }> =
      Array.isArray(state.transcript) ? [...state.transcript]
      : typeof state.transcript === 'string' ? JSON.parse(state.transcript || '[]')
      : []
    const conversation: Array<{ role: string; content: string }> =
      Array.isArray(state.conversation) ? [...state.conversation]
      : typeof state.conversation === 'string' ? JSON.parse(state.conversation || '[]')
      : []

    transcript.push({ speaker: 'customer', text })
    await dbUpdate(callId, { transcript })

    // ── Build system prompt ───────────────────────────────────────────────────
    const stages       = parseScript(state.task || '')
    const scriptStage  = (state.script_stage as number) || 0
    let scriptContext  = ''

    if (stages && stages.length > 0) {
      const currentStage = stages[Math.min(scriptStage, stages.length - 1)]
      const nextStage    = scriptStage + 1 < stages.length ? stages[scriptStage + 1] : null
      scriptContext = `
== SCRIPT PROGRESS ==
You are following a ${stages.length}-stage script.
Current stage (${scriptStage + 1}/${stages.length}): "${currentStage}"
${nextStage ? `Next stage when current is complete: "${nextStage}"` : 'This is the final stage — wrap up the call.'}

IMPORTANT: Complete the current stage naturally before moving on.
When the current stage goal is achieved, smoothly transition to the next stage.
Never skip stages. Never lose your place.`
    }

    const system = `You are on a live phone call. Your task: "${state.task}"
${scriptContext}

== SITUATIONAL AWARENESS ==

BARGE-IN: The caller just interrupted you. Acknowledge briefly and respond to what they said.

HOLD / WAIT: If they say "hold on", "one sec", "let me check", "hang on" — say "Of course, take your time." Then WAIT. Do not keep talking.

SILENCE / BACKCHANNEL: "mm-hmm", "ok", "yeah", "uh-huh" = they are listening, not answering. Don't treat it as a full response.

QUESTIONS you ask: After asking, STOP. Wait for their real answer. Never answer your own questions.

UNCLEAR: If you didn't understand, ask "Sorry, could you say that again?"

OBJECTIONS: Acknowledge their concern first, then respond. Don't bulldoze past objections.

== STYLE ==
- 1-3 sentences MAX. Short, punchy, natural.
- Spoken words ONLY. No markdown, no bullets, no stage directions, no brackets, no parentheses.
- Sound like a real human — casual, confident, direct.
- Never say you are an AI unless directly asked.`

    const messages = [
      { role: 'system',    content: system },
      ...conversation.slice(-10),
      { role: 'user',      content: text },
    ]

    const reply = await aiChat(messages, 120)

    if (reply) {
      transcript.push({ speaker: 'ai', text: reply })
      conversation.push({ role: 'assistant', content: reply })

      // Advance script stage if current stage seems complete
      let newStage = scriptStage
      if (stages && stages.length > 0) {
        // Simple heuristic: if the AI reply is a transition phrase or if we've had
        // enough back-and-forth on this stage (3+ turns), consider advancing
        const stageExchanges = conversation.filter(m => m.role === 'user').length
        const advanceTriggers = /great|perfect|moving on|next|let me tell you|speaking of|also wanted/i
        if (advanceTriggers.test(reply) && stageExchanges > scriptStage * 2) {
          newStage = Math.min(scriptStage + 1, stages.length - 1)
        }
      }

      await dbUpdate(callId, { transcript, conversation, script_stage: newStage })
      await speak(callId, reply)
    }

    await dbUpdate(callId, { processing: false, is_speaking: false })
    return NextResponse.json('OK')
  }

  // ── call.recording.saved ──────────────────────────────────────────────────
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

  // ── call.hangup — generate summary ───────────────────────────────────────
  if (eventType === 'call.hangup') {
    const state = await dbGet(callId)
    if (!state) return NextResponse.json('OK')
    await dbUpdate(callId, { status: 'ended', is_speaking: false })

    const transcript: Array<{ speaker: string; text: string }> =
      Array.isArray(state.transcript) ? state.transcript
      : typeof state.transcript === 'string' ? JSON.parse(state.transcript || '[]')
      : []

    if (transcript.length > 0) {
      const lines   = transcript.map(t => `${t.speaker === 'ai' ? 'AI' : 'Person'}: ${t.text}`).join('\n')
      const summary = await aiChat([{
        role:    'user',
        content: `Summarize this call in 3-5 bullet points. Be concise and factual.\nTask: ${state.task}\n\nTranscript:\n${lines}`,
      }], 250)
      await dbUpdate(callId, {
        summary: summary || `Call ended. ${transcript.length} exchanges.`,
        status:  'ended',
      })
    }

    return NextResponse.json('OK')
  }

  return NextResponse.json('OK')
}
