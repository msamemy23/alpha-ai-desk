/**
 * Compatibility endpoint for older Android clients.
 *
 * New clients must send sessionId + turnId and are forwarded to the durable
 * workflow. The legacy branch intentionally has no write capability: it can
 * only perform a small, verified set of tenant-scoped reads.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { AI_BASE_URLS, isOpenRouterBaseUrl, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { chatGptModel, fetchOpenAIChatCompletion } from '@/lib/openai-oauth-server'
import { getUserChatGptTransport } from '@/lib/chatgpt-connection'
import { verifyReadClaims, unverifiedReadMessage } from '@/lib/ai/read-verification'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const READ_ONLY_ACTIONS = new Set([
  'searchCustomers',
  'getShopStats',
  'getCustomerHistory',
  'listStaff',
  'getInventory',
  'getTimeclockReport',
  'searchWeb',
])

const ID = /^[a-zA-Z0-9._:-]{1,120}$/

type Settings = {
  ai_api_key?: string | null
  ai_model?: string | null
  ai_base_url?: string | null
  shop_name?: string | null
  labor_rate?: number | string | null
  tax_rate?: number | string | null
}

type ChatMessage = { role: 'user' | 'assistant'; content: string }

const LEGACY_SYSTEM = `You are Alpha AI's read-only compatibility assistant for an auto repair shop.
You can only retrieve information. To retrieve information, return exactly JSON:
{"tool":"dbAction","action":"searchCustomers|getShopStats|getCustomerHistory|listStaff|getInventory|getTimeclockReport|searchWeb","payload":{}}
Never claim a lookup ran unless a tool result was provided. Never create, update, send, delete, schedule, or save anything. If the customer asks to change shop data, tell them that this client must send sessionId and turnId so the durable workflow can prepare a review.`

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

function sessionRequiredReply() {
  return 'This action needs the current chat client. Send a sessionId and turnId so Alpha can prepare a durable review; nothing was changed.'
}

function likelyMutation(message: string) {
  return /\b(?:create|make|build|save|send|delete|remove|void|convert|schedule|add|open)\b[\s\S]{0,80}\b(?:invoice|estimate|receipt|customer|job|appointment|follow[- ]?up|staff|message|email|text|inventory)\b/i.test(message)
    || /\b(?:update|change)\b[\s\S]{0,80}\b(?:customer|job|invoice|estimate|appointment|inventory|staff|status)\b/i.test(message)
}

function requiredReads(message: string) {
  const required = new Set<string>()
  if (/\b(?:inventory|stock)\b/i.test(message) && /\b(?:how many|count|check|show|list|look up|search|find|on hand|in stock|have|returned|available)\b/i.test(message)) required.add('getInventory')
  if (/\b(?:staff|technicians?|employees?|team)\b/i.test(message) && /\b(?:who|list|show|find|check|how many|available)\b/i.test(message)) required.add('listStaff')
  if (/\b(?:shop stats?|revenue|sales|dashboard)\b/i.test(message) && /\b(?:show|check|what|how|stats?|revenue|sales)\b/i.test(message)) required.add('getShopStats')
  if (/\b(?:time ?clock|clocked|hours worked)\b/i.test(message)) required.add('getTimeclockReport')
  if (/\b(?:customer history|service history|repair history)\b/i.test(message)) required.add('getCustomerHistory')
  if (/\b(?:find|search|look up)\b/i.test(message) && /\b(?:customer|client)\b/i.test(message)) required.add('searchCustomers')
  if (/\b(?:search|look up|find)\b/i.test(message) && /\b(?:web|online|internet)\b/i.test(message)) required.add('searchWeb')
  if (/\b(?:find|search|look up|show|list|check)\b/i.test(message) && /\b(?:customer|client|job|invoice|estimate|document|record)\b/i.test(message)) required.add('searchCustomers')
  if (/\b(?:price|pricing|part number|availability)\b/i.test(message) && /\b(?:online|web|internet|store|retailer)\b/i.test(message)) required.add('searchWeb')
  return required
}

function parseTool(raw: string): { action: string; payload: Record<string, unknown> } | null {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  let parsed: unknown
  try { parsed = JSON.parse(cleaned) } catch { return null }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  if (value.tool !== 'dbAction' || typeof value.action !== 'string') return null
  const payload = value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload)
    ? value.payload as Record<string, unknown>
    : {}
  return { action: value.action, payload }
}

async function getSettings(shopId: string): Promise<Settings> {
  const { data, error } = await getServiceClient().from('settings')
    .select('ai_api_key,ai_model,ai_base_url,shop_name,labor_rate,tax_rate')
    .eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error('Unable to load shop AI settings')
  return (data || {}) as Settings
}

function legacyPrompt(settings: Settings) {
  return `${LEGACY_SYSTEM}\nSHOP: ${String(settings.shop_name || 'your shop')}\nLabor rate: ${Number.isFinite(Number(settings.labor_rate)) ? `$${Number(settings.labor_rate)}/hr` : 'not configured'}\nTax rate: ${Number.isFinite(Number(settings.tax_rate)) ? `${Number(settings.tax_rate)}%` : 'not configured'}`
}

function legacyHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ChatMessage => Boolean(item) && typeof item === 'object'
    && ((item as ChatMessage).role === 'user' || (item as ChatMessage).role === 'assistant')
    && typeof (item as ChatMessage).content === 'string')
    .slice(-10).map(item => ({ role: item.role, content: item.content.slice(0, 4000) }))
}

async function callReadAction(req: NextRequest, action: string, payload: Record<string, unknown>) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const authorization = req.headers.get('authorization')
  const cookie = req.headers.get('cookie')
  if (authorization) headers.set('authorization', authorization)
  if (cookie) headers.set('cookie', cookie)
  try {
    const response = await fetch(new URL('/api/ai-action', req.url), {
      method: 'POST', headers, body: JSON.stringify({ action, payload }),
    })
    const data = await response.json().catch(() => ({}))
    return { ok: response.ok && data?.ok === true, data: data?.data, error: data?.error || `Action failed with HTTP ${response.status}` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Read action failed' }
  }
}

async function delegateWorkflow(req: NextRequest, body: Record<string, unknown>) {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const authorization = req.headers.get('authorization')
  const cookie = req.headers.get('cookie')
  if (authorization) headers.set('authorization', authorization)
  if (cookie) headers.set('cookie', cookie)
  try {
    const response = await fetch(new URL('/api/ai-workflow', req.url), {
      method: 'POST', headers,
      body: JSON.stringify({ sessionId: body.sessionId, turnId: body.turnId, message: body.message, confirmation: body.confirmation, history: body.history }),
    })
    const data = await response.json().catch(() => ({}))
    return NextResponse.json({ ...data, reply: data?.reply || data?.error, sessionId: body.sessionId, turnId: body.turnId, ...(data?.approval ? { pendingAction: { action: data.approval.action, payload: data.approval.payload } } : {}) }, {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ error: 'Workflow is temporarily unavailable. No action was started.', reply: 'Workflow is temporarily unavailable. No action was started.', sessionId: body.sessionId, turnId: body.turnId }, { status: 503 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const body: unknown = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'A request body is required' }, { status: 400 })
  const request = body as Record<string, unknown>

  // A session identifies the durable protocol. Modern clients provide their
  // own turn ID for replay-safe retries; older mobile clients get a bounded
  // server-generated ID and can still use the durable approval contract.
  if (request.sessionId !== undefined) {
    if (!validId(request.sessionId)) return NextResponse.json({ error: 'A valid sessionId is required' }, { status: 400 })
    if (request.turnId !== undefined && !validId(request.turnId)) return NextResponse.json({ error: 'A valid turnId is required' }, { status: 400 })
    request.turnId = validId(request.turnId) ? request.turnId : `legacy-${crypto.randomUUID()}`
    return delegateWorkflow(req, request)
  }
  if (request.turnId !== undefined || request.confirmation !== undefined) {
    return NextResponse.json({ error: 'sessionId is required with turnId or confirmation', reply: sessionRequiredReply() }, { status: 400 })
  }

  const message = typeof request.message === 'string' ? request.message.trim() : ''
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 })
  if (message.length > 4000) return NextResponse.json({ error: 'message is too long' }, { status: 413 })
  if (likelyMutation(message)) return NextResponse.json({ error: 'sessionId required for mutations', reply: sessionRequiredReply() }, { status: 400 })

  try {
    const settings = await getSettings(auth.shopId)
    const transport = await getUserChatGptTransport(auth)
    const apiKey = typeof settings.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
    const baseUrl = normalizeAiBaseUrl(settings.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const model = transport ? chatGptModel(settings.ai_model) : normalizeAiModel(settings.ai_model, baseUrl)
    if (!transport && !apiKey) return NextResponse.json({ reply: 'AI is not configured yet. Add this shop AI API key in Settings.' }, { status: 503 })

    const messages: ChatMessage[] = [...legacyHistory(request.history), { role: 'user', content: message }]
    const successfulReads = new Set<string>()
    const required = requiredReads(message)
    let retried = false

    for (let step = 0; step < 5; step++) {
      const completion = transport
        ? await fetchOpenAIChatCompletion(transport, { model, messages: [{ role: 'system', content: legacyPrompt(settings) }, ...messages], max_tokens: 600 }, AbortSignal.timeout(120000))
        : await (async () => {
            const response = await fetch(`${baseUrl}/chat/completions`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(isOpenRouterBaseUrl(baseUrl) ? { 'HTTP-Referer': 'https://alpha-ai-desk.vercel.app', 'X-Title': 'Alpha AI Desk' } : {}) },
              body: JSON.stringify({ model, messages: [{ role: 'system', content: legacyPrompt(settings) }, ...messages], max_tokens: 600, temperature: 0.2 }),
              signal: AbortSignal.timeout(120000),
            })
            return { ok: response.ok, status: response.status, data: await response.json().catch(() => ({})) }
          })()
      if (!completion.ok || completion.data?.error) return NextResponse.json({ reply: `AI error: ${completion.data?.error?.message || `provider returned HTTP ${completion.status}`}` }, { status: 502 })
      const raw = completion.data?.choices?.[0]?.message?.content?.trim()
      if (!raw) return NextResponse.json({ reply: 'The AI provider returned an empty response.' }, { status: 502 })
      messages.push({ role: 'assistant', content: raw })

      const tool = parseTool(raw)
      if (!tool) {
        const verified = verifyReadClaims(message, raw, successfulReads, retried)
        for (const action of required) if (!successfulReads.has(action) && !verified.missing.includes(action)) verified.missing.push(action)
        const missing = verified.missing
        if (missing.length) {
          if (retried) return NextResponse.json({ reply: unverifiedReadMessage(missing) }, { status: 502 })
          retried = true
          messages.push({ role: 'user', content: `Execution check: ${missing.join(', ')} has not successfully run. Return the corresponding JSON dbAction now; do not claim a result.` })
          continue
        }
        return NextResponse.json({ reply: raw, legacy: true }, { headers: { 'Cache-Control': 'no-store' } })
      }

      if (!READ_ONLY_ACTIONS.has(tool.action)) return NextResponse.json({ error: 'sessionId required for mutations', reply: sessionRequiredReply() }, { status: 400 })
      const result = await callReadAction(req, tool.action, tool.payload)
      if (result.ok) successfulReads.add(tool.action)
      messages.push({ role: 'user', content: `Tool result for ${tool.action}:\n${JSON.stringify(result.ok ? result.data : { error: result.error })}` })
    }
    return NextResponse.json({ reply: 'I could not verify the requested lookup before the safe tool limit. No result has been marked as verified.' }, { status: 502 })
  } catch (error) {
    console.error('[ai-chat] legacy compatibility error:', error)
    return NextResponse.json({ reply: 'Something went wrong. No action was taken.' }, { status: 500 })
  }
}

export async function GET() {
  if (!await getAuthedShop()) return unauthorized()
  return NextResponse.json({ ok: true, route: 'ai-chat', protocol: 'durable-workflow-v1', legacy: 'read-only' })
}
