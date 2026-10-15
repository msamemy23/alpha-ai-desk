import test from 'node:test'
import assert from 'node:assert/strict'
import * as l from '../src/lib/list-logic.ts'

test('typed money and counts: blanks stay blank, junk is not turned into zero', () => {
  assert.equal(l.parseMoney('12.50'), 12.5)
  assert.equal(l.parseMoney('$1,200'), 1200)
  assert.equal(l.parseMoney('0.99'), 0.99)
  assert.equal(l.parseMoney(''), null)
  assert.equal(l.parseMoney('.'), null)
  assert.equal(l.parseMoney('abc'), null)
  assert.equal(l.parseCount('7.9'), 7)
  assert.equal(l.parseCount(' '), null)
  assert.equal(l.roundCents(1.005 + 1.005), 2.01)
})

test('stock: out when empty, low at or under the reorder number, reorder 0 turns the warning off', () => {
  assert.equal(l.stockState(0, 5), 'out')
  assert.equal(l.stockState(0, 0), 'out')
  assert.equal(l.stockState(5, 5), 'low')
  assert.equal(l.stockState(6, 5), 'ok')
  assert.equal(l.stockState(2, 0), 'ok')
  assert.equal(l.stockState(null, undefined), 'out')
})

test('margin is the share of the price kept, not markup', () => {
  assert.deepEqual(l.marginOf(4.15, 9.99), { profit: 5.84, marginPct: 58.5 })
  assert.equal(l.marginLabel(50, 100), '50%')
  assert.equal(l.marginLabel(10, 8), '-25%')
  assert.equal(l.marginLabel('', 8), '')
  assert.equal(l.marginLabel(5, 0), '')
  assert.equal(l.marginLabel(0, 5), '')
  assert.equal(l.marginOf(5, 0).marginPct, null)
})

test('inventory sort puts out of stock first, then low, then the rest by name', () => {
  const parts = [
    { name: 'Wipers', qty_on_hand: 9, qty_reorder: 2 },
    { name: 'Coolant', qty_on_hand: 1, qty_reorder: 4 },
    { name: 'Brake pads', qty_on_hand: 0, qty_reorder: 4 },
    { name: 'Air filter', qty_on_hand: 8, qty_reorder: 2 },
  ]
  assert.deepEqual(l.sortInventory(parts, 'stock').map(p => p.name), ['Brake pads', 'Coolant', 'Air filter', 'Wipers'])
  assert.deepEqual(l.sortInventory(parts, 'name').map(p => p.name), ['Air filter', 'Brake pads', 'Coolant', 'Wipers'])
})

test('store results are matched to shelf stock by part number first, then by name', () => {
  const stock = [
    { id: 1, part_number: 'MO-301', name: 'Oil filter' },
    { id: 2, part_number: 'PH-3593', supplier_part_number: 'FR-PH3593', name: 'Oil filter' },
    { id: 3, part_number: '', name: 'Front brake pads' },
  ]
  assert.deepEqual(l.matchStock(stock, 'mo 301', 'Whatever').map(h => [h.part.id, h.why]), [[1, 'part number']])
  assert.deepEqual(l.matchStock(stock, 'frph3593', '').map(h => h.part.id), [2])
  assert.deepEqual(l.matchStock(stock, 'XX-1', 'Front brake pads ceramic').map(h => [h.part.id, h.why]), [[3, 'name']])
  assert.deepEqual(l.matchStock(stock, 'XX-1', 'Wiper'), [])
  assert.deepEqual(l.searchStock(stock, 'brake front').map(p => p.id), [3])
  assert.deepEqual(l.searchStock(stock, '   '), [])
  assert.deepEqual(l.searchStock(stock, 'the brake and fronts').map(p => p.id), [3])
})

test('canned job total: labor plus parts, blank qty counts as one', () => {
  assert.equal(l.cannedTotal(0.5, 125, [{ cost: 38, qty: 1 }, { cost: 8.49, qty: '' }]), 108.99)
  assert.equal(l.cannedTotal('', '', []), 0)
  assert.equal(l.sameCategory('Oil change', ' Oil Change '), true)
  assert.deepEqual(l.mergeCategories(['Oil Change', 'Brakes'], ['Oil change', 'Fleet', '', null]), ['Oil Change', 'Brakes', 'Fleet'])
})

test('duplicate customers: same phone or email is a match, a bare name is a hint, editing yourself is not', () => {
  const book = [
    { id: 'a', name: 'Walt Kowalski', phone: '(281) 555-0101', email: '' },
    { id: 'b', name: 'Dana Ortiz', phone: '2815550117', email: 'Dana@Example.com' },
  ]
  assert.deepEqual(l.findDuplicates(book, { phone: '+1 281 555 0101' }).map(h => [h.customer.id, h.why]), [['a', 'phone']])
  assert.deepEqual(l.findDuplicates(book, { email: 'dana@example.com' }).map(h => [h.customer.id, h.why]), [['b', 'email']])
  assert.deepEqual(l.findDuplicates(book, { name: 'walt  kowalski' }).map(h => [h.customer.id, h.why]), [['a', 'name']])
  assert.deepEqual(l.findDuplicates(book, { id: 'a', phone: '2815550101', name: 'Walt Kowalski' }), [])
  assert.deepEqual(l.findDuplicates(book, { phone: '555-0101' }), [])
})

test('contact checks only complain about what was typed', () => {
  assert.deepEqual(l.contactProblems('', ''), {})
  assert.ok(l.contactProblems('555', '').phone)
  assert.ok(l.contactProblems('', 'bob@').email)
  assert.deepEqual(l.contactProblems('(713) 555-0142', 'bob@shop.com'), {})
})

test('money owed counts sent invoices only, and never goes negative', () => {
  const docs = [
    { type: 'Invoice', status: 'Unpaid', total: 100, paid: 0 },
    { type: 'Invoice', status: 'Partial', total: 300, paid: 200 },
    { type: 'Invoice', status: 'Draft', total: 500, paid: 0 },
    { type: 'Invoice', status: 'Void', total: 500, paid: 0 },
    { type: 'Estimate', status: 'Sent', total: 900, paid: 0 },
    { type: 'Invoice', status: 'Paid', total: 80, paid: 80 },
  ]
  assert.equal(l.owedOn(docs), 200)
  assert.equal(l.paidOn(docs), 280)
})

test('vehicles: a customer record and a repair order for the same car are one car', () => {
  const customers = [
    { id: 'c1', name: 'Hector Villarreal', vehicle_year: '2019', vehicle_make: 'Ford', vehicle_model: 'F-250', vehicle_vin: '', vehicle_mileage: 112400 },
    { id: 'c2', name: 'Sam Reed', vehicle_year: '2019', vehicle_make: 'Ford', vehicle_model: 'F-250', vehicle_vin: '', vehicle_mileage: '90,000' },
    { id: 'c3', name: 'No Car' },
  ]
  const jobs = [
    { id: 'j1', customer_id: 'c1', customer_name: 'Hector Villarreal', ro_number: 'RO-1', vehicle_year: '2019', vehicle_make: 'ford', vehicle_model: 'F-250', vehicle_vin: '1FT7W2BT5KED12345', vehicle_plate: 'lkt9921', vehicle_mileage: '121,040', status: 'Approved', created_at: '2026-10-10T15:00:00Z' },
    { id: 'j2', customer_id: 'c1', customer_name: 'Hector Villarreal', ro_number: 'RO-0', vehicle_year: '2019', vehicle_make: 'Ford', vehicle_model: 'F-250', vehicle_vin: '', vehicle_mileage: '100,000', status: 'Paid', created_at: '2026-05-01T15:00:00Z' },
    { id: 'j3', customer_id: '', customer_name: 'Walk-in: Eddie', ro_number: 'RO-9', vehicle_make: 'Chevrolet', vehicle_model: 'Malibu', vehicle_year: '2012', created_at: '2026-10-01T15:00:00Z' },
  ]
  const v = l.buildVehicles(customers, jobs)
  assert.equal(v.length, 3)
  const truck = v.find(x => x.ownerId === 'c1')
  assert.equal(truck.vin, '1FT7W2BT5KED12345')
  assert.equal(truck.plate, 'LKT9921')
  assert.equal(truck.mileage, 121040)
  assert.deepEqual(truck.jobs.map(j => j.id), ['j1', 'j2'])
  assert.equal(truck.lastIn, '2026-10-10T15:00:00Z')
  assert.equal(truck.owner, 'Hector Villarreal')
  const other = v.find(x => x.ownerId === 'c2')
  assert.equal(other.mileage, 90000)
  assert.equal(other.jobs.length, 0)
  assert.equal(v.find(x => x.owner === 'Walk-in: Eddie').ownerId, '')
})

test('vehicles: the same VIN under two spellings of the owner is one car; sorting and search work', () => {
  const jobs = [
    { id: 'a', customer_id: 'c1', customer_name: 'A', vehicle_year: '2016', vehicle_make: 'BMW', vehicle_model: '328i', vehicle_vin: 'WBA8E9C58GK640212', created_at: '2026-01-01T00:00:00Z' },
    { id: 'b', customer_id: 'c1', customer_name: 'A', vehicle_year: '2016', vehicle_make: 'BMW', vehicle_model: '328i', vehicle_vin: 'wba8e9c58gk640212', created_at: '2026-02-01T00:00:00Z' },
    { id: 'c', customer_id: 'c2', customer_name: 'B', vehicle_year: '2020', vehicle_make: 'Audi', vehicle_model: 'A4', created_at: '2026-03-01T00:00:00Z' },
  ]
  const v = l.buildVehicles([], jobs)
  assert.equal(v.length, 2)
  assert.deepEqual(l.sortVehicles(v, 'recent').map(x => x.make), ['Audi', 'BMW'])
  assert.deepEqual(l.sortVehicles(v, 'car').map(x => x.make), ['BMW', 'Audi'])
  assert.deepEqual(l.sortVehicles(v, 'owner').map(x => x.owner), ['A', 'B'])
  assert.equal(l.matchesVehicle(v[0], 'bmw 328'), true)
  assert.equal(l.matchesVehicle(v[0], 'audi'), false)
  assert.equal(l.carName({ year: '', make: '', model: '' }), 'Unknown vehicle')
})

test('insurance claim figures', () => {
  const claim = { status: 'In Repair', approved_amount: 4820, deductible: 500, deductible_collected: false, supplement_status: 'Approved', supplement_amount_approved: 1000 }
  assert.equal(l.claimApprovedTotal(claim), 5820)
  assert.equal(l.owesDeductible(claim), true)
  assert.equal(l.owesDeductible({ ...claim, deductible_collected: true }), false)
  assert.equal(l.claimIsOpen({ status: 'Paid' }), false)
  assert.equal(l.hasSupplement({ supplement_status: 'None' }), false)
  assert.equal(l.supplementWaiting({ supplement_status: 'Requested' }), true)
  assert.equal(l.supplementWaiting({ supplement_status: 'Denied' }), false)
  const now = Date.parse('2026-10-14T12:00:00Z')
  assert.equal(l.openForLabel('2026-10-02T12:00:00Z', now), 'Open 12 days')
  assert.equal(l.openForLabel('2026-10-14T01:00:00Z', now), 'Opened today')
  assert.equal(l.openForLabel('', now), '')
})

test('dirty check ignores key order and undefined fields', () => {
  assert.equal(l.isDirty({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1, z: undefined }), false)
  assert.equal(l.isDirty({ a: 1 }, { a: 2 }), true)
  assert.equal(l.isDirty([{ x: 1 }], [{ x: 1 }]), false)
})

test('parts lookup helpers', () => {
  assert.equal(l.usd(1234.5), '$1,234.50')
  assert.equal(l.usd(undefined), '$0.00')
  assert.equal(l.tierLabel('mid'), 'Mid-grade')
  assert.equal(l.tierLabel('budget'), 'Budget')
  assert.equal(l.tierLabel(''), 'Option')
  assert.equal(l.lineTotal(45.99, 2), 91.98)
  assert.equal(l.lineTotal(10, 0), 10)
  assert.match(l.lookupErrorText(429, 'RATE_LIMITED', 'Too many'), /Wait a minute/)
  assert.match(l.lookupErrorText(401, 'UNAUTHORIZED', ''), /Sign in again/)
  assert.match(l.lookupErrorText(400, 'BAD_REQUEST', 'No AI provider is connected. Connect ChatGPT in Settings or add the shop AI key.'), /Connect ChatGPT/)
  assert.match(l.lookupErrorText(500, 'INTERNAL_ERROR', 'boom'), /Try again in a minute/)
  const opt = { tier: 'mid', brand: 'Akebono', parts: [{ position: 'Front', name: 'Ceramic pads', partNumber: 'ACT1210', price: 45.99, quantity: 2, url: 'https://x.test/p' }] }
  const withRate = l.estimatePrompt({ vehicle: '2016 Toyota Camry', query: 'brakes', laborHours: 1.5, laborRate: 125, option: opt })
  assert.match(withRate, /1\.5 hours at \$125\.00 per hour/)
  assert.match(withRate, /Akebono Mid-grade:/)
  assert.match(withRate, /\$45\.99 each, quantity 2/)
  const noRate = l.estimatePrompt({ vehicle: '', query: 'brakes', laborHours: 1.5, laborRate: null, option: opt })
  assert.doesNotMatch(noRate, /null|NaN|undefined/)
  assert.match(noRate, /Use the shop labor rate/)
})

test('repair order label: bare numbers get RO, numbers that already start with RO are left alone', () => {
  assert.equal(l.roLabel('1041'), 'RO 1041')
  assert.equal(l.roLabel('RO-2026-0043'), 'RO-2026-0043')
  assert.equal(l.roLabel('ro 55'), 'ro 55')
  assert.equal(l.roLabel('ROBERTS-9'), 'RO ROBERTS-9')
  assert.equal(l.roLabel(''), '')
  assert.equal(l.roLabel(null), '')
})
