/**
 * Inbound Call Handler.
 *
 * Telnyx webhooks are signed, but the call id alone is not a tenant selector.
 * Resolve the shop from the called number (or an existing scoped call row) before
 * reading or writing any call state.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyTelnyxSignature } from '@/lib/telnyx-verify'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { getServiceClient } from '@/lib/supabase'

const TELNYX_BASE = 'https://api.telnyx.com/v2'
const VOICE = 'Telnyx.Natural.abbie'
const VOICE_FALLBACK = 'female'

type ShopSettings = {
  shop_id: string
  shop_name?: string | null
  shop_phone?: string | null
  telnyx_phone_number?: string | null
  shop_address?: string | null
  shop_email?: string | null
  shop_hours?: string | null
  ai_api_key?: string | null
  ai_base_url?: string | null
  ai_model?: string | null
  telnyx_api_key?: string | null
}

function digits(value: unknown) {
  return String(value || '').replace(/\D/g, '').slice(-10)
}

async function resolveShop(payload: Record<string, unknown>, callId: string): Promise<ShopSettings | null> {
  const db = getServiceClient()
  const calledNumber = digits(payload.to || payload.phone_number || payload.called_number || payload.destination)
  const { data: settings, error } = await db.from('settings')
    .select('shop_id,shop_name,shop_phone,telnyx_phone_number,telnyx_api_key,shop_address,shop_email,ai_api_key,ai_base_url,ai_model')
    .not('shop_id', 'is', null)
  if (error) throw error

  const matches = (settings || []).filter((row: ShopSettings) => {
    const configured = digits(row.telnyx_phone_number || row.shop_phone)
    return Boolean(calledNumber && configured && calledNumber === configured)
  })
  if (matches.length === 1) return matches[0]

  const { data: existing, error: existingError } = await db.from('ai_calls')
    .select('shop_id')
    .eq('id', callId)
    .maybeSingle()
  if (existingError) throw existingError
  if (!existing?.shop_id) return null
  return (settings || []).find((row: ShopSettings) => row.shop_id === existing.shop_id) || null
}

async function dbGet(callId: string, shopId: string) {
  const { data, error } = await getServiceClient().from('ai_calls')
    .select('*')
    .eq('id', callId)
    .eq('shop_id', shopId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function dbUpsert(callId: string, shopId: string, patch: Record<string, unknown>) {
  const db = getServiceClient()
  const { data: existing, error: existingError } = await db.from('ai_calls')
    .select('shop_id')
    .eq('id', callId)
    .maybeSingle()
  if (existingError) throw existingError
  if (existing?.shop_id && existing.shop_id !== shopId) {
    throw new Error('Call belongs to another shop')
  }
  const { error } = await db.from('ai_calls')
    .upsert({ id: callId, shop_id: shopId, ...patch }, { onConflict: 'id' })
  if (error) throw error
}

async function dbUpdate(callId: string, shopId: string, patch: Record<string, unknown>) {
  const { error } = await getServiceClient().from('ai_calls')
    .update(patch)
    .eq('id', callId)
    .eq('shop_id', shopId)
  if (error) throw error
}

async function telnyxPost(path: string, body: Record<string, unknown>, apiKey: string) {
  if (!apiKey) return { ok: false, data: { error: 'Telnyx is not configured' } }
  const r = await fetch(`${TELNYX_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}

async function speak(callId: string, text: string, apiKey: string): Promise<boolean> {
  const clean = text.replace(/"/g, "'").slice(0, 3000)
  const primary = await telnyxPost(`/calls/${callId}/actions/speak`, {
    payload: clean, payload_type: 'text', voice: VOICE,
  }, apiKey)
  if (primary.ok) return true
  const fallback = await telnyxPost(`/calls/${callId}/actions/speak`, {
    payload: clean, payload_type: 'text', voice: VOICE_FALLBACK,
  }, apiKey)
  return fallback.ok
}

async function aiChat(messages: Array<{ role: string; content: string }>, maxTokens: number, settings: ShopSettings) {
  const apiKey = String(settings.ai_api_key || '')
  if (!apiKey) return ''
  try {
    const baseUrl = normalizeAiBaseUrl(settings.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const model = normalizeAiModel(settings.ai_model, baseUrl)
    const r = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(baseUrl.includes('openrouter.ai') ? {
          'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL || 'https://alpha-ai-desk.vercel.app',
          'X-Title': 'Alpha AI Desk',
        } : {}),
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.7 }),
      signal: AbortSignal.timeout(30000),
    })
    if (!r.ok) return ''
    const d = await r.json().catch(() => ({}))
    return String(d?.choices?.[0]?.message?.content || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/^["']|["']$/g, '')
      .replace(/\([^)]*\)/g, '')
      .trim()
  } catch {
    return ''
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text()
  const signature = req.headers.get('telnyx-signature-ed25519')
  const timestamp = req.headers.get('telnyx-timestamp')
  if (!verifyTelnyxSignature(rawBody, signature, timestamp)) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const data = body.data as Record<string, unknown> | undefined
  const eventType = typeof data?.event_type === 'string' ? data.event_type : ''
  const payload = (data?.payload && typeof data.payload === 'object' ? data.payload : {}) as Record<string, unknown>
  if (eventType === 'version') return NextResponse.json({ v: 'v8.0-inbound' })

  const callId = typeof payload.call_control_id === 'string' ? payload.call_control_id : ''
  if (!callId) return NextResponse.json({ ok: false, error: 'Missing call control id' }, { status: 400 })

  const settings = await resolveShop(payload, callId)
  if (!settings?.shop_id) {
    return NextResponse.json({ ok: false, error: 'No configured shop matches this called number' }, { status: 400 })
  }
  const shopId = settings.shop_id
  const shopName = String(settings.shop_name || 'the configured auto repair shop')
  const shopPhone = String(settings.shop_phone || settings.telnyx_phone_number || 'the shop phone')
  const telnyxKey = String(settings.telnyx_api_key || '')

  try {
    if (eventType === 'call.initiated') {
      if (payload.direction === 'incoming') {
        const from = String(payload.from || 'unknown').slice(0, 40)
        await dbUpsert(callId, shopId, {
          task: `Inbound call from ${from}. Act as AI receptionist for ${shopName}.`,
          status: 'ringing',
          caller: from,
          started_at: Date.now(),
        })
        const answer = await telnyxPost(`/calls/${callId}/actions/answer`, {}, telnyxKey)
        if (!answer.ok) console.error('[inbound-webhook] answer failed:', answer.data)
      }
      return NextResponse.json('OK')
    }

    if (eventType === 'call.answered') {
      const from = String(payload.from || 'unknown').slice(0, 40)
      await dbUpsert(callId, shopId, {
        task: `Inbound call from ${from}. Act as AI receptionist for ${shopName}.`,
        status: 'active',
        caller: from,
        started_at: Date.now(),
        greeted: false,
        processing: true,
      })

      const transcription = await telnyxPost(`/calls/${callId}/actions/transcription_start`, {
        language: 'en',
        transcription_engine: 'B',
        transcription_tracks: 'both',
        interim_results: false,
      }, telnyxKey)
      if (!transcription.ok) console.error('[inbound-webhook] transcription start failed:', transcription.data)

      const recording = await telnyxPost(`/calls/${callId}/actions/record_start`, {
        format: 'mp3',
        channels: 'dual',
      }, telnyxKey)
      if (!recording.ok) console.error('[inbound-webhook] recording start failed:', recording.data)

      const greeting = await aiChat([{
        role: 'user',
        content: `You are the receptionist for ${shopName}, an auto repair shop at ${settings.shop_address || 'the configured shop address'}.
A customer is calling. Write a short warm greeting (1-2 sentences). Plain conversational speech only — no markdown, asterisks, or quotes.`,
      }], 60, settings) || `Thank you for calling ${shopName}. How can I help you today?`

      await dbUpdate(callId, shopId, {
        greeted: true,
        transcript: [{ speaker: 'ai', text: greeting }],
        conversation: [{ role: 'assistant', content: greeting }],
        processing: false,
      })
      if (!await speak(callId, greeting, telnyxKey)) {
        console.error('[inbound-webhook] greeting could not be spoken')
      }
      return NextResponse.json('OK')
    }

    if (eventType === 'call.transcription') {
      const td = (payload.transcription_data && typeof payload.transcription_data === 'object' ? payload.transcription_data : {}) as Record<string, unknown>
      const text = String(td.transcript || '').trim().slice(0, 2000)
      const isFinal = td.is_final === true
      if (!text || !isFinal) return NextResponse.json('OK')

      const state = await dbGet(callId, shopId)
      if (!state) return NextResponse.json('OK')
      if (state.processing) return NextResponse.json('OK')
      await dbUpdate(callId, shopId, { processing: true })

      const transcript = Array.isArray(state.transcript) ? [...state.transcript] as Array<{ speaker: string; text: string }> : []
      const conversation = Array.isArray(state.conversation) ? [...state.conversation] as Array<{ role: string; content: string }> : []
      transcript.push({ speaker: 'customer', text })
      await dbUpdate(callId, shopId, { transcript })

      const reply = await aiChat([
        {
          role: 'system',
          content: `You are the AI phone receptionist for ${shopName}. Phone: ${shopPhone}. Hours: ${settings.shop_hours || 'the configured shop hours'}.

Rules:
- Live phone call. Keep replies short — 1-3 sentences max.
- Help with appointments, vehicle questions, pricing, directions, and hours.
- If caller wants to leave a message, acknowledge you will pass it along.
- Speak naturally. Never say you are AI unless directly asked.`,
        },
        ...conversation.slice(-8),
        { role: 'user', content: text },
      ], 100, settings)

      if (reply) {
        transcript.push({ speaker: 'ai', text: reply })
        conversation.push({ role: 'assistant', content: reply })
        await dbUpdate(callId, shopId, { transcript, conversation })
        if (!await speak(callId, reply, telnyxKey)) console.error('[inbound-webhook] reply could not be spoken')
      }
      await dbUpdate(callId, shopId, { processing: false })
      return NextResponse.json('OK')
    }

    if (eventType === 'call.speak.ended') {
      await dbUpdate(callId, shopId, { processing: false })
      return NextResponse.json('OK')
    }

    if (eventType === 'call.recording.saved') {
      const urls = payload.recording_urls
      const recordingUrl = typeof urls === 'string'
        ? urls
        : urls && typeof urls === 'object'
          ? String((urls as Record<string, unknown>).mp3 || (urls as Record<string, unknown>).wav || Object.values(urls as Record<string, unknown>)[0] || '')
          : String(payload.public_url || '')
      if (recordingUrl) await dbUpdate(callId, shopId, { recording_url: recordingUrl.slice(0, 2000) })
      return NextResponse.json('OK')
    }

    if (eventType === 'call.hangup') {
      const state = await dbGet(callId, shopId)
      if (!state) return NextResponse.json('OK')
      await dbUpdate(callId, shopId, { status: 'ended', processing: false })
      const transcript = Array.isArray(state.transcript) ? state.transcript as Array<{ speaker: string; text: string }> : []
      if (transcript.length > 0) {
        const lines = transcript.map(item => `${item.speaker === 'ai' ? 'AI' : 'Caller'}: ${item.text}`).join('\n')
        const summary = await aiChat([{
          role: 'user',
          content: `Summarize this inbound customer call in 2-4 concise bullet points for ${shopName}.

Transcript:
${lines}`,
        }], 300, settings)
        await dbUpdate(callId, shopId, { summary: summary || `Inbound call ended. ${transcript.length} exchanges.` })
      }
      return NextResponse.json('OK')
    }

    return NextResponse.json('OK')
  } catch (error) {
    console.error('[inbound-webhook] error:', error)
    try { await dbUpdate(callId, shopId, { processing: false }) } catch { /* preserve original error */ }
    return NextResponse.json({ ok: false, error: 'Webhook processing failed' }, { status: 500 })
  }
}
