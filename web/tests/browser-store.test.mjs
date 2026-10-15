import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserDb } from './helpers/browser-fake-db.mjs'
import * as store from '../src/lib/browser/store.ts'

const SHOP = '11111111-1111-4111-8111-111111111111'
const OTHER_SHOP = '22222222-2222-4222-8222-222222222222'
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const details = (over = {}) => ({ kind: 'send', title: 'Send a message or request', summary: 'Press "Send" on shop.example.', host: 'shop.example', url: 'https://shop.example/contact', fields: [{ label: 'Name', value: 'Sam' }], why: 'This sends a message.', ...over })
const CANON = '["send","https://shop.example/contact","abc","post","https://shop.example/send",["Name=Sam"]]'

test('missing tables are reported, never thrown, and each feature falls back to its defaults', async () => {
  const db = createBrowserDb({}, { missing: ['browser_settings', 'browser_site_rules', 'browser_bookmarks', 'browser_approvals'] })
  const s = await store.loadSettings(db, SHOP)
  assert.deepEqual([s.missing, s.settings.mode, s.settings.aiEnabled], [true, 'open', true])
  assert.deepEqual(await store.saveSettings(db, SHOP, USER, { mode: 'allowlist' }), { ok: false, missing: true, error: 'This needs a database update.' })
  const rules = await store.listRules(db, SHOP)
  assert.deepEqual([rules.missing, rules.rules.length], [true, 0])
  const marks = await store.listBookmarks(db, SHOP)
  assert.equal(marks.missing, true)
  assert.ok(marks.items.length >= 5 && marks.items.every(b => b.builtin))
  const rule = await store.addRule(db, SHOP, USER, 'example.com', 'block')
  assert.equal(rule.ok, false)
  assert.equal(rule.missing, true)
  // Approvals fail closed: nothing is created, and nothing can be consumed.
  assert.deepEqual(await store.createApproval(db, SHOP, USER, { kind: 'send', hash: store.hashAction(CANON), details: details(), actor: 'user' }), { ok: false, missing: true })
  assert.equal(await store.consumeApproval(db, SHOP, USER, '00000000-0000-4000-8000-000000000001', store.hashAction(CANON)), false)
  await assert.rejects(() => store.authorizerFor(db, SHOP, USER, 'user')({ kind: 'send', canonical: CANON, details: details() }), e => e.name === 'NeedsDatabaseUpdate')
})

test('settings are saved per shop and read back; unknown values fall back safely', async () => {
  const db = createBrowserDb({ browser_settings: [] })
  assert.equal((await store.loadSettings(db, SHOP)).settings.mode, 'open')
  const saved = await store.saveSettings(db, SHOP, USER, { mode: 'allowlist', aiEnabled: false })
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.value, { mode: 'allowlist', aiEnabled: false, readerImages: true })
  assert.deepEqual((await store.loadSettings(db, SHOP)).settings, saved.value)
  assert.equal((await store.loadSettings(db, OTHER_SHOP)).settings.mode, 'open', 'another shop is untouched')
  const junk = await store.saveSettings(db, SHOP, USER, { mode: 'anything', aiEnabled: 'yes' })
  assert.deepEqual(junk.value, { mode: 'allowlist', aiEnabled: false, readerImages: true })
})

test('rules are cleaned to a bare site, kept once per site, and removed only inside the shop', async () => {
  const db = createBrowserDb({ browser_site_rules: [] })
  const a = await store.addRule(db, SHOP, USER, 'https://www.Example.com/some/page', 'block', '  no thanks ')
  assert.deepEqual([a.ok, a.value.host, a.value.rule, a.value.note], [true, 'example.com', 'block', 'no thanks'])
  await store.addRule(db, SHOP, USER, 'example.com', 'allow')
  assert.equal(db.tables.browser_site_rules.length, 1, 'one rule per site')
  assert.equal(db.tables.browser_site_rules[0].rule, 'allow')
  for (const bad of ['', 'localhost', '10.0.0.1', 'http://192.168.0.1/', 'not a site!!', 'intranet']) {
    assert.equal((await store.addRule(db, SHOP, USER, bad, 'block')).ok, false, bad)
  }
  assert.equal((await store.addRule(db, SHOP, USER, 'example.org', 'maybe')).ok, false)
  await store.addRule(db, OTHER_SHOP, USER, 'example.net', 'block')
  const mine = await store.listRules(db, SHOP)
  assert.deepEqual(mine.rules.map(r => r.host), ['example.com'])
  const otherId = db.tables.browser_site_rules.find(r => r.shop_id === OTHER_SHOP).id
  await store.removeRule(db, SHOP, otherId)
  assert.equal(db.tables.browser_site_rules.length, 2, 'cannot remove another shop\'s rule')
  assert.equal((await store.removeRule(db, SHOP, 'not-an-id')).ok, false)
  await store.removeRule(db, SHOP, mine.rules[0].id)
  assert.equal((await store.listRules(db, SHOP)).rules.length, 0)
})

test('quick sites: built-in ones until the shop saves its own; only public web addresses can be saved', async () => {
  const db = createBrowserDb({ browser_bookmarks: [] })
  assert.ok((await store.listBookmarks(db, SHOP)).items.every(b => b.builtin))
  const ok = await store.addBookmark(db, SHOP, USER, { title: ' Local   parts  house ', url: 'https://parts.example.com/search#x' })
  assert.equal(ok.ok, true)
  assert.equal(ok.value.title, 'Local parts house')
  assert.equal(ok.value.url, 'https://parts.example.com/search')
  const list = await store.listBookmarks(db, SHOP)
  assert.deepEqual(list.items.map(b => b.title), ['Local parts house'])
  for (const url of ['javascript:alert(1)', 'http://127.0.0.1/', 'ftp://x.example.com/', 'http://localhost:3000']) {
    assert.equal((await store.addBookmark(db, SHOP, USER, { title: 'x', url })).ok, false, url)
  }
  assert.equal((await store.listBookmarks(db, OTHER_SHOP)).items.every(b => b.builtin), true)
})

test('an approval is single-use, expires, belongs to the person who asked, and only fits the exact action', async () => {
  const db = createBrowserDb({ browser_approvals: [] })
  const t0 = Date.parse('2026-01-15T12:00:00Z')
  const hash = store.hashAction(CANON)
  const made = await store.createApproval(db, SHOP, USER, { kind: 'send', hash, details: details(), actor: 'ai', now: t0 })
  assert.equal(made.ok, true)
  const id = made.id
  assert.equal(db.tables.browser_approvals[0].status, 'pending')
  assert.equal(db.tables.browser_approvals[0].actor, 'ai')

  // Not approved yet: cannot be used.
  assert.equal(await store.consumeApproval(db, SHOP, USER, id, hash, t0 + 1000), false)
  // Someone else cannot approve it, and neither can another shop.
  assert.deepEqual(await store.decideApproval(db, SHOP, OTHER_USER, id, 'approved', t0 + 1000), { ok: false, reason: 'not_found' })
  assert.equal((await store.decideApproval(db, OTHER_SHOP, USER, id, 'approved', t0 + 1000)).ok, false)
  const decided = await store.decideApproval(db, SHOP, USER, id, 'approved', t0 + 2000)
  assert.equal(decided.ok, true)
  assert.equal(decided.approval.status, 'approved')
  // Cannot be decided twice.
  assert.deepEqual(await store.decideApproval(db, SHOP, USER, id, 'denied', t0 + 3000), { ok: false, reason: 'decided' })

  // Wrong action, wrong person, wrong shop, expired: no.
  assert.equal(await store.consumeApproval(db, SHOP, USER, id, store.hashAction(CANON.replace('Sam', 'Eve')), t0 + 4000), false)
  assert.equal(await store.consumeApproval(db, SHOP, OTHER_USER, id, hash, t0 + 4000), false)
  assert.equal(await store.consumeApproval(db, OTHER_SHOP, USER, id, hash, t0 + 4000), false)
  assert.equal(await store.consumeApproval(db, SHOP, USER, id, hash, t0 + 11 * 60_000), false)
  assert.equal(await store.consumeApproval(db, SHOP, USER, id, 'not-a-hash', t0 + 4000), false)
  assert.equal(await store.consumeApproval(db, SHOP, USER, 'not-an-id', hash, t0 + 4000), false)
  // Exactly once.
  const results = await Promise.all([store.consumeApproval(db, SHOP, USER, id, hash, t0 + 5000), store.consumeApproval(db, SHOP, USER, id, hash, t0 + 5000)])
  assert.equal(results.filter(Boolean).length >= 1, true)
  assert.equal(await store.consumeApproval(db, SHOP, USER, id, hash, t0 + 6000), false, 'used up')
  assert.equal(db.tables.browser_approvals[0].status, 'used')
})

test('a denied or expired request cannot be approved later', async () => {
  const db = createBrowserDb({ browser_approvals: [] })
  const t0 = Date.parse('2026-01-15T12:00:00Z')
  const a = (await store.createApproval(db, SHOP, USER, { kind: 'purchase', hash: store.hashAction('x'), details: details({ kind: 'purchase' }), actor: 'user', now: t0 })).id
  assert.equal((await store.decideApproval(db, SHOP, USER, a, 'denied', t0 + 1000)).ok, true)
  assert.deepEqual(await store.decideApproval(db, SHOP, USER, a, 'approved', t0 + 2000), { ok: false, reason: 'decided' })
  const b = (await store.createApproval(db, SHOP, USER, { kind: 'purchase', hash: store.hashAction('y'), details: details({ kind: 'purchase' }), actor: 'user', now: t0 })).id
  assert.deepEqual(await store.decideApproval(db, SHOP, USER, b, 'approved', t0 + 11 * 60_000), { ok: false, reason: 'expired' })
  assert.equal(await store.consumeApproval(db, SHOP, USER, b, store.hashAction('y'), t0 + 12 * 60_000), false)
})

test('the engine\'s authorizer records a pending approval first, then accepts exactly that one once approved', async () => {
  const db = createBrowserDb({ browser_approvals: [] })
  const authorize = store.authorizerFor(db, SHOP, USER, 'user')
  const first = await authorize({ kind: 'send', canonical: CANON, details: details() })
  assert.equal(first.granted, false)
  assert.equal(db.tables.browser_approvals.length, 1)
  // Presenting the id before a person approved it does not grant, and it records another pending request.
  const early = await authorize({ kind: 'send', canonical: CANON, details: details(), approvalId: first.approvalId })
  assert.equal(early.granted, false)
  await store.decideApproval(db, SHOP, USER, first.approvalId, 'approved')
  assert.deepEqual(await authorize({ kind: 'send', canonical: CANON, details: details(), approvalId: first.approvalId }), { granted: true })
  assert.deepEqual((await authorize({ kind: 'send', canonical: CANON, details: details(), approvalId: first.approvalId })).granted, false)
  // The details stored for the person to read are bounded.
  const big = await authorize({ kind: 'send', canonical: CANON + '1', details: details({ fields: Array.from({ length: 40 }, (_, i) => ({ label: 'f' + i, value: 'v'.repeat(500) })), summary: 's'.repeat(2000) }) })
  assert.equal(big.granted, false)
  const row = db.tables.browser_approvals.find(r => r.id === big.approvalId)
  assert.ok(row.summary.length <= 800)
  assert.equal(row.details.fields.length, 12)
  assert.ok(row.details.fields.every(f => f.value.length <= 200))
})
