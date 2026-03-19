/**
 * Telnyx Voice Webhook — AI voice agent v7.0
 * - Three call types: Alpha sales, custom AI task, personal call
 * - Personal calls: silent connect, no AI greeting or script
 * - Custom task calls: AI follows user's specific instructions
 * - Alpha sales calls: uses Alpha Auto Center sales script
 * - Echo filter, barge-in, transcription engine B, both tracks
 */
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'

const TELNYX_API_KEY = process.env.TELNYX_API_KEY || ''
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const TELNYX_BASE = 'https://api.telnyx.com/v2'
// Voice needs a FAST model — free models 429 too often, DeepSeek V3.2 thinking mode too slow
// Google Gemini Flash Lite is ultra-fast (lowest latency) and very cheap ($0.25/M in)
const AI_MODEL = 'google/gemini-2.5-flash-lite'
const VOICE = 'Telnyx.NaturalHD.orion'
const VOICE_FB = 'Telnyx.NaturalHD.sirius'

// ── Supabase helpers ──
async function dbGet(callId: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(callId)}&limit=1`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
  const rows = await r.json()
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}

async function dbUpsert(callId: string, data: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/ai_calls`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ id: callId, ...data }),
  })
}

async function dbPatch(callId: string, patch: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(callId)}`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

// ── Telnyx helpers ──
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
  await dbPatch(callId, { is_speaking: true, last_ai_text: clean })
  const r = await telnyxPost(`/calls/${callId}/actions/speak`, { payload: clean, payload_type: 'text', voice: VOICE })
  if (!r.ok) {
    console.log('[speak] primary voice failed, trying fallback')
    await telnyxPost(`/calls/${callId}/actions/speak`, { payload: clean, payload_type: 'text', voice: VOICE_FB })
  }
  console.log(`[speak] sent TTS: "${clean.slice(0, 80)}..."`)
}

// ── AI Chat via OpenRouter ──
async function aiChat(messages: Array<{ role: string; content: string }>, maxTokens = 120): Promise<string> {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://alpha-ai-desk.vercel.app' },
      body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: maxTokens, temperature: 0.7 }),
    })
    const d = await r.json()
    if (!r.ok) { console.error('[aiChat] HTTP error:', r.status, r.statusText, JSON.stringify(d)); return '' }
    if (d?.error) { console.error('[aiChat] API error:', JSON.stringify(d.error)); return '' }
    let text: string = d?.choices?.[0]?.message?.content?.trim() || ''
    // Strip thinking tags if model returns them
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    text = text.replace(/^["']|["']$/g, '').trim()
    text = text.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()
    text = text.replace(/\b(laughs|chuckles|pauses|sighs|warmly|cheerfully|gently|softly|nodding|click)\b/gi, '').trim()
    text = text.replace(/^[-*#]+\s*/gm, '').trim()
    text = text.replace(/ +/g, ' ').trim()
    const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
    if (lines.length > 1) {
      const leak = lines[1].startsWith('-') || lines[1].length < 20 || /^(speak|note|after|end|call|task|stage|step|next|if)/i.test(lines[1])
      text = leak ? lines[0] : lines.slice(0, 3).join(' ')
    }
    return text.trim()
  } catch (e) { console.error('[aiChat] error:', e); return '' }
}

// ÄÄ Clean raw AI text (strip markdown, stage directions, etc.) ÄÄ
function cleanAiText(raw: string): string {
  let text = raw
  text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/^["']|["']$/g, '').trim()
  text = text.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').trim()
  text = text.replace(/\b(laughs|chuckles|pauses|sighs|warmly|cheerfully|gently|softly|nodding|click)\b/gi, '').trim()
  text = text.replace(/^[-*#]+\s*/gm, '').trim()
  text = text.replace(/ +/g, ' ').trim()
  const lns = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0)
  if (lns.length > 1) {
    const leak = lns[1].startsWith('-') || lns[1].length < 20 || /^(speak|note|after|end|call|task|stage|step|next|if)/i.test(lns[1])
    text = leak ? lns[0] : lns.slice(0, 3).join(' ')
  }
  return text.trim()
}

// ÄÄ Stream AI response - speak first sentence immediately for low latency ÄÄ
async function streamAndSpeak(callId: string, messages: Array<{ role: string; content: string }>, maxTokens = 60): Promise<string> {
  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://alpha-ai-desk.vercel.app' },
      body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: maxTokens, temperature: 0.7, stream: true }),
    })
    if (!r.ok || !r.body) { console.error('[streamAndSpeak] HTTP error:', r.status); return '' }
    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let firstSentSpoken = false
    let done = false
    while (!done) {
      const { done: d, value } = await reader.read()
      done = d
      if (value) {
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') { done = true; break }
          try {
            const delta = JSON.parse(raw)?.choices?.[0]?.delta?.content || ''
            fullText += delta
            // Speak first complete sentence immediately (min 12 chars so we don't cut too early)
            if (!firstSentSpoken) {
              const m = fullText.match(/^(.{12,}?[.!?])(\s|$)/)
              if (m) {
                firstSentSpoken = true
                const firstSent = cleanAiText(m[1])
                if (firstSent) {
                  console.log('[streamAndSpeak] Speaking first sentence early:', firstSent.slice(0, 60))
                  await speak(callId, firstSent)
                }
              }
            }
          } catch { /* skip malformed SSE chunk */ }
        }
      }
    }
    const cleaned = cleanAiText(fullText)
    // If no sentence boundary was found (very short reply), speak the full thing
    if (!firstSentSpoken && cleaned) {
      console.log('[streamAndSpeak] No sentence boundary - speaking full reply:', cleaned.slice(0, 60))
      await speak(callId, cleaned)
    }
    return cleaned
  } catch (e) { console.error('[streamAndSpeak] error:', e); return '' }
}

// ÄÄ Detect Alpha conversation stage from history to prevent looping ÄÄ
function getAlphaStageContext(conversation: Array<{ role: string; content: string }>): string {
  const aiMsgs = conversation.filter(m => m.role === 'assistant').map(m => m.content.toLowerCase())
  const userMsgs = conversation.filter(m => m.role === 'user').map(m => m.content.toLowerCase())
  const askedOilChange = aiMsgs.some(m => /last.time|oil.change|how.long|when.*oil/i.test(m))
  const customerAnswered = userMsgs.some(m => /month|week|year|ago|recent|don.t know|never|always|just/i.test(m))
  const askedSchedule = aiMsgs.some(m => /thursday|friday|what day|which day|schedule|put you down|book you/i.test(m))
  const covered: string[] = []
  if (askedOilChange) covered.push('oil change question already asked')
  if (customerAnswered) covered.push('customer answered')
  if (askedSchedule) covered.push('scheduling day already asked')
  let stage = 'STAGE: Opening.'
  if (askedSchedule) stage = 'STAGE: Closing - confirm appointment day and location.'
  else if (askedOilChange && customerAnswered) stage = 'STAGE: Pitch price and get a specific day.'
  else if (askedOilChange) stage = 'STAGE: Waiting for their answer, then pitch price.'
  const coveredStr = covered.length > 0 ? ` ALREADY COVERED: ${covered.join(', ')}.` : ''
  return `${stage}${coveredStr} If they go off-topic, acknowledge briefly then return to current stage.`
}

// ── Alpha Auto Center system prompt ──
const ALPHA_SYSTEM = `You are Sam, an outbound salesperson calling local Houston customers for Alpha International Auto Center at 10710 South Main Street, Houston Texas. Phone: seven one three six six three six nine seven nine.

YOUR JOB: Sell oil changes. Be friendly, confident, and persuasive.

OIL CHANGE PRICES:
- Regular oil: thirty-four dollars and ninety-nine cents
- House synthetic: forty-four dollars and ninety-nine cents
- Valvoline full synthetic: fifty-four dollars and ninety-nine cents
- All prices include up to five quarts. Additional quarts cost extra.

OTHER SERVICES (only if asked): brakes, diagnostics, suspension, AC, engine, transmission, state inspections, paint and body.

REBUTTALS (use one per objection, then accept gracefully if they still say no):
- "I already have a place" -> "That is cool, we just want a chance to earn your business. We are fast, affordable, and right here on Main Street. Can we get you in this week?"
- "Not due yet" -> "Perfect timing, gives you a chance to try us out. Can we go ahead and get you on the schedule? This week or next?"
- "Too expensive" -> "I hear you, thirty-four ninety-nine including up to five quarts is honestly one of the best deals in Houston. What were you paying before?"
- "Busy" -> "I get it, we are quick, most oil changes done in under thirty minutes. Morning or afternoon work better?"
- "Just text me" -> "Absolutely, but real quick, do you have a day this week that works even tentatively? Thursday or Friday?"

CLOSING: Always try to get a specific day. Can I put you down for a day? Even tentatively, just so we hold a spot.

CONVERSATION FLOW (follow these stages in order):
1. OPEN: Greet them and ask how they are doing.
2. QUALIFY: Ask ONCE when they last got an oil change. Do NOT ask again.
3. PITCH: Suggest the right oil change and give the price.
4. SCHEDULE: Get a specific day. Thursday or Friday?
5. CLOSE: Confirm the day and address on South Main Street.

RULES:
- YOU called THEM. Never say Thanks for calling.
- 1-3 sentences max per reply. Short and punchy.
- CRITICAL: Check conversation history. NEVER repeat a question already answered. Move forward.
- If not interested or no thanks: give ONE rebuttal, then if still no say No problem, have a great day! and stop.
- If they say hold on or one sec say Of course, take your time. and wait.
- Spoken words only. No markdown, no bullets, no stage directions.`

// ── Handle call.answered ──
// Three call types:
// 1. Alpha sales call: task === 'Alpha Auto Center oil change call' or mentions auto services
// 2. AI task call: task has custom instructions (e.g. "ask if he's going to church")
// 3. Personal call: task is empty — user just wants to talk, no AI involvement
async function handleAnswered(callId: string, task: string) {
  try {
    console.log(`[handleAnswered] START callId=${callId.slice(0, 25)} task="${task.slice(0, 80)}"`) 
    const isAlpha = task === 'Alpha Auto Center oil change call' || (
      /oil.?change|brake|transmission|engine|state inspection/i.test(task) &&
      !/calling.*hotline|calling.*chatgpt|have a conversation|test.*call/i.test(task)
    )
    const isPersonalCall = !task || task.trim() === '' || task === 'personal call'
    const isCustomTask = !isAlpha && !isPersonalCall

    console.log(`[handleAnswered] callType: isAlpha=${isAlpha} isPersonalCall=${isPersonalCall} isCustomTask=${isCustomTask}`)

    await dbUpsert(callId, { status: 'active', task: task || 'personal call', greeted: false, processing: true, is_speaking: false, script_stage: 0, objection_count: 0, started_at: Date.now(), last_ai_text: '' })

    // Start transcription — use 'both' since 'inbound'/'outbound' alone can miss audio
    const txResult = await telnyxPost(`/calls/${callId}/actions/transcription_start`, {
      language: 'en',
      transcription_engine: 'B',
      transcription_tracks: 'both',
      interim_results: false,
    })
    console.log(`[handleAnswered] transcription_start result: ok=${txResult.ok} status=${txResult.status}`)

    await telnyxPost(`/calls/${callId}/actions/record_start`, { format: 'mp3', channels: 'dual', play_beep: false })

    // Personal call: no AI greeting, just connect silently
    if (isPersonalCall) {
      console.log('[handleAnswered] Personal call — skipping AI greeting, just connecting')
      await dbPatch(callId, { greeted: true, processing: false })
      return
    }

    // Build greeting based on call type
    let greetingPrompt: string
    let fallbackGreeting: string
    if (isAlpha) {
      greetingPrompt = ALPHA_SYSTEM + '\n\nSay your opening line to a Houston customer. One punchy sentence.\nYOU called THEM. Never say Thanks for calling.'
      fallbackGreeting = 'Hey there, this is Sam from Alpha International Auto Center. How are you doing today?'
    } else {
      // Custom AI task — greeting should reflect the user's actual instructions
      greetingPrompt = `You are making an outbound phone call on behalf of someone. Your specific task for this call is: "${task}"

Say a natural opening line that starts working toward completing your task. 1-2 sentences max. Be friendly and direct.
YOU called THEM. Never say Thanks for calling. No markdown, no stage directions.
Spoken words only.`
      fallbackGreeting = 'Hey, how are you doing today?'
    }

    const greeting = await aiChat([{ role: 'system', content: greetingPrompt }], 60) || fallbackGreeting

    const transcript = [{ speaker: 'ai', text: greeting }]
    const conversation = [{ role: 'assistant', content: greeting }]
    await dbPatch(callId, { greeted: true, transcript, conversation, greeting_sent_at: Date.now() })
    await speak(callId, greeting)
    // Do NOT unlock processing here — let call.speak.ended clear both
    // is_speaking and processing, so no echo transcription sneaks through
    console.log('[handleAnswered] DONE greeting sent, waiting for speak.ended to unlock')
  } catch (e) {
    console.error('[handleAnswered] ERROR:', e)
    await dbPatch(callId, { processing: false, is_speaking: false })
  }
}

// ── Handle transcription — conversation loop ──
async function handleTranscription(callId: string, text: string, isFinal: boolean) {
  try {
    console.log(`[handleTranscription] text="${text}" isFinal=${isFinal}`)

    // Only process final transcriptions for AI reply
    if (!isFinal) {
      console.log('[VOICE DEBUG] Dropped: not final transcription', { callId: callId.slice(0, 20), text })
      return
    }

    // Ignore very short utterances (noise, "uh", etc.)
    if (text.length < 3) {
      console.log('[VOICE DEBUG] Dropped: text too short', { callId: callId.slice(0, 20), text })
      return
    }

    const state = await dbGet(callId)
    if (!state) {
      console.log('[VOICE DEBUG] Dropped: no state found in DB', { callId: callId.slice(0, 20) })
      return
    }

    // Greeting cooldown — drop any transcription within 5s of the greeting
    // The greeting TTS gets picked up by 'both' tracks as a transcription echo
    const greetingSentAt = state.greeting_sent_at as number | undefined
    if (greetingSentAt && Date.now() - greetingSentAt < 5000) {
      console.log('[VOICE DEBUG] Dropped: greeting cooldown (within 5s of greeting)', { callId: callId.slice(0, 20), text: text.slice(0, 50), elapsed: Date.now() - greetingSentAt })
      return
    }

    // Echo filter — drop transcriptions that closely match ANY AI utterance in conversation
    // This prevents TTS bleed (AI's own voice being picked up and re-processed)
    const incoming = text.toLowerCase().trim()
    const echoConvo: Array<{ role: string; content: string }> = Array.isArray(state.conversation) ? state.conversation : []
    const aiTexts = echoConvo.filter(m => m.role === 'assistant').map(m => m.content.toLowerCase().trim())
    // Also include last_ai_text as a fallback
    const lastAiText = (state.last_ai_text || '').toLowerCase().trim()
    if (lastAiText && !aiTexts.includes(lastAiText)) aiTexts.push(lastAiText)

    for (const aiText of aiTexts) {
      if (aiText.length < 10) continue
      // Check if the incoming text is a substring of any AI utterance or vice versa
      if (aiText.includes(incoming) || incoming.includes(aiText.slice(0, 50))) {
        console.log('[VOICE DEBUG] Dropped: echo filter (matches AI text)', { callId: callId.slice(0, 20), text: text.slice(0, 50), matchedAi: aiText.slice(0, 50) })
        return
      }
      // Also check similarity — if >60% of words match, it's likely echo
      const aiWords = new Set(aiText.split(/\s+/))
      const inWords = incoming.split(/\s+/)
      if (inWords.length > 3) {
        const matchCount = inWords.filter(w => aiWords.has(w)).length
        const matchRatio = matchCount / inWords.length
        if (matchRatio > 0.6) {
          console.log('[VOICE DEBUG] Dropped: echo filter (word similarity)', { callId: callId.slice(0, 20), text: text.slice(0, 50), matchRatio: matchRatio.toFixed(2) })
          return
        }
      }
    }

    // If AI is currently speaking and human says 2+ words, barge-in
    let currentState = state
    if (state.is_speaking && text.split(' ').length >= 2) {
      await telnyxPost(`/calls/${callId}/actions/playback_stop`, { stop: 'all' })
      await dbPatch(callId, { is_speaking: false, processing: false })
      await new Promise(res => setTimeout(res, 200))
      // Only re-fetch DB state after barge-in since flags may have changed
      currentState = await dbGet(callId)
    }

    // Check processing flag — if locked, skip
    if (currentState?.processing) {
      console.log('[VOICE DEBUG] Dropped: processing=true', { callId: callId.slice(0, 20), text, processing: currentState.processing })
      return
    }

    console.log(`[handleTranscription] PROCESSING: "${text}"`)
    const transcript: Array<{ speaker: string; text: string }> = Array.isArray(currentState.transcript) ? [...currentState.transcript] : []
    const conversation: Array<{ role: string; content: string }> = Array.isArray(currentState.conversation) ? [...currentState.conversation] : []
    transcript.push({ speaker: 'customer', text })
    await dbPatch(callId, { processing: true, transcript })

    const objectionCount = (currentState.objection_count as number) || 0
    const isHardNo = /not interested|do not call|take me off|remove me|stop calling/i.test(text)
    const isSoftNo = /no thank|no thanks|can.?t right now|not right now|maybe later|not today|not looking/i.test(text)
    const isAlpha = (currentState.task || '') === 'Alpha Auto Center oil change call' || /oil.?change|auto.?center|brake|transmission|engine|state inspection/i.test(currentState.task || '')

    if (isHardNo || (isSoftNo && objectionCount >= 1)) {
      const bye = 'No problem at all, I appreciate your time. Have a great day!'
      transcript.push({ speaker: 'ai', text: bye })
      conversation.push({ role: 'assistant', content: bye })
      await dbPatch(callId, { transcript, conversation })
      await speak(callId, bye)
      // Unlock processing immediately — don't wait for speak.ended
      await dbPatch(callId, { processing: false })
      console.log('[handleTranscription] END: said goodbye')
      return
    }

    // Determine call type from stored task
    const storedTask = currentState.task || ''
    const isPersonal = !storedTask || storedTask === 'personal call'
    
    let systemPrompt: string
    if (isAlpha) {
      const stageCtx = getAlphaStageContext(conversation)
      systemPrompt = ALPHA_SYSTEM + `\n\n${stageCtx}\n\nThe customer just said: "${text}".\nRespond in 1 sentence. Spoken words only.`
    } else if (isPersonal) {
      // Personal call — AI should just have a natural conversation, no script
      systemPrompt = `You are on a live phone call. This is a personal call — just have a natural, friendly conversation. No sales pitch, no script.\n\nRULES:\n- Be conversational and friendly.\n- HOLD phrases: say Of course, take your time. and wait.\n- 1-3 sentences max. Natural spoken words. No markdown.`
    } else {
      // Custom AI task — AI must follow the user's specific instructions
      systemPrompt = `You are on a live phone call. You were given a specific task for this call: "${storedTask}"

CRITICAL: Stay focused on your task. Your job is to accomplish what you were asked to do.
Do NOT go off-topic. Do NOT pitch oil changes or any other unrelated services.

RULES:
- Stay on task: "${storedTask}"
- Answer their questions if they ask.
- HOLD phrases: say Of course, take your time. and wait.
- 1-3 sentences max. Natural spoken words. No markdown.`
    }

    const messages = [{ role: 'system', content: systemPrompt }, ...conversation.slice(-10), { role: 'user', content: text }]
    console.log('[handleTranscription] calling AI for response...')
    const reply = await streamAndSpeak(callId, messages, 60)

    if (reply) {
      console.log(`[handleTranscription] AI replied: "${reply.slice(0, 80)}"`)
      transcript.push({ speaker: 'ai', text: reply })
      conversation.push({ role: 'assistant', content: reply })
      const newObjCount = isSoftNo ? objectionCount + 1 : objectionCount
      await dbPatch(callId, { transcript, conversation, objection_count: newObjCount })
      // speak() already called inside streamAndSpeak - do not call again
      // Unlock processing immediately so next transcription can be processed
      // call.speak.ended acts as a safety net to clear is_speaking
      await dbPatch(callId, { processing: false })
    } else {
      console.log('[handleTranscription] AI returned empty, unlocking')
      await dbPatch(callId, { processing: false })
    }
  } catch (e) {
    console.error('[handleTranscription] ERROR:', e)
    await dbPatch(callId, { processing: false, is_speaking: false })
  }
}

// ── Main webhook — return 200 IMMEDIATELY then process ──
export async function POST(req: NextRequest) {
  const body = await req.json()
  const eventType = body?.data?.event_type as string
  const payload = body?.data?.payload as Record<string, unknown>
  const callId = payload?.call_control_id as string
  console.log(`[webhook] ${eventType} callId=${callId?.slice(0, 25) || 'n/a'}`)

  if (eventType === 'version') return NextResponse.json({ v: 'v7.0-call-types' })

  // call.initiated — create DB row early so state exists when other events arrive
  if (eventType === 'call.initiated') {
    let task = ''
    const cs = payload?.client_state as string
    if (cs) { try { task = JSON.parse(Buffer.from(cs, 'base64').toString()).task || '' } catch { /* ok */ } }
    console.log(`[webhook] call.initiated — creating DB row, task="${task.slice(0, 50)}"`) 
    waitUntil(dbUpsert(callId, { task, status: 'calling', greeted: false, processing: false, is_speaking: false, script_stage: 0, objection_count: 0, started_at: Date.now(), last_ai_text: '' }))
    return NextResponse.json('OK')
  }

  if (eventType === 'call.answered') {
    let task = ''
    const cs = payload?.client_state as string
    if (cs) { try { task = JSON.parse(Buffer.from(cs, 'base64').toString()).task || '' } catch { /* ok */ } }
    waitUntil(handleAnswered(callId, task))
    return NextResponse.json('OK')
  }

  // call.speak.ended — clear is_speaking AND processing flags
  // This is the authoritative unlock point: no transcription should be
  // processed while TTS is still playing (prevents echo re-processing).
  if (eventType === 'call.speak.ended') {
    console.log('[webhook] call.speak.ended — clearing is_speaking + processing')
    waitUntil(dbPatch(callId, { is_speaking: false, processing: false }))
    return NextResponse.json('OK')
  }

  if (eventType === 'call.transcription') {
    const td = payload?.transcription_data as Record<string, unknown>
    const text = (td?.transcript as string || '').trim()
    const isFinal = td?.is_final as boolean
    console.log(`[webhook] transcription: final=${isFinal} text="${text?.slice(0, 50)}"`)
    if (text) { waitUntil(handleTranscription(callId, text, isFinal)) }
    return NextResponse.json('OK')
  }

  if (eventType === 'call.recording.saved') {
    const urls = payload?.recording_urls
    let url = ''
    if (typeof urls === 'string') url = urls
    else if (urls && typeof urls === 'object') { url = (urls as Record<string, string>).mp3 || (urls as Record<string, string>).wav || Object.values(urls as Record<string, string>)[0] || '' }
    if (!url && payload?.public_url) url = payload.public_url as string
    if (url) waitUntil(dbPatch(callId, { recording_url: url }))
    return NextResponse.json('OK')
  }

  if (eventType === 'call.hangup') {
    waitUntil(dbPatch(callId, { status: 'ended', is_speaking: false, processing: false }))
    waitUntil((async () => {
      const state = await dbGet(callId)
      if (!state) return
      const transcript: Array<{ speaker: string; text: string }> = Array.isArray(state.transcript) ? state.transcript : []
      if (transcript.length > 1) {
        const lines = transcript.map((t: { speaker: string; text: string }) => `${t.speaker === 'ai' ? 'AI' : 'Person'}: ${t.text}`).join('\n')
        const summary = await aiChat([{ role: 'user', content: `Summarize this call in 3-5 bullet points.\nTask: ${state.task}\n\nTranscript:\n${lines}` }], 200)
        await dbPatch(callId, { summary: summary || `Call ended. ${transcript.length} exchanges.`, status: 'ended' })
      }
    })())
    return NextResponse.json('OK')
  }

  return NextResponse.json('OK')
}
