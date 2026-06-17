import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const ALLOWED_AI_HOSTS = new Set(['openrouter.ai', 'api.openai.com'])

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
  const openAiKey = process.env.OPENAI_API_KEY || ''
  const apiKey = settingsKey || openRouterKey || openAiKey

  const baseUrl = normalizeBaseUrl(
    settings?.ai_base_url ||
    (settingsKey || openRouterKey ? DEFAULT_BASE_URL : OPENAI_BASE_URL)
  )

  const defaultModel = baseUrl.includes('api.openai.com') ? 'gpt-4o-mini' : 'deepseek/deepseek-v3.2'
  const settingsModel = typeof settings?.ai_model === 'string' && settings.ai_model.trim() ? settings.ai_model.trim() : ''

  return { apiKey, baseUrl, defaultModel: settingsModel || defaultModel }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  try {
    const body = await req.json()
    if (!Array.isArray(body?.messages) || body.messages.length === 0) {
      return error('AI request is missing messages')
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
      return error('AI API key is not configured. Add OPENROUTER_API_KEY, OPENAI_API_KEY, or a shop AI key in Settings.')
    }

    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : defaultModel

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
    })

    const data = await upstream.json().catch(() => ({}))
    return NextResponse.json(data, { status: upstream.status })
  } catch (e) {
    return error(e instanceof Error ? e.message : 'AI request failed', 500)
  }
}
