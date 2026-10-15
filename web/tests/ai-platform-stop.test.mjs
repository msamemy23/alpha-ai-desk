import test from 'node:test'
import assert from 'node:assert/strict'
import { clearLocalCancels, CANCEL_WINDOW_MS, makeStopCheck, requestCancel } from '../src/lib/ai/run-control.ts'

const scope = { shopId: 'shop-a', userId: 'user-1', sessionId: 'sess-1', turnId: 'turn-1' }

function fakeDb({ rows = [], failWith = null } = {}) {
  const calls = []
  return {
    calls,
    from(table) {
      const query = { table, filters: {} }
      const builder = {
        upsert(row, options) {
          calls.push({ op: 'upsert', table, row, options })
          if (failWith) return Promise.resolve({ error: failWith })
          rows.push(row)
          return Promise.resolve({ error: null })
        },
        select() { return builder },
        eq(column, value) { query.filters[column] = value; return builder },
        gte() { return builder },
        limit() { return builder },
        maybeSingle() {
          calls.push({ op: 'select', table, filters: { ...query.filters } })
          const hit = rows.find(row => row.shop_id === query.filters.shop_id && row.user_id === query.filters.user_id && row.session_id === query.filters.session_id && row.turn_id === query.filters.turn_id)
          return Promise.resolve({ data: hit ? { requested_at: hit.requested_at } : null, error: null })
        },
      }
      return builder
    },
  }
}

test('a Stop request is stored for exactly that conversation turn', async () => {
  clearLocalCancels()
  const db = fakeDb()
  assert.deepEqual(await requestCancel(db, scope), { stored: 'database' })
  const row = db.calls[0].row
  assert.deepEqual([row.shop_id, row.user_id, row.session_id, row.turn_id], ['shop-a', 'user-1', 'sess-1', 'turn-1'])
  assert.equal(db.calls[0].options.onConflict, 'shop_id,user_id,session_id,turn_id')
})

test('the engine check sees the Stop and keeps saying so', async () => {
  clearLocalCancels()
  const db = fakeDb()
  const check = makeStopCheck(db, scope, { pollMs: 0 })
  assert.equal(await check(), false)
  await requestCancel(fakeDb(), scope)
  assert.equal(await check(), true)
  assert.equal(await check(), true)
})

test('a Stop for one turn or another shop never stops a different turn', async () => {
  clearLocalCancels()
  const db = fakeDb()
  await requestCancel(db, { ...scope, turnId: 'turn-2' })
  assert.equal(await makeStopCheck(db, scope, { pollMs: 0 })(), false)
  assert.equal(await makeStopCheck(db, { ...scope, shopId: 'shop-b' }, { pollMs: 0 })(), false)
})

test('the database is read at most once per poll interval', async () => {
  clearLocalCancels()
  const db = fakeDb()
  let now = 1_000
  const check = makeStopCheck(db, scope, { pollMs: 600, now: () => now })
  await check(); await check(); await check()
  assert.equal(db.calls.filter(call => call.op === 'select').length, 1)
  now += 700
  await check()
  assert.equal(db.calls.filter(call => call.op === 'select').length, 2)
})

test('the browser abort signal stops work immediately', async () => {
  clearLocalCancels()
  const controller = new AbortController()
  const check = makeStopCheck(fakeDb(), scope, { signal: controller.signal, pollMs: 0 })
  assert.equal(await check(), false)
  controller.abort()
  assert.equal(await check(), true)
})

test('without the table, Stop still works on the same server instance', async () => {
  clearLocalCancels()
  const broken = fakeDb({ failWith: { code: '42P01', message: 'relation "ai_run_cancels" does not exist' } })
  assert.deepEqual(await requestCancel(broken, scope), { stored: 'memory' })
  assert.equal(await makeStopCheck(fakeDb(), scope, { pollMs: 0 })(), true)
})

test('an old Stop request is ignored so it cannot stop a later turn', async () => {
  clearLocalCancels()
  await requestCancel(fakeDb(), scope, 1_000)
  const later = 1_000 + CANCEL_WINDOW_MS + 1
  assert.equal(await makeStopCheck(fakeDb(), scope, { pollMs: 0, now: () => later })(), false)
})
