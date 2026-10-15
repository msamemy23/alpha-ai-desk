import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const share = readFileSync(new URL('../src/app/api/inspection/share/route.ts', import.meta.url), 'utf8')
const pub = readFileSync(new URL('../src/app/api/inspection/public/route.ts', import.meta.url), 'utf8')
const middleware = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8')
const customerPage = readFileSync(new URL('../src/app/inspection/[token]/page.tsx', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../src/app/inspection/[token]/layout.tsx', import.meta.url), 'utf8')
const migration = readFileSync(new URL('../../supabase/migrations/036_dvi_customer_link.sql', import.meta.url), 'utf8')
const lines = src => src.split('\n').map((text, i) => ({ text, n: i + 1 }))

test('making or turning off a link needs a signed-in, non-viewer user', () => {
  assert.equal((share.match(/getAuthedShop\(\)/g) || []).length, 2, 'GET and POST both check the session')
  assert.match(share, /if \(!auth\) return unauthorized\(\)/)
  assert.match(share, /auth\.role === 'viewer'\) return forbidden\(\)/)
})

test('the shop side only touches the signed-in shop\'s inspections', () => {
  for (const { text, n } of lines(share)) {
    if (!/sb\.from\('(dvi|settings)'\)|getServiceClient\(\)\.from\('dvi'\)/.test(text)) continue
    assert.match(text, /\.eq\('shop_id', auth\.shopId\)/, `share:${n} is limited to the shop`)
  }
  // the update that stores or clears the token is limited by id AND shop
  assert.equal((share.match(/\.update\(\{ share_token: [^}]+\}\)\.eq\('id', id\)\.eq\('shop_id', auth\.shopId\)/g) || []).length, 2)
})

test('the link token is a random UUID, never guessable from the inspection', () => {
  assert.match(share, /crypto\.randomUUID\(\)/)
  assert.doesNotMatch(share, /share_token: (id|row\.id)/)
})

test('the customer routes are public in the middleware, and nothing else under /api/inspection is', () => {
  assert.match(middleware, /'\/api\/inspection\/public'/)
  assert.doesNotMatch(middleware, /'\/api\/inspection\/share'/)
  assert.doesNotMatch(middleware, /'\/api\/inspection'[,\]]/)
  assert.match(middleware, /pathname\.startsWith\('\/inspection\/'\)/)
})

test('the customer routes check the token shape, limit the rate, and look the inspection up by token only', () => {
  assert.match(pub, /const TOKEN = \/\^\[0-9a-f\]\{8\}/)
  assert.equal((pub.match(/TOKEN\.test\(token\)/g) || []).length, 2, 'GET and POST both validate the token')
  assert.equal((pub.match(/checkRateLimit\(/g) || []).length, 2, 'GET and POST are both rate limited')
  assert.match(pub, /\.eq\('share_token', token\)/)
  // the answer is written to the row that token found, in that row's own shop
  assert.match(pub, /\.eq\('id', row\.id as string\)\.eq\('shop_id', row\.shop_id as string\)/)
})

test('the customer response never includes ids, the customer\'s phone, or the shop\'s private notes', () => {
  const reply = pub.slice(pub.indexOf('return reply({\n    ok: true,\n    shop:'), pub.indexOf('export async function POST'))
  assert.ok(reply.length > 100, 'found the GET response')
  for (const leak of ['shop_id', 'customer_id', 'job_id', 'share_token', 'internal', 'phone: row', 'tech:']) assert.ok(!reply.includes(leak), `response must not include ${leak}`)
})

test('answers are checked against the real findings, and need at least one choice', () => {
  assert.match(pub, /cleanDecisions\(body\?\.decisions, list\.map\(f => f\.id\)\)/)
  assert.match(pub, /Object\.keys\(decisions\)\.length === 0\) return reply\(\{ ok: false/)
})

test('the customer page is kept out of search results and sends nothing but the token and the answers', () => {
  assert.match(layout, /robots: \{ index: false, follow: false \}/)
  assert.match(customerPage, /JSON\.stringify\(\{ token, decisions: choice \}\)/)
})

test('the migration adds the columns and a unique token, and does not drop anything', () => {
  for (const c of ['customer_id', 'share_token', 'customer_decisions', 'customer_decided_at', 'viewed_at', 'summary']) assert.match(migration, new RegExp(c))
  assert.match(migration, /unique index/i)
  assert.doesNotMatch(migration, /drop\s+(table|column)/i)
})
