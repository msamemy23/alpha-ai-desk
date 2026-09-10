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

RULES:
- Keep responses SHORT. Max 3-5 sentences.
- When you need data, call a tool. When you have the data, answer.
- Never make up customer info. Always search first.
- Format currency as $X.XX`

function buildSystemPrompt(settings: Record<string, unknown>) {
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

async function getSettings(shopId: string) {
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
    return {}
  }
  return data || {}
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
    if (!res.ok) {
      return { error: data?.error || `Action failed with HTTP ${res.status}`, approvalRequired: data?.approvalRequired }
    }
    return data?.data ?? data
  } catch (e) {
    return { error: (e as Error).message }
  }
}

async function saveChatHistory(shopId: string, userId: string, sessionId: string | undefined, message: string, reply: string) {
  if (!sessionId) return
  const db = getServiceClient()
  const { error } = await db.from('ai_chat_history').insert([
    { shop_id: shopId, user_id: userId, session_id: sessionId, role: 'user', content: message, created_at: new Date().toISOString() },
    { shop_id: shopId, user_id: userId, session_id: sessionId, role: 'assistant', content: reply, created_at: new Date().toISOString() },
  ])
  if (error) console.error('[ai-chat] history save failed:', error.message)
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
      caller = { shopId: String(profile.id), userId: String(profile.user_id) }
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

    const settings = await getSettings(caller.shopId)
    const apiKey = typeof settings.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
    const baseUrl = normalizeAiBaseUrl(settings.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const model = normalizeAiModel(settings.ai_model, baseUrl)

    if (!apiKey) {
      const reply = 'AI is not configured yet. Please add this shop's AI API key in Settings on the web dashboard.'
      await saveChatHistory(caller.shopId, caller.userId, sessionId, message, reply)
      return NextResponse.json({ reply, sessionId })
    }

    const agentMessages: Array<{ role: string; content: string }> = [
      ...history,
      { role: 'user', content: message },
    ]

    // Agent loop — up to 5 steps to handle read-only tool calls.
    for (let step = 0; step < 5; step++) {
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
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        const detail = data.error?.message || `provider returned HTTP ${res.status}`
        const reply = `AI error: ${detail}`
        await saveChatHistory(caller.shopId, caller.userId, sessionId, message, reply)
        return NextResponse.json({ reply, sessionId }, { status: 502 })
      }

      const raw = data.choices?.[0]?.message?.content?.trim() || ''
      if (!raw) {
        const reply = 'The AI provider returned an empty response. Please try again.'
        await saveChatHistory(caller.shopId, caller.userId, sessionId, message, reply)
        return NextResponse.json({ reply, sessionId }, { status: 502 })
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
        await saveChatHistory(caller.shopId, caller.userId, sessionId, message, raw)
        return NextResponse.json({ reply: raw, sessionId })
      }

      const toolName = parsed.tool as string
      if (toolName !== 'dbAction') {
        const reply = 'The AI requested an unsupported tool, so I stopped safely.'
        await saveChatHistory(caller.shopId, caller.userId, sessionId, message, reply)
        return NextResponse.json({ reply, sessionId }, { status: 502 })
      }

      const action = typeof parsed.action === 'string' ? parsed.action : ''
      const payload = parsed.payload && typeof parsed.payload === 'object' && !Array.isArray(parsed.payload)
        ? parsed.payload as Record<string, unknown>
        : {}
      if (!action) {
        const reply = 'The AI returned an incomplete action, so I stopped safely.'
        await saveChatHistory(caller.shopId, caller.userId, sessionId, message, reply)
        return NextResponse.json({ reply, sessionId }, { status: 502 })
      }

      // The model may propose a write, but it is never allowed to claim or
      // perform the write. A separate explicit confirmation is required.
      if (!READ_ONLY_ACTIONS.has(action)) {
        const reply = `I can prepare “${action}”, but I need your confirmation before changing shop data or sending anything. Nothing was changed.`
        await saveChatHistory(caller.shopId, caller.userId, sessionId, message, reply)
        return NextResponse.json({ reply, pendingAction: { action, payload }, sessionId })
      }

      const result = await callDbAction(action, payload, caller.shopId, {
        authorization: req.headers.get('authorization') || undefined,
        cookie: req.headers.get('cookie') || undefined,
      })
      agentMessages.push({
        role: 'user',
        content: `Tool result for ${action}:\n${JSON.stringify(result, null, 2)}`,
      })
    }

    const lastAssistant = agentMessages.filter(m => m.role === 'assistant').pop()?.content
    const reply = lastAssistant || 'I reached the safe tool limit before finishing. Please try again.'
    await saveChatHistory(caller.shopId, caller.userId, sessionId, message, reply)
    return NextResponse.json({ reply, sessionId })
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
