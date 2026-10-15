import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserDb } from './helpers/browser-fake-db.mjs'
import * as host from '../src/lib/browser/host-store.ts'

const SHOP = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const T0 = Date.parse('2026-02-01T09:00:00Z')

// The desktop app, as it will behave: claim once, then poll, do, and send back.
function fakeHost(db) {
  const state = { token: null, hostId: null }
  return {
    state,
    async claim(code, now) {
      const r = await host.claimPairing(db, code, { platform: 'test-os', appVersion: '0.1' }, now)
      if (r.ok) { state.token = r.token; state.hostId = r.hostId }
      return r
    },
    async poll(now) {
      const who = await host.authenticateHost(db, state.token, now)
      if (!who) return { error: 'unauthorized' }
      return { who, command: await host.nextCommand(db, who.shopId, who.hostId, now) }
    },
    async answer(commandId, result, now) {
      const who = await host.authenticateHost(db, state.token, now)
      if (!who) return false
      return host.submitResult(db, who.shopId, who.hostId, commandId, result, now)
    },
  }
}

test('a one-time code pairs a computer once; only hashes are stored; the token is shown once', async () => {
  const db = createBrowserDb({ browser_hosts: [], browser_host_commands: [] })
  const made = await host.createPairing(db, SHOP, USER, '  Front   desk PC ', T0)
  assert.equal(made.ok, true)
  assert.match(made.code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
  const row = db.tables.browser_hosts[0]
  assert.equal(row.name, 'Front desk PC')
  assert.equal(row.status, 'pairing')
  assert.ok(!JSON.stringify(row).includes(made.code), 'the code itself is never stored')
  assert.equal(row.pairing_code_hash, host.hashSecret(made.code))

  const app = fakeHost(db)
  // Wrong, malformed, expired and reused codes do not pair.
  for (const bad of ['', 'ZZZZ-ZZZZ', 'abcd', 'ABCD-EFG0', null, 12345678]) assert.equal((await app.claim(bad, T0 + 1000)).ok, false, String(bad))
  assert.equal((await app.claim(made.code, T0 + 11 * 60_000)).ok, false, 'expired')
  const ok = await app.claim(made.code.toLowerCase().replace('-', ' '), T0 + 60_000)
  assert.equal(ok.ok, true, 'typed in lower case with a space still works')
  assert.match(ok.token, /^abh_[A-Za-z0-9_-]{40,60}$/)
  assert.equal(ok.shopId, SHOP)
  const after = db.tables.browser_hosts[0]
  assert.equal(after.status, 'active')
  assert.equal(after.pairing_code_hash, null)
  assert.equal(after.token_hash, host.hashSecret(ok.token))
  assert.ok(!JSON.stringify(after).includes(ok.token), 'the token itself is never stored')
  assert.equal((await fakeHost(db).claim(made.code, T0 + 61_000)).ok, false, 'a code works once')
})

test('only one code is live at a time, and a new one replaces an unused older one', async () => {
  const db = createBrowserDb({ browser_hosts: [] })
  const a = await host.createPairing(db, SHOP, USER, 'A', T0)
  const b = await host.createPairing(db, SHOP, USER, 'B', T0 + 1000)
  assert.equal(db.tables.browser_hosts.length, 1)
  assert.equal((await fakeHost(db).claim(a.code, T0 + 2000)).ok, false)
  assert.equal((await fakeHost(db).claim(b.code, T0 + 2000)).ok, true)
})

test('a paired computer polls for commands, gets each one once, and sends results back', async () => {
  const db = createBrowserDb({ browser_hosts: [], browser_host_commands: [] })
  const made = await host.createPairing(db, SHOP, USER, 'PC', T0)
  const app = fakeHost(db)
  await app.claim(made.code, T0 + 1000)

  assert.equal((await app.poll(T0 + 2000)).command, null)
  const valid = host.validateCommand('open', { url: 'https://www.rockauto.com/' }, () => null)
  assert.equal(valid.ok, true)
  const q = await host.enqueueCommand(db, SHOP, USER, app.state.hostId, valid, T0 + 3000)
  assert.equal(q.ok, true)
  assert.equal((await host.getCommand(db, SHOP, q.id, T0 + 3500)).status, 'queued')

  const first = await app.poll(T0 + 4000)
  assert.equal(first.command.id, q.id)
  assert.equal(first.command.kind, 'open')
  assert.deepEqual(first.command.payload, { url: 'https://www.rockauto.com/' })
  assert.equal((await app.poll(T0 + 4100)).command, null, 'handed over once')

  // A result for someone else's command, a made-up id or oversized junk is refused.
  const other = fakeHost(db)
  const made2 = await host.createPairing(db, OTHER, USER, 'Other PC', T0)
  await other.claim(made2.code, T0 + 1000)
  assert.equal(await other.answer(q.id, { ok: true, title: 'x' }, T0 + 5000), false, 'another shop\'s computer cannot answer')
  assert.equal(await app.answer('00000000-0000-4000-8000-0000000000ff', { ok: true }, T0 + 5000), false)
  assert.equal(await app.answer(q.id, { ok: true, text: 'x'.repeat(30000), image: 'data:image/jpeg;base64,' + 'A'.repeat(950_000) }, T0 + 5000), true, 'oversize text and picture are trimmed or dropped, not stored whole')
  const done = await host.getCommand(db, SHOP, q.id, T0 + 6000)
  assert.equal(done.status, 'done')
  assert.equal(done.result.text.length, 20000)
  assert.equal(done.result.image, undefined)
  assert.equal(await app.answer(q.id, { ok: true }, T0 + 7000), false, 'a command is answered once')
})

test('commands expire, results after expiry are refused, and the queue is short', async () => {
  const db = createBrowserDb({ browser_hosts: [], browser_host_commands: [] })
  const made = await host.createPairing(db, SHOP, USER, 'PC', T0)
  const app = fakeHost(db)
  await app.claim(made.code, T0 + 1000)
  const snap = { kind: 'snapshot', payload: {} }
  const a = await host.enqueueCommand(db, SHOP, USER, app.state.hostId, snap, T0 + 2000)
  assert.equal((await app.poll(T0 + 3 * 60_000)).command, null, 'an old command is never handed over')
  assert.equal((await host.getCommand(db, SHOP, a.id, T0 + 3 * 60_000)).status, 'expired')
  const b = await host.enqueueCommand(db, SHOP, USER, app.state.hostId, snap, T0 + 4 * 60_000)
  await app.poll(T0 + 4 * 60_000 + 1000)
  assert.equal(await app.answer(b.id, { ok: true }, T0 + 4 * 60_000 + 3 * 60_000), false, 'too late')
  const t = T0 + 10 * 60_000
  for (let i = 0; i < 3; i++) assert.equal((await host.enqueueCommand(db, SHOP, USER, app.state.hostId, snap, t)).ok, true)
  const full = await host.enqueueCommand(db, SHOP, USER, app.state.hostId, snap, t)
  assert.equal(full.ok, false)
  assert.match(full.error, /busy/)
})

test('revoking a computer cuts it off at once and drops what it was waiting for', async () => {
  const db = createBrowserDb({ browser_hosts: [], browser_host_commands: [] })
  const made = await host.createPairing(db, SHOP, USER, 'PC', T0)
  const app = fakeHost(db)
  await app.claim(made.code, T0 + 1000)
  const q = await host.enqueueCommand(db, SHOP, USER, app.state.hostId, { kind: 'snapshot', payload: {} }, T0 + 2000)
  assert.equal((await host.revokeHost(db, OTHER, app.state.hostId, T0 + 3000)).ok, false, 'another shop cannot revoke it')
  assert.equal((await host.revokeHost(db, SHOP, app.state.hostId, T0 + 3000)).ok, true)
  assert.equal((await app.poll(T0 + 4000)).error, 'unauthorized')
  assert.equal(await host.authenticateHost(db, app.state.token, T0 + 4000), null)
  assert.equal((await host.getCommand(db, SHOP, q.id, T0 + 4000)).status, 'expired')
  assert.equal((await host.enqueueCommand(db, SHOP, USER, app.state.hostId, { kind: 'snapshot', payload: {} }, T0 + 5000)).ok, false)
  assert.equal((await host.listHosts(db, SHOP, T0 + 5000)).items.length, 0)
})

test('the list says which computers are online; tokens must look right before the database is asked', async () => {
  const db = createBrowserDb({ browser_hosts: [] })
  const made = await host.createPairing(db, SHOP, USER, 'PC', T0)
  const app = fakeHost(db)
  await app.claim(made.code, T0)
  assert.equal((await host.listHosts(db, SHOP, T0 + 10_000)).items[0].online, true)
  assert.equal((await host.listHosts(db, SHOP, T0 + 90_000)).items[0].online, false)
  const before = db.log.length
  for (const bad of [undefined, '', 'abh_short', 'Bearer abh_x', 'x'.repeat(50), 'abh_' + '!'.repeat(43)]) assert.equal(await host.authenticateHost(db, bad, T0), null)
  assert.equal(db.log.length, before, 'a token that cannot be real never reaches the database')
})

test('what Alpha may ask a computer to do is small and follows the shop\'s address rules', () => {
  const refuse = url => (/paypal/.test(url) ? 'Payments and investing. Alpha never handles payment sign-ins.' : null)
  assert.deepEqual(host.validateCommand('snapshot', { anything: 1 }, refuse), { ok: true, kind: 'snapshot', payload: {} })
  assert.deepEqual(host.validateCommand('scroll', { dy: 99999 }, refuse), { ok: true, kind: 'scroll', payload: { dy: 4000 } })
  assert.equal(host.validateCommand('scroll', { dy: 0 }, refuse).ok, false)
  assert.equal(host.validateCommand('open', { url: 'https://www.paypal.com/x' }, refuse).ok, false)
  assert.equal(host.validateCommand('open', {}, refuse).ok, false)
  for (const kind of ['click', 'fill', 'press', 'eval', 'download', undefined]) assert.equal(host.validateCommand(kind, { url: 'https://a.example.com/' }, refuse).ok, false, String(kind))
})

test('missing tables are reported as a needed update, never thrown', async () => {
  const db = createBrowserDb({}, { missing: ['browser_hosts', 'browser_host_commands'] })
  assert.deepEqual((await host.listHosts(db, SHOP)), { items: [], missing: true })
  const p = await host.createPairing(db, SHOP, USER, 'PC')
  assert.deepEqual([p.ok, p.missing], [false, true])
  assert.deepEqual(await host.claimPairing(db, 'ABCD-EFGH', {}), { ok: false, reason: 'missing' })
})
