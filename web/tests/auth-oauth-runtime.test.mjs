import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as crypto from 'node:crypto'
import * as oauthCore from '@openai-oauth/core'
import * as oauthWeb from '@openai-oauth/web/server'

function load(relativePath, stubs = {}, globals = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const testModule = { exports: {} }
  vm.runInNewContext(compiled, {
    module: testModule, exports: testModule.exports, Request, Response, Headers, URL, AbortSignal,
    crypto: crypto.webcrypto, console: { error() {} },
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://test.invalid', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only' } },
    require(id) { if (id in stubs) return stubs[id]; throw new Error(`Unexpected import: ${id}`) },
    ...globals,
  }, { filename: relativePath })
  return testModule.exports
}

const callback = load('../src/lib/auth-callback.ts')
test('stored audit results redact passwords, API credentials, and staff PINs', async () => {
  let saved
  const audit = load('../src/lib/audit-log.ts', {
    '@/lib/supabase': { getServiceClient: () => ({ from: () => ({ insert: async row => { saved = row; return { error: null } } }) }) },
  })
  await audit.writeAuditLog({ shopId: 'shop-a', action: 'ai.listStaff', metadata: {
    result: { staff: [{ name: 'Test', pin: '1234', pin_hash: 'test-hash', password: 'test-password', access_token: 'test-token', api_key: 'test-key' }] },
  } })
  const entry = saved.metadata.result.staff[0]
  assert.equal(entry.name, 'Test')
  for (const key of ['pin', 'pin_hash', 'password', 'access_token', 'api_key']) assert.equal(entry[key], '[redacted]')
})

test('Google callback waits for automatic PKCE initialization and never exchanges twice', async () => {
  const calls = []
  const session = { user: { id: 'owner' } }
  const result = await callback.getCallbackSession({
    async initialize() { calls.push('initialize'); return { error: null } },
    async getSession() { calls.push('getSession'); return { data: { session }, error: null } },
    async exchangeCodeForSession() { assert.fail('One-use code exchanged twice') },
  })
  assert.equal(result, session)
  assert.deepEqual(calls, ['initialize', 'getSession'])
})

test('callback surfaces initialization errors and missing sessions instead of pretending success', async () => {
  await assert.rejects(callback.getCallbackSession({
    async initialize() { return { error: new Error('Expired authorization') } },
    async getSession() { assert.fail('Must stop after authorization error') },
  }), /Expired authorization/)
  await assert.rejects(callback.getCallbackSession({
    async initialize() { return { error: null } },
    async getSession() { return { data: { session: null }, error: null } },
  }), /same browser/)
})

function query(result) {
  const chain = { async maybeSingle() { return result }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject) } }
  for (const name of ['select', 'eq', 'order', 'limit']) chain[name] = () => chain
  return chain
}

for (const scenario of ['success', 'query-error', 'audit-error']) {
  test(`read-only AI actions durably audit results and failures: ${scenario}`, async () => {
    const audits = []
    const row = { id: 'inventory-test', name: 'Brake pad' }
    const route = load('../src/app/api/ai-action/route.ts', {
      'next/server': { NextResponse: Response },
      'node:crypto': crypto,
      '@/lib/supabase': { getServiceClient: () => ({ from: () => query(scenario === 'query-error' ? { data: null, error: { message: 'Test database outage' } } : { data: [row], error: null }) }) },
      '@/lib/api-auth': { getAuthedShop: async () => ({ shopId: 'shop-a', userId: 'user-a', role: 'owner' }), hasInternalApiSecret: () => false },
      '@/lib/email': {},
      '@/lib/api-response': { getIdempotencyKey: () => 'test-key' },
      '@/lib/audit-log': { writeAuditLog: async entry => { audits.push(entry); return scenario === 'audit-error' ? { ok: false, error: 'Audit unavailable' } : { ok: true } } },
      '@/lib/rate-limit': { checkRateLimit: () => ({ ok: true }), rateLimitKey: () => 'test-limit' },
      '@/lib/sms-consent': {},
      '@/lib/document-money': {},
    })
    const response = await route.POST(new Request('https://alpha.invalid/api/ai-action', { method: 'POST', body: JSON.stringify({ action: 'getInventory', payload: {} }) }))
    assert.equal(audits.length, 1)
    assert.equal(audits[0].permission, 'read')
    assert.equal(audits[0].shopId, 'shop-a')
    assert.equal(audits[0].action, 'ai.getInventory')
    if (scenario === 'query-error') {
      assert.equal(response.status, 500)
      assert.equal(audits[0].metadata.success, false)
      assert.equal(audits[0].metadata.error, 'Test database outage')
    } else {
      assert.equal(response.status, scenario === 'audit-error' ? 502 : 200)
      assert.equal(audits[0].metadata.result.inventory[0].id, row.id)
    }
  })
}
for (const [name, membership, expected] of [
  ['active owner', { data: { shop_id: 'shop-a', role: 'owner' }, error: null }, 'shop-a'],
  ['hard-revoked owner', { data: null, error: null }, null],
  ['membership lookup outage', { data: null, error: { message: 'unavailable' } }, null],
]) {
  test(`server authorization: ${name}`, async () => {
    const auth = load('../src/lib/api-auth.ts', {
      'next/headers': { headers: async () => new Headers({ authorization: 'Bearer test-only' }) },
      '@supabase/ssr': {},
      '@supabase/supabase-js': { createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user-a' } } }) } }) },
      '@/lib/supabase': { getServiceClient: () => ({ from: table => query(table === 'shop_memberships' ? membership : { data: { id: 'legacy-owned-shop' }, error: null }) }) },
    })
    const result = await auth.getAuthedShop()
    assert.equal(result?.shopId ?? null, expected)
  })
}

const oauth = load('../src/lib/openai-oauth-server.ts', {
  '@openai-oauth/core': oauthCore, '@openai-oauth/web/server': oauthWeb,
})
test('ChatGPT connector preserves Alpha authorization and requires both OAuth headers', () => {
  const request = new Request('https://alpha.invalid', { headers: { Authorization: 'Bearer alpha-only' } })
  assert.equal(oauth.getOpenAIOAuthTransport(request), null)
  assert.equal(request.headers.get('authorization'), 'Bearer alpha-only')
})

test('actual OAuth adapter binds the account, normalizes Codex requests, and collects the streamed answer', async () => {
  let sent
  const transport = oauthCore.createOpenAIOAuthTransport({
    auth: { accessToken: 'test-only-token', accountId: 'test-account' },
    codexVersion: '0.100.0',
    fetch: async (input, init) => {
      const url = String(input instanceof Request ? input.url : input)
      if (url.includes('/models')) return Response.json({ models: [{ slug: 'gpt-5.5', display_name: 'Test model', supported_in_api: true, visibility: 'list' }] })
      assert.match(url, /^https:\/\/chatgpt.com\/backend-api\/codex\/responses/)
      sent = { headers: new Headers(init.headers), body: JSON.parse(init.body) }
      const response = { id: 'response-test', status: 'completed', model: 'gpt-5.5', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Test answer' }] }] }
      return new Response(`event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    },
  })
  const result = await oauth.fetchOpenAIChatCompletion(transport, {
    model: 'gpt-5.5', messages: [{ role: 'system', content: 'Be accurate' }, { role: 'user', content: 'Test' }], max_tokens: 40,
  })
  assert.equal(result.ok, true)
  assert.equal(result.data.choices[0].message.content, 'Test answer')
  assert.equal(sent.headers.get('chatgpt-account-id'), 'test-account')
  assert.equal(sent.headers.get('authorization'), 'Bearer test-only-token')
  assert.equal(sent.body.store, false)
  assert.equal(sent.body.stream, true)
  assert.equal(sent.body.input[0].role, 'developer')
  assert.equal(sent.body.max_output_tokens, undefined)
})

test('incomplete or empty ChatGPT responses fail visibly', async () => {
  for (const body of [{}, { status: 'completed', output: [] }, { status: 'incomplete', output: [] }]) {
    const result = await oauth.fetchOpenAIChatCompletion({ baseURL: 'https://test.invalid', fetch: async () => Response.json(body) }, { model: 'gpt-5.5', messages: [] })
    assert.equal(result.ok, false)
    assert.equal(result.status, 502)
  }
})

for (const missingCampaignId of [false, true]) {
  test(missingCampaignId ? 'Facebook 200 without an id is uncertain, not retryable failure' : 'Facebook partial failure preserves the existing campaign for reconciliation', async () => {
    const finishes = []
    const requests = []
    const settings = { ai_api_key: 'test-only', facebook_page_token: 'test-only', facebook_page_id: 'page', fb_ad_account_id: 'account', shop_name: 'Test Shop', shop_address: 'Test Address', shop_phone: 'Test Phone' }
    const route = load('../src/app/api/growth/create-ad/route.ts', {
      'node:crypto': crypto,
      'next/server': { NextResponse: Response },
      '@/lib/supabase': { getServiceClient: () => ({ from: table => query({ data: table === 'settings' ? settings : null, error: null }) }) },
      '@/lib/document-money': { roundMoney: v => v },
      '@/lib/ai-config': { AI_BASE_URLS: { OPENROUTER: 'https://ai.invalid' }, normalizeAiBaseUrl: v => v, normalizeAiModel: () => 'test' },
      '@/lib/api-auth': { getRouteShop: async () => ({ shopId: 'test-shop', role: 'owner' }) },
      '@/lib/api-response': { getIdempotencyKey: () => 'test-key' },
      '@/lib/social-operation': {
        peekSocialPublishingOperation: async () => ({ state: 'missing' }),
        startSocialPublishingOperation: async () => ({ state: 'claimed', id: 'test-operation' }),
        finishSocialPublishingOperation: async (...args) => { finishes.push(args); return { ok: true } },
      },
    }, { fetch: async (url, init) => {
      requests.push(String(url))
      if (String(url).includes('ai.invalid')) {
        assert.match(init.body, /Test Address/)
        assert.match(init.body, /Test Phone/)
        return Response.json({ choices: [{ message: { content: '{"headline":"Test"}' } }] })
      }
      if (String(url).endsWith('/campaigns')) return Response.json(missingCampaignId ? {} : { id: 'existing-campaign' })
      if (String(url).endsWith('/adsets')) return Response.json({ error: { message: 'Invalid targeting' } }, { status: 400 })
      assert.fail(`Unexpected outbound request ${url}`)
    } })
    const response = await route.POST(new Request('https://alpha.invalid/api/growth/create-ad', { method: 'POST', body: JSON.stringify({ platform: 'facebook', service: 'brakes', budget: 10, duration_days: 7, target_area: 'Houston' }) }))
    assert.equal((await response.json()).ok, false)
    assert.equal(finishes.length, 1)
    assert.equal(finishes[0][1], 'unknown')
    if (!missingCampaignId) assert.equal(finishes[0][2].campaign_id, 'existing-campaign')
    assert.equal(requests.length, missingCampaignId ? 2 : 3)
  })
}
