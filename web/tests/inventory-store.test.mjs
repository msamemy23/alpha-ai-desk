import test from 'node:test'
import assert from 'node:assert/strict'
import { createDb } from './helpers/reports-fake-db.mjs'
import { inventoryRpc } from './helpers/inventory-rpc.mjs'
import {
  adjustPart, applyPrices, cancelPo, canAdjust, canBuy, checkVendor, loadHistory, loadInventoryData, loadSoldLines, markPoSent, previewPo, receivePo, removeVendorPrice,
  saveExtras, savePoDraft, saveReturn, saveRules, saveVendor, saveVendorPrice, sendPo, setVendorActive,
} from '../src/lib/inventory-store.ts'

const SHOP = 'shop-a'
const OTHER = 'shop-b'
const ME = { userId: 'user-1', name: 'Sam Rivera' }
const TODAY = '2026-10-14'
const SHOP_FACTS = { name: 'Test Auto Repair', address: '1 Test St', phone: '(555) 010-0100', email: 'office@example.com' }

const parts = () => [
  { id: 'p1', shop_id: SHOP, name: 'Oil filter', part_number: 'OF-100', category: 'Filters', qty_on_hand: 6, qty_reorder: 4, qty_on_order: 0, cost: 5, retail_price: 12, supplier: '', supplier_part_number: '' },
  { id: 'p2', shop_id: SHOP, name: 'Brake pads', part_number: 'BP-200', category: 'Brakes', qty_on_hand: 1, qty_reorder: 2, qty_on_order: 0, cost: 30, retail_price: 80, supplier: '', supplier_part_number: '' },
  { id: 'q1', shop_id: OTHER, name: 'Their filter', part_number: 'OF-100', category: 'Filters', qty_on_hand: 9, qty_reorder: 4, qty_on_order: 0, cost: 5, retail_price: 12 },
]
const makeDb = (seed = {}, options = {}) => createDb(
  { inventory: parts(), vendors: [], vendor_prices: [], inventory_extras: [], purchase_orders: [], purchase_order_lines: [], part_history: [], part_returns: [], pricing_rules: [], ...seed },
  { rpc: inventoryRpc(), unique: { vendors: [['shop_id', 'name']], inventory_extras: [['shop_id', 'barcode']] }, ...options },
)
const noRpc = ['inventory_apply_delta', 'inventory_set_prices', 'next_po_number', 'po_save_draft', 'po_mark_sent', 'po_cancel', 'receive_po_lines']

test('who can do what: viewers change nothing, only managers buy', () => {
  assert.equal(canAdjust('viewer'), false)
  assert.equal(canAdjust('member'), true)
  assert.equal(canBuy('member'), false)
  assert.equal(canBuy('manager'), true)
  assert.equal(canBuy('service'), true)
})

/* ---------- counts ---------- */

test('a count change goes through one step and leaves a history line with the person\'s name', async () => {
  const db = makeDb()
  const r = await adjustPart(db, SHOP, ME, { part_id: 'p1', delta: -2, reason: 'used', reference: 'INV-1001' })
  assert.equal(r.ok, true)
  assert.deepEqual([r.old, r.new, r.viaFallback], [6, 4, false])
  assert.equal(db.tables.inventory.find(p => p.id === 'p1').qty_on_hand, 4)
  const h = db.tables.part_history[0]
  assert.equal(h.actor_name, 'Sam Rivera')
  assert.equal(h.reason, 'used')
  assert.equal(h.reference, 'INV-1001')
  assert.deepEqual([h.old_value, h.new_value], [6, 4])
})

test('setting a count to the number counted works, and the same number changes nothing and logs nothing', async () => {
  const db = makeDb()
  assert.equal((await adjustPart(db, SHOP, ME, { part_id: 'p1', set: 12, reason: 'count' })).new, 12)
  await adjustPart(db, SHOP, ME, { part_id: 'p1', set: 12 })
  assert.equal(db.tables.part_history.length, 1)
})

test('bad counts are refused in plain words and change nothing', async () => {
  const db = makeDb()
  const below = await adjustPart(db, SHOP, ME, { part_id: 'p2', delta: -5 })
  assert.equal(below.ok, false)
  assert.equal(below.status, 400)
  assert.match(below.message, /below zero/)
  for (const input of [{ part_id: 'p1' }, { part_id: 'p1', delta: 1.5 }, { part_id: 'p1', delta: 1, set: 2 }, { part_id: 'p1', set: -1 }, { part_id: '', delta: 1 }, { part_id: 'p1', field: 'cost', delta: 1 }]) {
    assert.equal((await adjustPart(db, SHOP, ME, input)).ok, false, JSON.stringify(input))
  }
  assert.equal(db.tables.inventory.find(p => p.id === 'p2').qty_on_hand, 1)
  assert.equal(db.tables.part_history.length, 0)
})

test('a part from another shop cannot be changed', async () => {
  const db = makeDb()
  const r = await adjustPart(db, SHOP, ME, { part_id: 'q1', delta: 1 })
  assert.equal(r.ok, false)
  assert.equal(r.status, 404)
  assert.equal(db.tables.inventory.find(p => p.id === 'q1').qty_on_hand, 9)
})

test('without the database update a count still changes, but only if nobody else changed it first', async () => {
  const db = makeDb({}, { missingFunctions: noRpc })
  const ok = await adjustPart(db, SHOP, ME, { part_id: 'p1', delta: 3 })
  assert.equal(ok.ok, true)
  assert.equal(ok.viaFallback, true)
  assert.equal(db.tables.inventory.find(p => p.id === 'p1').qty_on_hand, 9)
  assert.equal(db.tables.part_history.length, 1, 'the history is still written when its table exists')

  const raced = makeDb({}, { missingFunctions: noRpc })
  const realFrom = raced.from
  raced.from = table => {
    const b = realFrom(table)
    if (table !== 'inventory') return b
    const update = b.update
    b.update = v => { raced.tables.inventory.find(p => p.id === 'p1').qty_on_hand = 50; return update(v) }
    return b
  }
  const lost = await adjustPart(raced, SHOP, ME, { part_id: 'p1', delta: 1 })
  assert.equal(lost.ok, false)
  assert.equal(lost.status, 409)
  assert.equal(raced.tables.inventory.find(p => p.id === 'p1').qty_on_hand, 50, 'the other person\'s change is not overwritten')
})

test('without the history table the count change still stands', async () => {
  const db = makeDb({}, { missingFunctions: noRpc, missingTables: ['part_history'] })
  const r = await adjustPart(db, SHOP, ME, { part_id: 'p1', delta: 1 })
  assert.equal(r.ok, true)
  assert.equal(db.tables.inventory.find(p => p.id === 'p1').qty_on_hand, 7)
})

test('without the update, going below zero is still refused', async () => {
  const db = makeDb({}, { missingFunctions: noRpc })
  const r = await adjustPart(db, SHOP, ME, { part_id: 'p2', delta: -9 })
  assert.equal(r.ok, false)
  assert.equal(r.status, 400)
})

/* ---------- prices ---------- */

test('rules: saved only when every range makes sense', async () => {
  const db = makeDb()
  const bad = await saveRules(db, SHOP, ME, { tiers: [{ min_cost: 10, max_cost: 5, method: 'markup', pct: 50 }], round_to: 'none', minimum_price: 0 })
  assert.equal(bad.ok, false)
  const ok = await saveRules(db, SHOP, ME, { tiers: [{ min_cost: 0, max_cost: 20, method: 'markup', pct: 80 }, { min_cost: 20, max_cost: null, method: 'margin', pct: 40 }], round_to: '0.99', minimum_price: 3 })
  assert.equal(ok.ok, true)
  assert.equal(db.tables.pricing_rules.length, 1)
  assert.equal(db.tables.pricing_rules[0].shop_id, SHOP)
  await saveRules(db, SHOP, ME, { tiers: [], round_to: 'none', minimum_price: 0 })
  assert.equal(db.tables.pricing_rules.length, 1, 'one row per shop')
})

test('applying prices changes only parts whose price is what the list showed', async () => {
  for (const options of [{}, { missingFunctions: noRpc }]) {
    const db = makeDb({}, options)
    db.tables.inventory.find(p => p.id === 'p2').retail_price = 99 // changed since the list was made
    const r = await applyPrices(db, SHOP, ME, [{ part_id: 'p1', from: 12, to: 14.5 }, { part_id: 'p2', from: 80, to: 90 }, { part_id: 'q1', from: 12, to: 20 }])
    assert.equal(r.ok, true)
    assert.deepEqual([r.changed, r.skipped], [1, 2])
    assert.equal(db.tables.inventory.find(p => p.id === 'p1').retail_price, 14.5)
    assert.equal(db.tables.inventory.find(p => p.id === 'p2').retail_price, 99, 'not overwritten')
    assert.equal(db.tables.inventory.find(p => p.id === 'q1').retail_price, 12, 'another shop\'s part is never touched')
    assert.equal(db.tables.part_history.filter(h => h.field === 'retail_price').length, 1)
  }
})

test('applying prices refuses an empty or malformed list', async () => {
  const db = makeDb()
  assert.equal((await applyPrices(db, SHOP, ME, [])).ok, false)
  assert.equal((await applyPrices(db, SHOP, ME, [{ part_id: 'p1', from: 1, to: -4 }])).ok, false)
  assert.equal((await applyPrices(db, SHOP, ME, 'all')).ok, false)
})

/* ---------- vendors ---------- */

test('vendors: checked, saved for this shop, unique by name, archived not deleted', async () => {
  const db = makeDb()
  assert.equal(checkVendor({ name: '' }).ok, false)
  assert.equal(checkVendor({ name: 'V', email: 'not-an-email' }).ok, false)
  assert.equal(checkVendor({ name: 'V', lead_days: 900 }).ok, false)
  const a = await saveVendor(db, SHOP, ME, null, { name: ' Fake Parts  Supply ', email: 'orders@example.com', phone: '(555) 010-0111', lead_days: '2' })
  assert.equal(a.ok, true)
  assert.equal(a.vendor.name, 'Fake Parts Supply')
  assert.equal(a.vendor.lead_days, 2)
  assert.equal(db.tables.vendors[0].shop_id, SHOP)
  const dup = await saveVendor(db, SHOP, ME, null, { name: 'Fake Parts Supply' })
  assert.equal(dup.ok, false)
  assert.equal(dup.status, 409)
  const edited = await saveVendor(db, SHOP, ME, a.vendor.id, { name: 'Fake Parts Supply', email: 'new@example.com' })
  assert.equal(edited.vendor.email, 'new@example.com')
  assert.equal(db.tables.vendors.length, 1)
  const off = await setVendorActive(db, SHOP, a.vendor.id, false)
  assert.equal(off.vendor.active, false)
  assert.equal(db.tables.vendors.length, 1, 'archived, not removed')
})

test('another shop\'s vendor cannot be edited or archived', async () => {
  const db = makeDb({ vendors: [{ id: 'v-x', shop_id: OTHER, name: 'Theirs', active: true }] })
  assert.equal((await saveVendor(db, SHOP, ME, 'v-x', { name: 'Mine now' })).status, 404)
  assert.equal((await setVendorActive(db, SHOP, 'v-x', false)).status, 404)
  assert.equal(db.tables.vendors[0].name, 'Theirs')
})

test('vendor prices: one per vendor and part, both must belong to this shop, removal is by id and shop', async () => {
  const db = makeDb({ vendors: [{ id: 'v1', shop_id: SHOP, name: 'A', active: true }, { id: 'v2', shop_id: OTHER, name: 'B', active: true }] })
  assert.equal((await saveVendorPrice(db, SHOP, ME, { vendor_id: 'v1', part_id: 'p1', price: 'abc' }, TODAY)).ok, false)
  assert.equal((await saveVendorPrice(db, SHOP, ME, { vendor_id: 'v2', part_id: 'p1', price: '4' }, TODAY)).status, 404)
  assert.equal((await saveVendorPrice(db, SHOP, ME, { vendor_id: 'v1', part_id: 'q1', price: '4' }, TODAY)).status, 404)
  const a = await saveVendorPrice(db, SHOP, ME, { vendor_id: 'v1', part_id: 'p1', price: '$4.25', vendor_sku: 'A-1' }, TODAY)
  assert.equal(a.ok, true)
  assert.equal(a.price.price, 4.25)
  assert.equal(a.price.checked_on, TODAY)
  await saveVendorPrice(db, SHOP, ME, { vendor_id: 'v1', part_id: 'p1', price: '4.10' }, TODAY)
  assert.equal(db.tables.vendor_prices.length, 1, 'the second save updates the first')
  assert.equal(db.tables.vendor_prices[0].price, 4.1)
  assert.equal((await removeVendorPrice(db, OTHER, a.price.id)).status, 404)
  assert.equal((await removeVendorPrice(db, SHOP, a.price.id)).ok, true)
})

/* ---------- barcodes ---------- */

test('barcodes: a real UPC is accepted, a mistyped one is caught, a shelf code is fine, a repeat names the part it is on', async () => {
  const db = makeDb()
  assert.equal((await saveExtras(db, SHOP, ME, { part_id: 'p1', barcode: '036000291452' })).ok, true)
  const bad = await saveExtras(db, SHOP, ME, { part_id: 'p2', barcode: '036000291453' })
  assert.equal(bad.ok, false)
  assert.ok(bad.fields.barcode)
  assert.equal((await saveExtras(db, SHOP, ME, { part_id: 'p2', barcode: 'SHELF-B2' })).ok, true)
  const dup = await saveExtras(db, SHOP, ME, { part_id: 'p2', barcode: '0360 0029-1452' })
  assert.equal(dup.ok, false)
  assert.equal(dup.status, 409)
  assert.match(dup.message, /Oil filter/)
})

test('order levels: validated, the preferred vendor must be this shop\'s, and a part from another shop is refused', async () => {
  const db = makeDb({ vendors: [{ id: 'v1', shop_id: SHOP, name: 'A', active: true }, { id: 'v2', shop_id: OTHER, name: 'B', active: true }] })
  assert.equal((await saveExtras(db, SHOP, ME, { part_id: 'p1', max_qty: -1 })).ok, false)
  assert.equal((await saveExtras(db, SHOP, ME, { part_id: 'p1', order_multiple: 0 })).ok, false)
  assert.equal((await saveExtras(db, SHOP, ME, { part_id: 'p1', preferred_vendor_id: 'v2' })).ok, false)
  assert.equal((await saveExtras(db, SHOP, ME, { part_id: 'q1', max_qty: 5 })).status, 404)
  const ok = await saveExtras(db, SHOP, ME, { part_id: 'p1', max_qty: '12', order_multiple: '6', core_charge: '8.5', preferred_vendor_id: 'v1' })
  assert.equal(ok.ok, true)
  assert.deepEqual([ok.extra.max_qty, ok.extra.order_multiple, ok.extra.core_charge, ok.extra.preferred_vendor_id], [12, 6, 8.5, 'v1'])
})

/* ---------- returns ---------- */

test('returns and cores: described, credited with a date, never before they were opened', async () => {
  const db = makeDb({ vendors: [{ id: 'v1', shop_id: SHOP, name: 'A', active: true }] })
  assert.equal((await saveReturn(db, SHOP, ME, null, { description: '', kind: 'core' }, TODAY)).ok, false)
  assert.equal((await saveReturn(db, SHOP, ME, null, { description: 'Alternator core', kind: 'nonsense' }, TODAY)).ok, false)
  const a = await saveReturn(db, SHOP, ME, null, { description: 'Alternator core', kind: 'core', qty: 1, amount: '35', vendor_id: 'v1', opened_on: '2026-10-01' }, TODAY)
  assert.equal(a.ok, true)
  assert.equal(a.ret.status, 'open')
  assert.equal(a.ret.amount, 35)
  const credited = await saveReturn(db, SHOP, ME, a.ret.id, { description: 'Alternator core', kind: 'core', qty: 1, amount: '35', vendor_id: 'v1', opened_on: '2026-10-01', status: 'credited' }, TODAY)
  assert.equal(credited.ret.status, 'credited')
  assert.equal(credited.ret.credited_on, TODAY, 'the day defaults to today')
  const early = await saveReturn(db, SHOP, ME, a.ret.id, { description: 'Alternator core', kind: 'core', opened_on: '2026-10-05', status: 'credited', credited_on: '2026-10-01' }, TODAY)
  assert.equal(early.ok, false)
  assert.equal(db.tables.part_returns.length, 1)
  assert.equal((await saveReturn(db, SHOP, ME, a.ret.id, { description: 'x', kind: 'core', vendor_id: 'nope' }, TODAY)).ok, false)
})

/* ---------- purchase orders ---------- */

const poInput = (over = {}) => ({ vendor_id: 'v1', notes: 'Call when it ships', expected_on: '2026-10-20', lines: [{ part_id: 'p1', description: 'Oil filter', sku: 'OF-100', qty: 10, unit_cost: 4.5 }, { part_id: 'p2', description: 'Brake pads', sku: 'BP-200', qty: 4, unit_cost: 28, core_charge: 0 }], ...over })
const withVendor = (email = 'orders@example.com') => makeDb({ vendors: [{ id: 'v1', shop_id: SHOP, name: 'Fake Parts Supply', email, contact: 'Pat Lee', active: true }] })
const mailbox = (fail = false) => { const sent = []; const f = async m => { if (fail) throw new Error('smtp down'); sent.push(m) }; f.sent = sent; return f }

test('orders: numbered one after another per shop, saved with their lines, changed only while a draft', async () => {
  const db = withVendor()
  const a = await savePoDraft(db, SHOP, ME, null, poInput())
  assert.equal(a.ok, true)
  assert.equal(a.po_number, 'PO-0001')
  const b = await savePoDraft(db, SHOP, ME, null, poInput())
  assert.equal(b.po_number, 'PO-0002')
  const c = await savePoDraft(db, OTHER, ME, null, poInput({ vendor_id: null, vendor_name: 'Walk-up counter', lines: [{ description: 'Wipers', qty: 2, unit_cost: 6 }] }))
  assert.equal(c.po_number, 'PO-0001', 'another shop has its own numbers')
  const edit = await savePoDraft(db, SHOP, ME, a.id, poInput({ lines: [{ part_id: 'p1', description: 'Oil filter', qty: 3, unit_cost: 4 }] }))
  assert.equal(edit.ok, true)
  assert.equal(db.tables.purchase_order_lines.filter(l => l.po_id === a.id).length, 1, 'the old lines are replaced')
  db.tables.purchase_orders.find(o => o.id === a.id).status = 'sent'
  assert.equal((await savePoDraft(db, SHOP, ME, a.id, poInput())).status, 409)
})

test('orders: a bad order says what is wrong and saves nothing', async () => {
  const db = withVendor()
  for (const input of [poInput({ lines: [] }), poInput({ vendor_id: null, vendor_name: '' }), poInput({ lines: [{ description: 'x', qty: 0, unit_cost: 1 }] }), poInput({ vendor_id: 'nope' }), poInput({ lines: [{ part_id: 'q1', description: 'Their filter', qty: 1, unit_cost: 1 }] })]) {
    assert.equal((await savePoDraft(db, SHOP, ME, null, input)).ok, false)
  }
  assert.equal(db.tables.purchase_orders.length, 0)
})

test('sending an order: the owner sees the exact message first, and only that message can be sent', async () => {
  const db = withVendor()
  const po = await savePoDraft(db, SHOP, ME, null, poInput())
  const p = await previewPo(db, SHOP, po.id, SHOP_FACTS)
  assert.equal(p.ok, true)
  assert.equal(p.preview.to, 'orders@example.com')
  assert.match(p.preview.subject, /Purchase order PO-0001 from Test Auto Repair/)
  assert.match(p.preview.text, /10 x Oil filter/)
  assert.match(p.preview.text, /Hello Pat,/)
  const send = mailbox()
  const stale = await sendPo(db, SHOP, ME, po.id, 'not-the-token', SHOP_FACTS, send)
  assert.equal(stale.ok, false)
  assert.equal(stale.status, 409)
  assert.equal(send.sent.length, 0)
  const ok = await sendPo(db, SHOP, ME, po.id, p.preview.token, SHOP_FACTS, send)
  assert.equal(ok.ok, true)
  assert.equal(ok.recorded, true)
  assert.equal(send.sent.length, 1)
  assert.equal(send.sent[0].to, 'orders@example.com')
  assert.equal(send.sent[0].subject, p.preview.subject)
  assert.equal(send.sent[0].text, p.preview.text)
  const o = db.tables.purchase_orders[0]
  assert.equal(o.status, 'sent')
  assert.equal(o.sent_via, 'email')
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_order, 10, 'what was ordered is now on order')
  assert.equal(db.tables.inventory.find(x => x.id === 'p2').qty_on_order, 4)
  const again = await sendPo(db, SHOP, ME, po.id, p.preview.token, SHOP_FACTS, send)
  assert.equal(again.ok, false)
  assert.equal(send.sent.length, 1, 'a second tap sends nothing')
})

test('sending an order: no vendor email means nothing is sent, and the message changes if the vendor\'s address changes', async () => {
  const db = withVendor('')
  const po = await savePoDraft(db, SHOP, ME, null, poInput())
  const p = await previewPo(db, SHOP, po.id, SHOP_FACTS)
  assert.equal(p.preview.to, '')
  const send = mailbox()
  const r = await sendPo(db, SHOP, ME, po.id, p.preview.token, SHOP_FACTS, send)
  assert.equal(r.ok, false)
  assert.match(r.message, /no email address/)
  db.tables.vendors[0].email = 'orders@example.com'
  const p2 = await previewPo(db, SHOP, po.id, SHOP_FACTS)
  assert.notEqual(p2.preview.token, p.preview.token)
  assert.equal((await sendPo(db, SHOP, ME, po.id, p.preview.token, SHOP_FACTS, send)).ok, false, 'the old approval does not cover the new address')
})

test('sending an order: if the email fails nothing is recorded and it can be tried again', async () => {
  const db = withVendor()
  const po = await savePoDraft(db, SHOP, ME, null, poInput())
  const p = await previewPo(db, SHOP, po.id, SHOP_FACTS)
  const down = await sendPo(db, SHOP, ME, po.id, p.preview.token, SHOP_FACTS, mailbox(true))
  assert.equal(down.ok, false)
  assert.equal(down.status, 502)
  assert.equal(db.tables.purchase_orders[0].status, 'draft')
  assert.equal(db.tables.purchase_orders[0].send_started_at, null, 'the claim is released')
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_order, 0)
  const up = mailbox()
  assert.equal((await sendPo(db, SHOP, ME, po.id, p.preview.token, SHOP_FACTS, up)).ok, true)
  assert.equal(up.sent.length, 1)
})

test('sending an order: if the email went out but recording failed, it says so and will not send again', async () => {
  const real = makeDb({ vendors: [{ id: 'v1', shop_id: SHOP, name: 'Fake Parts Supply', email: 'orders@example.com', active: true }] })
  const po = await savePoDraft(real, SHOP, ME, null, poInput())
  const p = await previewPo(real, SHOP, po.id, SHOP_FACTS)
  const rpc = real.rpc
  real.rpc = (fn, args) => (fn === 'po_mark_sent' ? Promise.resolve({ data: null, error: { code: '57014', message: 'timeout' } }) : rpc(fn, args))
  const send = mailbox()
  const r = await sendPo(real, SHOP, ME, po.id, p.preview.token, SHOP_FACTS, send)
  assert.equal(r.ok, true)
  assert.equal(r.recorded, false)
  assert.equal(send.sent.length, 1)
  const again = await sendPo(real, SHOP, ME, po.id, p.preview.token, SHOP_FACTS, send)
  assert.equal(again.ok, false)
  assert.equal(send.sent.length, 1)
  // The owner can still record it by hand.
  real.rpc = rpc
  assert.equal((await markPoSent(real, SHOP, ME, po.id, 'emailed earlier')).ok, true)
  assert.equal(real.tables.purchase_orders[0].status, 'sent')
})

test('an order placed by phone can be marked sent without emailing, once', async () => {
  const db = withVendor()
  const po = await savePoDraft(db, SHOP, ME, null, poInput())
  assert.equal((await markPoSent(db, SHOP, ME, po.id, 'phoned in')).ok, true)
  const again = await markPoSent(db, SHOP, ME, po.id, 'phoned in')
  assert.equal(again.already, true)
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_order, 10, 'on order is added once')
  assert.equal((await markPoSent(db, OTHER, ME, po.id, 'x')).status, 404)
})

test('cancelling an order takes what had not arrived back out of "on order"', async () => {
  const db = withVendor()
  const po = await savePoDraft(db, SHOP, ME, null, poInput())
  await markPoSent(db, SHOP, ME, po.id, 'phone')
  const lines = db.tables.purchase_order_lines.filter(l => l.po_id === po.id)
  const rcv = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-aaaa1', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 4 }] })
  assert.equal(rcv.ok, true)
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_order, 6)
  const c = await cancelPo(db, SHOP, ME, po.id)
  assert.equal(c.ok, true)
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_order, 0)
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_hand, 10, 'what arrived stays')
  assert.equal(db.tables.inventory.find(x => x.id === 'p2').qty_on_order, 0)
  assert.equal((await cancelPo(db, SHOP, ME, po.id)).already, true)
  assert.equal(db.tables.purchase_orders.length, 1, 'cancelled, not deleted')
})

test('receiving: counts go up, on order goes down, cost follows the method, and the order moves from sent to partly to received', async () => {
  const db = withVendor()
  const po = await savePoDraft(db, SHOP, ME, null, poInput())
  const early = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-0000', cost_method: 'keep', items: [{ line_id: 'x', qty: 1 }] })
  assert.equal(early.ok, false, 'a draft cannot be received')
  await markPoSent(db, SHOP, ME, po.id, 'phone')
  const [l1, l2] = db.tables.purchase_order_lines.filter(l => l.po_id === po.id)
  const first = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-0001', cost_method: 'average', items: [{ line_id: l1.id, qty: 10 }, { line_id: l2.id, qty: 0 }] })
  assert.equal(first.ok, true)
  assert.equal(first.status, 'partial')
  const filter = () => db.tables.inventory.find(x => x.id === 'p1')
  assert.equal(filter().qty_on_hand, 16)
  assert.equal(filter().qty_on_order, 0)
  assert.equal(filter().cost, 4.69, 'six at 5.00 and ten at 4.50 average to 4.69')
  const second = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-0002', cost_method: 'latest', items: [{ line_id: l2.id, qty: 4 }] })
  assert.equal(second.status, 'received')
  assert.equal(db.tables.inventory.find(x => x.id === 'p2').cost, 28)
  const done = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-0003', cost_method: 'keep', items: [{ line_id: l2.id, qty: 1 }] })
  assert.equal(done.ok, false, 'a fully received order takes no more')
  assert.ok(db.tables.part_history.some(h => h.reason === 'received' && h.reference === 'PO-0001' && h.actor_name === 'Sam Rivera'))
})

test('receiving the same delivery twice counts it once', async () => {
  const db = withVendor()
  const po = await savePoDraft(db, SHOP, ME, null, poInput())
  await markPoSent(db, SHOP, ME, po.id, 'phone')
  const [l1] = db.tables.purchase_order_lines.filter(l => l.po_id === po.id)
  const input = { receipt_key: 'receipt-dup01', cost_method: 'keep', items: [{ line_id: l1.id, qty: 5 }] }
  const a = await receivePo(db, SHOP, ME, po.id, input)
  const b = await receivePo(db, SHOP, ME, po.id, input)
  assert.equal(a.duplicate, false)
  assert.equal(b.duplicate, true)
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_hand, 11, '6 + 5, not 6 + 10')
  assert.equal(db.tables.purchase_order_lines.find(l => l.id === l1.id).qty_received, 5)
})

test('receiving more than was ordered needs the person to confirm, and a bad receipt changes nothing', async () => {
  const db = withVendor()
  const po = await savePoDraft(db, SHOP, ME, null, poInput())
  await markPoSent(db, SHOP, ME, po.id, 'phone')
  const [l1, l2] = db.tables.purchase_order_lines.filter(l => l.po_id === po.id)
  const over = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-over1', cost_method: 'keep', items: [{ line_id: l1.id, qty: 12 }] })
  assert.equal(over.ok, false)
  assert.match(over.message, /Confirm if the vendor really sent extra/)
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_hand, 6)
  const sure = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-over2', cost_method: 'keep', allow_over: true, items: [{ line_id: l1.id, qty: 12 }] })
  assert.equal(sure.ok, true)
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_hand, 18)
  for (const input of [{ cost_method: 'keep', items: [{ line_id: l2.id, qty: 1 }] }, { receipt_key: 'receipt-bad01', items: [{ line_id: l2.id, qty: 1 }] }, { receipt_key: 'receipt-bad02', cost_method: 'keep', items: [] }, { receipt_key: 'receipt-bad03', cost_method: 'keep', items: [{ line_id: 'not-a-line', qty: 1 }] }, { receipt_key: 'receipt-bad04', cost_method: 'keep', items: [{ line_id: l2.id, qty: -2 }] }]) {
    assert.equal((await receivePo(db, SHOP, ME, po.id, input)).ok, false, JSON.stringify(input))
  }
  assert.equal(db.tables.inventory.find(x => x.id === 'p2').qty_on_hand, 1)
})

test('orders on a database without the update say so, for that feature only', async () => {
  const db = withVendor()
  db.rpc = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.po_save_draft in the schema cache' } })
  const r = await savePoDraft(db, SHOP, ME, null, poInput())
  assert.equal(r.ok, false)
  assert.equal(r.needsUpdate, true)
})

/* ---------- reading ---------- */

test('reading: each resource says ok, needs an update, or error on its own', async () => {
  const db = makeDb({ vendors: [{ id: 'v1', shop_id: SHOP, name: 'A', active: true }] }, { missingTables: ['purchase_orders', 'part_returns'], failures: { 'select:vendor_prices': { code: '57014', message: 'timeout' } } })
  const d = await loadInventoryData(db, SHOP)
  assert.equal(d.vendors.state, 'ok')
  assert.equal(d.vendors.value.length, 1)
  assert.equal(d.orders.state, 'needs-update')
  assert.equal(d.returns.state, 'needs-update')
  assert.equal(d.prices.state, 'error')
  assert.ok(!/timeout/.test(d.prices.error))
  assert.equal(d.extras.state, 'ok')
  assert.equal(d.rules.state, 'ok')
})

test('reading orders joins their lines in order and never mixes in another shop', async () => {
  const db = withVendor()
  const a = await savePoDraft(db, SHOP, ME, null, poInput())
  await savePoDraft(db, OTHER, ME, null, poInput({ vendor_id: null, vendor_name: 'X', lines: [{ description: 'Wipers', qty: 2, unit_cost: 6 }] }))
  const d = await loadInventoryData(db, SHOP)
  assert.equal(d.orders.value.length, 1)
  assert.equal(d.orders.value[0].id, a.id)
  assert.deepEqual(d.orders.value[0].lines.map(l => l.description), ['Oil filter', 'Brake pads'])
})

test('history reads newest first for one part of this shop', async () => {
  const db = makeDb()
  await adjustPart(db, SHOP, ME, { part_id: 'p1', delta: -1, reason: 'used' })
  await adjustPart(db, SHOP, { userId: 'u2', name: 'Dana' }, { part_id: 'p1', delta: 5, reason: 'received' })
  await adjustPart(db, SHOP, ME, { part_id: 'p2', delta: 1 })
  const h = await loadHistory(db, SHOP, 'p1')
  assert.equal(h.state, 'ok')
  assert.equal(h.value.length, 2)
  assert.ok(h.value.every(x => x.part_id === 'p1'))
  assert.deepEqual(h.value.map(x => x.actor).sort(), ['Dana', 'Sam Rivera'])
  const gone = await loadHistory(makeDb({}, { missingTables: ['part_history'] }), SHOP, 'p1')
  assert.equal(gone.state, 'needs-update')
})

test('sales for the reorder suggestions skip drafts and voids and read old lines with missing fields', async () => {
  const db = makeDb({ documents: [
    { id: 'd1', shop_id: SHOP, type: 'Invoice', status: 'Paid', doc_date: '2026-10-02', created_at: '2026-10-02T15:00:00Z', parts: [{ name: 'Oil filter', qty: 2 }, { name: 'Wipers' }, { qty: 3 }] },
    { id: 'd2', shop_id: SHOP, type: 'Invoice', status: 'Draft', doc_date: '2026-10-03', created_at: '2026-10-03T15:00:00Z', parts: [{ name: 'Oil filter', qty: 9 }] },
    { id: 'd3', shop_id: SHOP, type: 'Invoice', status: 'Void', doc_date: '2026-10-03', created_at: '2026-10-03T15:00:00Z', parts: [{ name: 'Oil filter', qty: 9 }] },
    { id: 'd4', shop_id: OTHER, type: 'Invoice', status: 'Paid', doc_date: '2026-10-03', created_at: '2026-10-03T15:00:00Z', parts: [{ name: 'Oil filter', qty: 9 }] },
    { id: 'd5', shop_id: SHOP, type: 'Invoice', status: 'Paid', doc_date: null, created_at: '2026-10-04T15:00:00Z', parts: null },
  ] })
  const lines = await loadSoldLines(db, SHOP, '2026-08-01')
  assert.deepEqual(lines, [{ date: '2026-10-02', name: 'Oil filter', qty: 2 }, { date: '2026-10-02', name: 'Wipers', qty: 1 }])
})

/* ---------- the bill that goes with a delivery ---------- */

const sentOrder = async (db) => {
  const po = await savePoDraft(db, SHOP, ME, null, poInput())
  await markPoSent(db, SHOP, ME, po.id, 'phone')
  return { po, lines: db.tables.purchase_order_lines.filter(l => l.po_id === po.id) }
}
const BILLER = { mayBill: true, todayKey: '2026-10-16' }

test('receiving with a bill: the delivery is counted and one bill lands in Accounting under Parts bought, with the order number on it', async () => {
  const db = withVendor(); db.tables.expenses = []
  const { po, lines } = await sentOrder(db)
  const r = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-bill01', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 10 }], bill: { add: true, amount: 49.5, paid: false } }, BILLER)
  assert.equal(r.ok, true)
  assert.equal(r.bill.state, 'added')
  assert.equal(db.tables.expenses.length, 1)
  const e = db.tables.expenses[0]
  assert.deepEqual([e.vendor, e.category, e.amount, e.reference, e.date, e.paid_on, e.shop_id], ['Fake Parts Supply', 'parts', 49.5, 'PO-0001', '2026-10-16', null, SHOP])
  assert.match(e.memo, /Parts received on PO-0001/)
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_hand, 16, 'the shelf count still went up')
})

test('a bill marked already paid carries today as the paid day', async () => {
  const db = withVendor(); db.tables.expenses = []
  const { po, lines } = await sentOrder(db)
  const r = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-bill02', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 2 }], bill: { add: true, amount: '9.00', paid: true } }, BILLER)
  assert.equal(r.bill.paid, true)
  assert.equal(db.tables.expenses[0].paid_on, '2026-10-16')
})

test('no bill is added unless asked, and none is added by someone who may not enter bills', async () => {
  const db = withVendor(); db.tables.expenses = []
  const { po, lines } = await sentOrder(db)
  const none = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-bill03', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 1 }] }, BILLER)
  assert.equal(none.bill, null)
  const tech = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-bill04', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 1 }], bill: { add: true, amount: 4.5, paid: false } }, { mayBill: false, todayKey: '2026-10-16' })
  assert.equal(tech.ok, true, 'the delivery is still counted')
  assert.equal(tech.bill.state, 'skipped')
  assert.match(tech.bill.message, /Only an owner, admin or manager/)
  const old = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-bill05', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 1 }], bill: { add: true, amount: 4.5, paid: false } })
  assert.equal(old.bill.state, 'skipped', 'a caller that passes no options never adds a bill')
  assert.equal(db.tables.expenses.length, 0)
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_hand, 9, 'three deliveries of one')
})

test('a bill amount that cannot be right is refused before anything is counted', async () => {
  const db = withVendor(); db.tables.expenses = []
  const { po, lines } = await sentOrder(db)
  for (const amount of ['', 'abc', 0, -5, 20_000_000]) {
    const r = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-bad001', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 3 }], bill: { add: true, amount, paid: false } }, BILLER)
    assert.equal(r.ok, false, `amount ${JSON.stringify(amount)}`)
    assert.equal(r.status, 400)
    assert.ok(r.fields.bill)
  }
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_hand, 6, 'nothing was counted')
  assert.equal(db.tables.po_receipts?.length || 0, 0)
  assert.equal(db.tables.expenses.length, 0)
})

test('sending the same delivery twice adds the bill once', async () => {
  const db = withVendor(); db.tables.expenses = []
  const { po, lines } = await sentOrder(db)
  const input = { receipt_key: 'receipt-twice1', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 5 }], bill: { add: true, amount: 22.5, paid: false } }
  const a = await receivePo(db, SHOP, ME, po.id, input, BILLER)
  const b = await receivePo(db, SHOP, ME, po.id, input, BILLER)
  assert.equal(a.bill.state, 'added')
  assert.equal(b.duplicate, true)
  assert.equal(b.bill, null)
  assert.equal(db.tables.expenses.length, 1)
})

test('a second delivery on the same order gets its own bill, numbered, and the same amount on the same day is flagged instead of doubled', async () => {
  const db = withVendor(); db.tables.expenses = []
  const { po, lines } = await sentOrder(db)
  await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-part01', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 4 }], bill: { add: true, amount: 18, paid: false } }, BILLER)
  const second = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-part02', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 3 }], bill: { add: true, amount: 13.5, paid: false } }, BILLER)
  assert.equal(second.bill.state, 'added')
  assert.equal(second.bill.reference, 'PO-0001 delivery 2')
  assert.deepEqual(db.tables.expenses.map(e => e.reference).sort(), ['PO-0001', 'PO-0001 delivery 2'])
  // Someone already typed this very bill by hand today: it is reported, not entered twice.
  const same = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-part03', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 1 }], bill: { add: true, amount: 13.5, paid: false } }, BILLER)
  assert.equal(same.ok, true)
  assert.equal(same.bill.state, 'duplicate')
  assert.match(same.bill.message, /already in Accounting/)
  assert.equal(db.tables.expenses.length, 2)
})

test('an order whose vendor is gone is still checked in, and the missing bill is explained', async () => {
  const db = withVendor(); db.tables.expenses = []
  const { po, lines } = await sentOrder(db)
  db.tables.purchase_orders.find(o => o.id === po.id).vendor_name = ''
  db.tables.vendors = []
  const r = await receivePo(db, SHOP, ME, po.id, { receipt_key: 'receipt-novend', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 2 }], bill: { add: true, amount: 9, paid: false } }, BILLER)
  assert.equal(r.ok, true)
  assert.equal(r.bill.state, 'failed')
  assert.match(r.bill.message, /checked in, but the order has no vendor name/)
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_hand, 8)
  assert.equal(db.tables.expenses.length, 0)
})

test('retrying a delivery that was already counted says so, even when it was the whole order', async () => {
  const db = withVendor(); db.tables.expenses = []
  const { po, lines } = await sentOrder(db)
  const input = { receipt_key: 'receipt-retry1', cost_method: 'keep', items: [{ line_id: lines[0].id, qty: 10 }, { line_id: lines[1].id, qty: 4 }], bill: { add: true, amount: 157, paid: false } }
  const a = await receivePo(db, SHOP, ME, po.id, input, BILLER)
  assert.equal(a.ok, true)
  assert.equal(a.status, 'received')
  const b = await receivePo(db, SHOP, ME, po.id, input, BILLER)
  assert.equal(b.ok, true, 'the answer is "already counted", not "this order is already received"')
  assert.equal(b.duplicate, true)
  assert.equal(db.tables.inventory.find(x => x.id === 'p1').qty_on_hand, 16, 'counted once')
  assert.equal(db.tables.expenses.length, 1, 'billed once')
  // A different key on a finished order is still refused.
  const c = await receivePo(db, SHOP, ME, po.id, { ...input, receipt_key: 'receipt-retry2' }, BILLER)
  assert.equal(c.ok, false)
})
