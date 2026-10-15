import test from 'node:test'
import assert from 'node:assert/strict'
import * as guard from '../src/lib/browser/guard.ts'
import { DEFAULT_SETTINGS } from '../src/lib/browser/policy.ts'

const headers = (obj) => ({ get: (n) => obj[n.toLowerCase()] ?? null })

test('a request must come from a page on this site; forged cross-site requests are refused', () => {
  const url = 'https://shop.app.example.com/api/browser/approvals/approve'
  assert.equal(guard.sameOriginRequest(headers({ origin: 'https://shop.app.example.com', host: 'shop.app.example.com' }), url), true)
  assert.equal(guard.sameOriginRequest(headers({ origin: 'https://evil.example', host: 'shop.app.example.com' }), url), false)
  assert.equal(guard.sameOriginRequest(headers({ origin: 'null', host: 'shop.app.example.com' }), url), false)
  assert.equal(guard.sameOriginRequest(headers({ 'sec-fetch-site': 'cross-site', host: 'shop.app.example.com' }), url), false)
  assert.equal(guard.sameOriginRequest(headers({ 'sec-fetch-site': 'same-origin', origin: 'https://shop.app.example.com', host: 'shop.app.example.com' }), url), true)
  assert.equal(guard.sameOriginRequest(headers({ host: 'shop.app.example.com' }), url), true, 'a tool with no Origin is not a cross-site browser')
  assert.equal(guard.sameOriginRequest(headers({ origin: 'https://shop.app.example.com', 'x-forwarded-host': 'shop.app.example.com', host: 'internal-1234' }), url), true)
  assert.equal(guard.sameOriginRequest(headers({ origin: 'https://shop.app.example.com.evil.example', host: 'shop.app.example.com' }), url), false)
})

test('Alpha\'s own hosts come from the environment and the request, and are never browsable', async () => {
  const hosts = guard.collectOwnHosts({ NEXT_PUBLIC_APP_URL: 'https://desk.app.example.com/', VERCEL_URL: 'desk-abc.vercel.app', NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co', OTHER: 'x' }, 'Desk.App.Example.com:443')
  assert.deepEqual([...hosts].sort(), ['desk-abc.vercel.app', 'desk.app.example.com', 'desk.app.example.com', 'proj.supabase.co'].filter((h, i, a) => a.indexOf(h) === i).sort())
  const { evaluateUrl } = await import('../src/lib/browser/policy.ts')
  const ctx = { settings: DEFAULT_SETTINGS, rules: [], quickHosts: [], ownHosts: hosts }
  assert.equal(evaluateUrl('https://desk.app.example.com/api/x', 'user', ctx).code, 'own_service')
  assert.equal(evaluateUrl('https://proj.supabase.co/rest/v1/', 'user', ctx).code, 'own_service')
  assert.equal(evaluateUrl('https://sub.desk.app.example.com/', 'ai', ctx).code, 'own_service')
})

test('the page address follows the whole policy; what a page loads follows the hard blocks and block lists but not the allow list', () => {
  const ctx = {
    settings: { mode: 'allowlist', aiEnabled: false, readerImages: true },
    rules: [{ host: 'parts.example.com', rule: 'allow' }, { host: 'ads.example.net', rule: 'block' }],
    quickHosts: [], ownHosts: ['desk.app.example.com'],
  }
  const check = guard.makeCheck(ctx, 'ai')
  assert.match(check('https://parts.example.com/', { navigation: true }), /switched off/)
  const user = guard.makeCheck(ctx, 'user')
  assert.equal(user('https://parts.example.com/', { navigation: true }), null)
  assert.match(user('https://other.example.org/', { navigation: true }), /only allows the sites on its list/)
  // Pictures and scripts from a content network are fine in allow-list mode...
  assert.equal(user('https://cdn.example.org/pic.png', { navigation: false }), null)
  assert.equal(check('https://cdn.example.org/pic.png', { navigation: false }), null, 'the AI switch is about opening pages, not about what a page draws')
  // ...but never from a blocked site, a default-blocked site, or Alpha itself.
  assert.match(user('https://ads.example.net/t.js', { navigation: false }), /blocked/)
  assert.match(user('https://www.paypal.com/x.js', { navigation: false }), /payments/i)
  assert.match(user('https://desk.app.example.com/api/secret', { navigation: false }), /Alpha Desk itself/)
  assert.ok(user('http://127.0.0.1:3000/', { navigation: false }))
  assert.ok(user('file:///etc/passwd', { navigation: false }))
})

test('the locked browser\'s own fetch refuses private and internal addresses', async () => {
  const fetcher = guard.makeResourceFetcher()
  const init = { method: 'GET', headers: {}, signal: AbortSignal.timeout(2000), maxBytes: 1000 }
  for (const url of ['http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'http://[::ffff:127.0.0.1]/', 'http://10.0.0.5/', 'file:///etc/passwd', 'http://metadata.google.internal/', 'http://example.com:6379/']) {
    await assert.rejects(() => fetcher(url, init), e => e.name === 'SafeFetchError' && ['blocked', 'bad_url'].includes(e.code), url)
  }
})

test('downloads cannot be programs, hide a program behind a second extension, or carry a path', () => {
  assert.deepEqual(guard.cleanDownloadName('guide.pdf'), { name: 'guide.pdf', program: false })
  assert.equal(guard.cleanDownloadName('invoice.pdf.exe').program, true)
  assert.equal(guard.cleanDownloadName('setup.MSI').program, true)
  assert.equal(guard.cleanDownloadName('run.sh').program, true)
  assert.equal(guard.cleanDownloadName('tool.jar').program, true)
  assert.equal(guard.cleanDownloadName('photo.jpg').program, false)
  assert.equal(guard.cleanDownloadName('../../etc/passwd').name, 'passwd')
  assert.equal(guard.cleanDownloadName('..\\..\\evil.pdf').name, 'evil.pdf')
  assert.equal(guard.cleanDownloadName('a"b<c>.pdf').name, 'abc.pdf')
  assert.equal(guard.cleanDownloadName('').name, 'file')
  assert.equal(guard.cleanDownloadName('x'.repeat(300) + '.pdf').name.length, 120)
  assert.equal(guard.downloadType('a.pdf'), 'application/pdf')
  assert.equal(guard.downloadType('a.html'), 'application/octet-stream')
  assert.equal(guard.downloadType('a.svg'), 'application/octet-stream')
  assert.equal(guard.downloadType('noext'), 'application/octet-stream')
})
