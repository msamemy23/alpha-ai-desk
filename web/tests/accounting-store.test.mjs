import test from 'node:test'
import assert from 'node:assert/strict'
import './helpers-reports.mjs'
import { createDb } from './helpers/reports-fake-db.mjs'
import {
  addExpense, canManageBooks, checkSettings, DEFAULT_SETTINGS, loadBooks, payExpense, restoreExpense, saveClose, saveMappings, saveSettings, settingsFrom, updateExpense, voidExpense,
} from '../src/lib/books-store.ts'

const SHOP = 'shop-a'
const OTHER = 'shop-b'
const ME = { userId: 'user-1', name: 'Owner' }
const TODAY = '2026-10-14'

const bill = (over = {}) => ({ date: '2026-10-10', vendor: 'Fake Parts Supply', category: 'parts', amount: '125.50', paid: false, ...over })
const fresh = (seed = {}, options = {}) => createDb({ expenses: [], accounting_settings: [], account_mappings: [], month_closes: [], ...seed }, options)

test('only owners, admins, managers and the server can see or change the books', () => {
  for (const r of ['owner', 'admin', 'manager', 'service']) assert.equal(canManageBooks(r), true)
  for (const r of ['member', 'viewer', '']) assert.equal(canManageBooks(r), false)
})

test('settings: a shop that has saved nothing gets the plain defaults', () => {
  assert.deepEqual(settingsFrom(null), DEFAULT_SETTINGS)
  assert.deepEqual(settingsFrom({ basis: 'weird', cogs_method: 'x', tax_components: 'nope', labor_cost_per_hour: 'abc' }), DEFAULT_SETTINGS)
})

test('settings: tax lines must be complete; nothing is silently dropped or guessed', () => {
  const ok = checkSettings({ taxComponents: [{ name: 'State', ratePct: 6.25, agency: 'State comptroller' }, { name: 'City', ratePct: 2, agency: '' }] }, DEFAULT_SETTINGS)
  assert.equal(ok.ok, true)
  assert.equal(ok.value.taxComponents.length, 2)
  const bad = checkSettings({ taxComponents: [{ name: '', ratePct: 6.25 }] }, DEFAULT_SETTINGS)
  assert.equal(bad.ok, false)
  assert.match(bad.errors.taxComponents, /name and a rate/)
  assert.equal(checkSettings({ taxComponents: [{ name: 'Huge', ratePct: 40 }] }, DEFAULT_SETTINGS).ok, false)
  assert.equal(checkSettings({ basis: 'maybe' }, DEFAULT_SETTINGS).ok, false)
  assert.equal(checkSettings({ laborCostPerHour: '$-5' }, DEFAULT_SETTINGS).ok, false)
  assert.equal(checkSettings({ laborCostPerHour: '' }, { ...DEFAULT_SETTINGS, laborCostPerHour: 30 }).value.laborCostPerHour, null)
  assert.equal(checkSettings({ laborCostPerHour: '$32.5' }, DEFAULT_SETTINGS).value.laborCostPerHour, 32.5)
})

test('settings: saving one choice keeps the others, and saves for this shop only', async () => {
  const db = fresh({ accounting_settings: [{ shop_id: OTHER, basis: 'cash' }] })
  const a = await saveSettings(db, SHOP, ME, { basis: 'cash' })
  assert.equal(a.ok, true)
  const b = await saveSettings(db, SHOP, ME, { cogsMethod: 'purchases' })
  assert.equal(b.ok, true)
  assert.equal(b.settings.basis, 'cash', 'the earlier choice is kept')
  assert.equal(b.settings.cogsMethod, 'purchases')
  const mine = db.tables.accounting_settings.filter(r => r.shop_id === SHOP)
  assert.equal(mine.length, 1, 'one row per shop')
  assert.equal(db.tables.accounting_settings.find(r => r.shop_id === OTHER).basis, 'cash', 'the other shop is untouched')
})

test('settings: a missing table is a "needs an update" answer for this feature, not a crash', async () => {
  const db = fresh({}, { missingTables: ['accounting_settings'] })
  const r = await saveSettings(db, SHOP, ME, { basis: 'cash' })
  assert.equal(r.ok, false)
  assert.equal(r.needsUpdate, true)
  assert.equal(r.status, 503)
})

test('reading the books: one missing table does not hide the rest, and a failed read is an error, not an empty list', async () => {
  const db = fresh({ expenses: [{ id: 'x1', shop_id: SHOP, date: '2026-10-01', vendor: 'Fake Power Co', category: 'utilities', amount: 100 }] },
    { missingTables: ['month_closes'], failures: { 'select:account_mappings': { code: '57014', message: 'statement timeout' } } })
  const b = await loadBooks(db, SHOP)
  assert.equal(b.settings.state, 'ok')
  assert.deepEqual(b.settings.value, DEFAULT_SETTINGS)
  assert.equal(b.expenses.state, 'ok')
  assert.equal(b.expenses.value.length, 1)
  assert.equal(b.closes.state, 'needs-update')
  assert.equal(b.mappings.state, 'error')
  assert.ok(b.mappings.error && !/timeout/.test(b.mappings.error), 'the person gets plain words, not database text')
})

test('reading the books only returns this shop\'s bills', async () => {
  const db = fresh({ expenses: [
    { id: 'x1', shop_id: SHOP, date: '2026-10-01', vendor: 'Mine', category: 'rent', amount: 10 },
    { id: 'x2', shop_id: OTHER, date: '2026-10-01', vendor: 'Theirs', category: 'rent', amount: 20 },
  ] })
  const b = await loadBooks(db, SHOP)
  assert.deepEqual(b.expenses.value.map(e => e.vendor), ['Mine'])
})

test('account names: unknown accounts are refused, blank puts the suggested name back, other shops are untouched', async () => {
  const db = fresh({ account_mappings: [{ shop_id: SHOP, key: 'sales_labor', account_name: 'Old labor' }, { shop_id: OTHER, key: 'sales_labor', account_name: 'Their labor' }] })
  assert.equal((await saveMappings(db, SHOP, ME, [{ key: 'not_an_account', account_name: 'x' }])).ok, false)
  assert.equal((await saveMappings(db, SHOP, ME, [])).ok, false)
  const r = await saveMappings(db, SHOP, ME, [{ key: 'sales_labor', account_name: '' }, { key: 'sales_parts', account_name: ' Parts   Sales ', account_number: '4010' }])
  assert.equal(r.ok, true)
  assert.deepEqual([r.saved, r.reset], [1, 1])
  const mine = db.tables.account_mappings.filter(m => m.shop_id === SHOP)
  assert.deepEqual(mine.map(m => [m.key, m.account_name, m.account_number]), [['sales_parts', 'Parts Sales', '4010']])
  assert.equal(db.tables.account_mappings.find(m => m.shop_id === OTHER).account_name, 'Their labor')
})

test('a bill: checked before saving, saved for this shop, and shown back the way the screen reads it', async () => {
  const db = fresh()
  const bad = await addExpense(db, SHOP, ME, bill({ amount: 'lots' }), TODAY)
  assert.equal(bad.ok, false)
  assert.equal(bad.status, 400)
  assert.ok(bad.fields.amount)
  const good = await addExpense(db, SHOP, ME, bill(), TODAY)
  assert.equal(good.ok, true)
  assert.equal(good.expense.amount, 125.5)
  assert.equal(good.expense.paid_on, null)
  const row = db.tables.expenses[0]
  assert.equal(row.shop_id, SHOP)
  assert.equal(row.created_by, 'user-1')
})

test('a bill typed twice is caught and only saved again when the person says so', async () => {
  const db = fresh()
  assert.equal((await addExpense(db, SHOP, ME, bill(), TODAY)).ok, true)
  const again = await addExpense(db, SHOP, ME, bill({ vendor: 'fake parts supply' }), TODAY)
  assert.equal(again.ok, false)
  assert.equal(again.status, 409)
  assert.ok(again.duplicate)
  assert.equal(db.tables.expenses.length, 1)
  assert.equal((await addExpense(db, SHOP, ME, { ...bill(), confirm_duplicate: true }, TODAY)).ok, true)
  assert.equal(db.tables.expenses.length, 2)
})

test('another shop\'s bill does not count as a duplicate', async () => {
  const db = fresh({ expenses: [{ id: 'x9', shop_id: OTHER, date: '2026-10-10', vendor: 'Fake Parts Supply', category: 'parts', amount: 125.5 }] })
  assert.equal((await addExpense(db, SHOP, ME, bill(), TODAY)).ok, true)
})

test('editing a bill: only a live bill of this shop can be changed', async () => {
  const db = fresh({ expenses: [
    { id: 'x1', shop_id: SHOP, date: '2026-10-10', vendor: 'Fake Parts Supply', category: 'parts', amount: 125.5 },
    { id: 'x2', shop_id: SHOP, date: '2026-10-10', vendor: 'Gone', category: 'parts', amount: 10, voided_at: '2026-10-11T00:00:00Z' },
    { id: 'x3', shop_id: OTHER, date: '2026-10-10', vendor: 'Theirs', category: 'parts', amount: 10 },
  ] })
  const ok = await updateExpense(db, SHOP, ME, 'x1', bill({ amount: '130' }), TODAY)
  assert.equal(ok.ok, true)
  assert.equal(ok.expense.amount, 130)
  for (const id of ['x2', 'x3', 'nope']) {
    const r = await updateExpense(db, SHOP, ME, id, bill(), TODAY)
    assert.equal(r.ok, false, id)
    assert.equal(r.status, 404)
  }
  assert.equal(db.tables.expenses.find(e => e.id === 'x3').amount, 10, 'the other shop\'s bill is untouched')
})

test('marking a bill paid: not before the bill date, and it keeps the method already on it', async () => {
  const db = fresh({ expenses: [{ id: 'x1', shop_id: SHOP, date: '2026-10-10', vendor: 'V', category: 'parts', amount: 50, method: 'check' }] })
  const early = await payExpense(db, SHOP, ME, 'x1', '2026-10-01', '', TODAY)
  assert.equal(early.ok, false)
  assert.equal(early.status, 400)
  const ok = await payExpense(db, SHOP, ME, 'x1', '2026-10-12', '', TODAY)
  assert.equal(ok.ok, true)
  assert.equal(ok.expense.paid_on, '2026-10-12')
  assert.equal(ok.expense.method, 'check')
  assert.equal((await payExpense(db, SHOP, ME, 'x1', 'tomorrow', '', TODAY)).ok, false)
})

test('voiding keeps the bill on record, once; restoring puts it back; nothing is ever deleted', async () => {
  const db = fresh({ expenses: [{ id: 'x1', shop_id: SHOP, date: '2026-10-10', vendor: 'V', category: 'parts', amount: 50 }] })
  const v = await voidExpense(db, SHOP, ME, 'x1', 'Entered twice')
  assert.equal(v.ok, true)
  assert.ok(v.expense.voided_at)
  assert.equal(db.tables.expenses.length, 1)
  assert.equal(db.tables.expenses[0].void_reason, 'Entered twice')
  assert.equal((await voidExpense(db, SHOP, ME, 'x1', '')).status, 404, 'a second void does nothing')
  const back = await restoreExpense(db, SHOP, ME, 'x1')
  assert.equal(back.ok, true)
  assert.equal(back.expense.voided_at, null)
  assert.equal((await restoreExpense(db, SHOP, ME, 'x1')).status, 404)
})

test('bills on a database without the table say so', async () => {
  const db = fresh({}, { missingTables: ['expenses'] })
  const r = await addExpense(db, SHOP, ME, bill(), TODAY)
  assert.equal(r.ok, false)
  assert.equal(r.needsUpdate, true)
})

test('month close: ticks are kept, closing records the totals, reopening clears the close but keeps the ticks', async () => {
  const db = fresh()
  const snapshot = { billed: 1000.5, collected: 900, tax: 80, invoices: 12, owed: 100.5, expenses: 300 }
  assert.equal((await saveClose(db, SHOP, ME, { month: 'October', checked: {} })).ok, false)
  const saved = await saveClose(db, SHOP, ME, { month: '2026-09', checked: { bank: true, payroll: true, hacked: true }, note: 'Bank rec done', action: 'save' })
  assert.equal(saved.ok, true)
  assert.deepEqual(Object.keys(saved.close.checked).sort(), ['bank', 'payroll'], 'unknown items are not stored')
  assert.equal(saved.close.closed_at, null)
  assert.equal((await saveClose(db, SHOP, ME, { month: '2026-09', checked: { bank: true }, action: 'close' })).ok, false, 'closing needs the totals')
  const closed = await saveClose(db, SHOP, ME, { month: '2026-09', checked: { bank: true, payroll: true }, action: 'close', snapshot })
  assert.equal(closed.ok, true)
  assert.ok(closed.close.closed_at)
  assert.equal(closed.close.closed_by, 'user-1')
  assert.equal(closed.close.snapshot.billed, 1000.5)
  assert.equal(db.tables.month_closes.length, 1, 'one row per month')
  const reopened = await saveClose(db, SHOP, ME, { month: '2026-09', checked: { bank: true, payroll: true }, action: 'reopen' })
  assert.equal(reopened.close.closed_at, null)
  assert.equal(reopened.close.checked.bank, true)
  assert.equal(reopened.close.snapshot?.billed, 1000.5, 'the old totals stay on record')
})
