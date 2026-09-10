/**
 * Background AI Turn Processor
 * Called fire-and-forget by telnyx-voice-webhook when a transcription arrives.
 * Handles: AI reply generation + Telnyx speak + Supabase update.
 * Runs independently so the webhook can return 200 to Telnyx in <1s.
 */

import { NextRequest, NextResponse } from 'next/server'
import { AI_BASE_URLS, normalizeAiModel } from '@/lib/ai-config'
import { hasInternalApiSecret } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

const SUPABASE_URL       = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_KEY       = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
const TELNYX_BASE        = 'https://api.telnyx.com/v2'
const VOICE              = 'Telnyx.Natural.abbie'
const VOICE_FALLBACK     = 'female'

type VoiceProcessorSettings = {
  shop_name?: string | null
  shop_phone?: string | null
  telnyx_api_key?: string | null
  ai_api_key?: string | null
  ai_base_url?: string | null
  ai_model?: string | null
}

async function getProcessorSettings(shopId: string): Promise<VoiceProcessorSettings | null> {
  const { data, error } = await getServiceClient()
    .from('settings')
    .select('shop_name,shop_phone,telnyx_api_key,ai_api_key,ai_base_url,ai_model')
    .eq('shop_id', shopId)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[voice-processor] settings lookup failed:', error.message)
    return null
  }
  return data as VoiceProcessorSettings | null
}

async function dbUpdate(callId: string, shopId: string, patch: Record<string, unknown>) {
  await fetch(
    `${SUPABASE_URL}/rest/v1/ai_calls?id=eq.${encodeURIComponent(callId)}&shop_id=eq.${encodeURIComponent(shopId)}`,
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

async function telnyxPost(path: string, body: Record<string, unknown>, apiKey: string) {
  if (!apiKey) return { ok: false, data: { error: 'Telnyx is not configured for this shop' } }
  const r = await fetch(`${TELNYX_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}

async function speak(callId: string, text: string, apiKey: string): Promise<boolean> {
  const clean = text.replace(/"/g, "'").slice(0, 3000)
  const r = await telnyxPost(`/calls/${callId}/actions/speak`, { payload: clean, payload_type: 'text', voice: VOICE }, apiKey)
  if (r.ok) return true
  const fb = await telnyxPost(`/calls/${callId}/actions/speak`, { payload: clean, payload_type: 'text', voice: VOICE_FALLBACK }, apiKey)
  return fb.ok
}

async function aiChat(messages: Array<{role: string; content: string}>, maxTokens: number, settings: VoiceProcessorSettings): Promise<string> {
  const apiKey = String(settings.ai_api_key || '').trim()
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
    return String(d?.choices?.[0]?.message?.content || '').trim()
  } catch {
    return ''
  }
}

export async function POST(req: NextRequest) {
  let parsedCallId = ''
  let parsedShopId = ''
  if (!hasInternalApiSecret(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  if (!SUPABASE_URL || !SUPABASE_KEY) return NextResponse.json({ ok: false, error: 'Voice processor is not configured' }, { status: 503 })
  try {
    const { callId, text, state } = await req.json()
    parsedCallId = callId || ''
    parsedShopId = typeof state?.shopId === 'string' ? state.shopId : ''
    if (!callId || !text || !state || !parsedShopId) return NextResponse.json({ ok: false, error: 'Missing call or shop context' }, { status: 400 })

    const settings = await getProcessorSettings(parsedShopId)
    if (!settings) return NextResponse.json({ ok: false, error: 'Shop settings could not be loaded' }, { status: 503 })

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
    await dbUpdate(callId, parsedShopId, { transcript })

    const system = `You are a phone AI agent calling on behalf of ${settings.shop_name || state.shopName || 'the configured auto repair shop'} (${settings.shop_phone || state.shopPhone || 'the shop phone'}).

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

    const reply = await aiChat(messages, 120, settings)
    if (reply) {
      transcript.push({ speaker: 'ai', text: reply })
      conversation.push({ role: 'assistant', content: reply })
      await dbUpdate(callId, parsedShopId, { transcript, conversation })
      await speak(callId, reply, String(settings.telnyx_api_key || ''))
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[ai-process-turn] error:', err)
    return NextResponse.json({ ok: false })
  } finally {
    // Always unlock — even if we crash above
    if (parsedCallId) {
      try { await dbUpdate(parsedCallId, parsedShopId, { processing: false }) } catch { /* ignore */ }
    }
  }
}
