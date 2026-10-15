/**
 * Talks to the shop's own AI provider (the key they saved in Settings) for the receptionist and the test screen.
 * Never throws: on any problem it returns an empty string and the engine falls back to its plain script.
 * Only the shop's chosen provider host is called (the allowlist lives in ai-config), and no customer phone number is sent.
 */
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '../ai-config.ts'
import type { ChatMessage, ModelFn } from './engine.ts'

export type AiSettings = { [column: string]: unknown }

export function hasAiKey(settings: AiSettings | null | undefined): boolean {
  return typeof settings?.ai_api_key === 'string' && settings.ai_api_key.trim().length > 0
}

/** Builds the model function for one shop, or null when the shop has no AI key saved. */
export function makeModel(settings: AiSettings | null | undefined, opts: { timeoutMs: number; appUrl?: string } = { timeoutMs: 9000 }): ModelFn | null {
  if (!hasAiKey(settings)) return null
  const apiKey = String(settings?.ai_api_key).trim()
  const baseUrl = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
  const model = normalizeAiModel(settings?.ai_model, baseUrl)
  return async (messages: ChatMessage[], o: { maxTokens: number; json: boolean }): Promise<string> => {
    try {
      const body: Record<string, unknown> = { model, messages, max_tokens: o.maxTokens, temperature: 0.3 }
      if (o.json && baseUrl.includes('api.openai.com')) body.response_format = { type: 'json_object' }
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(baseUrl.includes('openrouter.ai') ? { 'HTTP-Referer': opts.appUrl || 'https://localhost', 'X-Title': 'Shop assistant' } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs),
      })
      if (!res.ok) return ''
      const data = await res.json().catch(() => ({}))
      return String(data?.choices?.[0]?.message?.content || '')
    } catch {
      return ''
    }
  }
}
