import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADJUST_REASONS, applyReceipt, billOutcomeWords, billReference, checkPo, checkReceipt, compareOffers, describeHistory, findByCode, groupByVendor, normalizeCode, normalizeRules, poCsv, poHtml, poMessage, poNumberFor,
  poTotals, previewReprice, priceAge, priceFor, reorderCsv, reorderSuggestions, returnsSummary, roundPrice, statusAfterReceiving, usageFromSales, validBarcode, valuation, valuationCsv, receiptAmount,
} from '../src/lib/inventory-logic.ts'

const part = (o = {}) => ({ id: 'p', part_number: '', name: 'Part', category: '', brand: '', cost: null, retail_price: null, qty_on_hand: 0, qty_reorder: 0, qty_on_order: 0, location: '', supplier: '', supplier_part_number: '', ...o })
const P1 = part({ id: 'p1', part_number: 'MO-301', name: 'Brake pads front', category: 'Brakes', brand: 'Acme', cost: 35, retail_price: 80, qty_on_hand: 1, qty_reorder: 4, supplier: 'Fake Parts Supply', supplier_part_number: 'FP-MO301' })
const P2 = part({ id: 'p2', part_number: 'OF-100', name: 'Oil filter', category: 'Filters', cost: 5, retail_price: 12, qty_on_hand: 0, qty_reorder: 6 })
const P3 = part({ id: 'p3', part_number: 'OIL-5W30', name: 'Synthetic oil 5W-30 quart', category: 'Fluids & Chemicals', cost: 4, retail_price: 9, qty_on_hand: 40, qty_reorder: 12 })
const P4 = part({ id: 'p4', name: 'Wiper blade 22in', category: 'Other', cost: 6, retail_price: 15, qty_on_hand: 2, qty_reorder: 2, qty_on_order: 6 })
const P5 = part({ id: 'p5', name: 'Alternator remanufactured', category: 'Electrical', cost: 120, retail_price: 210, qty_on_hand: 3 })
const P6 = part({ id: 'p6', name: 'Mystery part', qty_on_hand: -2 })
const PARTS = [P1, P2, P3, P4, P5, P6]
const vendor = (o = {}) => ({ id: 'v', name: 'V', email: '', phone: '', contact: '', account_number: '', address: '', terms: '', lead_days: null, notes: '', active: true, ...o })
const V1 = vendor({ id: 'v1', name: 'Fake Parts Supply', email: 'orders@example.com', contact: 'Jo Smith' }), V2 = vendor({ id: 'v2', name: 'Budget Parts Co' }), V3 = vendor({ id: 'v3', name: 'Closed Vendor', active: false })
const VENDORS = [V1, V2, V3]
const price = (o) => ({ id: `${o.vendor_id}-${o.part_id}`, vendor_sku: '', core_charge: 0, checked_on: '2026-09-01', ...o })
const PRICES = [price({ vendor_id: 'v1', part_id: 'p1', price: 38 }), price({ vendor_id: 'v2', part_id: 'p1', price: 33.5 }), price({ vendor_id: 'v3', part_id: 'p1', price: 30 }), price({ vendor_id: 'v2', part_id: 'p2', price: 4.25 })]
const extra = (o) => ({ barcode: '', max_qty: null, order_multiple: null, core_charge: 0, preferred_vendor_id: null, ...o })
const noUsage = new Map()

test('usage: sold lines are matched to stocked parts by name or by a part number in the line, inside the period', () => {
  const lines = [
    { date: '2026-10-05', name: 'Synthetic oil 5W-30 quart', qty: 5 }, { date: '2026-10-12', name: 'MO-301 brake pads', qty: 1 },
    { date: '2026-01-01', name: 'Oil filter', qty: 9 }, { date: '2026-10-12', name: 'Something else', qty: 3 }, { date: '2026-10-12', name: 'Oil filter', qty: 0 },
  ]
  const u = usageFromSales(lines, PARTS, '2026-10-14', 90)
  assert.deepEqual([...u.keys()].sort(), ['p1', 'p3'])
  assert.equal(u.get('p3').sold, 5); assert.equal(u.get('p3').perWeek, 0.39); assert.equal(u.get('p1').lastSold, '2026-10-12')
  // Two stocked parts with the same name cannot be told apart, so neither is credited.
  const twin = usageFromSales([{ date: '2026-10-05', name: 'Oil filter', qty: 1 }], [P2, { ...P2, id: 'p2b' }], '2026-10-14')
  assert.equal(twin.size, 0)
})

test('reorder: low and out parts not already covered by an order, out first', () => {
  const list = reorderSuggestions({ parts: PARTS, extras: new Map(), vendors: VENDORS, prices: PRICES, usage: noUsage })
  assert.deepEqual(list.map(s => s.part.id), ['p2', 'p1'])
  const [oil, pads] = list
  assert.deepEqual([oil.qty, oil.vendorName, oil.unitCost, oil.costFrom, oil.state], [12, 'Budget Parts Co', 4.25, 'vendor price', 'out'])
  assert.equal(oil.reason, 'Out of stock')
  assert.deepEqual([pads.qty, pads.vendorName, pads.unitCost, pads.state], [7, 'Fake Parts Supply', 38, 'low'], 'the vendor named on the part wins over a cheaper one')
  assert.equal(pads.reason, '1 left, reorder point is 4')
  // The wiper blades are low, but 6 are already on order, so they are not asked for again.
  assert.ok(!list.some(s => s.part.id === 'p4'))
})

test('reorder: preferred vendor, order up to level, and cases', () => {
  const extras = new Map([['p1', extra({ part_id: 'p1', preferred_vendor_id: 'v2', max_qty: 10, order_multiple: 4 })]])
  const [pads] = reorderSuggestions({ parts: [P1], extras, vendors: VENDORS, prices: PRICES, usage: noUsage })
  assert.deepEqual([pads.vendorId, pads.unitCost, pads.qty], ['v2', 33.5, 12], '9 needed, sold in cases of 4')
  // An inactive vendor is never chosen.
  const only3 = reorderSuggestions({ parts: [P1], extras: new Map(), vendors: [V3], prices: PRICES, usage: noUsage })
  assert.equal(only3[0].vendorId, null)
})

test('reorder: a part with no reorder point is only listed when it is out and has sold lately', () => {
  const sold = new Map([['p6', { sold: 8, perWeek: 4, lastSold: '2026-10-10' }]])
  assert.equal(reorderSuggestions({ parts: [P6], extras: new Map(), vendors: [], prices: [], usage: noUsage }).length, 0)
  const s = reorderSuggestions({ parts: [P6], extras: new Map(), vendors: [], prices: [], usage: sold })
  assert.equal(s.length, 1); assert.equal(s[0].qty, 16, 'four weeks at the recent pace')
  assert.equal(s[0].costFrom, 'none')
})

test('reorder: days of stock left comes from the recent pace', () => {
  const usage = new Map([['p1', { sold: 6, perWeek: 3.5, lastSold: '2026-10-10' }]])
  assert.equal(reorderSuggestions({ parts: [P1], extras: new Map(), vendors: VENDORS, prices: [], usage })[0].daysLeft, 2)
})

test('suggestions are grouped into one draft order per vendor', () => {
  const g = groupByVendor(reorderSuggestions({ parts: PARTS, extras: new Map(), vendors: VENDORS, prices: PRICES, usage: noUsage }))
  assert.deepEqual(g.map(x => [x.vendorName, x.items.length, x.total]), [['Fake Parts Supply', 1, 266], ['Budget Parts Co', 1, 51]])
})

test('purchase order: totals, with core charges and what is still to come', () => {
  const lines = [{ qty: 4, unit_cost: 38, core_charge: 0, qty_received: 4 }, { qty: 2, unit_cost: 120, core_charge: 30, qty_received: 1 }]
  assert.deepEqual(poTotals(lines), { subtotal: 392, cores: 60, total: 452, units: 6, received: 5, outstanding: 1 })
  assert.deepEqual(poTotals([]), { subtotal: 0, cores: 0, total: 0, units: 0, received: 0, outstanding: 0 })
})

test('purchase order: a draft is checked line by line in plain words', () => {
  const ok = checkPo({ vendor_id: 'v1', vendor_name: 'Fake Parts Supply', notes: 'Call first', expected_on: '2026-10-20', lines: [{ part_id: 'p1', description: ' Brake  pads ', sku: 'FP-MO301', qty: '7', unit_cost: '38', core_charge: 0 }] })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value.lines, [{ part_id: 'p1', description: 'Brake pads', sku: 'FP-MO301', qty: 7, unit_cost: 38, core_charge: 0 }])
  const bad = checkPo({ lines: [{ description: '', qty: 1, unit_cost: 1 }, { description: 'A', qty: 0, unit_cost: 1 }, { description: 'B', qty: 2, unit_cost: 'x' }, { description: 'C', qty: 2, unit_cost: 1, core_charge: -1 }], expected_on: 'soon' })
  assert.equal(bad.ok, false)
  assert.equal(bad.errors.length, 6)
  assert.ok(bad.errors.includes('Choose the vendor this order goes to.') && bad.errors.includes('The expected date is not a real date.'))
  assert.ok(bad.errors.includes('Line 2 (A): the quantity must be a whole number, 1 or more.'))
  assert.deepEqual(checkPo({ vendor_name: 'V', lines: [] }).errors, ['Add at least one part to the order.'])
  assert.equal(poNumberFor(7), 'PO-0007'); assert.equal(poNumberFor(12345), 'PO-12345'); assert.equal(poNumberFor(0), 'PO-0001')
})

const sentPo = (o = {}) => ({ id: 'po1', po_number: 'PO-0001', status: 'sent', notes: '', expected_on: null, lines: [{ id: 'l1', part_id: 'p1', description: 'Brake pads', sku: 'FP-MO301', qty: 4, unit_cost: 38, core_charge: 0, qty_received: 0 }, { id: 'l2', part_id: 'p2', description: 'Oil filter', sku: '', qty: 6, unit_cost: 4.25, core_charge: 0, qty_received: 6 }], ...o })

test('receiving: checked against the order before anything is saved', () => {
  const po = sentPo()
  const ok = checkReceipt(po, [{ lineId: 'l1', qty: 3 }])
  assert.equal(ok.ok, true); assert.equal(ok.units, 3); assert.deepEqual(ok.lines[0], { lineId: 'l1', partId: 'p1', qty: 3, unitCost: 38, description: 'Brake pads' })
  const over = checkReceipt(po, [{ lineId: 'l1', qty: 5 }])
  assert.equal(over.ok, false); assert.match(over.problems[0], /Brake pads would be 5 of 4 ordered. Confirm if the vendor really sent extra/)
  assert.equal(checkReceipt(po, [{ lineId: 'l1', qty: 5 }], true).ok, true, 'the person can confirm extra')
  assert.match(checkReceipt(sentPo({ status: 'draft' }), [{ lineId: 'l1', qty: 1 }]).problems[0], /has not been sent yet/)
  assert.match(checkReceipt(sentPo({ status: 'received' }), [{ lineId: 'l1', qty: 1 }]).problems[0], /already fully received/)
  assert.match(checkReceipt(po, []).problems[0], /Enter how many/)
  assert.match(checkReceipt(po, [{ lineId: 'zz', qty: 1 }]).problems[0], /not on the order/)
  assert.match(checkReceipt(po, [{ lineId: 'l1', qty: 1 }, { lineId: 'l1', qty: 1 }]).problems[0], /listed twice/)
  assert.match(checkReceipt(po, [{ lineId: 'l1', qty: -2 }]).problems[0], /0 or more/)
})

test('receiving: the order is partly received, then received', () => {
  const po = sentPo()
  assert.equal(statusAfterReceiving(po), 'partial')
  po.lines[0].qty_received = 4
  assert.equal(statusAfterReceiving(po), 'received')
  po.lines[0].qty_received = 0; po.lines[1].qty_received = 0
  assert.equal(statusAfterReceiving(po), 'sent')
  assert.equal(statusAfterReceiving(sentPo({ status: 'draft' })), 'draft'); assert.equal(statusAfterReceiving(sentPo({ status: 'cancelled' })), 'cancelled')
})

test('receiving: counts and cost after parts arrive', () => {
  const had = { qty_on_hand: 10, qty_on_order: 12, cost: 5 }
  assert.deepEqual(applyReceipt(had, 10, 7, 'latest'), { qty_on_hand: 20, qty_on_order: 2, cost: 7 })
  assert.deepEqual(applyReceipt(had, 10, 7, 'average'), { qty_on_hand: 20, qty_on_order: 2, cost: 6 })
  assert.deepEqual(applyReceipt(had, 10, 7, 'keep'), { qty_on_hand: 20, qty_on_order: 2, cost: 5 })
  assert.equal(applyReceipt({ qty_on_hand: 0, qty_on_order: 3, cost: null }, 5, 9, 'average').cost, 9)
  assert.equal(applyReceipt({ qty_on_hand: -4, qty_on_order: 3, cost: 5 }, 5, 9, 'latest').qty_on_hand, 5, 'a negative count is treated as empty')
  assert.equal(applyReceipt(had, 99, 7, 'keep').qty_on_order, 0, 'on order never goes below zero')
  assert.equal(applyReceipt(had, 0, 7, 'latest').cost, 5)
})

test('the order as a message: exactly what is sent, with the vendor, lines and total', () => {
  const m = poMessage(sentPo({ expected_on: '2026-10-20', notes: 'Deliver to the back door.' }), V1, { name: 'Test Auto', address: '1 Main St', phone: '555-0100', email: 'shop@example.com' })
  assert.equal(m.subject, 'Purchase order PO-0001 from Test Auto')
  assert.ok(m.text.startsWith('Hello Jo,'))
  assert.ok(m.text.includes('4 x Brake pads (FP-MO301)  $38.00 each  =  $152.00'))
  assert.ok(m.text.includes('Subtotal $177.50, total $177.50'))
  assert.ok(m.text.includes('Needed by October 20, 2026.') && m.text.includes('Notes: Deliver to the back door.'))
  assert.ok(m.text.trimEnd().endsWith('1 Main St  |  555-0100  |  shop@example.com'))
  const html = poHtml(sentPo({ notes: '<script>x</script>' }), { name: 'A & B', account_number: '12' }, { name: 'Test Auto', address: '', phone: '', email: '' })
  assert.ok(!html.includes('<script>') && html.includes('A &amp; B') && html.includes('Account 12'))
  assert.ok(poHtml(sentPo(), V1, { name: 'T', address: '', phone: '', email: '' }, true).startsWith('<!doctype html>'))
})

test('vendor prices compared: cheapest first, what it saves against the current cost', () => {
  const o = compareOffers('p1', VENDORS, PRICES, 35)
  assert.deepEqual(o.map(x => [x.vendor.name, x.price, x.saving, x.cheapest]), [['Closed Vendor', 30, 5, true], ['Budget Parts Co', 33.5, 1.5, false], ['Fake Parts Supply', 38, -3, false]])
  assert.deepEqual(compareOffers('p9', VENDORS, PRICES, 35), [])
  assert.equal(compareOffers('p1', VENDORS, PRICES, null)[0].saving, null)
  assert.deepEqual(priceAge('2026-09-01', '2026-10-14'), { days: 43, stale: false })
  assert.deepEqual(priceAge('2026-01-01', '2026-10-14').stale, true)
  assert.deepEqual(priceAge(null, '2026-10-14'), { days: null, stale: true })
})

test('returns and cores: what is still to send and what credit is still to come', () => {
  const r = (o) => ({ id: 'r', part_id: null, vendor_id: 'v1', description: 'Core', kind: 'core', qty: 1, amount: 30, status: 'open', opened_on: '2026-10-01', credited_on: null, reference: '', note: '', ...o })
  const s = returnsSummary([r({ id: '1' }), r({ id: '2', status: 'shipped', amount: 45, opened_on: '2026-08-01' }), r({ id: '3', status: 'credited', amount: 99 }), r({ id: '4', vendor_id: 'v2', amount: 12 })], '2026-10-14')
  assert.deepEqual([s.open, s.shipped, s.waitingCredit, s.overdue, s.overdueCredit], [2, 1, 87, 1, 45])
  assert.deepEqual(s.byVendor, [{ vendorId: 'v1', credit: 75, count: 2 }, { vendorId: 'v2', credit: 12, count: 1 }])
})

test('shelf value: at cost and at price, honest about parts it cannot value', () => {
  const v = valuation(PARTS, null)
  assert.deepEqual([v.parts, v.units, v.atCost, v.atRetail, v.potentialProfit], [6, 46, 567, 1100, 533])
  assert.deepEqual(v.negative.map(p => p.id), ['p6'])
  assert.deepEqual(v.noCost, [])
  assert.deepEqual(v.byCategory.map(c => [c.category, c.atCost]), [['Electrical', 360], ['Fluids & Chemicals', 160], ['Other', 12], ['Brakes', 35], ['Filters', 0], ['No category', 0]].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])))
  const costless = valuation([part({ id: 'x', qty_on_hand: 4, retail_price: 10 })], null)
  assert.equal(costless.noCost.length, 1); assert.equal(costless.atCost, 0)
  assert.deepEqual(v.slow, [], 'with no sales information nothing is called slow')
  const slow = valuation(PARTS, new Map([['p3', { sold: 5, perWeek: 1, lastSold: '' }]]))
  assert.deepEqual(slow.slow.map(s => s.part.id), ['p5', 'p1', 'p4'])
  assert.equal(slow.slowValue, 407)
})

test('barcodes: check digits and tidy typing', () => {
  for (const good of ['036000291452', '4006381333931', '96385074']) assert.equal(validBarcode(good), true, good)
  for (const bad of ['036000291453', '12345', '', 'abc']) assert.equal(validBarcode(bad), false, bad)
  assert.equal(normalizeCode(' mo-301\n'), 'MO301'); assert.equal(normalizeCode(null), '')
})

test('lookup by typed or scanned code: exact first, then parts that start with it', () => {
  const extras = new Map([['p3', extra({ part_id: 'p3', barcode: '036000291452' })]])
  const by = (code) => findByCode(PARTS, extras, code).map(m => `${m.part.id}:${m.why}`)
  assert.deepEqual(by('036000291452'), ['p3:barcode'])
  assert.deepEqual(by('mo 301'), ['p1:part number'])
  assert.deepEqual(by('fp-mo301'), ['p1:vendor part number'])
  assert.deepEqual(by('MO30'), ['p1:starts with'])
  assert.deepEqual(by('MO'), [], 'two characters is too little to guess from')
  assert.deepEqual(by(''), [])
  assert.deepEqual(by('ZZZZ'), [])
  const noBarcode = findByCode(PARTS, new Map([['p1', extra({ part_id: 'p1', barcode: '' })]]), '')
  assert.deepEqual(noBarcode, [])
})

test('price rules: markup or margin by cost band, category overrides, rounding up, never below cost', () => {
  const rules = normalizeRules({ tiers: [
    { min_cost: 0, max_cost: 10, method: 'markup', pct: 100 }, { min_cost: 10, max_cost: 50, method: 'markup', pct: 60 },
    { min_cost: 50, max_cost: null, method: 'margin', pct: 30 }, { min_cost: 0, max_cost: null, method: 'markup', pct: 80, category: 'Brakes' },
  ], round_to: '0.99' })
  assert.equal(priceFor(5, 'Filters', rules), 10.99)
  assert.equal(priceFor(35, 'Filters', rules), 56.99)
  assert.equal(priceFor(120, 'Filters', rules), 171.99)
  assert.equal(priceFor(35, 'brakes', rules), 63.99, 'a category tier wins')
  assert.equal(priceFor(0, '', rules), null); assert.equal(priceFor(-3, '', rules), null)
  assert.equal(priceFor(5, '', normalizeRules({ tiers: [{ min_cost: 10, max_cost: null, method: 'markup', pct: 50 }] })), null, 'no band covers the cost')
  assert.equal(priceFor(10, '', normalizeRules({ tiers: [{ min_cost: 0, max_cost: null, method: 'markup', pct: 0 }], minimum_price: 0 })), 10, 'never below cost')
  assert.equal(priceFor(2, '', normalizeRules({ tiers: [{ min_cost: 0, max_cost: null, method: 'markup', pct: 10 }], minimum_price: 5 })), 5, 'minimum price')
})

test('price rules: rounding and bad rules', () => {
  assert.deepEqual([12.34, 13, 12.99, 0.5].map(n => roundPrice(n, '0.99')), [12.99, 13.99, 12.99, 0.99])
  assert.deepEqual([12.31, 12.35, 12.36].map(n => roundPrice(n, '0.05')), [12.35, 12.35, 12.4])
  assert.deepEqual([12.01, 12].map(n => roundPrice(n, '1')), [13, 12])
  assert.equal(roundPrice(12.346, 'none'), 12.35); assert.equal(roundPrice(0, '0.99'), 0)
  const r = normalizeRules({ tiers: [{ min_cost: 5, max_cost: 5, pct: 10 }, { min_cost: 0, pct: 'x' }, { min_cost: 0, method: 'margin', pct: 99 }, { min_cost: 0, pct: -1 }, { min_cost: 0, pct: 20 }, null], round_to: 'weird', minimum_price: -4 })
  assert.deepEqual(r, { tiers: [{ min_cost: 0, max_cost: null, method: 'markup', pct: 20, category: '' }], round_to: 'none', minimum_price: 0 })
  assert.deepEqual(normalizeRules(undefined), { tiers: [], round_to: 'none', minimum_price: 0 })
})

test('re-pricing is previewed part by part and changes nothing', () => {
  const rules = normalizeRules({ tiers: [{ min_cost: 0, max_cost: null, method: 'markup', pct: 100 }], round_to: 'none' })
  const parts = [P1, P2, part({ id: 'x', name: 'No cost', cost: null }), part({ id: 'y', name: 'Already right', cost: 5, retail_price: 10 })]
  const before = JSON.stringify(parts)
  const changes = previewReprice(parts, rules)
  assert.deepEqual(changes.map(c => [c.part.id, c.from, c.to, c.change]), [['p1', 80, 70, -10], ['p2', 12, 10, -2]])
  assert.deepEqual(previewReprice(parts, rules, { onlyRaise: true }), [])
  assert.equal(changes[0].marginFrom, 56.3); assert.equal(changes[0].marginTo, 50)
  assert.equal(JSON.stringify(parts), before)
})

test('history reads as a sentence', () => {
  const h = { id: '1', part_id: 'p1', at: '2026-10-05T10:00:00Z', actor: 'Sam', field: 'qty_on_hand', before: 6, after: 4, reason: 'used', reference: 'INV-1001', note: '' }
  assert.equal(describeHistory(h), 'Sam changed on hand from 6 to 4 (used on a job, INV-1001).')
  assert.equal(describeHistory({ ...h, actor: '', field: 'cost', before: null, after: 7.5, reason: '', reference: '', note: 'new vendor' }), 'Someone changed cost from nothing to $7.50 (new vendor).')
  assert.ok(ADJUST_REASONS.length >= 6)
})

test('the files for the shop', () => {
  const v = valuationCsv(PARTS).trim().split('\r\n')
  assert.equal(v[0], 'Part number,Name,Brand,Category,Location,On hand,Cost,Price,Value at cost,Value at price,Vendor')
  assert.ok(v.includes('MO-301,Brake pads front,Acme,Brakes,,1,35.00,80.00,35.00,80.00,Fake Parts Supply'))
  assert.ok(v.some(l => l.includes('Mystery part') && l.includes(',-2,')), 'a negative count is shown as it is, not hidden')
  const r = reorderCsv(reorderSuggestions({ parts: [P2], extras: new Map(), vendors: VENDORS, prices: PRICES, usage: noUsage })).trim().split('\r\n')
  assert.equal(r[1], 'OF-100,Oil filter,Budget Parts Co,0,0,6,12,4.25,51.00,Out of stock')
  assert.equal(poCsv(sentPo()).trim().split('\r\n')[1], 'PO-0001,FP-MO301,Brake pads,4,38.00,0.00,152.00,0')
})

/* ---------- the bill that goes with a delivery ---------- */

test('what a delivery came to: only what arrived, at the order cost, plus any core charge on each', () => {
  const po = { lines: [
    { id: 'a', part_id: 'p1', description: 'Filter', sku: '', qty: 10, unit_cost: 4.5, core_charge: 0, qty_received: 0 },
    { id: 'b', part_id: 'p2', description: 'Alternator', sku: '', qty: 2, unit_cost: 88, core_charge: 25, qty_received: 0 },
  ] }
  assert.equal(receiptAmount(po, [{ lineId: 'a', qty: 10 }, { lineId: 'b', qty: 2 }]), 271)
  assert.equal(receiptAmount(po, [{ lineId: 'a', qty: 4 }]), 18, 'a short delivery is billed for what came')
  assert.equal(receiptAmount(po, [{ lineId: 'b', qty: 1 }]), 113, 'the core is added for each one that came')
  assert.equal(receiptAmount(po, [{ lineId: 'a', qty: 0 }, { lineId: 'zzz', qty: 5 }, { lineId: 'a', qty: -3 }]), 0, 'nothing, an unknown line or a negative never add up')
  assert.equal(receiptAmount(po, []), 0)
})

test('the bill reference is the order number, with the delivery number from the second one on', () => {
  assert.equal(billReference('PO-0007', 1), 'PO-0007')
  assert.equal(billReference('PO-0007', 2), 'PO-0007 delivery 2')
  assert.equal(billReference('PO-0007', 0), 'PO-0007')
})

test('the bill outcome is one plain sentence and never claims a bill that was not added', () => {
  assert.equal(billOutcomeWords(null), '')
  assert.match(billOutcomeWords({ state: 'added', amount: 271, paid: false, vendor: 'Keystone', reference: 'PO-0001' }), /bill from Keystone \(PO-0001\) for \$271\.00 was added to Accounting as unpaid/)
  assert.match(billOutcomeWords({ state: 'added', amount: 18.5, paid: true, vendor: 'Keystone', reference: 'PO-0001' }), /\$18\.50 was added to Accounting as paid/)
  assert.equal(billOutcomeWords({ state: 'failed', message: 'The delivery was checked in, but the bill was not added.' }), 'The delivery was checked in, but the bill was not added.')
})
