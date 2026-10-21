import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { CHATGPT_MODELS, chainFailureMessage, chatGptModelCandidates, cleanCompletionBody, completeWithFallback, isModelRefusal, providerErrorText, shopKeyModel } from '../src/lib/ai/provider-chain.ts'

const refusal = (model) => ({ ok: false, status: 400, data: { detail: `The '${model}' model is not supported when using Codex with a ChatGPT account.` } })
const answer = (text) => ({ ok: true, status: 200, data: { choices: [{ message: { role: 'assistant', content: text } }] } })

test('retired ChatGPT models are never tried; current ones are, best first', () => {
  assert.deepEqual(chatGptModelCandidates('gpt-5.5'), [...CHATGPT_MODELS])
  assert.deepEqual(chatGptModelCandidates(undefined), [...CHATGPT_MODELS])
  assert.deepEqual(chatGptModelCandidates('gpt-7-nova'), ['gpt-7-nova', ...CHATGPT_MODELS])
  assert.deepEqual(chatGptModelCandidates('deepseek/deepseek-v3.2'), [...CHATGPT_MODELS])
  assert.deepEqual(chatGptModelCandidates(undefined, 'gpt-6-astra'), ['gpt-6-astra', ...CHATGPT_MODELS])
  assert.ok(!chatGptModelCandidates('GPT-5.4').includes('gpt-5.4'))
})

test('provider error text is read from detail, error.message or error', () => {
  assert.match(providerErrorText(refusal('gpt-5.5').data), /not supported/)
  assert.equal(providerErrorText({ error: { message: 'No credits' } }), 'No credits')
  assert.equal(providerErrorText({ error: 'Key revoked' }), 'Key revoked')
  assert.equal(providerErrorText({}, 503), 'The AI provider answered with HTTP 503')
})

test('a model refusal is told apart from other failures', () => {
  assert.equal(isModelRefusal(400, refusal('gpt-5.5').data), true)
  assert.equal(isModelRefusal(404, { error: { message: 'model gpt-x not found' } }), true)
  assert.equal(isModelRefusal(401, { error: { message: 'Invalid token' } }), false)
  assert.equal(isModelRefusal(429, { error: { message: 'Rate limit' } }), false)
})

test('the 20 Oct production failure: every ChatGPT model refused, so the shop key answers', async () => {
  const tried = []
  const out = await completeWithFallback({
    chatgpt: async (model) => { tried.push(model); return refusal(model) },
    chatgptModels: chatGptModelCandidates('gpt-5.5'),
    shopKey: async () => answer('2 invoices are part paid, $310 owed.'),
    shopKeyModel: 'deepseek/deepseek-v4-flash',
  })
  assert.equal(out.ok, true)
  assert.equal(out.provider, 'shop_key')
  assert.deepEqual(tried, ['gpt-6.1-sol', 'gpt-6-luna'])
  assert.equal(out.attempts.length, 2)
})

test('the next ChatGPT model is tried after a refusal, and its answer is used', async () => {
  const out = await completeWithFallback({
    chatgpt: async (model) => model === 'gpt-6.1-sol' ? refusal(model) : answer('ok'),
    chatgptModels: ['gpt-6.1-sol', 'gpt-6-luna'],
    shopKey: async () => { throw new Error('should not be called') },
  })
  assert.equal(out.provider, 'chatgpt')
  assert.equal(out.model, 'gpt-6-luna')
})

test('a non-model ChatGPT failure (expired, rate limited) goes straight to the shop key', async () => {
  const tried = []
  const out = await completeWithFallback({
    chatgpt: async (model) => { tried.push(model); return { ok: false, status: 429, data: { error: { message: 'Usage limit reached' } } } },
    chatgptModels: ['gpt-6.1-sol', 'gpt-6-luna'],
    shopKey: async () => answer('ok'),
  })
  assert.deepEqual(tried, ['gpt-6.1-sol'])
  assert.equal(out.provider, 'shop_key')
})

test('a thrown ChatGPT error is recorded and the shop key still answers; Stop is never swallowed', async () => {
  const out = await completeWithFallback({ chatgpt: async () => { throw new Error('socket hang up') }, shopKey: async () => answer('ok') })
  assert.equal(out.ok, true)
  const abort = Object.assign(new Error('stopped'), { name: 'AbortError' })
  await assert.rejects(completeWithFallback({ chatgpt: async () => { throw abort }, shopKey: async () => answer('ok') }), /stopped/)
})

test('when everything fails the person sees what was tried and the provider\'s own words', async () => {
  const out = await completeWithFallback({
    chatgpt: async (model) => refusal(model),
    chatgptModels: ['gpt-6.1-sol'],
    shopKey: async () => ({ ok: false, status: 402, data: { error: { message: 'Insufficient credits' } } }),
    shopKeyModel: 'deepseek/deepseek-v4-flash',
  })
  assert.equal(out.ok, false)
  const msg = chainFailureMessage(out)
  assert.match(msg, /ChatGPT gpt-6\.1-sol/)
  assert.match(msg, /shop key deepseek\/deepseek-v4-flash/)
  assert.match(msg, /Insufficient credits/)
  assert.doesNotMatch(msg, /AI provider unavailable/)
})

test('nothing set up gives one plain sentence, no provider called', async () => {
  const out = await completeWithFallback({})
  assert.equal(out.provider, 'none')
  assert.match(chainFailureMessage(out), /not set up/)
})

test('callers cannot pass arbitrary provider options or huge token budgets', () => {
  const body = cleanCompletionBody({ messages: [], max_tokens: 999999, temperature: 0.2, tools: [{}], n: 9, logit_bias: { 1: 100 }, model: 'x' })
  assert.equal(body.max_tokens, 8000)
  assert.equal(body.temperature, 0.2)
  assert.equal(body.tools, undefined)
  assert.equal(body.n, undefined)
  assert.equal(body.model, undefined)
  assert.equal(cleanCompletionBody({}).max_tokens, 2000)
})

test('the shop key only runs the shop default or a free model', () => {
  assert.equal(shopKeyModel('openai/gpt-6-astra', 'deepseek/deepseek-v4-flash'), 'deepseek/deepseek-v4-flash')
  assert.equal(shopKeyModel('meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-v4-flash'), 'meta-llama/llama-3.3-70b-instruct:free')
  assert.equal(shopKeyModel(undefined, 'deepseek/deepseek-v4-flash'), 'deepseek/deepseek-v4-flash')
})

test('every AI route uses the shared chain and no route pins a retired model', () => {
  for (const file of ['../src/app/api/ai-completions/route.ts', '../src/app/api/ai-chat/route.ts', '../src/app/api/parts-lookup/route.ts']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(src, /completeWithFallback/, file)
    assert.doesNotMatch(src, /'gpt-5\.5'/, file)
  }
  const oauth = readFileSync(new URL('../src/lib/openai-oauth-server.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(oauth, /fallback = 'gpt-5\.5'/)
  const workflow = readFileSync(new URL('../src/app/api/ai-workflow/route.ts', import.meta.url), 'utf8')
  assert.match(workflow, /providerErrorText\(data, response\.status\)/)
  assert.doesNotMatch(workflow, /'AI provider unavailable'/)
})
