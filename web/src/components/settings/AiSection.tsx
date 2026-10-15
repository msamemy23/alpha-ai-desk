'use client'
import Link from 'next/link'
import ChatGPTConnection from '@/components/ChatGPTConnection'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import {
  AI_BASE_URLS,
  DEEPSEEK_PRO_MODEL,
  DEEPSEEK_PRO_OPENROUTER_MODEL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENROUTER_MODEL,
  normalizeAiBaseUrl,
  normalizeAiModel,
} from '@/lib/ai-config'
import { Group, SelectField, TextField, useSettings } from './fields'
import { StatusLine } from './shared'

const PROVIDERS = [
  { value: AI_BASE_URLS.OPENROUTER, label: 'OpenRouter' },
  { value: AI_BASE_URLS.OPENAI, label: 'OpenAI' },
  { value: AI_BASE_URLS.DEEPSEEK, label: 'DeepSeek' },
]

// The same model has a different name on each provider, so each list is its own.
const MODELS: Record<string, string[]> = {
  [AI_BASE_URLS.OPENROUTER]: [
    DEFAULT_OPENROUTER_MODEL,
    DEEPSEEK_PRO_OPENROUTER_MODEL,
    'meta-llama/llama-3.3-70b-instruct:free',
    'openai/gpt-4o-mini',
    'openai/gpt-4o',
    'anthropic/claude-3.5-sonnet',
    'google/gemini-flash-1.5',
  ],
  [AI_BASE_URLS.OPENAI]: [DEFAULT_OPENAI_MODEL, 'gpt-4o'],
  [AI_BASE_URLS.DEEPSEEK]: [DEFAULT_DEEPSEEK_MODEL, DEEPSEEK_PRO_MODEL],
}

const MODEL_LABELS: Record<string, string> = {
  [DEFAULT_OPENROUTER_MODEL]: 'DeepSeek V4 Flash (latest)',
  [DEFAULT_DEEPSEEK_MODEL]: 'DeepSeek V4 Flash (latest)',
  [DEEPSEEK_PRO_OPENROUTER_MODEL]: 'DeepSeek V4 Pro',
  [DEEPSEEK_PRO_MODEL]: 'DeepSeek V4 Pro',
  'meta-llama/llama-3.3-70b-instruct:free': 'Llama 3.3 70B (free)',
  'openai/gpt-4o-mini': 'GPT-4o Mini',
  'gpt-4o-mini': 'GPT-4o Mini',
  'openai/gpt-4o': 'GPT-4o',
  'gpt-4o': 'GPT-4o',
  'anthropic/claude-3.5-sonnet': 'Claude 3.5 Sonnet',
  'google/gemini-flash-1.5': 'Gemini Flash 1.5',
}

export default function AiSection() {
  const { settings, set } = useSettings()
  const loaded = 'ai_api_key_configured' in settings
  const keySaved = settings.ai_api_key_configured === true
  const provider = normalizeAiBaseUrl(settings.ai_base_url)
  const modelIds = MODELS[provider] || MODELS[AI_BASE_URLS.OPENROUTER]

  // Changing the provider also moves the model to that provider's name for it, so the two never disagree.
  const changeProvider = (nextBase: string) => {
    const base = normalizeAiBaseUrl(nextBase)
    const ids = MODELS[base] || modelIds
    const moved = normalizeAiModel(settings.ai_model, base)
    set('ai_model', ids.includes(moved) ? moved : ids[0])
  }

  return (
    <div className="space-y-4">
      <Notice kind="info">
        Alpha needs an AI key or your ChatGPT plan to answer questions and draft estimates and texts. An AI key is a long password from an AI company. Get one at <strong>openrouter.ai</strong>, openai.com or deepseek.com, paste it once, and it is never shown again.
      </Notice>

      <Group title="Your AI key" description="DeepSeek V4 Flash through OpenRouter is the default.">
        {loaded && (keySaved
          ? <StatusLine lamp="green">AI key saved</StatusLine>
          : <StatusLine lamp="off">No AI key saved. That is fine if you use your ChatGPT plan below.</StatusLine>)}
        <TextField k="ai_api_key" label="AI API key" type="password" mono secret placeholder="sk-or-v1-... or sk-..." />
        <SelectField
          k="ai_base_url"
          label="AI provider"
          fallback={AI_BASE_URLS.OPENROUTER}
          options={PROVIDERS}
          onPick={changeProvider}
          hint="Keep OpenRouter if your key starts with sk-or. Choose OpenAI or DeepSeek only if your key came straight from them."
        />
        <SelectField
          k="ai_model"
          label="Model"
          options={modelIds.map(id => ({ value: id, label: MODEL_LABELS[id] || id }))}
          hint="The model that answers. DeepSeek V4 Flash is fast and low cost."
        />
      </Group>

      <Group
        title="Use your ChatGPT plan"
        description="Use your ChatGPT subscription instead of an AI key. You approve a one-time code on OpenAI’s sign-in page, and no extension is needed. Your connection is encrypted, stored on Alpha’s server, and used only for your shop’s chat requests. It uses your plan’s Codex limits, not the billed OpenAI API, and it is separate from your Alpha sign-in. You can disconnect at any time."
      >
        <ChatGPTConnection />
      </Group>

      <section className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <h3 className="section-title">Agents and tools</h3>
          <p className="mt-1 text-[0.9375rem] text-text-secondary">See what Alpha’s helpers can do, which actions ask you first, and the connections on your desktop app.</p>
        </div>
        <Link href="/tools" className="btn btn-secondary shrink-0">
          Open agents and tools
          <Icon name="arrowRight" className="h-5 w-5" />
        </Link>
      </section>
    </div>
  )
}
