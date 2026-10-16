import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as f from '../src/lib/jobflow.ts'

const src = rel => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8')

test('the progress steps show what is behind the customer, where the car is, and what is next', () => {
  const at = step => f.stepStates(step).map(s => `${s.key}:${s.state}`).join(' ')
  assert.equal(at('in'), 'in:now approved:next working:next ready:next')
  assert.equal(at('approved'), 'in:done approved:now working:next ready:next')
  assert.equal(at('working'), 'in:done approved:done working:now ready:next')
  assert.equal(at('ready'), 'in:done approved:done working:done ready:done')
  assert.equal(at('done'), 'in:done approved:done working:done ready:done')
  // Every step has words, so the page never leans on colour alone.
  for (const s of f.stepStates('working')) assert.ok(s.word.length > 3)
})

test('every status the shop uses lands on a step and a headline the customer can read', () => {
  for (const status of ['New', 'Approved', 'In Progress', 'In Repair', 'Waiting on Parts', 'Waiting on Customer', 'Supplement', 'Completed', 'Ready for Pickup', 'Paid', 'Closed', 'Something Odd']) {
    const p = f.publicStatusOf(status)
    assert.ok(p.headline.length > 5, status)
    assert.ok(f.stepStates(p.step).some(s => s.state === 'now') || p.step === 'done' || p.step === 'ready', status)
    // Money and internal wording never reach the customer.
    assert.ok(!/\$|invoice|estimate total|internal/i.test(`${p.headline} ${p.detail}`), status)
  }
})

test('the lamp is green when the car is ready, amber when the shop is waiting, blue otherwise', () => {
  assert.equal(f.statusLampFor('ready', null), 'green')
  assert.equal(f.statusLampFor('done', null), 'green')
  assert.equal(f.statusLampFor('working', 'parts'), 'amber')
  assert.equal(f.statusLampFor('working', 'you'), 'amber')
  assert.equal(f.statusLampFor('working', null), 'blue')
  assert.equal(f.statusLampFor('in', null), 'blue')
  // A ready car is green even if a waiting flag is left over.
  assert.equal(f.statusLampFor('ready', 'parts'), 'green')
})

test('a parts date is shown as a short day, and bad dates are left out', () => {
  assert.equal(f.shortYmd('2026-10-22'), 'Oct 22')
  assert.equal(f.shortYmd('2026-01-05T00:00:00Z'), 'Jan 5')
  for (const bad of ['', 'soon', '2026-13-01', '2026-00-10', '2026-10-32', null, undefined, 42]) assert.equal(f.shortYmd(bad), '', String(bad))
})

test('the public answer carries no ids, prices, plate, VIN or notes', () => {
  const route = src('app/api/status/route.ts')
  const body = route.slice(route.indexOf('return reply({\n    ok: true,'))
  assert.match(body, /headline: pub\.headline/, 'the test must be looking at the real answer')
  for (const secret of ['vehicle_plate', 'vehicle_vin', 'internal_notes', 'customer_notes', 'total', 'phone:', 'customer_id', 'job_id', 'shop_id', 'status_token']) {
    assert.ok(!new RegExp(`\\b${secret}\\b`).test(body.split('inspection,')[0].replace(/phone: info\.phone/, '')), `${secret} must not be in the public answer`)
  }
  assert.match(route, /overLimit\('status-view'/, 'one visitor cannot hammer it')
  assert.match(route, /const TOKEN = /, 'the token is checked before the database is asked')
})

test('the customer page is public, private to search engines, and refreshes itself', () => {
  assert.match(src('middleware.ts'), /pathname\.startsWith\('\/status\/'\)/)
  assert.match(src('middleware.ts'), /'\/api\/status'/)
  assert.match(src('app/status/[token]/layout.tsx'), /index: false/)
  const page = src('app/status/[token]/page.tsx')
  assert.match(page, /\/api\/status\?token=/)
  assert.match(page, /visibilitychange/)
  assert.match(page, /setInterval/)
  // A bad link stays bad: no retry button for a 404.
  assert.match(page, /setCanRetry\(res\.status !== 404\)/)
  assert.ok(!/supabase|localStorage|document\.cookie/.test(page), 'the page holds no sign-in and no stored data')
})

test('the status link card sends nothing by itself and only reads or writes the extras', () => {
  const card = src('components/jobs/StatusLinkCard.tsx')
  const calls = [...card.matchAll(/fetch\(([^,)]+)/g)].map(m => m[1].replace(/\s+/g, ''))
  assert.ok(calls.length >= 2)
  for (const c of calls) assert.ok(c.includes('/api/jobflow'), `unexpected request: ${c}`)
  assert.ok(!/api\/sms|api\/messages|send-text|sendText/.test(card), 'it never texts on its own')
  // The shop sees the message first: the card only opens the composer.
  const detail = src('components/jobs/JobDetail.tsx')
  assert.match(detail, /onText=\{url => \{ setBody\(statusTextBody\(/)
  assert.match(detail, /setComposing\(true\) \}\}/)
  // Turning the link off asks first.
  assert.match(card, /Turn off this link\?/)
})

test('the jobflow GET can be asked for one car and rejects a malformed car id', () => {
  const route = src('app/api/jobflow/route.ts')
  assert.match(route, /searchParams\.get\('job_id'\)/)
  assert.match(route, /!ID\.test\(one\)\) return reply\(\{ ok: false, error: 'Missing car' \}, 400\)/)
  assert.match(route, /\.eq\('shop_id', auth\.shopId\)/)
})
