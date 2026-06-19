import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { AI_BASE_URLS, normalizeAiModel } from '@/lib/ai-config'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'

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
  const settingsKey = typeof settings?.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
  const openRouterKey = process.env.OPENROUTER_API_KEY || ''
  const deepSeekKey = process.env.DEEPSEEK_API_KEY || ''
  const openAiKey = process.env.OPENAI_API_KEY || ''
  const apiKey = settingsKey || openRouterKey || deepSeekKey || openAiKey

  const baseUrl = normalizeBaseUrl(
    settings?.ai_base_url ||
    (settingsKey || openRouterKey ? DEFAULT_BASE_URL : deepSeekKey ? DEEPSEEK_BASE_URL : OPENAI_BASE_URL)
  )

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

    const sb = getServiceClient()
    const { data: settings } = await sb
      .from('settings')
      .select('ai_api_key,ai_model,ai_base_url')
      .eq('shop_id', auth.shopId)
      .limit(1)
      .maybeSingle()

    const { apiKey, baseUrl, defaultModel } = pickProvider(settings)
    if (!apiKey) {
      return error('AI API key is not configured. Add OPENROUTER_API_KEY, DEEPSEEK_API_KEY, OPENAI_API_KEY, or a shop AI key in Settings.')
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
