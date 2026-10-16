import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import * as c from '../src/lib/client-errors.ts'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

/* ---------- what a report may carry ---------- */

test('scrub takes out email addresses, phone numbers, long numbers and tokens', () => {
  const out = c.scrub('Could not text maria.lopez@example.com at (713) 555-0142, card 4111111111111111, id 9f2c1d7e-1b2a-4c3d-8e9f-0a1b2c3d4e5f', 400)
  assert.ok(!out.includes('maria.lopez'), out)
  assert.ok(!out.includes('555-0142'), out)
  assert.ok(!out.includes('4111111111111111'), out)
  assert.ok(!out.includes('9f2c1d7e'), out)
  assert.match(out, /\[email\]/)
  assert.match(out, /\[number\]/)
  assert.match(out, /\[id\]/)
})

test('scrub drops the query string and fragment of a link but keeps the host and path', () => {
  const out = c.scrub('GET https://alpha-ai-desk.vercel.app/api/status?token=SECRETVALUE123 failed, see https://x.test/a/b#frag=abc', 400)
  assert.ok(!out.includes('SECRETVALUE123'), out)
  assert.ok(!out.includes('frag=abc'), out)
  assert.ok(out.includes('https://alpha-ai-desk.vercel.app/api/status'), out)
  assert.ok(out.includes('https://x.test/a/b'), out)
})

test('scrub masks a long mixed token but leaves a script file name readable', () => {
  assert.match(c.scrub('bad token Abc123Def456Ghi789Jkl012Mno345', 200), /\[token\]/)
  const stack = c.scrub('at f (https://x.test/_next/static/chunks/4bd1b696-c023c6e3521b1417.js:1:2345)', 300)
  assert.ok(stack.includes('4bd1b696-c023c6e3521b1417.js'), stack)
})

test('scrub keeps ordinary words and short numbers, and cuts to the length limit', () => {
  assert.equal(c.scrub('Cannot read properties of undefined (reading \'map\')', 200), "Cannot read properties of undefined (reading 'map')")
  assert.equal(c.scrub('x'.repeat(1000), 50).length, 50)
  assert.equal(c.scrub(undefined, 50), '')
  assert.equal(c.scrub({ a: 1 }, 50), '')
})

test('cleanPath turns ids and tokens in the address into :id and drops the query string', () => {
  assert.equal(c.cleanPath('/dashboard'), '/dashboard')
  assert.equal(c.cleanPath('/customers/4f1c9b2e-0000-4000-8000-123456789abc?tab=notes'), '/customers/:id')
  assert.equal(c.cleanPath('/status/Zk3p9Qw1Xv8Lm2Nd7Rt4'), '/status/:id')
  assert.equal(c.cleanPath('/sign/abc123?x=1#y'), '/sign/:id')
  assert.equal(c.cleanPath('/shopboard'), '/shopboard')
  assert.equal(c.cleanPath('https://evil.test/x'), '')
  assert.equal(c.cleanPath(undefined), '')
  assert.ok(c.cleanPath('/' + 'a-'.repeat(200)).length <= 120)
})

test('cleanStack keeps only the top lines and scrubs them', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `    at fn${i} (https://x.test/a.js:${i}:1)`)
  const out = c.cleanStack(['TypeError: boom for sam@shop.com', ...lines].join('\n'))
  assert.ok(out.split('\n').length <= 9)
  assert.ok(!out.includes('sam@shop.com'))
  assert.ok(out.length <= 1200)
  assert.equal(c.cleanStack(undefined), '')
})

test('cleanReport accepts only the five kinds and needs a message or a digest', () => {
  for (const kind of c.REPORT_KINDS) assert.ok(c.cleanReport({ kind, message: 'x' }), kind)
  assert.equal(c.cleanReport({ kind: 'other', message: 'x' }), null)
  assert.equal(c.cleanReport({ kind: 'screen' }), null)
  assert.equal(c.cleanReport({ kind: 'screen', message: '' , digest: '' }), null)
  assert.ok(c.cleanReport({ kind: 'page', digest: '1234567890' }))
  assert.equal(c.cleanReport(null), null)
  assert.equal(c.cleanReport('text'), null)
  assert.equal(c.cleanReport([1, 2]), null)
})

test('cleanReport returns only the five known fields, cleaned, and ignores anything else sent', () => {
  const r = c.cleanReport({
    kind: 'script', message: 'Failed for bob@x.com', stack: 'Error\n at a (https://x.test/a.js:1:2)', path: '/invoices/12345678?x=1', digest: 'ab12!!cd', password: 'hunter2', userId: 'u-1', cookie: 'a=b',
  })
  assert.deepEqual(Object.keys(r).sort(), ['digest', 'kind', 'message', 'path', 'stack'])
  assert.ok(!JSON.stringify(r).includes('hunter2'))
  assert.ok(!r.message.includes('bob@x.com'))
  assert.equal(r.path, '/invoices/:id')
  assert.equal(r.digest, 'ab12cd')
})

test('cleanDigest and referenceCode give a short plain reference, or nothing', () => {
  assert.equal(c.referenceCode('3849105027abcdef'), '3849105027')
  assert.equal(c.referenceCode(undefined), '')
  assert.equal(c.referenceCode('   '), '')
  assert.equal(c.cleanDigest('a'.repeat(100)).length, 40)
})

test('noise: extensions, hidden cross-origin errors, resize notices and offline fetches are not reported', () => {
  assert.ok(c.isNoise('Script error.'))
  assert.ok(c.isNoise('ResizeObserver loop completed with undelivered notifications.'))
  assert.ok(c.isNoise('x', 'chrome-extension://abc/content.js'))
  assert.ok(c.isNoise('Failed to fetch'))
  assert.ok(c.isNoise('Load failed'))
  assert.ok(!c.isNoise('Cannot read properties of undefined'))
  assert.ok(!c.isNoise(undefined))
})

test('reportKey is the same for the same problem on the same page, so it is sent once', () => {
  const a = { kind: 'screen', message: 'boom', path: '/jobs', digest: '' }
  assert.equal(c.reportKey(a), c.reportKey({ ...a }))
  assert.notEqual(c.reportKey(a), c.reportKey({ ...a, path: '/customers' }))
  assert.equal(c.MAX_REPORTS_PER_PAGE, 5)
})

/* ---------- the screens ---------- */

test('the library imports nothing, so browser, server and tests share one set of rules', () => {
  assert.ok(!/^\s*import\s/m.test(read('src/lib/client-errors.ts')))
})

test('every crash screen exists: app, public, global and not-found', () => {
  for (const f of ['src/app/(app)/error.tsx', 'src/app/error.tsx', 'src/app/global-error.tsx', 'src/app/not-found.tsx']) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), f)
})

test('the app screen sits inside the signed-in layout and goes back to Today; the public one carries its own header', () => {
  const app = read('src/app/(app)/error.tsx')
  assert.match(app, /'use client'/)
  assert.match(app, /homeHref="\/dashboard"/)
  assert.match(app, /retry/)
  assert.ok(!/PublicHeader/.test(app), 'the shell already has a menu')
  const root = read('src/app/error.tsx')
  assert.match(root, /'use client'/)
  assert.match(root, /PublicHeader/)
})

test('the shared screen offers Try again and a way out, reports once, and never prints the technical message', () => {
  const s = read('src/components/ErrorScreen.tsx')
  assert.match(s, /Try again/)
  assert.match(s, /onClick=\{\(\) => retry\(\)\}/)
  assert.match(s, /reportClientError\('screen'/)
  assert.match(s, /role="alert"/)
  assert.ok(!/error\.message/.test(s), 'the message goes to the log, not onto the screen')
  assert.ok(!/error\.stack/.test(s))
})

test('the global screen draws its own html and body, has a title, and reports', () => {
  const g = read('src/app/global-error.tsx')
  assert.match(g, /<html lang="en">/)
  assert.match(g, /<body>/)
  assert.match(g, /<title>/)
  assert.match(g, /reportClientError\('app'/)
  assert.match(g, /retry/)
  assert.ok(!/globals\.css/.test(g), 'it has no global styles to rely on')
  assert.ok(!/error\.message/.test(g))
})

test('the not-found page says nothing was lost and offers two ways on', () => {
  const n = read('src/app/not-found.tsx')
  assert.match(n, /not found/i)
  assert.match(n, /Nothing was lost/)
  assert.match(n, /href="\/dashboard"/)
  assert.match(n, /href="\/help"/)
})

test('no emoji, gradients or uppercase styling in the new screens', () => {
  for (const f of ['src/components/ErrorScreen.tsx', 'src/app/not-found.tsx', 'src/app/global-error.tsx']) {
    const t = read(f)
    assert.ok(!/\p{Extended_Pictographic}/u.test(t), f)
    assert.ok(!/gradient/i.test(t), f)
    assert.ok(!/uppercase|text-transform/i.test(t), f)
  }
})

/* ---------- the route ---------- */

test('the report route is open to signed-out visitors, and only that route', () => {
  const m = read('src/middleware.ts')
  assert.match(m, /'\/api\/client-errors'/)
})

test('the report route checks the origin, the size, the rate, and answers 204 to everything', () => {
  const r = read('src/app/api/client-errors/route.ts')
  assert.match(r, /sameOrigin\(/)
  assert.match(r, /MAX_BODY_BYTES/)
  assert.match(r, /checkRateLimit\(`client-error:\$\{ip\}`, 10, 60_000\)/)
  assert.match(r, /checkRateLimit\('client-error:all', 120, 60_000\)/)
  assert.match(r, /cleanReport\(/)
  assert.match(r, /status: 204/)
  assert.ok(!/status: (4|5)\d\d/.test(r), 'a caller never learns why a report was dropped')
})

test('the report route writes one log line first, counts only for signed-in staff, and calls no outside service', () => {
  const r = read('src/app/api/client-errors/route.ts')
  assert.match(r, /console\.error\(JSON\.stringify\(\{ event: 'client_error'/)
  // The only database work is the daily count, and only after a signed-in shop is found. Nothing is sent anywhere.
  const code = r.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(!/fetch\(|resend|telnyx|\.from\(|\.insert\(/i.test(code))
  assert.match(code, /if \(auth\) await recordProblem\(/)
})

test('the browser reporter skips noise and repeats, caps the count, and never throws', () => {
  const s = read('src/lib/report-error.ts')
  assert.match(s, /isNoise\(/)
  assert.match(s, /sent\.has\(key\)/)
  assert.match(s, /MAX_REPORTS_PER_PAGE/)
  assert.match(s, /catch \{/)
  assert.match(s, /keepalive: true/)
})

test('the root layout listens for errors that no screen catches', () => {
  assert.match(read('src/app/layout.tsx'), /<ClientErrorListener \/>/)
  const l = read('src/components/ClientErrorListener.tsx')
  assert.match(l, /addEventListener\('error'/)
  assert.match(l, /addEventListener\('unhandledrejection'/)
  assert.match(l, /removeEventListener\('error'/)
})

test('masking a long number keeps the line break that follows it', () => {
  assert.equal(c.scrub('Error: Handler crash 4111111111111111\n    at onClick', 200), 'Error: Handler crash [number]\n    at onClick')
})
