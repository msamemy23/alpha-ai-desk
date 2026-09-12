import { createOpenAIOAuthTransport, type OpenAIOAuthTransport } from '@openai-oauth/core'
import { openaiCredentials } from '@openai-oauth/web/server'

type ChatMessage = { role: string; content?: unknown }

function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .filter(Boolean)
    .join('\n')
}

export function chatMessagesToResponsesInput(messages: unknown[]) {
  return messages.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const message = value as ChatMessage
    const text = messageText(message.content)
    if (!text) return []
    const role = message.role === 'system' ? 'developer' : message.role
    if (role !== 'user' && role !== 'assistant' && role !== 'developer') return []
    return [{
      role,
      content: [{ type: 'input_text', text }],
    }]
  })
}

export function responsesToChatCompletion(data: unknown, fallbackModel: string) {
  const response = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const output = Array.isArray(response.output) ? response.output : []
  const content = output
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const parts = (item as { content?: unknown }).content
      return Array.isArray(parts) ? parts : []
    })
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .filter(Boolean)
    .join('')
  return {
    id: typeof response.id === 'string' ? response.id : `chatcmpl-${crypto.randomUUID()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: typeof response.model === 'string' ? response.model : fallbackModel,
    choices: [{
      index: 0,
      message: { role: 'assistant', content },
      finish_reason: response.status === 'completed' ? 'stop' : null,
    }],
    ...(response.usage && typeof response.usage === 'object' ? { usage: response.usage } : {}),
  }
}

export async function fetchOpenAIChatCompletion(
  transport: OpenAIOAuthTransport,
  request: { model: string; messages: unknown[]; max_tokens?: number },
  signal?: AbortSignal,
) {
  const upstream = await transport.fetch(`${transport.baseURL}/responses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: request.model,
      input: chatMessagesToResponsesInput(request.messages),
      max_output_tokens: request.max_tokens,
      stream: false,
    }),
    signal,
  })
  const raw = await upstream.json().catch(() => ({}))
  if (!upstream.ok) return { ok: false, status: upstream.status, data: raw }
  const completion = responsesToChatCompletion(raw, request.model)
  if (raw.status !== 'completed' || !completion.choices[0].message.content.trim()) {
    return {
      ok: false,
      status: 502,
      data: { error: { message: 'ChatGPT did not return a completed answer. Try again or reconnect your account.' } },
    }
  }
  return {
    ok: true,
    status: upstream.status,
    data: completion,
  }
}

/**
 * Convert the browser-prefixed headers into the standard request shape the
 * OAuth adapter expects. The Alpha Supabase bearer token remains separate.
 */
export function getOpenAIOAuthTransport(req: Request): OpenAIOAuthTransport | null {
  const authorization = req.headers.get('x-openai-oauth-authorization')
  const accountId = req.headers.get('x-openai-oauth-account-id')
  if (!authorization || !accountId || !/^Bearer\s+\S+$/i.test(authorization)) return null

  const oauthHeaders = new Headers({
    authorization,
    'chatgpt-account-id': accountId,
  })
  const fedRamp = req.headers.get('x-openai-oauth-fedramp')
  if (fedRamp === 'true') oauthHeaders.set('x-openai-fedramp', 'true')
  const credentials = openaiCredentials(oauthHeaders)
  return createOpenAIOAuthTransport({ auth: credentials.getSession })
}

export function chatGptModel(value: unknown, fallback = 'gpt-5.5') {
  const requested = typeof value === 'string' ? value.trim() : ''
  // Provider-specific model names from the old OpenRouter settings must not
  // be sent to the ChatGPT Codex backend. Keep the allowlist deliberately
  // small; the backend still enforces what the user's plan can use.
  return /^gpt-(?:5|5\.)[a-z0-9._-]+$/i.test(requested) ? requested : fallback
}
