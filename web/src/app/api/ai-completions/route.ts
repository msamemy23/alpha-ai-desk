import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { AI_BASE_URLS, normalizeAiModel } from '@/lib/ai-config'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { fetchOpenAIChatCompletion } from '@/lib/openai-oauth-server'
import { getUserChatGptTransport } from '@/lib/chatgpt-connection'
import { chainFailureMessage, chatGptModelCandidates, cleanCompletionBody, completeWithFallback, isModelRefusal, shopKeyModel, type ProviderResult } from '@/lib/ai/provider-chain'

export const dynamic = 'force-dynamic'

const DEFAULT_BASE_URL = AI_BASE_URLS.OPENROUTER
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

/**
 * The one door every screen uses to reach the AI.
 * Order: the person's ChatGPT connection (current ChatGPT models only), then the shop's own API key.
 * The caller cannot pick an expensive model or send provider options beyond the short list in provider-chain.
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const limited = checkRateLimit(rateLimitKey('ai-completions', auth.userId, auth.shopId, ip), 60, 60_000)
  if (!limited.ok) return error('Too many AI requests. Wait a minute and try again.', 429)

  // Stop in the browser (or a closed tab) ends the provider call too, so no work or cost carries on unseen.
  const stopOrTimeout = (ms: number) => AbortSignal.any([req.signal, AbortSignal.timeout(ms)])

  try {
    const body = await req.json()
    if (!Array.isArray(body?.messages) || body.messages.length === 0) return error('AI request is missing messages')
    if (body.messages.length > 40) return error('AI request has too many messages', 400)
    if (body.messages.some((message: { role?: unknown }) => !message || !['system', 'developer', 'user', 'assistant', 'tool'].includes(String(message.role)))) {
      return error('Chat contains an unsupported message type. Reload the page and try again.', 400)
    }
    const options = cleanCompletionBody(body)
    // Viewers can ask questions, but with a smaller answer budget and only the shop's default model.
    if (auth.role === 'viewer') {
      options.max_tokens = Math.min(Number(options.max_tokens) || 2000, 2000)
      delete body.model
    }

    // A ChatGPT connection that expired or cannot refresh is not fatal: the shop key still answers.
    let chatGptTransport: Awaited<ReturnType<typeof getUserChatGptTransport>> = null
    let chatGptProblem = ''
    try { chatGptTransport = await getUserChatGptTransport(auth) } catch (e) { chatGptProblem = e instanceof Error ? e.message : 'ChatGPT connection unavailable' }

    const { data: settings } = await getServiceClient()
      .from('settings')
      .select('ai_api_key,ai_model,ai_base_url')
      .eq('shop_id', auth.shopId)
      .limit(1)
      .maybeSingle()
    const apiKey = typeof settings?.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
    const baseUrl = normalizeBaseUrl(settings?.ai_base_url || DEFAULT_BASE_URL)
    const defaultModel = normalizeAiModel(settings?.ai_model, baseUrl)
    const keyModel = normalizeAiModel(shopKeyModel(body.model, defaultModel), baseUrl)

    const callKey = async (model: string): Promise<ProviderResult> => {
      const upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(baseUrl.includes('openrouter.ai') ? { 'HTTP-Referer': 'https://alpha-ai-desk.vercel.app', 'X-Title': 'Alpha AI Desk' } : {}),
        },
        body: JSON.stringify({ ...options, messages: body.messages, model }),
        signal: stopOrTimeout(120000),
      })
      return { ok: upstream.ok, status: upstream.status, data: await upstream.json().catch(() => ({})) }
    }

    const out = await completeWithFallback({
      ...(chatGptTransport ? {
        chatgpt: (model: string) => fetchOpenAIChatCompletion(chatGptTransport!, { model, messages: body.messages, max_tokens: options.max_tokens as number }, stopOrTimeout(120000)),
        chatgptModels: chatGptModelCandidates(body.model, process.env.CHATGPT_MODEL),
      } : {}),
      ...(apiKey ? {
        shopKeyModel: keyModel,
        shopKey: async () => {
          const first = await callKey(keyModel)
          // A free model a screen asked for may have been withdrawn; the shop's own default still answers.
          if (!first.ok && keyModel !== defaultModel && isModelRefusal(first.status, first.data)) return callKey(defaultModel)
          return first
        },
      } : {}),
    })

    const headers = { 'Cache-Control': 'no-store', 'X-Alpha-AI-Provider': out.provider, ...(out.model ? { 'X-Alpha-AI-Model': out.model } : {}) }
    if (out.ok) return NextResponse.json(out.data, { status: 200, headers })
    if (out.provider === 'none') {
      return NextResponse.json({ error: chatGptProblem || out.error || 'AI is not set up for this shop. Add the shop AI key in Settings.' }, { status: 503, headers })
    }
    console.error('[ai-completions] all providers failed', JSON.stringify(out.attempts))
    return NextResponse.json({ error: chainFailureMessage(out), attempts: out.attempts }, { status: out.status >= 400 && out.status < 600 ? out.status : 502, headers })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return error('The AI request was stopped.', 499)
    return error(e instanceof Error ? e.message : 'AI request failed', 500)
  }
}
