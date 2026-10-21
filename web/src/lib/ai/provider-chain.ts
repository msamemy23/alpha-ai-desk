/**
 * Which AI model answers, and what happens when one refuses.
 *
 * Order: the person's ChatGPT connection (if any) with each current ChatGPT model, then the shop's own API key.
 * A ChatGPT model that OpenAI has retired from ChatGPT sign-in (gpt-5.5 on 14 Oct 2026) is skipped, never pinned.
 * Nothing here talks to the network: callers pass in the two "try" functions, so the order and the error text are
 * tested directly. No `@/` imports, so `node --test` loads this exact file.
 */

export type ProviderResult = { ok: boolean; status: number; data: unknown }
export type ProviderAttempt = { provider: 'chatgpt' | 'shop_key'; model: string; status: number; error?: string }

/** Current ChatGPT-sign-in models, best first. GPT-6.1 Sol needs Plus or above; GPT-6 Luna works on every plan. */
export const CHATGPT_MODELS = ['gpt-6.1-sol', 'gpt-6-luna'] as const

/** Retired from ChatGPT sign-in. Asking for one of these goes straight to the current list. */
export const RETIRED_CHATGPT_MODELS = new Set([
  'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2', 'gpt-5.2-codex',
])

const CHATGPT_ID = /^gpt-\d+(?:\.\d+)?(?:-[a-z0-9.]+)*$/i

/** The models to try on ChatGPT, in order: a valid requested one first (unless retired), then the current list. */
export function chatGptModelCandidates(requested?: unknown, envDefault?: string): string[] {
  const out: string[] = []
  const add = (value: unknown) => {
    const id = typeof value === 'string' ? value.trim().toLowerCase() : ''
    if (!id || !CHATGPT_ID.test(id) || RETIRED_CHATGPT_MODELS.has(id) || out.includes(id)) return
    out.push(id)
  }
  add(requested)
  add(envDefault)
  for (const id of CHATGPT_MODELS) add(id)
  return out
}

/** The plain words a provider sent back, wherever it put them (OpenAI uses `detail`, OpenRouter `error.message`). */
export function providerErrorText(data: unknown, status?: number): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>
    if (typeof d.error === 'string' && d.error.trim()) return d.error.trim()
    if (d.error && typeof d.error === 'object' && typeof (d.error as Record<string, unknown>).message === 'string') {
      const m = String((d.error as Record<string, unknown>).message).trim()
      if (m) return m
    }
    if (typeof d.detail === 'string' && d.detail.trim()) return d.detail.trim()
    if (typeof d.message === 'string' && d.message.trim()) return d.message.trim()
  }
  return status ? `The AI provider answered with HTTP ${status}` : 'The AI provider did not answer'
}

/** True when the provider refused the model itself (retired, not on this plan, unknown id). */
export function isModelRefusal(status: number, data: unknown): boolean {
  if (status !== 400 && status !== 403 && status !== 404) return false
  return /model[\s\S]{0,80}(not supported|not found|does not exist|not available|no access|unsupported)/i.test(providerErrorText(data, status))
}

export type ChainInput = {
  /** Present when the signed-in person connected ChatGPT. */
  chatgpt?: (model: string) => Promise<ProviderResult>
  chatgptModels?: string[]
  /** Present when the shop saved its own API key. */
  shopKey?: () => Promise<ProviderResult>
  shopKeyModel?: string
}

export type ChainOutput = ProviderResult & { provider: 'chatgpt' | 'shop_key' | 'none'; model?: string; attempts: ProviderAttempt[]; error?: string }

/**
 * Try ChatGPT models in order while each refuses the model; on any other ChatGPT failure, or when every model is
 * refused, use the shop key. Returns the first success, or the last failure with every attempt listed.
 */
export async function completeWithFallback(input: ChainInput): Promise<ChainOutput> {
  const attempts: ProviderAttempt[] = []
  let last: ChainOutput | null = null
  if (input.chatgpt) {
    for (const model of input.chatgptModels?.length ? input.chatgptModels : [...CHATGPT_MODELS]) {
      let result: ProviderResult
      try { result = await input.chatgpt(model) } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error
        result = { ok: false, status: 502, data: { error: error instanceof Error ? error.message : 'ChatGPT request failed' } }
      }
      if (result.ok) return { ...result, provider: 'chatgpt', model, attempts }
      const error = providerErrorText(result.data, result.status)
      attempts.push({ provider: 'chatgpt', model, status: result.status, error })
      last = { ...result, provider: 'chatgpt', model, attempts, error }
      if (!isModelRefusal(result.status, result.data)) break
    }
  }
  if (input.shopKey) {
    let result: ProviderResult
    try { result = await input.shopKey() } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      result = { ok: false, status: 502, data: { error: error instanceof Error ? error.message : 'AI request failed' } }
    }
    const model = input.shopKeyModel || ''
    if (result.ok) return { ...result, provider: 'shop_key', model, attempts }
    const error = providerErrorText(result.data, result.status)
    attempts.push({ provider: 'shop_key', model, status: result.status, error })
    return { ...result, provider: 'shop_key', model, attempts, error }
  }
  if (last) return last
  return { ok: false, status: 503, data: { error: 'AI is not set up for this shop. Add the shop AI key in Settings, or connect ChatGPT.' }, provider: 'none', attempts, error: 'AI is not set up for this shop. Add the shop AI key in Settings, or connect ChatGPT.' }
}

/** One sentence for the person when every provider failed: what was tried and the provider's own words. */
export function chainFailureMessage(out: ChainOutput): string {
  if (!out.attempts.length) return out.error || 'AI is not set up for this shop.'
  const lastAttempt = out.attempts[out.attempts.length - 1]
  const tried = out.attempts.map(a => `${a.provider === 'chatgpt' ? 'ChatGPT' : 'shop key'} ${a.model}`.trim()).join(', ')
  return `The AI could not answer (tried ${tried}). Last error: ${lastAttempt.error || `HTTP ${lastAttempt.status}`}`
}

/** Request fields a caller may pass through to the provider. Everything else (tools, n, logit_bias...) is dropped. */
export const PASSTHROUGH_FIELDS = ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop', 'response_format', 'reasoning'] as const
export const MAX_COMPLETION_TOKENS = 8000

export function cleanCompletionBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of PASSTHROUGH_FIELDS) if (body[key] !== undefined) out[key] = body[key]
  const requested = typeof body.max_tokens === 'number' && Number.isFinite(body.max_tokens) ? Math.floor(body.max_tokens) : 2000
  out.max_tokens = Math.max(1, Math.min(MAX_COMPLETION_TOKENS, requested))
  return out
}

/**
 * The model to use with the shop's key. A caller may only pick the shop's own default or a free model;
 * anything else would spend the shop's money on a model the owner did not choose.
 */
export function shopKeyModel(requested: unknown, shopDefault: string): string {
  const id = typeof requested === 'string' ? requested.trim() : ''
  if (!id || id === shopDefault) return shopDefault
  if (/:free$/i.test(id) && id.length <= 120) return id
  return shopDefault
}
