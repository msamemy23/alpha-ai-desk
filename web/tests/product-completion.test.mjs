import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
function load(path, imports = {}, globals = {}) {
  const module = { exports: {} }
  vm.runInNewContext(ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, Buffer, URL, Response, Headers, AbortSignal, console,
    process: { env: { ALPHA_CONNECTION_ENCRYPTION_KEY: 'test-only-key-not-a-production-secret-123456789' } },
    require: name => { if (name in imports) return imports[name]; throw new Error(`Unexpected import: ${name}`) }, ...globals,
  })
  return module.exports
}
const sealed = load('../src/lib/private-state.ts', { 'node:crypto': crypto })

test('private credentials are encrypted, randomized, tamper-proof and bound to shop/user', () => {
  const first = sealed.sealPrivateState({ refreshToken: 'private-token' }, 'shop-a:user-a')
  const second = sealed.sealPrivateState({ refreshToken: 'private-token' }, 'shop-a:user-a')
  assert.notEqual(first, second)
  assert.ok(!first.includes('private-token'))
  assert.equal(sealed.openPrivateState(first, 'shop-a:user-a').refreshToken, 'private-token')
  assert.throws(() => sealed.openPrivateState(first, 'shop-b:user-a'))
  assert.throws(() => sealed.openPrivateState(first, 'shop-a:user-b'))
  assert.throws(() => sealed.openPrivateState(first.replace(/.$/, first.endsWith('x') ? 'a' : 'x'), 'shop-a:user-a'))
})

function fixture() {
  const rows = new Map()
  const upstream = []
  const auth = { userId: 'user-a', shopId: 'shop-a', role: 'owner' }
  const db = { from: () => {
    let kind = 'read', values, filters = []
    const run = () => {
      if (kind === 'insert') { if (rows.has(values.user_id)) return { error: { code: '23505' } }; rows.set(values.user_id, { ...values }); return {} }
      const row = [...rows.values()].find(row => filters.every(([key, value, op]) => op === 'lte' ? row[key] <= value : row[key] === value))
      if (row && kind === 'update') Object.assign(row, values)
      if (row && kind === 'delete') rows.delete(row.user_id)
      return { data: row ? { ...row } : null, error: null }
    }
    const q = { select: () => q, eq: (k,v) => { filters.push([k,v,'eq']); return q }, lte: (k,v) => { filters.push([k,v,'lte']); return q },
      maybeSingle: async () => run(), insert: v => { kind = 'insert'; values = v; return q }, update: v => { kind = 'update'; values = v; return q }, delete: () => { kind = 'delete'; return q }, then: (resolve,reject) => Promise.resolve(run()).then(resolve,reject) }
    return q
  } }
  const tokens = { accessToken: 'access-secret', refreshToken: 'refresh-secret', accountId: 'chatgpt-account', expiresIn: 3600 }
  const lib = load('../src/lib/chatgpt-connection.ts', {
    'node:crypto': crypto, '@/lib/supabase': { getServiceClient: () => db }, '@/lib/private-state': sealed,
    '@openai-oauth/core': { DEFAULT_OPENAI_OAUTH_CLIENT_ID: 'public-client', deriveAccountId: () => 'chatgpt-account', exchangeOpenAIOAuthCode: async () => tokens, refreshOpenAIOAuthTokens: async () => tokens, createOpenAIOAuthTransport: options => options },
  }, { fetch: async (url, options) => {
    upstream.push({ url, body: JSON.parse(options.body) })
    return url.endsWith('usercode') ? Response.json({ device_auth_id: 'secret-device-id', user_code: 'TEST-CODE', interval: '5' })
      : Response.json({ authorization_code: 'secret-code', code_verifier: 'secret-verifier' })
  } })
  return { lib, rows, auth, upstream }
}

test('device sign-in exposes only the user code, polls once and keeps credentials private', async () => {
  const f = fixture()
  const start = await f.lib.startChatGptConnection(f.auth)
  assert.equal(start.status, 'pending'); assert.equal(start.code, 'TEST-CODE')
  assert.ok(!JSON.stringify(start).includes('secret-device-id'))
  await f.lib.pollChatGptConnection(f.auth)
  assert.equal(f.upstream.length, 1, 'early polling must not hit OpenAI')
  f.rows.get('user-a').next_poll_at = new Date(0).toISOString()
  await Promise.all([f.lib.pollChatGptConnection(f.auth), f.lib.pollChatGptConnection(f.auth)])
  assert.equal(f.upstream.length, 2, 'concurrent poll is fenced')
  assert.equal((await f.lib.chatGptConnectionStatus(f.auth)).status, 'connected')
  assert.ok(!JSON.stringify([...f.rows.values()]).includes('refresh-secret'))
  assert.equal((await f.lib.getUserChatGptTransport(f.auth)).auth.accessToken, 'access-secret')
  assert.equal(await f.lib.getUserChatGptTransport({ ...f.auth, userId: 'user-b' }), null)
  await f.lib.disconnectChatGpt(f.auth)
  assert.equal(await f.lib.getUserChatGptTransport(f.auth), null)
})

test('device cancellation and expired attempts cannot expose or reuse a session', async () => {
  const f = fixture()
  await f.lib.startChatGptConnection(f.auth)
  f.rows.get('user-a').expires_at = new Date(0).toISOString()
  assert.equal((await f.lib.pollChatGptConnection(f.auth)).status, 'expired')
  assert.equal(f.upstream.length, 1)
  await f.lib.disconnectChatGpt(f.auth)
  assert.equal((await f.lib.chatGptConnectionStatus(f.auth)).status, 'disconnected')
})

const browser = load('../src/lib/hosted-browser.ts', { 'puppeteer-core': {}, '@sparticuz/chromium': {}, '@/lib/public-url': {} })
test('hosted browser validates every action and rejects unsupported consequential steps', () => {
  assert.equal(browser.validateBrowserActions([{ type: 'fill', selector: '#search', value: 'brake pads' }]).length, 1)
  for (const actions of [null, Array(9).fill({ type: 'wait', ms: 1 }), [{ type: 'submit', selector: '#pay' }], [{ type: 'shell', value: 'whoami' }], [{ type: 'click' }], [{ type: 'wait', ms: 50000 }]]) assert.throws(() => browser.validateBrowserActions(actions))
})

test('chat reserves the viewport for messages, keeps controls bounded, and saves drafts idempotently', () => {
  const chat = read('../src/app/(app)/ai/page.tsx')
  assert.match(chat, /data-testid="chat-layout" className="flex h-full min-h-0/)
  assert.match(chat, /\[showActivity, setShowActivity\] = useState\(false\)/)
  assert.match(chat, /data-testid="chat-messages" className="min-h-0 flex-1/)
  assert.doesNotMatch(chat, /scrollIntoView|h-screen max-h-screen|encodedData.slice\(0, 8\)/)
  assert.match(chat, /'Idempotency-Key': key/)
  assert.match(chat, /_request_id: proposalId/)
  assert.match(chat, /element.disabled = saved/)
  const history = read('../src/app/api/ai-chat-history/route.ts')
  const normalize = history.match(/function normalizeMessages\(value: unknown\): HistoryMessage\[\] \{([\s\S]*?)\n\}/)[1]
  const js = ts.transpileModule(`function normalizeMessages(value) {${normalize}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const saved = vm.runInNewContext(`${js}; normalizeMessages([{ role: 'assistant', content: '', html: '<div>Unsaved invoice draft</div>' }])`)
  assert.equal(saved.length, 1, 'rich document drafts must survive cloud history normalization')
  assert.equal(saved[0].html, '<div>Unsaved invoice draft</div>')
})

test('credentials have no browser grants and browser traffic has no direct private-network path', () => {
  const migration = read('../supabase/migrations/20260912171907_private_chatgpt_connections.sql')
  assert.match(migration, /enable row level security/)
  assert.match(migration, /revoke all .* from public, anon, authenticated/)
  const runtime = read('../src/lib/hosted-browser.ts')
  assert.match(runtime, /fetchPublicUrl\(request.url\(\)/)
  assert.match(runtime, /proxy-server=http:\/\/127.0.0.1:9/)
  assert.doesNotMatch(runtime, /request.continue\(/)
  assert.match(runtime, /finally \{ clearTimeout\(watchdog\); await browser.close/)
})
