import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { AI_BASE_URLS, normalizeAiModel } from '@/lib/ai-config'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { chatGptModel, fetchOpenAIChatCompletion } from '@/lib/openai-oauth-server'
import { getUserChatGptTransport } from '@/lib/chatgpt-connection'

export const dynamic = 'force-dynamic'

const DEFAULT_BASE_URL = AI_BASE_URLS.OPENROUTER
const OPENAI_BASE_URL = AI_BASE_URLS.OPENAI
const DEEPSEEK_BASE_URL = AI_BASE_URLS.DEEPSEEK
const ALLOWED_AI_HOSTS = new Set(['openrouter.ai', 'api.openai.com', 'api.deepseek.com'])

function normalizeBaseUrl(value: unknown) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_BASE_URL
  const url = new URL(raw)
  if (url.protocol !== 'https:' || !ALLOWED_AI_HOSTS.has(url.hostname)) {
    throw new Error('Configured AI base URL is not allowed')
  }
  return url.toString().replace(/\/$/, '')
}

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function pickProvider(settings: { ai_api_key?: unknown; ai_base_url?: unknown; ai_model?: unknown } | null | undefined) {
  const apiKey = typeof settings?.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
  const baseUrl = normalizeBaseUrl(settings?.ai_base_url || DEFAULT_BASE_URL)
  const defaultModel = normalizeAiModel(settings?.ai_model, baseUrl)
  return { apiKey, baseUrl, defaultModel }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const limited = checkRateLimit(rateLimitKey('ai-completions', auth.userId, auth.shopId, ip), 60, 60_000)
  if (!limited.ok) return error('Too many AI requests. Wait a minute and try again.', 429)

  try {
    const body = await req.json()
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return error('AI request is missing messages')
    }
    if (body.messages.length > 40) {
      return error('AI request has too many messages', 400)
    }
    if (body.messages.some((message: { role?: unknown }) => !message || !['system', 'developer', 'user', 'assistant', 'tool'].includes(String(message.role)))) {
      return error('Chat contains an unsupported message type. Reload the page and try again.', 400)
    }

    const chatGptTransport = await getUserChatGptTransport(auth)
    if (chatGptTransport) {
      const completion = await fetchOpenAIChatCompletion(chatGptTransport, {
        model: chatGptModel(body.model),
        messages: body.messages,
        max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : undefined,
      }, AbortSignal.timeout(120000))
      return NextResponse.json(completion.data, { status: completion.status })
    }

    const sb = getServiceClient()
    const { data: settings } = await sb
      .from('settings')
      .select('ai_api_key,ai_model,ai_base_url')
      .eq('shop_id', auth.shopId)
      .limit(1)
      .maybeSingle()

    const { apiKey, baseUrl, defaultModel } = pickProvider(settings)
    if (!apiKey) {
      return error('AI API key is not configured for this shop. Add the shop key in Settings.')
    }

    const requestedModel = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : defaultModel
    const model = normalizeAiModel(requestedModel, baseUrl)

    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(baseUrl.includes('openrouter.ai') ? {
          'HTTP-Referer': 'https://alpha-ai-desk.vercel.app',
          'X-Title': 'Alpha AI Desk',
        } : {}),
      },
      body: JSON.stringify({
        ...body,
        model,
      }),
      signal: AbortSignal.timeout(120000),
    })

    const data = await upstream.json().catch(() => ({}))
    return NextResponse.json(data, { status: upstream.status })
  } catch (e) {
    return error(e instanceof Error ? e.message : 'AI request failed', 500)
  }
}
