import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import * as rp from '../src/lib/browser/read-page.ts'
import { DEFAULT_SETTINGS } from '../src/lib/browser/policy.ts'

// A fake internet: every public-looking name resolves to a public-looking address, and the connection is steered to a local server.
let seen
let local
const PAGES = {
  '/page': ['text/html; charset=utf-8', '<html><head><title>Brake pads</title></head><body><h1>Brake pads</h1><p>Front set, in stock.</p><a href="/other">Other page</a><script>alert(1)</script></body></html>'],
  '/pdf': ['application/pdf', '%PDF-1.4'],
  '/plain': ['text/plain', 'Hello <b>plain</b> text'],
  '/error': ['text/html', '<html><body></body></html>'],
}
test.before(async () => {
  local = http.createServer((req, res) => {
    const host = String(req.headers.host || '')
    seen.push(`${host}${req.url}`)
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/redirect-blocked') { res.writeHead(302, { location: 'https://www.paypal.com/signin' }); return res.end() }
    if (url.pathname === '/redirect-private') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end() }
    if (url.pathname === '/redirect-loop') { res.writeHead(302, { location: '/redirect-loop' }); return res.end() }
    if (url.pathname === '/huge') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('x'.repeat(4 * 1024 * 1024)) }
    if (url.pathname === '/missing') { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('nope') }
    if (url.pathname === '/error') { res.writeHead(500, { 'content-type': 'text/html' }); return res.end('<html><body></body></html>') }
    if (url.pathname === '/html/' && host.startsWith('html.duckduckgo.com')) {
      res.writeHead(200, { 'content-type': 'text/html' })
      if (url.searchParams.get('q') === 'bot') return res.end('<html><body>Unfortunately, bots use DuckDuckGo too. Please complete the following challenge.</body></html>')
      return res.end(`<div class="result"><h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rockauto.com%2Fen%2Fcatalog">RockAuto Catalog</a></h2><a class="result__snippet">Auto parts online</a></div>
        <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.paypal.com%2Fx">PayPal</a></div>
        <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fblocked-shop.example.com%2F">Blocked shop</a></div>`)
    }
    const page = PAGES[url.pathname]
    if (!page) { res.writeHead(404); return res.end('') }
    res.writeHead(200, { 'content-type': page[0] }); res.end(page[1])
  })
  await new Promise(r => local.listen(0, '127.0.0.1', r))
})
test.after(() => local.close())
test.beforeEach(() => { seen = [] })

const deps = () => ({
  lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  httpRequest: (options, cb) => http.request({ ...options, hostname: '127.0.0.1', port: local.address().port }, cb),
  httpsRequest: (options, cb) => http.request({ ...options, hostname: '127.0.0.1', port: local.address().port }, cb),
})
const ctx = (over = {}) => ({ settings: DEFAULT_SETTINGS, rules: [{ host: 'blocked-shop.example.com', rule: 'block' }], quickHosts: [], ownHosts: ['desk.app.example.com'], ...over })

test('a page is read into Alpha\'s own blocks: title, text and links, with scripts dropped', async () => {
  const out = await rp.readPage('http://shop.example.com/page', ctx(), 'user', deps())
  assert.equal(out.ok, true)
  assert.equal(out.doc.title, 'Brake pads')
  assert.match(out.doc.text, /Front set, in stock/)
  assert.ok(!/alert/.test(out.doc.text))
  assert.deepEqual(out.doc.links.map(l => l.href), ['http://shop.example.com/other'])
  assert.deepEqual(seen, ['shop.example.com/page'])
  const plain = await rp.readPage('http://shop.example.com/plain', ctx(), 'user', deps())
  assert.match(plain.doc.text, /Hello <b>plain<\/b> text/, 'plain text is kept as text, never read as markup')
})

test('a blocked or private address is refused before anything is fetched', async () => {
  const blocked = await rp.readPage('https://blocked-shop.example.com/', ctx(), 'user', deps())
  assert.deepEqual([blocked.ok, blocked.code], [false, 'blocked'])
  const bank = await rp.readPage('https://www.chase.com/', ctx(), 'user', deps())
  assert.equal(bank.code, 'blocked')
  const own = await rp.readPage('https://desk.app.example.com/api/anything', ctx(), 'user', deps())
  assert.equal(own.code, 'blocked')
  const ai = await rp.readPage('http://shop.example.com/page', ctx({ settings: { ...DEFAULT_SETTINGS, aiEnabled: false } }), 'ai', deps())
  assert.equal(ai.code, 'blocked')
  for (const url of ['http://127.0.0.1/', 'http://localhost:3000/', 'http://169.254.169.254/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://[::1]/']) {
    const r = await rp.readPage(url, ctx(), 'user', deps())
    assert.equal(r.ok, false, url)
  }
  assert.deepEqual(seen, [], 'nothing reached the network')
})

test('a redirect to a blocked or private place is stopped at the hop, and the destination is never asked', async () => {
  const toBank = await rp.readPage('http://shop.example.com/redirect-blocked', ctx(), 'user', deps())
  assert.deepEqual([toBank.ok, toBank.code], [false, 'blocked'])
  const toMeta = await rp.readPage('http://shop.example.com/redirect-private', ctx(), 'user', deps())
  assert.deepEqual([toMeta.ok, toMeta.code], [false, 'blocked'])
  const loop = await rp.readPage('http://shop.example.com/redirect-loop', ctx(), 'user', deps())
  assert.equal(loop.ok, false)
  assert.ok(!seen.some(s => s.includes('paypal') || s.includes('169.254')))
})

test('a site that points at a private address is refused (DNS rebinding), even when one answer is public', async () => {
  const d = (answers) => ({ ...deps(), lookup: async () => answers })
  for (const answers of [[{ address: '10.0.0.5', family: 4 }], [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }], [{ address: '::ffff:127.0.0.1', family: 6 }], [{ address: 'fe80::1', family: 6 }]]) {
    const r = await rp.readPage('http://shop.example.com/page', ctx(), 'user', d(answers))
    assert.deepEqual([r.ok, r.code], [false, 'blocked'], JSON.stringify(answers))
  }
  assert.deepEqual(seen, [])
})

test('files, errors and oversized pages are reported in plain words', async () => {
  const pdf = await rp.readPage('http://shop.example.com/pdf', ctx(), 'user', deps())
  assert.deepEqual([pdf.ok, pdf.code], [false, 'type'])
  assert.match(pdf.message, /PDF/)
  const missing = await rp.readPage('http://shop.example.com/missing', ctx(), 'user', deps())
  assert.equal(missing.code, 'not_found')
  const err = await rp.readPage('http://shop.example.com/error', ctx(), 'user', deps())
  assert.deepEqual([err.ok, err.code], [false, 'unreadable'])
  const huge = await rp.readPage('http://shop.example.com/huge', ctx(), 'user', deps())
  assert.deepEqual([huge.ok, huge.code], [false, 'too_large'])
})

test('a search sends only the words, hides results the shop does not allow and says how many', async () => {
  const out = await rp.searchWeb('  brake   pads 2019 civic ', ctx(), 'user', deps())
  assert.equal(out.ok, true)
  assert.deepEqual(out.hits.map(h => h.host), ['rockauto.com'])
  assert.equal(out.hidden, 2)
  assert.equal(out.query, 'brake pads 2019 civic')
  assert.deepEqual(seen, ['html.duckduckgo.com/html/?q=brake%20pads%202019%20civic&kl=us-en'])
  assert.deepEqual((await rp.searchWeb('   ', ctx(), 'user', deps())).code, 'empty_query')
  const bot = await rp.searchWeb('bot', ctx(), 'user', deps())
  assert.deepEqual([bot.ok, bot.code], [false, 'blocked_by_provider'])
})
