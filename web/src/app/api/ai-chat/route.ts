/**
 * /api/ai-chat
 * Mobile app AI chat endpoint.
 * Accepts { message, sessionId, history? } from the Android APK.
 * Reads the OpenRouter API key from Supabase settings,
 * runs the full Alpha AI agent loop (with shop tools), and returns { reply }.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, hasInternalApiSecret } from '@/lib/api-auth'
import { AI_BASE_URLS, isOpenRouterBaseUrl, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { chatGptModel, fetchOpenAIChatCompletion } from '@/lib/openai-oauth-server'
import { getUserChatGptTransport } from '@/lib/chatgpt-connection'
import { verifyReadClaims, unverifiedReadMessage } from '@/lib/ai/read-verification'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://alpha-ai-desk.vercel.app'
const INTERNAL_SECRET = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET || ''
const READ_ONLY_ACTIONS = new Set([
  'searchCustomers',
  'getShopStats',
  'getCustomerHistory',
  'listStaff',
  'getInventory',
  'getTimeclockReport',
  'searchWeb',
])

const SYSTEM_PROMPT = `You are Alpha AI, the intelligent assistant for the configured auto repair shop.

SHOP INFO:
The exact shop name, address, phone, labor rate, tax rate, payment methods, and technicians are provided at request time. Treat that context as the only source of truth. If a value is missing, say it is not configured instead of inventing a value.

PERSONALITY: Confident, direct, knowledgeable. Short sentences. You know cars inside and out. Be conversational and natural — you're talking to a mechanic who's busy, be efficient.

TOOLS (respond with JSON when using a tool):
{ "tool": "dbAction", "action": "<actionName>", "payload": { ... } }

Available actions:
- searchCustomers: { query: string }
- getShopStats: {}
- getCustomerHistory: { customer_id?: string, customer_name?: string }
- createCustomer: { name, phone?, email?, address?, notes? }
- createJob: { customer_name, vehicle_year?, vehicle_make?, vehicle_model?, status?, notes? }
- updateJobStatus: { id, status }
- scheduleFollowUp: { customer_name, channel: "sms"|"email", scheduled_for, message_body }
- listStaff: {}
- getInventory: { query?: string } (up to 50 matching items; report the returned count)
- getTimeclockReport: { startDate?: string, endDate?: string }
- searchWeb: { query: string }

RULES:
- Keep responses SHORT. Max 3-5 sentences.
- When you need data, call a tool. When you have the data, answer.
- Never make up customer info. Always search first.
- Format currency as $X.XX`

type AiChatSettings = {
  ai_api_key?: string | null
  ai_model?: string | null
  ai_base_url?: string | null
  shop_name?: string | null
  shop_address?: string | null
  shop_phone?: string | null
  labor_rate?: number | string | null
  tax_rate?: number | string | null
  payment_methods?: string | string[] | null
}

function buildSystemPrompt(settings: AiChatSettings) {
  const paymentMethods = Array.isArray(settings.payment_methods)
    ? settings.payment_methods.join(', ')
    : String(settings.payment_methods || 'not configured')
  return `${SYSTEM_PROMPT}

LIVE SHOP CONTEXT:
- Name: ${String(settings.shop_name || 'your shop')}
- Address: ${String(settings.shop_address || 'not configured')}
- Phone: ${String(settings.shop_phone || 'not configured')}
- Labor rate: ${Number.isFinite(Number(settings.labor_rate)) ? `$${Number(settings.labor_rate)}/hr` : 'not configured'}
- Tax rate: ${Number.isFinite(Number(settings.tax_rate)) ? `${Number(settings.tax_rate)}%` : 'not configured'}
- Payment methods: ${paymentMethods}`
}

export const dynamic = 'force-dynamic'

async function getSettings(shopId: string): Promise<AiChatSettings> {
  const db = getServiceClient()
  const { data, error } = await db
    .from('settings')
    .select('ai_api_key,ai_model,ai_base_url,shop_name,shop_address,shop_phone,labor_rate,tax_rate,payment_methods')
    .eq('shop_id', shopId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[ai-chat] settings lookup failed:', error.message)
    throw new Error('Unable to load shop AI settings')
  }
  return (data || {}) as AiChatSettings
}

async function callDbAction(
  action: string,
  payload: Record<string, unknown>,
  shopId: string,
  requestHeaders: { authorization?: string; cookie?: string },
) {
  try {
    const res = await fetch(`${APP_URL}/api/ai-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(INTERNAL_SECRET
          ? { Authorization: `Bearer ${INTERNAL_SECRET}` }
          : requestHeaders.authorization
            ? { Authorization: requestHeaders.authorization }
            : {}),
        ...(requestHeaders.cookie ? { Cookie: requestHeaders.cookie } : {}),
      },
      body: JSON.stringify({ action, payload, shopId }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.ok !== true) {
      return { error: data?.error || `Action failed with HTTP ${res.status}`, approvalRequired: data?.approvalRequired }
    }
    return data?.data ?? data
  } catch (e) {
    return { error: (e as Error).message }
  }
}

type PersistedChatMessage = { role: 'user' | 'assistant'; content: string }

async function saveChatHistory(
  shopId: string,
  userId: string,
  sessionId: string | undefined,
  history: PersistedChatMessage[],
  message: string,
  reply: string,
): Promise<boolean> {
  if (!sessionId) return true
  const db = getServiceClient()
  const { error } = await db.rpc('replace_ai_chat_history', {
    p_shop_id: shopId,
    p_user_id: userId,
    p_session_id: sessionId,
    p_messages: [...history, { role: 'user', content: message }, { role: 'assistant', content: reply }].slice(-60),
  })
  if (error) {
    console.error('[ai-chat] history save failed:', error.message)
    return false
  }
  return true
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as {
      message?: unknown
      sessionId?: unknown
      history?: unknown
      shopId?: unknown
    } | null
    const sessionAuth = await getAuthedShop()
    const internal = hasInternalApiSecret(req)
    let caller = sessionAuth

    // Internal callers (for example the Android bridge) must name a shop and
    // the server validates that shop before reading settings or data.
    if (!caller && internal) {
      const requestedShopId = typeof body?.shopId === 'string' ? body.shopId : ''
      if (!requestedShopId) return NextResponse.json({ error: 'shopId is required for internal calls' }, { status: 400 })
      const { data: profile } = await getServiceClient()
        .from('shop_profiles')
        .select('id,user_id')
        .eq('id', requestedShopId)
        .maybeSingle()
      if (!profile) return NextResponse.json({ error: 'Shop not found' }, { status: 404 })
      caller = { shopId: String(profile.id), userId: String(profile.user_id), role: 'service' }
    }
    if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })
    if (message.length > 4000) return NextResponse.json({ error: 'message is too long' }, { status: 413 })

    const sessionId = typeof body?.sessionId === 'string' && body.sessionId.length <= 128 ? body.sessionId : undefined
    const history = Array.isArray(body?.history)
      ? body.history
          .filter((item): item is { role: string; content: string } => {
            const value = item as Record<string, unknown>
            return (value.role === 'user' || value.role === 'assistant') && typeof value.content === 'string'
          })
          .slice(-10)
          .map((item) => ({ role: item.role as 'user' | 'assistant', content: item.content.slice(0, 4000) }))
      : []

    const respond = async (reply: string, extra: Record<string, unknown> = {}, responseStatus = 200) => {
      const historySaved = await saveChatHistory(caller!.shopId, caller!.userId, sessionId, history, message, reply)
      return NextResponse.json({
        reply,
        ...extra,
        sessionId,
        ...(sessionId && !historySaved ? { history_saved: false } : {}),
      }, { status: sessionId && !historySaved ? 502 : responseStatus })
    }

    const settings = await getSettings(caller.shopId)
    const chatGptTransport = await getUserChatGptTransport(caller)
    const apiKey = typeof settings.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
    const baseUrl = normalizeAiBaseUrl(settings.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const model = chatGptTransport ? chatGptModel(settings.ai_model) : normalizeAiModel(settings.ai_model, baseUrl)

    if (!apiKey && !chatGptTransport) {
      const reply = 'AI is not configured yet. Please add this shop AI API key in Settings on the web dashboard.'
      return respond(reply)
    }

    const agentMessages: Array<{ role: string; content: string }> = [
      ...history,
      { role: 'user', content: message },
    ]

    const successfulReads = new Set<string>()
    let readVerificationRetried = false
    // Agent loop — up to 5 steps to handle read-only tool calls.
    for (let step = 0; step < 5; step++) {
      const completion = chatGptTransport
        ? await fetchOpenAIChatCompletion(chatGptTransport, {
            model,
            messages: [{ role: 'system', content: buildSystemPrompt(settings as Record<string, unknown>) }, ...agentMessages],
            max_tokens: 600,
          }, AbortSignal.timeout(120000))
        : await (async () => {
            const res = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                ...(isOpenRouterBaseUrl(baseUrl) ? {
                  'HTTP-Referer': 'https://alpha-ai-desk.vercel.app',
                  'X-Title': 'Alpha AI Desk',
                } : {}),
              },
              body: JSON.stringify({
                model,
                messages: [{ role: 'system', content: buildSystemPrompt(settings as Record<string, unknown>) }, ...agentMessages],
                max_tokens: 600,
                temperature: 0.3,
              }),
              signal: AbortSignal.timeout(120000),
            })
            return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) }
          })()

      const data = completion.data
      if (!completion.ok || data.error) {
        const detail = data.error?.message || `provider returned HTTP ${completion.status}`
        const reply = `AI error: ${detail}`
        return respond(reply, {}, 502)
      }

      const raw = data.choices?.[0]?.message?.content?.trim() || ''
      if (!raw) {
        const reply = 'The AI provider returned an empty response. Please try again.'
        return respond(reply, {}, 502)
      }
      agentMessages.push({ role: 'assistant', content: raw })

      let parsed: Record<string, unknown> | null = null
      try {
        const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
        try { parsed = JSON.parse(cleaned) } catch {
          const match = cleaned.match(/\{[\s\S]*"tool"[\s\S]*\}/)
          if (match) { try { parsed = JSON.parse(match[0]) } catch { parsed = null } }
        }
        if (parsed && !parsed.tool) parsed = null
      } catch { parsed = null }

      if (!parsed) {
        const verification = verifyReadClaims(message, raw, successfulReads, readVerificationRetried)
        if (verification.decision === 'retry') {
          readVerificationRetried = true
          agentMessages.push({ role: 'user', content: `Execution check: ${verification.missing.join(', ')} has NOT successfully run. Return a JSON dbAction call for the requested lookup; do not invent a result or reuse an old answer.` })
          continue
        }
        if (verification.decision === 'block') return respond(unverifiedReadMessage(verification.missing), {}, 502)
        return respond(raw)
      }

      const toolName = parsed.tool as string
      if (toolName !== 'dbAction') {
        const reply = 'The AI requested an unsupported tool, so I stopped safely.'
        return respond(reply, {}, 502)
      }

      const action = typeof parsed.action === 'string' ? parsed.action : ''
      const payload = parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)
        ? parsed.payload as Record<string, unknown>
        : {}
      if (!action) {
        const reply = 'The AI returned an incomplete action, so I stopped safely.'
        return respond(reply, {}, 502)
      }

      // The model may propose a write, but it is never allowed to claim or
      // perform the write. A separate explicit confirmation is required.
      if (!READ_ONLY_ACTIONS.has(action)) {
        const reply = `I can prepare “${action}”, but I need your confirmation before changing shop data or sending anything. Nothing was changed.`
        return respond(reply, { pendingAction: { action, payload } })
      }

      const result = await callDbAction(action, payload, caller.shopId, {
        authorization: req.headers.get('authorization') || undefined,
        cookie: req.headers.get('cookie') || undefined,
      })
      if (!result?.error && !result?.approvalRequired) successfulReads.add(action)
      agentMessages.push({
        role: 'user',
        content: `Tool result for ${action}:\n${JSON.stringify(result, null, 2)}`,
      })
    }

    return respond('I reached the safe tool limit before finishing. The overall request has not been marked completed.', {}, 502)
  } catch (err) {
    console.error('[ai-chat] error:', err)
    return NextResponse.json({ reply: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({ ok: true, route: 'ai-chat' })
}
