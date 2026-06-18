export const AI_BASE_URLS = {
  OPENROUTER: 'https://openrouter.ai/api/v1',
  OPENAI: 'https://api.openai.com/v1',
  DEEPSEEK: 'https://api.deepseek.com',
} as const

export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4-flash'
export const DEEPSEEK_PRO_OPENROUTER_MODEL = 'deepseek/deepseek-v4-pro'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash'
export const DEEPSEEK_PRO_MODEL = 'deepseek-v4-pro'
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

const LEGACY_DEEPSEEK_MODELS = new Set([
  'deepseek/deepseek-v3.2',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-reasoner',
  'deepseek-chat',
  'deepseek-reasoner',
])

export function normalizeAiBaseUrl(value: unknown, fallback = AI_BASE_URLS.OPENROUTER) {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\/$/, '') : fallback
}

export function isOpenRouterBaseUrl(baseUrl: unknown) {
  return normalizeAiBaseUrl(baseUrl).includes('openrouter.ai')
}

export function isOpenAiBaseUrl(baseUrl: unknown) {
  return normalizeAiBaseUrl(baseUrl).includes('api.openai.com')
}

export function isDeepSeekBaseUrl(baseUrl: unknown) {
  return normalizeAiBaseUrl(baseUrl).includes('api.deepseek.com')
}

export function normalizeAiModel(value: unknown, baseUrl: unknown = AI_BASE_URLS.OPENROUTER) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : ''

  if (isOpenAiBaseUrl(baseUrl)) {
    if (!raw || raw.startsWith('deepseek/') || LEGACY_DEEPSEEK_MODELS.has(raw)) return DEFAULT_OPENAI_MODEL
    return raw.startsWith('openai/') ? raw.replace(/^openai\//, '') : raw
  }

  if (isDeepSeekBaseUrl(baseUrl)) {
    if (!raw || raw === DEFAULT_OPENROUTER_MODEL || LEGACY_DEEPSEEK_MODELS.has(raw)) return DEFAULT_DEEPSEEK_MODEL
    if (raw === DEEPSEEK_PRO_OPENROUTER_MODEL) return DEEPSEEK_PRO_MODEL
    return raw.startsWith('deepseek/') ? raw.replace(/^deepseek\//, '') : raw
  }

  if (!raw || raw === DEFAULT_DEEPSEEK_MODEL || LEGACY_DEEPSEEK_MODELS.has(raw)) return DEFAULT_OPENROUTER_MODEL
  if (raw === DEEPSEEK_PRO_MODEL) return DEEPSEEK_PRO_OPENROUTER_MODEL
  return raw
}
