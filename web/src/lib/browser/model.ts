/**
 * The call to the shop's own AI provider for the browsing assistant. Server only.
 *
 * Uses the key the shop saved in Settings and only the provider hosts Alpha already allows (see ai-config). The key is
 * never returned, logged or put in an error message. A slow or failing provider is "no answer", not a crash.
 */
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'

export interface AiSettings { ai_api_key?: unknown; ai_base_url?: unknown; ai_model?: unknown }

export function hasAiKey(settings: AiSettings | null | undefined): boolean {
  return typeof settings?.ai_api_key === 'string' && settings.ai_api_key.trim().length > 8
}

export function makeAskModel(settings: AiSettings, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000, maxTokens = 300) {
  return async (messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string | null> => {
    const key = typeof settings.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
    if (!key) return null
    const baseUrl = normalizeAiBaseUrl(settings.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const model = normalizeAiModel(settings.ai_model, baseUrl)
    try {
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.1 }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) return null
      const data = await res.json().catch(() => null) as { choices?: Array<{ message?: { content?: unknown } }> } | null
      const content = data?.choices?.[0]?.message?.content
      return typeof content === 'string' ? content.slice(0, 4000) : null
    } catch {
      return null
    }
  }
}
