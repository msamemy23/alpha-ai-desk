import test from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDb } from './ai-platform-fake-db.mjs'
import { isMissingRulesColumn, loadShopRules, saveShopRules } from '../src/lib/ai/shop-rules-server.ts'
import { runUndo } from '../src/lib/ai/undo-server.ts'
import { parseUndo, undoForCreate, undoForCreatedDocument, undoForDelete, undoForUpdate } from '../src/lib/ai/undo.ts'
import { defaultRules, describeRulesChange, normalizeRules } from '../src/lib/ai/shop-rules.ts'

const SHOP = 'shop-a'

test('rules load from the settings row and fall back to safe defaults', async () => {
  const db = createFakeDb({ settings: [{ id: 's1', shop_id: SHOP, updated_at: 'x', ai_rules: { tone: 'direct', permissions: { send: 'never' } } }] })
  const loaded = await loadShopRules(db, SHOP)
  assert.equal(loaded.status, 'ok')
  assert.equal(loaded.rules.tone, 'direct')
  assert.equal(loaded.rules.permissions.send, 'never')
  const empty = await loadShopRules(createFakeDb({ settings: [{ id: 's1', shop_id: SHOP, updated_at: 'x' }] }), SHOP)
  assert.deepEqual(empty.rules, defaultRules())
  assert.equal(empty.status, 'ok')
})

test('a missing column is reported, not hidden: defaults apply and saving says a database update is needed', async () => {
  const missing = { code: '42703', message: 'column settings.ai_rules does not exist' }
  const db = createFakeDb({ settings: [{ id: 's1', shop_id: SHOP }] }, { failures: { 'select:settings': missing } })
  const loaded = await loadShopRules(db, SHOP)
  assert.equal(loaded.status, 'missing_column')
  assert.deepEqual(loaded.rules, defaultRules())
  const saved = await saveShopRules(db, SHOP, { tone: 'direct' })
  assert.equal(saved.ok, false)
  assert.equal(saved.needsDatabaseUpdate, true)
  assert.equal(saved.status, 409)
  assert.equal(isMissingRulesColumn({ message: 'Could not find the ai_rules column in the schema cache' }), true)
})

test('any other read error fails closed so a gate can refuse to act', async () => {
  const db = createFakeDb({ settings: [] }, { failures: { 'select:settings': { code: '57014', message: 'timeout' } } })
  assert.equal((await loadShopRules(db, SHOP)).status, 'error')
  const saved = await saveShopRules(db, SHOP, {})
  assert.equal(saved.ok, false)
  assert.equal(saved.status, 500)
})

test('saving normalizes the rules and only touches this shop\'s settings row', async () => {
  const db = createFakeDb({ settings: [{ id: 's1', shop_id: SHOP, updated_at: 'x' }, { id: 's2', shop_id: 'shop-b', updated_at: 'x' }] })
  const saved = await saveShopRules(db, SHOP, { tone: 'professional', permissions: { send: 'never', charge: 'auto' }, neverDo: ['  No engine quotes  '] })
  assert.equal(saved.ok, true)
  assert.equal(saved.rules.permissions.charge, 'never')
  assert.deepEqual(db.tables.settings[0].ai_rules.neverDo, ['No engine quotes'])
  assert.equal(db.tables.settings[1].ai_rules, undefined, 'another shop is never touched')
  assert.equal((await saveShopRules(db, SHOP, 'nope')).status, 400)
})

test('saving without a settings row asks for shop details first', async () => {
  const saved = await saveShopRules(createFakeDb({ settings: [] }), SHOP, {})
  assert.equal(saved.ok, false)
  assert.equal(saved.status, 409)
  assert.match(saved.error, /Settings first/)
})

test('rule changes are described in one plain sentence', () => {
  const before = defaultRules()
  const after = normalizeRules({ tone: 'direct', permissions: { send: 'never' }, neverDo: ['a', 'b'], facts: ['x'] })
  assert.equal(describeRulesChange(before, after), 'Changed: tone friendly to direct, contact customers ask to never, 2 never-do rules added, 1 shop facts added.')
  assert.equal(describeRulesChange(before, defaultRules()), '')
})

// ---- Undo executor ----

const jobBefore = { id: 'job-1', shop_id: SHOP, status: 'Pending', updated_at: 't1' }
const jobAfter = { id: 'job-1', shop_id: SHOP, status: 'In Progress', updated_at: 't2' }
const restoreJob = () => parseUndo(undoForUpdate({ table: 'jobs', id: 'job-1', fields: ['status'], before: jobBefore, after: jobAfter, label: 'Changed' }).undo)

test('undo puts the old value back and stamps the record', async () => {
  const db = createFakeDb({ jobs: [{ ...jobAfter }] })
  const run = await runUndo(db, SHOP, restoreJob())
  assert.equal(run.ok, true)
  assert.equal(db.tables.jobs[0].status, 'Pending')
  assert.notEqual(db.tables.jobs[0].updated_at, 't2')
})

test('undo refuses when the record changed again, and changes nothing', async () => {
  const db = createFakeDb({ jobs: [{ ...jobAfter, status: 'Complete', updated_at: 't3' }] })
  const run = await runUndo(db, SHOP, restoreJob())
  assert.equal(run.ok, false)
  assert.equal(run.outcome, 'changed')
  assert.equal(db.tables.jobs[0].status, 'Complete')
})

test('undo never reaches another shop\'s record', async () => {
  const db = createFakeDb({ jobs: [{ ...jobAfter, shop_id: 'shop-b' }] })
  const run = await runUndo(db, SHOP, restoreJob())
  assert.equal(run.ok, false)
  assert.equal(run.outcome, 'missing')
  assert.equal(db.tables.jobs[0].status, 'In Progress')
})

test('undo twice is safe: the second time reports it is already back', async () => {
  const db = createFakeDb({ jobs: [{ ...jobAfter }] })
  const descriptor = restoreJob()
  assert.equal((await runUndo(db, SHOP, descriptor)).ok, true)
  const again = await runUndo(db, SHOP, descriptor)
  assert.equal(again.ok, false)
  assert.equal(again.outcome, 'already')
  assert.equal(again.status, 200)
})

test('undo of a created customer removes it only when nothing is attached', async () => {
  const customer = { id: 'cust-1', shop_id: SHOP, name: 'Test Customer', updated_at: 'c1' }
  const descriptor = parseUndo(undoForCreate({ table: 'customers', row: customer, label: 'Added' }).undo)
  const used = createFakeDb({ customers: [{ ...customer }], jobs: [{ id: 'j', shop_id: SHOP, customer_id: 'cust-1' }] })
  const blocked = await runUndo(used, SHOP, descriptor)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.outcome, 'blocked')
  assert.match(blocked.message, /jobs/)
  assert.equal(used.tables.customers.length, 1)
  const free = createFakeDb({ customers: [{ ...customer }], jobs: [] })
  assert.equal((await runUndo(free, SHOP, descriptor)).ok, true)
  assert.equal(free.tables.customers.length, 0)
})

test('if what is attached cannot be checked, nothing is removed', async () => {
  const customer = { id: 'cust-1', shop_id: SHOP, name: 'Test Customer', updated_at: 'c1' }
  const descriptor = parseUndo(undoForCreate({ table: 'customers', row: customer, label: 'Added' }).undo)
  const db = createFakeDb({ customers: [{ ...customer }] }, { failures: { 'select:documents': { code: '57014', message: 'timeout' } } })
  const run = await runUndo(db, SHOP, descriptor)
  assert.equal(run.ok, false)
  assert.equal(run.outcome, 'error')
  assert.equal(db.tables.customers.length, 1)
})

test('undo of a created invoice voids the draft instead of deleting it', async () => {
  const doc = { id: 'doc-1', shop_id: SHOP, type: 'Invoice', doc_number: '1042', status: 'Draft', customer_name: 'Maria Lopez', updated_at: 'd1' }
  const descriptor = parseUndo(undoForCreatedDocument({ row: doc, label: 'Saved' }).undo)
  const db = createFakeDb({ documents: [{ ...doc }] })
  assert.equal((await runUndo(db, SHOP, descriptor)).ok, true)
  assert.equal(db.tables.documents.length, 1)
  assert.equal(db.tables.documents[0].status, 'Void')
  const paid = createFakeDb({ documents: [{ ...doc, status: 'Paid' }] })
  assert.equal((await runUndo(paid, SHOP, descriptor)).ok, false)
  assert.equal(paid.tables.documents[0].status, 'Paid')
})

test('undo of a deleted appointment puts it back under this shop', async () => {
  const row = { id: 'ap-1', shop_id: 'someone-else', customer_name: 'Maria Lopez', date: '2026-10-20', time: '09:00' }
  const descriptor = parseUndo(undoForDelete({ table: 'appointments', row, label: 'Deleted' }).undo)
  const db = createFakeDb({ appointments: [] })
  assert.equal((await runUndo(db, SHOP, descriptor)).ok, true)
  assert.equal(db.tables.appointments[0].shop_id, SHOP, 'the shop id always comes from the signed-in shop')
  const again = await runUndo(db, SHOP, descriptor)
  assert.equal(again.outcome, 'already')
})
