/**
 * Telnyx Voice Webhook — AI voice agent v6.1
 * - Returns 200 IMMEDIATELY to Telnyx, uses waitUntil() for async work
 * - FIXED: processing flag cleared immediately after speak() (no DB race)
 * - FIXED: removed echo guard entirely (inbound-only transcription = no echo)
 * - FIXED: transcription_tracks='both' for reliable remote party capture
 * - FIXED: comprehensive debug logging on every early return
 * - FIXED: Supabase env var fallback chain (SERVICE_ROLE_KEY -> SERVICE_KEY -> ANON)
 * - FIXED: voice model switched to DeepSeek V3.2 (Qwen free had 429 rate limits)
 * - FIXED: call.initiated handler to create DB row early
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

RULES:
- YOU called THEM. Never say Thanks for calling.
- 1-3 sentences max per reply. Short and punchy.
- Wait for them to finish. Never answer your own questions.
- If not interested or no thanks: give ONE rebuttal, then if still no say No problem, have a great day! and stop.
- If they say hold on or one sec say Of course, take your time. and wait.
- Spoken words only. No markdown, no bullets, no stage directions.`

// ── Handle call.answered ──
async function handleAnswered(callId: string, task: string) {
  try {
    console.log(`[handleAnswered] START callId=${callId.slice(0, 25)} task="${task.slice(0, 50)}"`)
    // Only use the Alpha sales script if this is explicitly an Alpha sales task
    // Do NOT match generic tasks that just mention the shop name
    const isAlpha = task === 'Alpha Auto Center oil change call' || (
      /oil.?change|brake|transmission|engine|state inspection/i.test(task) &&
      !/calling.*hotline|calling.*chatgpt|have a conversation|test.*call/i.test(task)
    )
    await dbUpsert(callId, { status: 'active', task, greeted: false, processing: true, is_speaking: false, script_stage: 0, objection_count: 0, started_at: Date.now(), last_ai_text: '' })

    // Start transcription — use 'both' to capture both sides of the conversation
    // Engine 'B' (Telnyx engine) is more reliable for diverse audio sources
    const txResult = await telnyxPost(`/calls/${callId}/actions/transcription_start`, {
      language: 'en',
      transcription_engine: 'B',
      transcription_tracks: 'both',
      interim_results: false,
    })
    console.log(`[handleAnswered] transcription_start result: ok=${txResult.ok} status=${txResult.status}`)

    await telnyxPost(`/calls/${callId}/actions/record_start`, { format: 'mp3', channels: 'dual', play_beep: false })

    const greetingPrompt = isAlpha
      ? ALPHA_SYSTEM + '\n\nSay your opening line to a Houston customer. One punchy sentence.\nYOU called THEM. Never say Thanks for calling.'
      : `You are making an outbound call. Task: "${task}"\nSay your opening line. 1-2 natural sentences. YOU called THEM. Never say Thanks for calling. No markdown.`

    const greeting = await aiChat([{ role: 'system', content: greetingPrompt }], 60) || "Hey, this is Sam from Alpha International Auto Center. Quick question, when was your last oil change?"

    const transcript = [{ speaker: 'ai', text: greeting }]
    const conversation = [{ role: 'assistant', content: greeting }]
    await dbPatch(callId, { greeted: true, transcript, conversation })
    await speak(callId, greeting)
    // Immediately unlock processing so transcriptions are accepted
    await dbPatch(callId, { processing: false })
    console.log('[handleAnswered] DONE greeting sent, processing=false')
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
    if (text.length < 2) {
      console.log('[VOICE DEBUG] Dropped: text too short', { callId: callId.slice(0, 20), text })
      return
    }

    const state = await dbGet(callId)
    if (!state) {
      console.log('[VOICE DEBUG] Dropped: no state found in DB', { callId: callId.slice(0, 20) })
      return
    }

    // If AI is currently speaking and human says 2+ words, barge-in
    if (state.is_speaking && text.split(' ').length >= 2) {
      console.log('[handleTranscription] BARGE-IN: stopping AI speech')
      await telnyxPost(`/calls/${callId}/actions/playback_stop`, { stop: 'all' })
      await dbPatch(callId, { is_speaking: false, processing: false })
      await new Promise(res => setTimeout(res, 200))
    }

    // Check processing flag — if locked, skip
    const freshState = await dbGet(callId)
    if (freshState?.processing) {
      console.log('[VOICE DEBUG] Dropped: processing=true', { callId: callId.slice(0, 20), text, processing: freshState.processing })
      return
    }

    // Lock immediately
    console.log(`[handleTranscription] PROCESSING: "${text}"`)
    await dbPatch(callId, { processing: true })

    const transcript: Array<{ speaker: string; text: string }> = Array.isArray(freshState.transcript) ? [...freshState.transcript] : []
    const conversation: Array<{ role: string; content: string }> = Array.isArray(freshState.conversation) ? [...freshState.conversation] : []
    transcript.push({ speaker: 'customer', text })
    await dbPatch(callId, { transcript })

    const objectionCount = (freshState.objection_count as number) || 0
    const isHardNo = /not interested|do not call|take me off|remove me|stop calling/i.test(text)
    const isSoftNo = /no thank|no thanks|can.?t right now|not right now|maybe later|not today|not looking/i.test(text)
    const isAlpha = (freshState.task || '') === 'Alpha Auto Center oil change call' || /oil.?change|auto.?center|brake|transmission|engine|state inspection/i.test(freshState.task || '')

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

    const systemPrompt = isAlpha
      ? ALPHA_SYSTEM + `\n\nThe customer just said: "${text}"\nRespond naturally. 1-3 sentences max. Spoken words only.`
      : `You are on a live phone call. Task: "${freshState.task}"\n\nRULES:\n- Answer their question if they asked one.\n- HOLD phrases: say Of course, take your time. and wait.\n- 1-3 sentences max. Natural spoken words. No markdown.`

    const messages = [{ role: 'system', content: systemPrompt }, ...conversation.slice(-10), { role: 'user', content: text }]
    console.log('[handleTranscription] calling AI for response...')
    const reply = await aiChat(messages, 100)

    if (reply) {
      console.log(`[handleTranscription] AI replied: "${reply.slice(0, 80)}"`)
      transcript.push({ speaker: 'ai', text: reply })
      conversation.push({ role: 'assistant', content: reply })
      const newObjCount = isSoftNo ? objectionCount + 1 : objectionCount
      await dbPatch(callId, { transcript, conversation, objection_count: newObjCount })
      await speak(callId, reply)
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

  if (eventType === 'version') return NextResponse.json({ v: 'v6.5-voice-fix' })

  // call.initiated — create DB row early so state exists when other events arrive
  if (eventType === 'call.initiated') {
    let task = 'Alpha Auto Center oil change call'
    const cs = payload?.client_state as string
    if (cs) { try { task = JSON.parse(Buffer.from(cs, 'base64').toString()).task || task } catch { /* ok */ } }
    console.log(`[webhook] call.initiated — creating DB row, task="${task.slice(0, 50)}"`) 
    waitUntil(dbUpsert(callId, { task, status: 'calling', greeted: false, processing: false, is_speaking: false, script_stage: 0, objection_count: 0, started_at: Date.now(), last_ai_text: '' }))
    return NextResponse.json('OK')
  }

  if (eventType === 'call.answered') {
    let task = 'Alpha Auto Center oil change call'
    const cs = payload?.client_state as string
    if (cs) { try { task = JSON.parse(Buffer.from(cs, 'base64').toString()).task || task } catch { /* ok */ } }
    waitUntil(handleAnswered(callId, task))
    return NextResponse.json('OK')
  }

  // call.speak.ended — clear is_speaking flag (safety net)
  if (eventType === 'call.speak.ended') {
    console.log('[webhook] call.speak.ended — clearing is_speaking')
    waitUntil(dbPatch(callId, { is_speaking: false }))
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
