// Signing in must give a person their own shop, find it again next time, and never hand a revoked person a new one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLib } from './estimates-helper.mjs'

const lib = loadLib('shop-bootstrap')

/** A fake database with shop_profiles and shop_memberships tables and the trigger that makes the creator the owner. */
function makeDb({ profiles = [], memberships = [], trigger = true, failInsert = false, raceMembership = null } = {}) {
  const state = { profiles: [...profiles], memberships: [...memberships], inserts: [] }
  const tables = { shop_profiles: state.profiles, shop_memberships: state.memberships }
  const from = (name) => {
    const rows = tables[name]
    let filters = []
    let limitN = 1000
    const chain = {
      select() { return chain },
      eq(c, v) { filters.push([c, v]); return chain },
      order() { return chain },
      limit(n) { limitN = n; return chain },
      maybeSingle() { const out = run(); return Promise.resolve({ data: out[0] || null, error: null }) },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej) },
      insert(row) {
        state.inserts.push({ table: name, row })
        const result = () => {
          if (failInsert && name === 'shop_profiles') { if (raceMembership) state.memberships.push(raceMembership); return { data: null, error: { message: 'duplicate' } } }
          const made = name === 'shop_profiles' ? { id: 'shop-new', ...row } : { ...row }
          rows.push(made)
          if (name === 'shop_profiles' && trigger) state.memberships.push({ shop_id: made.id, user_id: row.user_id, role: 'owner', status: 'active' })
          return { data: made, error: null }
        }
        const ins = { select() { return { single: () => Promise.resolve(result()) } }, then(res, rej) { return Promise.resolve(result()).then(res, rej) } }
        return ins
      },
    }
    const run = () => rows.filter((r) => filters.every(([c, v]) => r[c] === v)).slice(0, limitN)
    return chain
  }
  return { db: { from }, state }
}

test('a returning person gets their existing shop and nothing is created', async () => {
  const { db, state } = makeDb({ memberships: [{ shop_id: 'shop-1', user_id: 'u1', role: 'owner', status: 'active' }] })
  const out = await lib.ensureShopForUser(db, 'u1', 'Whatever')
  assert.deepEqual({ ...out }, { id: 'shop-1', created: false })
  assert.equal(state.inserts.length, 0)
})

test('a brand-new person gets one shop, named from the request, and becomes its owner', async () => {
  const { db, state } = makeDb()
  const out = await lib.ensureShopForUser(db, 'u2', '  Rivera   Auto  ')
  assert.deepEqual({ ...out }, { id: 'shop-new', created: true })
  const profile = state.inserts.find((i) => i.table === 'shop_profiles')
  assert.equal(profile.row.shop_name, 'Rivera Auto')
  assert.equal(profile.row.user_id, 'u2')
  assert.equal(state.memberships.filter((m) => m.user_id === 'u2' && m.role === 'owner' && m.status === 'active').length, 1)
})

test('if the database trigger is missing, the owner membership is added once', async () => {
  const { db, state } = makeDb({ trigger: false })
  const out = await lib.ensureShopForUser(db, 'u3', 'Shop')
  assert.equal(out.created, true)
  assert.equal(state.memberships.filter((m) => m.user_id === 'u3').length, 1)
})

test('a person whose access was revoked never gets a replacement shop', async () => {
  const { db, state } = makeDb({ memberships: [{ shop_id: 'shop-1', user_id: 'u4', role: 'member', status: 'revoked' }] })
  await assert.rejects(() => lib.ensureShopForUser(db, 'u4', 'New'), (e) => e.status === 403 && /inactive/.test(e.message))
  assert.equal(state.inserts.length, 0)
})

test('a person who owns a profile but has no active membership is turned away too', async () => {
  const { db, state } = makeDb({ profiles: [{ id: 'shop-9', user_id: 'u5' }] })
  await assert.rejects(() => lib.ensureShopForUser(db, 'u5', 'New'), (e) => e.status === 403)
  assert.equal(state.inserts.length, 0)
})

test('two sign-ins at the same moment end up with one shop', async () => {
  const { db, state } = makeDb()
  const [a, b] = await Promise.all([lib.ensureShopForUser(db, 'u6', 'Shop'), lib.ensureShopForUser(db, 'u6', 'Shop')])
  assert.equal(a.id, b.id)
  assert.equal(state.inserts.filter((i) => i.table === 'shop_profiles').length, 1)
})

test('losing a race to another request uses the shop that request made', async () => {
  const { db } = makeDb({ failInsert: true, raceMembership: { shop_id: 'shop-race', user_id: 'u7', role: 'owner', status: 'active' } })
  const out = await lib.ensureShopForUser(db, 'u7', 'Shop')
  assert.deepEqual({ ...out }, { id: 'shop-race', created: false })
})

test('a failed insert with no winner is an error, not a half-made shop', async () => {
  const { db } = makeDb({ failInsert: true })
  await assert.rejects(() => lib.ensureShopForUser(db, 'u8', 'Shop'), (e) => e.status === 500)
})

test('shop names are trimmed, defaulted and capped', () => {
  assert.equal(lib.cleanShopName(''), 'My Shop')
  assert.equal(lib.cleanShopName(undefined), 'My Shop')
  assert.equal(lib.cleanShopName('x'.repeat(300)).length, 120)
  assert.equal(lib.cleanShopName(' A\n B '), 'A B')
})
