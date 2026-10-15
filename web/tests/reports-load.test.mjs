import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_RAW, RAW } from './helpers-reports.mjs'
import { createDb } from './helpers/reports-fake-db.mjs'
import { aiCallFrom, allRows, callFrom, loadAiCalls, loadCalls, loadDocs, loadJobs, loadPayments } from '../src/lib/report-load.ts'
import { callSplit } from '../src/lib/report-calls.ts'

const SHOP = 'shop-a'
const OTHER = 'shop-b'
const docRows = (shop = SHOP) => ALL_RAW.map(r => ({ shop_id: shop, created_at: r.created_at || `${r.doc_date}T15:00:00Z`, ...r }))
const SNAP = '2026-10-15T00:00:00Z'

test('allRows reads every page once, even when many rows share the same time', async () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ id: `r${String(i).padStart(2, '0')}`, shop_id: SHOP, created_at: i < 7 ? '2026-10-01T10:00:00Z' : `2026-10-0${i - 5}T10:00:00Z` }))
  const db = createDb({ things: rows })
  const got = await allRows(db, 'things', 'id,created_at', SHOP, 'created_at', SNAP, undefined, 3)
  assert.equal(got.length, 11)
  assert.equal(new Set(got.map(r => r.id)).size, 11, 'no row comes back twice')
})

test('allRows never reads another shop and ignores rows made after the snapshot', async () => {
  const db = createDb({ things: [
    { id: 'a', shop_id: SHOP, created_at: '2026-10-01T10:00:00Z' }, { id: 'b', shop_id: OTHER, created_at: '2026-10-01T10:00:00Z' },
    { id: 'c', shop_id: SHOP, created_at: '2026-10-20T10:00:00Z' },
  ] })
  const got = await allRows(db, 'things', 'id', SHOP, 'created_at', SNAP)
  assert.deepEqual(got.map(r => r.id), ['a'])
})

test('allRows turns a database error into an error, never an empty list', async () => {
  const db = createDb({}, { failures: { 'select:things': { code: '57014', message: 'canceling statement due to statement timeout' } } })
  await assert.rejects(() => allRows(db, 'things', 'id', SHOP, 'created_at', SNAP), /statement timeout/)
})

test('loadDocs returns invoices, receipts and estimates that were sent for approval, for this shop only', async () => {
  const db = createDb({ documents: [...docRows(), ...docRows(OTHER).map(r => ({ ...r, id: `x-${r.id}` }))] })
  const { docs, extended } = await loadDocs(db, SHOP, SNAP)
  assert.equal(extended, true)
  assert.equal(docs.length, ALL_RAW.length)
  assert.ok(docs.some(d => d.type === 'Estimate' && d.id === 'e-2001'))
  assert.ok(!docs.some(d => d.id.startsWith('x-')))
})

test('loadDocs leaves out estimates that were never sent for approval', async () => {
  const db = createDb({ documents: [...docRows(), { shop_id: SHOP, id: 'e-9', type: 'Estimate', status: 'Draft', doc_date: '2026-10-01', created_at: '2026-10-01T10:00:00Z', parts: [], labors: [] }] })
  const { docs } = await loadDocs(db, SHOP, SNAP)
  assert.ok(!docs.some(d => d.id === 'e-9'))
})

test('loadDocs on a database without the newer columns still returns every invoice with the same money', async () => {
  const full = await loadDocs(createDb({ documents: docRows() }), SHOP, SNAP)
  const old = await loadDocs(createDb({ documents: docRows() }, { missingColumns: { documents: ['cashier'] } }), SHOP, SNAP)
  assert.equal(old.extended, false)
  const sales = ds => ds.filter(d => d.type !== 'Estimate').sort((a, b) => a.id.localeCompare(b.id))
  assert.equal(sales(old.docs).length, sales(full.docs).length)
  for (const [a, b] of sales(full.docs).map((d, i) => [d, sales(old.docs)[i]])) {
    assert.equal(a.id, b.id)
    assert.equal(a.total, b.total)
    assert.equal(a.tax, b.tax)
    assert.equal(a.balance, b.balance)
  }
  assert.ok(!old.docs.some(d => d.advisor), 'advisor is not known without the column')
})

test('loadDocs does not hide a real failure behind the older-database fallback', async () => {
  const db = createDb({ documents: docRows() }, { failures: { 'select:documents': { code: '57014', message: 'statement timeout' } } })
  await assert.rejects(() => loadDocs(db, SHOP, SNAP), /timeout/)
})

test('loadPayments fills in customer names from the invoices', async () => {
  const { docs } = await loadDocs(createDb({ documents: docRows() }), SHOP, SNAP)
  const db = createDb({ payments: [{ id: 'p1', shop_id: SHOP, document_id: 'd-1001', amount: '427.33', method: 'card', paid_at: '2026-10-02T16:00:00Z', created_at: '2026-10-02T16:00:00Z' }] })
  const pays = await loadPayments(db, SHOP, SNAP, docs)
  assert.equal(pays.length, 1)
  assert.equal(pays[0].customer, 'Maria Lopez')
  assert.equal(pays[0].amount, 427.33)
  assert.equal(pays[0].date, '2026-10-02')
})

test('loadJobs and loadCalls read their tables, and loadCalls retries without the newer columns', async () => {
  const jobs = await loadJobs(createDb({ jobs: [{ id: 'j1', shop_id: SHOP, status: 'open', tech: ' Sam ', customer_name: 'Maria', created_at: '2026-10-01T10:00:00Z' }] }), SHOP, SNAP)
  assert.equal(jobs[0].tech, 'Sam')
  const callRows = [{ id: 'h1', shop_id: SHOP, call_id: 'cc1', direction: 'INBOUND', duration_secs: '40', start_time: '2026-10-02T14:00:00Z', status: 'completed' }]
  const calls = await loadCalls(createDb({ call_history: callRows }), SHOP, SNAP, '2026-01-01T00:00:00')
  assert.equal(calls[0].direction, 'inbound')
  assert.equal(calls[0].seconds, 40)
  assert.equal(calls[0].callId, 'cc1')
  const older = await loadCalls(createDb({ call_history: callRows }, { missingColumns: { call_history: ['call_id'] } }), SHOP, SNAP, '2026-01-01T00:00:00')
  assert.equal(older.length, 1)
  assert.equal(older[0].callId, undefined)
})

test('the AI call log: start times in milliseconds, seconds and text all become one time; junk is dropped', () => {
  const ms = Date.parse('2026-10-02T14:00:00Z')
  assert.equal(aiCallFrom({ id: 'a', task: 'Inbound call from +17135550100. Asked about brakes.', started_at: ms, status: 'Ended' }).start, '2026-10-02T14:00:00.000Z')
  assert.equal(aiCallFrom({ id: 'a', task: 'x', started_at: ms / 1000 }).start, '2026-10-02T14:00:00.000Z')
  assert.equal(aiCallFrom({ id: 'a', task: 'x', started_at: '2026-10-02T14:00:00Z' }).start, '2026-10-02T14:00:00.000Z')
  assert.equal(aiCallFrom({ id: 'a', task: 'x', started_at: null }), null)
  assert.equal(aiCallFrom({ id: 'a', task: 'Inbound call from +1', started_at: ms }).inbound, true)
  assert.equal(aiCallFrom({ id: 'a', task: 'Call back about an estimate', started_at: ms }).inbound, false)
})

test('loadAiCalls errors loudly when the log cannot be read', async () => {
  const db = createDb({}, { failures: { 'select:ai_calls': { code: '42501', message: 'permission denied' } } })
  await assert.rejects(() => loadAiCalls(db, SHOP), /permission denied/)
})

test('call split: AI, people and missed add up to every incoming call, and a call in both logs counts once', () => {
  const range = { from: '2026-10-01', to: '2026-10-07' }
  const history = [
    { id: 'h1', callId: 'c1', direction: 'inbound', seconds: 95, start: '2026-10-02T14:00:00Z', status: 'completed' },
    { id: 'h2', callId: 'c2', direction: 'inbound', seconds: 0, start: '2026-10-02T15:00:00Z', status: 'missed' },
    { id: 'h3', callId: 'c3', direction: 'inbound', seconds: 8, start: '2026-10-03T15:00:00Z', status: 'completed' },
    { id: 'h4', callId: 'c4', direction: 'inbound', seconds: 120, start: '2026-10-04T15:00:00Z', status: 'completed' },
    { id: 'h5', callId: 'c5', direction: 'outbound', seconds: 60, start: '2026-10-04T16:00:00Z', status: 'completed' },
    { id: 'h6', callId: 'c6', direction: 'inbound', seconds: 60, start: '2026-09-20T16:00:00Z', status: 'completed' },
  ]
  const ai = [
    { id: 'c4', start: '2026-10-04T15:00:00.000Z', inbound: true, status: 'ended' },
    { id: 'c7', start: '2026-10-05T12:00:00.000Z', inbound: true, status: 'ended' },
    { id: 'c8', start: '2026-10-05T13:00:00.000Z', inbound: false, status: 'ended' },
  ]
  const s = callSplit(history, ai, range)
  assert.equal(s.inbound, 5)
  assert.equal(s.byAi, 2, 'c4 is in both logs and counts once; c7 is only in the AI log')
  assert.equal(s.byPeople, 1)
  assert.equal(s.missed, 2)
  assert.equal(s.byAi + s.byPeople + s.missed, s.inbound)
  assert.equal(s.aiPct, 40)
  assert.deepEqual(s.missedIds.sort(), ['h2', 'h3'])
})

test('call split with no calls has no percentages, and an outgoing AI call is not an incoming one', () => {
  const s = callSplit([], [{ id: 'c8', start: '2026-10-05T13:00:00.000Z', inbound: false, status: 'ended' }], { from: '2026-10-01', to: '2026-10-07' })
  assert.equal(s.inbound, 0)
  assert.equal(s.aiPct, null)
  assert.equal(s.missedPct, null)
})

test('callFrom reads old rows with missing fields', () => {
  assert.deepEqual(callFrom({ id: 1, direction: 'Inbound', duration_secs: null, start_time: '2026-10-01T00:00:00Z' }), { id: '1', direction: 'inbound', seconds: 0, start: '2026-10-01T00:00:00Z', callId: undefined, status: undefined })
  assert.ok(RAW.brakes)
})
