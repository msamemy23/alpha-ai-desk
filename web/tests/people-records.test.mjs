// Customers and vehicles: duplicate finding, the previewed and reversible merge, CSV import and export, the timeline,
// consent wording, VIN and NHTSA parsing, mileage and service history. Run for real, with in-memory fakes. Nothing here
// touches a network or a database.
process.env.TZ = 'America/Chicago'

import test from 'node:test'
import assert from 'node:assert/strict'
import * as dup from '../src/lib/customers/duplicates.ts'
import * as mg from '../src/lib/customers/merge.ts'
import * as imp from '../src/lib/customers/import.ts'
import * as tl from '../src/lib/customers/timeline.ts'
import * as cons from '../src/lib/customers/consent.ts'
import * as seg from '../src/lib/customers/segments.ts'
import * as stats from '../src/lib/customers/stats.ts'
import * as exp from '../src/lib/customers/export.ts'
import * as csv from '../src/lib/csv.ts'
import * as vin from '../src/lib/vehicles/vin.ts'
import * as nh from '../src/lib/vehicles/nhtsa.ts'
import * as mi from '../src/lib/vehicles/mileage.ts'
import * as rec from '../src/lib/vehicles/records.ts'
import * as hist from '../src/lib/vehicles/history.ts'
import * as pin from '../src/lib/pin.ts'
import { isMissingDbObject } from '../src/lib/db-missing.ts'

/* ---------- duplicates ---------- */

const book = [
  { id: 'a', name: 'Dana Fox', phone: '(713) 555-0142', email: 'dana@example.com', vehicle_vin: '', vehicle_plate: '' },
  { id: 'b', name: 'Dana  Fox ', phone: '+1 713 555 0142', email: '', vehicle_vin: '', vehicle_plate: '' },
  { id: 'c', name: 'Lee Park', phone: '', email: 'DANA@example.com', vehicle_vin: '', vehicle_plate: '' },
  { id: 'd', name: 'Fox, Dana', phone: '281-555-0100', email: '', vehicle_vin: '', vehicle_plate: '' },
  { id: 'e', name: 'Sam Ortiz', phone: '5555555555', email: '', vehicle_vin: '', vehicle_plate: '' },
  { id: 'f', name: 'Pat Kim', phone: '5555555555', email: '', vehicle_vin: '', vehicle_plate: '' },
]

test('the same phone, email or name is found, strongest first', () => {
  const pairs = dup.findDuplicatePairs(book)
  const key = p => `${p.a}${p.b}`
  const ab = pairs.find(p => key(p) === 'ab')
  assert.deepEqual(ab.reasons, ['phone', 'name'])
  assert.equal(ab.strength, 'strong')
  const ac = pairs.find(p => key(p) === 'ac')
  assert.deepEqual(ac.reasons, ['email'])
  assert.equal(ac.strength, 'strong')
  const ad = pairs.find(p => key(p) === 'ad')
  assert.deepEqual(ad.reasons, ['name']) // "Fox, Dana" is read as "Dana Fox"
  assert.equal(ad.strength, 'possible')
  assert.equal(pairs[0].strength, 'strong')
})

test('a placeholder phone number does not link strangers', () => {
  const pairs = dup.findDuplicatePairs(book)
  assert.equal(pairs.some(p => (p.a === 'e' && p.b === 'f')), false)
  assert.equal(dup.phoneKey('5555555555'), '')
  assert.equal(dup.phoneKey('1234567890'), '')
  assert.equal(dup.phoneKey('(713) 555-0142'), '7135550142')
  assert.equal(dup.phoneKey('17135550142'), '7135550142')
  assert.equal(dup.phoneKey('555-0142'), '')
})

test('a value shared by a crowd is ignored, and generic names never match', () => {
  const crowd = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, name: `Person ${i}`, phone: '7135550199', email: '' }))
  assert.equal(dup.findDuplicatePairs(crowd).length, 0)
  const walkins = [{ id: '1', name: 'Walk-in' }, { id: '2', name: 'walk-in' }, { id: '3', name: 'Cash' }, { id: '4', name: 'cash' }]
  assert.equal(dup.findDuplicatePairs(walkins).length, 0)
  assert.equal(dup.nameKey('Smith, John Jr.'), 'john smith')
  assert.equal(dup.nameKey('Al'), '')
})

test('the same name on the same car is strong; the same VIN alone is only possible', () => {
  const cars = [
    { id: '1', name: 'Rita Cole', vehicle_vin: '1HGCM82633A004352' },
    { id: '2', name: 'Rita Cole', vehicle_vin: '1HGCM82633A004352' },
    { id: '3', name: 'New Owner', vehicle_vin: '1HGCM82633A004352' },
  ]
  const pairs = dup.findDuplicatePairs(cars)
  assert.equal(pairs.find(p => p.a === '1' && p.b === '2').strength, 'strong')
  assert.equal(pairs.find(p => p.a === '1' && p.b === '3').strength, 'possible')
})

test('test-looking customers are labelled, never hidden or changed', () => {
  assert.ok(dup.looksLikeTest({ name: 'Test Customer' }))
  assert.ok(dup.looksLikeTest({ name: 'asdf' }))
  assert.ok(dup.looksLikeTest({ name: 'John Doe' }))
  assert.ok(dup.looksLikeTest({ name: 'Real Person', email: 'someone@example.com' }))
  assert.equal(dup.looksLikeTest({ name: 'Contessa Williams', email: 'contessa@shopmail.net' }), null)
  assert.equal(dup.looksLikeTest({ name: 'Tester Ramirez' }), 'The name looks like a test entry.')
})

/* ---------- merge ---------- */

function makeDb() {
  return {
    customers: new Map([
      ['A', { id: 'A', shop_id: 's1', name: 'Dana Fox', phone: '(713) 555-0142', email: '', address: '', notes: 'Likes texts', preferred_contact: 'Text', vehicle_year: '2017', vehicle_make: 'Toyota', vehicle_model: 'Camry', vehicle_vin: '', vehicle_plate: '', vehicle_mileage: '81000' }],
      ['B', { id: 'B', shop_id: 's1', name: 'Dana Fox', phone: '(713) 555-0142', email: 'dana@example.com', address: '12 Oak St', notes: 'Prefers mornings', preferred_contact: 'Call', vehicle_year: '2012', vehicle_make: 'Honda', vehicle_model: 'Civic', vehicle_vin: '', vehicle_plate: 'ABC123', vehicle_mileage: '140000' }],
    ]),
    documents: [
      { id: 'd1', shop_id: 's1', customer_id: 'B' }, { id: 'd2', shop_id: 's1', customer_id: 'A' }, { id: 'd3', shop_id: 's1', customer_id: 'B' },
      { id: 'dx', shop_id: 's2', customer_id: 'B' }, // another shop: must never be touched
    ],
    jobs: [{ id: 'j1', shop_id: 's1', customer_id: 'B' }],
    messages: [{ id: 'm1', shop_id: 's1', customer_id: 'B' }, { id: 'm2', shop_id: 's1', customer_id: null }],
    appointments: [{ id: 'p1', shop_id: 's1', customer_id: 'B' }],
    customer_meta: new Map(),
    vehicle_records: [],
    logs: [],
  }
}

function makeStore(db, opts = {}) {
  const shop = 's1'
  let repointCalls = 0
  const rows = spec => (spec.table === 'customer_meta' ? null : db[spec.table])
  return {
    async loadCustomer(id) { const r = db.customers.get(id); return r && r.shop_id === shop ? { ...r } : null },
    async refIds(spec, cid) { const t = rows(spec); if (!t) return null; return t.filter(r => r.customer_id === cid && r.shop_id === shop).map(r => r.id) },
    async repoint(spec, ids, from, to) {
      repointCalls += 1
      if (opts.failRepoint && opts.failRepoint(spec.table, repointCalls)) throw new Error('database said no')
      for (const r of rows(spec)) if (ids.includes(r.id) && r.customer_id === from && r.shop_id === shop) r.customer_id = to
    },
    async updateCustomer(id, patch) { Object.assign(db.customers.get(id), patch) },
    async deleteCustomer(id) { if (opts.failDelete) throw new Error('delete blocked'); db.customers.delete(id) },
    async insertCustomer(row) { if (db.customers.has(row.id)) throw new Error('already there'); db.customers.set(row.id, { ...row }) },
    async createLog(entry) { if (opts.failLog) throw new Error('no log table'); const id = `L${db.logs.length + 1}`; db.logs.push({ id, created_at: 'now', undone_at: null, ...structuredClone(entry) }); return id },
    async updateLog(id, patch) { Object.assign(db.logs.find(l => l.id === id), structuredClone(patch)) },
    async getLog(id) { const l = db.logs.find(x => x.id === id); return l ? structuredClone(l) : null },
    async foldMeta() { return undefined },
    async restoreMeta() {},
    async addCarriedVehicle(keepId, car) { if (opts.noRecords) return null; const id = `V${db.vehicle_records.length + 1}`; db.vehicle_records.push({ id, shop_id: shop, customer_id: keepId, ...car }); return id },
    async repointRecord(rid, from, to) { const r = db.vehicle_records.find(x => x.id === rid); if (r && r.customer_id === from) r.customer_id = to },
  }
}

async function preview(db, store, choices) {
  const keep = await store.loadCustomer('A')
  const other = await store.loadCustomer('B')
  const refs = await mg.collectRefs(store, 'B')
  return mg.planMerge({ keep, other, choices, refs, today: '2026-10-15' })
}

test('the merge preview says what moves, what fills in, and carries a different car over', async () => {
  const db = makeDb()
  const plan = await preview(db, makeStore(db))
  assert.deepEqual(plan.blocks, [])
  assert.equal(plan.totalMoves, 5) // 2 documents, 1 job, 1 message, 1 appointment (the other shop's document is not counted)
  assert.deepEqual(plan.moves.map(m => m.table), ['documents', 'jobs', 'appointments', 'messages'])
  assert.equal(plan.patch.email, 'dana@example.com') // the kept card had none
  assert.equal(plan.patch.address, '12 Oak St')
  assert.equal(plan.patch.phone, undefined) // same number
  assert.equal(plan.fields.find(f => f.field === 'preferred_contact').choice, true)
  assert.equal(plan.fields.find(f => f.field === 'preferred_contact').result, 'Text') // the kept card wins unless chosen
  assert.equal(plan.carry.model, 'Civic')
  assert.ok(plan.warnings.some(w => w.includes('different car')))
  assert.ok(plan.patch.notes.includes('Likes texts') && plan.patch.notes.includes('Prefers mornings'))
  assert.ok(plan.patch.notes.includes('2026-10-15'))
  assert.equal(plan.patch.vehicle_make, undefined) // one car is never written over another
})

test('choosing the other card for a field changes the result and keeps the value you did not pick in the notes', async () => {
  const db = makeDb()
  const plan = await preview(db, makeStore(db), { preferred_contact: 'other' })
  assert.equal(plan.patch.preferred_contact, 'Call')
  assert.ok(plan.patch.notes.includes('preferred contact Text'))
})

test('a merge is blocked for the same card or a missing card', () => {
  assert.ok(mg.planMerge({ keep: { id: 'A' }, other: { id: 'A' }, refs: {}, today: 'x' }).blocks.length > 0)
  assert.ok(mg.planMerge({ keep: { id: 'A' }, other: {}, refs: {}, today: 'x' }).blocks.length > 0)
})

test('the same car on both cards is filled in, not duplicated', () => {
  const plan = mg.planMerge({
    keep: { id: 'A', name: 'X', vehicle_make: 'Honda', vehicle_model: 'Civic', vehicle_year: '2012', vehicle_plate: '' },
    other: { id: 'B', name: 'X', vehicle_make: 'Honda', vehicle_model: 'Civic', vehicle_year: '2012', vehicle_plate: 'ABC123' }, refs: {}, today: 't',
  })
  assert.equal(plan.carry, null)
  assert.equal(plan.patch.vehicle_plate, 'ABC123')
})

test('a confirmed merge moves records by id, removes the old card last, and logs everything', async () => {
  const db = makeDb()
  const store = makeStore(db)
  const plan = await preview(db, store)
  const res = await mg.executeMerge(store, { keepId: 'A', removeId: 'B', expect: plan.fingerprint, today: '2026-10-15', actor: 'user-1' })
  assert.equal(res.ok, true)
  assert.equal(db.customers.has('B'), false)
  assert.deepEqual(db.documents.map(d => [d.id, d.customer_id]), [['d1', 'A'], ['d2', 'A'], ['d3', 'A'], ['dx', 'B']])
  assert.equal(db.jobs[0].customer_id, 'A')
  assert.equal(db.messages[1].customer_id, null)
  assert.equal(db.customers.get('A').email, 'dana@example.com')
  assert.equal(db.vehicle_records.length, 1)
  assert.equal(db.vehicle_records[0].customer_id, 'A')
  const log = db.logs[0]
  assert.equal(log.status, 'done')
  assert.equal(log.remove_snapshot.name, 'Dana Fox')
  assert.deepEqual(log.moved.documents.sort(), ['d1', 'd3'])
  assert.equal(log.created_by, 'user-1')
})

test('undo puts the old card back and moves exactly the same records back', async () => {
  const db = makeDb()
  const before = structuredClone(db.customers.get('B'))
  const keepBefore = structuredClone(db.customers.get('A'))
  const store = makeStore(db)
  const plan = await preview(db, store)
  const res = await mg.executeMerge(store, { keepId: 'A', removeId: 'B', expect: plan.fingerprint, today: '2026-10-15', actor: null })
  // After the merge a new invoice is written for the kept customer. It must stay with them.
  db.documents.push({ id: 'd9', shop_id: 's1', customer_id: 'A' })
  const undone = await mg.undoMerge(store, res.logId)
  assert.equal(undone.ok, true)
  assert.deepEqual(db.customers.get('B'), before)
  assert.deepEqual(db.documents.map(d => [d.id, d.customer_id]), [['d1', 'B'], ['d2', 'A'], ['d3', 'B'], ['dx', 'B'], ['d9', 'A']])
  assert.equal(db.jobs[0].customer_id, 'B')
  assert.equal(db.customers.get('A').email, keepBefore.email)
  assert.equal(db.customers.get('A').notes, keepBefore.notes)
  assert.equal(db.logs[0].status, 'undone')
  assert.equal((await mg.undoMerge(store, res.logId)).ok, false) // not twice
})

test('undo leaves alone a field the kept card was edited on after the merge', async () => {
  const db = makeDb()
  const store = makeStore(db)
  const plan = await preview(db, store)
  const res = await mg.executeMerge(store, { keepId: 'A', removeId: 'B', expect: plan.fingerprint, today: '2026-10-15', actor: null })
  db.customers.get('A').email = 'new-address@example.com'
  await mg.undoMerge(store, res.logId)
  assert.equal(db.customers.get('A').email, 'new-address@example.com')
  assert.equal(db.customers.get('A').address, '') // untouched since the merge, so put back
})

test('a failure part way puts everything back and keeps the old card', async () => {
  const db = makeDb()
  let failures = 1 // one hiccup on the repair orders, then the database is fine again
  const store = makeStore(db, { failRepoint: table => table === 'jobs' && failures-- > 0 })
  const plan = await preview(db, store)
  const before = JSON.stringify([db.documents, db.jobs, db.messages, db.appointments])
  const res = await mg.executeMerge(store, { keepId: 'A', removeId: 'B', expect: plan.fingerprint, today: '2026-10-15', actor: null })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'rolled_back')
  assert.equal(db.customers.has('B'), true)
  assert.equal(db.customers.get('A').email, '')
  assert.equal(JSON.stringify([db.documents, db.jobs, db.messages, db.appointments]), before)
  assert.equal(db.logs[0].status, 'undone')
})

test('if the database stays down the merge says so and Undo finishes the job later', async () => {
  const db = makeDb()
  let down = true
  const store = makeStore(db, { failRepoint: () => down })
  const plan = await preview(db, store)
  const res = await mg.executeMerge(store, { keepId: 'A', removeId: 'B', expect: plan.fingerprint, today: '2026-10-15', actor: null })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'stuck')
  assert.equal(db.customers.has('B'), true) // the old card is never removed until everything has moved
  assert.equal(db.logs[0].status, 'failed')
  down = false
  const undone = await mg.undoMerge(store, res.logId)
  assert.equal(undone.ok, true)
  assert.deepEqual(db.documents.map(d => d.customer_id), ['B', 'A', 'B', 'B'])
})

test('if the old card cannot be removed, everything is put back', async () => {
  const db = makeDb()
  const store = makeStore(db, { failDelete: true })
  const plan = await preview(db, store)
  const res = await mg.executeMerge(store, { keepId: 'A', removeId: 'B', expect: plan.fingerprint, today: '2026-10-15', actor: null })
  assert.equal(res.ok, false)
  assert.equal(db.customers.has('B'), true)
  assert.equal(db.documents.find(d => d.id === 'd1').customer_id, 'B')
  assert.equal(db.vehicle_records[0]?.customer_id === 'A' ? 'moved' : 'back', 'back')
})

test('with nowhere to write the merge record, nothing is touched', async () => {
  const db = makeDb()
  const store = makeStore(db, { failLog: true })
  const plan = await preview(db, store)
  const res = await mg.executeMerge(store, { keepId: 'A', removeId: 'B', expect: plan.fingerprint, today: '2026-10-15', actor: null })
  assert.equal(res.ok, false)
  assert.equal(db.customers.has('B'), true)
  assert.equal(db.documents.find(d => d.id === 'd1').customer_id, 'B')
})

test('a confirm only applies exactly what was previewed', async () => {
  const db = makeDb()
  const store = makeStore(db)
  const plan = await preview(db, store)
  db.documents.push({ id: 'd7', shop_id: 's1', customer_id: 'B' }) // a new invoice appeared after the preview
  const res = await mg.executeMerge(store, { keepId: 'A', removeId: 'B', expect: plan.fingerprint, today: '2026-10-15', actor: null })
  assert.equal(res.ok, false)
  assert.equal(res.code, 'changed')
  assert.equal(db.customers.has('B'), true)
  assert.equal(db.logs.length, 0)
})

test('missing tables are skipped and the same card cannot be merged into itself', async () => {
  const db = makeDb()
  delete db.appointments
  delete db.vehicle_records
  const store = makeStore(db, { noRecords: true })
  const plan = await preview(db, store)
  assert.equal(plan.moves.some(m => m.table === 'appointments'), false)
  assert.ok(plan.warnings.some(w => w.includes('Vehicle records are not set up')))
  const same = await mg.executeMerge(store, { keepId: 'A', removeId: 'A', expect: 'x', today: '2026-10-15', actor: null })
  assert.equal(same.ok, false)
  assert.equal(same.code, 'invalid')
})

/* ---------- import ---------- */

test('column headers from other systems are recognised', () => {
  const m = imp.detectMapping(['First Name', 'Last Name', 'Mobile Phone', 'E-mail', 'Street Address', 'City', 'State', 'Zip Code', 'Year', 'Make', 'Model', 'VIN', 'License Plate', 'Notes', 'Whatever'])
  assert.deepEqual([m.first_name, m.last_name, m.phone, m.email, m.address, m.city, m.state, m.zip], [0, 1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual([m.vehicle_year, m.vehicle_make, m.vehicle_model, m.vehicle_vin, m.vehicle_plate, m.notes], [8, 9, 10, 11, 12, 13])
  assert.equal(m.name, -1)
  assert.equal(imp.detectMapping(['Customer', 'Phone']).name, 0)
})

const NOW = Date.parse('2026-10-15T12:00:00Z')
const existing = [{ id: 'c1', name: 'Dana Fox', phone: '(713) 555-0142', email: 'dana@example.com' }]

function preview2(text, ex = existing) {
  const parsed = csv.parseCsv(text)
  const mapping = imp.detectMapping(parsed.rows[0])
  return imp.parseImport(parsed.rows, ex, { headerRow: true, mapping, today: NOW })
}

test('a preview sorts rows into new, duplicate and not importable, with a reason for each', () => {
  const p = preview2([
    'Name,Phone,Email,Year,VIN,Mileage',
    'ANA RIVERA,713.555.0188,ana@example.com,2019,1HGCM82633A004352,"84,210"',
    'Dana Fox,7135550142,,,,',
    ',7135550111,,,,',
    'Ana Rivera,713 555 0188,,,,',
    'Bo Chen,12,not-an-email,1850,SHORT,',
  ].join('\r\n'))
  assert.deepEqual(p.counts, { total: 5, new: 2, duplicate: 2, invalid: 1 })
  const [ana, dana, noName, again, bo] = p.rows
  assert.equal(ana.status, 'new')
  assert.equal(ana.values.name, 'Ana Rivera')
  assert.equal(ana.values.phone, '(713) 555-0188')
  assert.equal(ana.values.vehicle_mileage, '84210')
  assert.equal(dana.status, 'duplicate')
  assert.equal(dana.match.why, 'phone')
  assert.equal(noName.status, 'invalid')
  assert.ok(noName.problems[0].includes('No name'))
  assert.equal(again.status, 'duplicate')
  assert.equal(again.fileMatch, 2)
  assert.equal(bo.status, 'new')
  assert.equal(bo.values.email, '')
  assert.equal(bo.values.vehicle_year, '')
  assert.equal(bo.values.vehicle_vin, '')
  assert.equal(bo.warnings.length, 4)
  assert.equal(p.rows[0].line, 2)
})

test('first and last name columns are joined, and an address is built from its parts', () => {
  const p = preview2('First Name,Last Name,Address,City,State,Zip\r\nmarta,GOMEZ,5 Elm St,Katy,tx,77449')
  assert.equal(p.rows[0].values.name, 'Marta Gomez')
  assert.equal(p.rows[0].values.address, '5 Elm St, Katy, TX 77449')
})

test('the problems file lists every row that was not added, and is safe to open in a spreadsheet', () => {
  const p = preview2('Name,Phone\r\n=BAD(),7135550101\r\n,7135550102\r\nDana Fox,7135550142')
  const out = imp.importProblemsCsv(p.rows, new Set([2]))
  const rows = csv.parseCsv(out).rows
  assert.equal(rows.length, 3)
  assert.deepEqual(rows[0], ['Line', 'Name', 'Phone', 'Email', 'Result', 'Reason'])
  assert.equal(rows[1][4], 'Not added')
  assert.equal(rows[2][4], 'Skipped as a duplicate')
  assert.equal(imp.importProblemsCsv([{ line: 2, values: { name: '=HYPERLINK("x")', phone: '', email: '' }, status: 'invalid', problems: ['x'], warnings: [], match: null, fileMatch: null, tags: [] }], new Set()).includes(`'=HYPERLINK`), true)
})

test('the template has the headers the importer reads and one made-up row', () => {
  const t = csv.parseCsv(imp.importTemplateCsv())
  assert.equal(t.rows.length, 2)
  const p = imp.parseImport(t.rows, [], { headerRow: true, mapping: imp.detectMapping(t.rows[0]), today: NOW })
  assert.equal(p.counts.new, 1)
  assert.equal(imp.formatPhone('555-0100').warning.includes('area code'), true)
})

/* ---------- export ---------- */

test('the customer export has one row per customer and guards formulas', () => {
  const text = exp.customersCsv([{
    name: '=cmd|calc', phone: '(713) 555-0142', email: 'a@example.com', address: '1 Main, Houston', preferred_contact: 'Text', vehicle_year: '2017', vehicle_make: 'Toyota',
    vehicle_model: 'Camry', vehicle_vin: '', vehicle_plate: 'ABC123', vehicle_mileage: '81000', notes: 'Line one\nLine two', created_at: '2026-01-05T15:00:00Z',
    tags: ['fleet', 'vip'], textStatus: 'Can text', visits: 3, lastVisit: '2026-09-30T15:00:00Z', lifetime: 1234.5, owed: 0,
  }])
  const rows = csv.parseCsv(text).rows
  assert.equal(rows[0].length, exp.EXPORT_HEADERS.length)
  assert.equal(rows[1][0], '=cmd|calc') // the guard quote is removed again on read
  assert.ok(text.includes("'=cmd|calc"))
  assert.equal(rows[1][11], 'fleet; vip')
  assert.equal(rows[1][15], '1234.50')
  assert.equal(rows[1][18], 'Line one\nLine two')
  assert.equal(exp.exportFileName('2026-10-15'), 'customers-2026-10-15.csv')
})

/* ---------- timeline, consent, segments, stats ---------- */

test('the timeline puts everything in one list, newest first, with a link for each', () => {
  const items = tl.buildTimeline({
    docs: [{ id: 'd1', type: 'Invoice', status: 'Unpaid', number: 'INV-1001', at: '2026-10-01T15:00:00Z', total: 480, balance: 480 }, { id: 'd0', type: 'Estimate', status: 'Approved', number: 'EST-1000', at: '2026-09-20T15:00:00Z', total: 450, balance: 0 }],
    jobs: [{ id: 'j1', ro: 'RO-1042', concern: 'Brake noise', status: 'In progress', at: '2026-09-28T15:00:00Z', car: '2017 Toyota Camry' }],
    appointments: [{ id: 'p1', at: '2026-10-10T15:00:00Z', service: 'Oil change', status: 'Scheduled' }],
    messages: [{ id: 'm1', at: '2026-10-02T15:00:00Z', direction: 'inbound', body: 'Is it ready?' }],
    calls: [{ id: 'c1', at: '2026-10-03T15:00:00Z', direction: 'inbound', seconds: 0, status: 'no-answer' }, { id: 'c2', at: '2026-10-04T15:00:00Z', direction: 'outbound', seconds: 125, status: 'completed' }],
    inspections: [{ id: 'i1', at: '2026-09-28T16:00:00Z', title: 'Multi-point inspection', status: 'Complete' }],
    notes: [{ id: 'n1', at: '2026-10-05T15:00:00Z', body: 'Pays by check', author: 'Sam', pinned: true }],
  })
  assert.equal(items.length, 9)
  assert.deepEqual(items.map(i => i.id).slice(0, 3), ['appt:p1', 'note:n1', 'call:c2'])
  assert.equal(items.find(i => i.id === 'doc:d1').tone, 'bad')
  assert.equal(items.find(i => i.id === 'doc:d1').href, '/invoices?document=d1')
  assert.equal(items.find(i => i.id === 'doc:d0').href, '/estimates?document=d0')
  assert.equal(items.find(i => i.id === 'call:c1').kind, 'call_missed')
  assert.equal(items.find(i => i.id === 'call:c2').detail, '2 min')
  assert.equal(items.find(i => i.id === 'note:n1').group, 'notes')
  assert.equal(tl.monthHeading('2026-10-02T15:00:00Z'), 'October 2026')
  assert.equal(tl.monthHeading('junk'), 'Undated')
})

test('contact permission is stated plainly and a failed check is never shown as OK', () => {
  const base = { phone: '7135550142', email: 'a@example.com', cardOptedOut: false, record: null }
  assert.equal(cons.consentView(base).text.state, 'ok')
  const stopped = cons.consentView({ ...base, record: { optedOut: true, source: 'inbound_stop', updatedAt: '2026-03-03T15:00:00Z' } })
  assert.equal(stopped.text.state, 'blocked')
  assert.ok(stopped.text.detail.includes('replied STOP'))
  assert.equal(cons.canText(stopped), false)
  assert.equal(cons.consentView({ ...base, record: undefined }).text.state, 'unknown')
  assert.equal(cons.canText(cons.consentView({ ...base, record: undefined })), false)
  assert.equal(cons.consentView({ ...base, cardOptedOut: true, record: undefined }).text.state, 'blocked')
  assert.equal(cons.consentView({ ...base, phone: '' }).text.state, 'missing')
  const prefs = cons.consentView({ ...base, prefs: { doNotCall: true, doNotEmail: true, doNotText: false, bestTime: 'after 5', channel: 'text' } })
  assert.equal(prefs.call.state, 'blocked')
  assert.equal(prefs.email.state, 'blocked')
  assert.equal(prefs.text.state, 'ok')
  assert.equal(cons.consentView({ ...base, prefs: { doNotCall: false, doNotEmail: false, doNotText: true, bestTime: '', channel: '' } }).text.state, 'blocked')
})

test('customer groups use plain rules and the top group needs enough payers', () => {
  const NOWMS = Date.parse('2026-10-15T12:00:00Z')
  const c = o => ({ createdAt: '2020-01-01', visits: 1, lastVisit: '2026-10-01', owed: 0, spend: 0, hasPhone: true, optedOut: false, tags: [], accountId: '', looksTest: false, ...o })
  assert.equal(seg.inSegment('new', c({ createdAt: '2026-09-01' }), NOWMS, Infinity), true)
  assert.equal(seg.inSegment('new', c({ createdAt: '2026-06-01' }), NOWMS, Infinity), false)
  assert.equal(seg.inSegment('repeat', c({ visits: 2 }), NOWMS, Infinity), true)
  assert.equal(seg.inSegment('lapsed', c({ lastVisit: '2026-02-01' }), NOWMS, Infinity), true)
  assert.equal(seg.inSegment('lapsed', c({ lastVisit: '' }), NOWMS, Infinity), false)
  assert.equal(seg.inSegment('owes', c({ owed: 12 }), NOWMS, Infinity), true)
  assert.equal(seg.inSegment('fleet', c({ tags: ['Fleet'] }), NOWMS, Infinity), true)
  assert.equal(seg.inSegment('fleet', c({ accountId: 'acct' }), NOWMS, Infinity), true)
  assert.equal(seg.inSegment('no_phone', c({ hasPhone: false }), NOWMS, Infinity), true)
  assert.equal(seg.topSpendCut([100, 200, 300]), Infinity)
  const spends = Array.from({ length: 20 }, (_, i) => (i + 1) * 100)
  const cut = seg.topSpendCut(spends)
  assert.equal(spends.filter(s => s >= cut).length, 2)
  assert.equal(seg.inSegment('top', c({ spend: 2000 }), NOWMS, cut), true)
  assert.equal(seg.inSegment('top', c({ spend: 0 }), NOWMS, 0), false)
})

test('tags are cleaned up', () => {
  assert.deepEqual(seg.cleanTags([' Fleet ', 'fleet', 'VIP,gold', '', 'x'.repeat(40)]), ['Fleet', 'VIP gold', 'x'.repeat(24)])
  assert.deepEqual(seg.cleanTags('a, b ,a'), ['a', 'b'])
  assert.deepEqual(seg.cleanTags(null), [])
  assert.equal(seg.cleanTags(Array.from({ length: 30 }, (_, i) => `t${i}`)).length, 12)
})

test('customer stats use the same owed and paid sums as the rest of the app', () => {
  const NOWMS = Date.parse('2026-10-15T12:00:00Z')
  const s = stats.customerStats(
    [
      { id: '1', type: 'Invoice', status: 'Paid', date: '2026-08-01T00:00:00Z', total: 500, paid: 500 },
      { id: '2', type: 'Invoice', status: 'Partial', date: '2026-10-01T00:00:00Z', total: 300, paid: 100 },
      { id: '3', type: 'Estimate', status: 'Sent', date: '2026-10-10T00:00:00Z', total: 900, paid: 0 },
      { id: '4', type: 'Invoice', status: 'Void', date: '2026-10-11T00:00:00Z', total: 999, paid: 0 },
    ],
    [{ id: 'j1', created: '2026-09-01T00:00:00Z', status: 'Complete' }, { id: 'j2', created: '2026-10-01T00:00:00Z', status: 'Complete' }],
    NOWMS, '2025-01-01T00:00:00Z',
  )
  assert.equal(s.lifetime, 600)
  assert.equal(s.billed, 800)
  assert.equal(s.owed, 200)
  assert.equal(s.visits, 2)
  assert.equal(s.averageTicket, 400)
  assert.equal(s.lastVisit, '2026-10-01T00:00:00Z')
  assert.equal(s.daysSince, 14)
  assert.deepEqual(s.openEstimates, { count: 1, total: 900 })
  assert.equal(s.firstSeen, '2025-01-01T00:00:00Z')
  const none = stats.customerStats([], [], NOWMS)
  assert.equal(none.daysSince, null)
  assert.equal(none.averageTicket, null)
})

/* ---------- VIN ---------- */

test('a VIN is cleaned, checked and read for its model year', () => {
  assert.equal(vin.cleanVin(' 1hgcm8-2633a 004352 '), '1HGCM82633A004352')
  assert.equal(vin.cleanVin('1HGCM82633AO04352'), '1HGCM82633A004352') // letter O is read as zero
  assert.equal(vin.vinState('1HGCM82633A004352'), 'valid')
  assert.equal(vin.vinState('1HGCM82633A004353'), 'check_digit')
  assert.equal(vin.vinState('1HGCM82633'), 'short')
  assert.equal(vin.vinState('1HGCM82633A0043521'), 'long')
  assert.equal(vin.vinState(''), 'empty')
  assert.equal(vin.modelYearHint('1HGCM82633A004352', 2026), 2003)
  assert.equal(vin.modelYearHint('1HGCM826X3A004352'.replace('X3A', '3HA'), 2026) !== null, true)
  assert.equal(vin.modelYearHint('short'), null)
  assert.equal(vin.cleanPlate(' abc-123 '), 'ABC123')
  assert.equal(vin.vinTail('1HGCM82633A004352'), '004352')
  assert.ok(vin.vinMessage('check_digit').includes('check digit'))
})

/* ---------- NHTSA ---------- */

const VPIC_OK = {
  Count: 1, Message: 'Results returned successfully',
  Results: [{
    Make: 'TOYOTA', Model: 'Camry', ModelYear: '2017', Trim: 'SE', BodyClass: 'Sedan/Saloon', DriveType: 'FWD', FuelTypePrimary: 'Gasoline',
    DisplacementL: '2.5', EngineCylinders: '4', EngineHP: '178', TransmissionStyle: 'Automatic', VehicleType: 'PASSENGER CAR', PlantCity: 'GEORGETOWN', PlantCountry: 'UNITED STATES (USA)',
    ErrorCode: '0', ErrorText: '0 - VIN decoded clean. Check Digit (9th position) is correct',
  }],
}

test('a vPIC answer becomes the fields a shop uses', () => {
  const r = nh.parseDecode(VPIC_OK, '4T1BF1FK5HU000001')
  assert.equal(r.ok, true)
  assert.deepEqual(r.notes, [])
  assert.equal(r.vehicle.make, 'Toyota')
  assert.equal(r.vehicle.model, 'Camry')
  assert.equal(r.vehicle.year, '2017')
  assert.equal(r.vehicle.engine, '2.5L 4-cylinder 178 hp')
  assert.equal(r.vehicle.trim, 'SE')
  assert.equal(r.vehicle.plant, 'Georgetown, United States')
  assert.equal(nh.makeName('BMW'), 'BMW')
  assert.equal(nh.makeName('MERCEDES-BENZ'), 'Mercedes-Benz')
  assert.equal(nh.makeName('Ford'), 'Ford')
})

test('a vPIC answer with problems says so, and one with no car is not a result', () => {
  const warn = nh.parseDecode({ Results: [{ ...VPIC_OK.Results[0], ErrorCode: '1', ErrorText: '1 - Check Digit (9th position) does not calculate properly; 6 - Incomplete VIN' }] }, 'X')
  assert.equal(warn.ok, true)
  assert.equal(warn.notes.length, 2)
  assert.equal(warn.notes[0], 'Check Digit (9th position) does not calculate properly.')
  const none = nh.parseDecode({ Results: [{ Make: '', Model: '', ErrorCode: '7', ErrorText: '7 - Manufacturer is not registered' }] }, 'X')
  assert.equal(none.ok, false)
  assert.equal(none.reason, 'not_found')
  assert.equal(nh.parseDecode(null, 'X').ok, false)
  assert.equal(nh.parseDecode({ Results: [] }, 'X').ok, false)
  assert.equal(nh.parseDecode({ Results: [{ ...VPIC_OK.Results[0], Trim: 'Not Applicable', Series: '' }] }, 'X').vehicle.trim, '')
})

test('lookups only go to the two NHTSA hosts over https', () => {
  assert.equal(nh.isAllowedUrl('https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/X?format=json'), true)
  assert.equal(nh.isAllowedUrl('https://api.nhtsa.gov/recalls/recallsByVehicle?make=a'), true)
  assert.equal(nh.isAllowedUrl('http://vpic.nhtsa.dot.gov/x'), false)
  assert.equal(nh.isAllowedUrl('https://evil.example.com/x'), false)
  assert.equal(nh.isAllowedUrl('https://vpic.nhtsa.dot.gov.evil.example.com/x'), false)
  assert.equal(nh.isAllowedUrl('https://user:pw@vpic.nhtsa.dot.gov/x'), false)
  assert.equal(nh.isAllowedUrl('https://vpic.nhtsa.dot.gov:8443/x'), false)
  assert.equal(nh.isAllowedUrl('not a url'), false)
})

test('the decode request carries the VIN and nothing else', () => {
  const url = nh.decodeUrl('4T1BF1FK5HU000001', 2017)
  assert.equal(url, 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/4T1BF1FK5HU000001?format=json&modelyear=2017')
  assert.equal(nh.decodeUrl('4T1BF1FK5HU000001', 'junk').includes('modelyear'), false)
})

const stubFetch = (body, over = {}) => async (url, init) => {
  stubFetch.calls.push({ url, init })
  return { ok: over.ok ?? true, status: over.status ?? 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) }
}
stubFetch.calls = []

test('decoding a VIN end to end with a stub fetch', async () => {
  stubFetch.calls.length = 0
  const r = await nh.decodeVin('4t1bf1fk5hu000001', stubFetch(VPIC_OK))
  assert.equal(r.ok, true)
  assert.equal(r.vehicle.vin, '4T1BF1FK5HU000001')
  assert.equal(stubFetch.calls.length, 1)
  assert.equal(stubFetch.calls[0].init.redirect, 'error')
  assert.equal(stubFetch.calls[0].init.method, 'GET')
  assert.equal(stubFetch.calls[0].init.body, undefined)
  const bad = await nh.decodeVin('SHORT', stubFetch(VPIC_OK))
  assert.equal(bad.reason, 'bad_vin')
})

test('lookup failures come back as reasons, never as thrown errors', async () => {
  assert.equal((await nh.getJson('https://vpic.nhtsa.dot.gov/x', stubFetch({}, { ok: false, status: 503 }))).reason, 'status')
  assert.equal((await nh.getJson('https://vpic.nhtsa.dot.gov/x', stubFetch('not json'))).reason, 'bad_json')
  assert.equal((await nh.getJson('https://vpic.nhtsa.dot.gov/x', stubFetch('x'.repeat(nh.MAX_BODY_BYTES + 1)))).reason, 'too_large')
  assert.equal((await nh.getJson('https://vpic.nhtsa.dot.gov/x', async () => { throw new Error('boom') })).reason, 'network')
  assert.equal((await nh.getJson('https://elsewhere.example.com/x', stubFetch({}))).reason, 'blocked')
  const slow = (_url, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
  assert.equal((await nh.getJson('https://vpic.nhtsa.dot.gov/x', slow, 20)).reason, 'timeout')
  assert.ok(nh.failureText('timeout').includes('too long'))
})

const RECALLS = {
  Count: 3,
  results: [
    { NHTSACampaignNumber: '18V123000', Manufacturer: 'Toyota Motor North America, Inc.', Component: 'FUEL SYSTEM, GASOLINE', Summary: 'Fuel pump may fail.', Consequence: 'Engine stall.', Remedy: 'Dealers will replace the pump.', ReportReceivedDate: '13/04/2018', parkIt: false, parkOutSide: false, overTheAirUpdate: false },
    { NHTSACampaignNumber: '20V999000', Component: 'AIR BAGS', Summary: 'Inflator may rupture.', Consequence: 'Injury.', Remedy: 'Replace inflator.', ReportReceivedDate: '02/11/2020', parkIt: true, parkOutSide: true },
    { NHTSACampaignNumber: '18V123000', Component: 'duplicate row' },
  ],
}

test('recalls are cleaned, dated, de-duplicated and put in order with do-not-drive first', () => {
  const list = nh.parseRecalls(RECALLS)
  assert.equal(list.length, 2)
  assert.equal(list[0].campaign, '20V999000')
  assert.equal(list[0].parkIt, true)
  assert.equal(list[1].reported, '2018-04-13')
  assert.equal(nh.recallDate('31/12/2019'), '2019-12-31')
  assert.equal(nh.recallDate('2019-12-31T00:00:00'), '2019-12-31')
  assert.equal(nh.recallDate('99/99/2019'), '')
  assert.deepEqual(nh.parseRecalls(null), [])
  assert.deepEqual(nh.parseRecalls({ results: 'x' }), [])
})

test('the recall lookup sends the year, make and model only and refuses bad input', async () => {
  stubFetch.calls.length = 0
  const r = await nh.recallsFor({ year: '2017', make: 'Toyota', model: 'Camry' }, stubFetch(RECALLS))
  assert.equal(r.ok, true)
  assert.equal(r.recalls.length, 2)
  assert.equal(stubFetch.calls[0].url, 'https://api.nhtsa.gov/recalls/recallsByVehicle?make=Toyota&model=Camry&modelYear=2017')
  assert.equal((await nh.recallsFor({ year: '17', make: 'Toyota', model: 'Camry' }, stubFetch(RECALLS))).reason, 'bad_input')
  assert.equal((await nh.recallsFor({ year: '2017', make: '', model: 'Camry' }, stubFetch(RECALLS))).reason, 'bad_input')
  const odd = nh.recallsUrl({ year: 2017, make: 'A&B', model: 'C D' })
  assert.ok(odd.includes('make=A%26B') && odd.includes('model=C%20D'))
})

/* ---------- mileage ---------- */

const R = (id, at, miles, source = 'logged') => ({ id, at, miles, source, label: id, note: '' })

test('mileage readings are listed newest first with the last known mileage', () => {
  const s = mi.summarizeMileage([R('a', '2025-01-10', 60000), R('b', '2025-07-10', 67000), R('c', '2026-01-10', 74000)])
  assert.deepEqual(s.rows.map(r => r.id), ['c', 'b', 'a'])
  assert.equal(s.lastKnown.miles, 74000)
  assert.equal(s.flagged, 0)
  assert.equal(s.milesPerYear, 14000)
})

test('a lower or jumping reading is flagged and does not become the last known mileage', () => {
  const low = mi.summarizeMileage([R('a', '2025-01-10', 60000), R('b', '2025-03-10', 6100), R('c', '2025-06-10', 65000)])
  assert.equal(low.rows.find(r => r.id === 'b').lower, true)
  assert.equal(low.lastKnown.miles, 65000)
  const jump = mi.summarizeMileage([R('a', '2025-01-10', 60000), R('b', '2025-03-10', 190000), R('c', '2025-06-10', 65000)])
  assert.equal(jump.rows.find(r => r.id === 'b').jump, true)
  assert.equal(jump.rows.find(r => r.id === 'c').lower, false) // compared with the last believable reading, not the typo
  assert.equal(jump.lastKnown.miles, 65000)
  assert.equal(jump.flagged, 1)
})

test('miles per year needs readings three months apart', () => {
  assert.equal(mi.summarizeMileage([R('a', '2026-01-10', 60000), R('b', '2026-02-10', 61000)]).milesPerYear, null)
  assert.equal(mi.summarizeMileage([]).lastKnown, null)
  const undated = mi.summarizeMileage([R('a', '', 5000)])
  assert.equal(undated.lastKnown.miles, 5000)
})

test('a new reading is checked before it is saved', () => {
  assert.equal(mi.parseMiles('84,210 mi'), 84210)
  assert.equal(mi.parseMiles('0'), null)
  assert.equal(mi.parseMiles('abc'), null)
  assert.equal(mi.parseMiles('99999999'), null)
  assert.equal(mi.checkReading('abc', 1000).ok, false)
  assert.equal(mi.checkReading(70000, 60000).warning, '')
  assert.ok(mi.checkReading(50000, 60000).warning.includes('lower'))
  assert.ok(mi.checkReading(200000, 60000).warning.includes('more than'))
  assert.equal(mi.checkReading(5, null).ok, true)
})

/* ---------- vehicle records and history ---------- */

const car = (o = {}) => ({ key: 'k', year: '2017', make: 'Toyota', model: 'Camry', color: '', vin: '', plate: '', mileage: null, ownerId: 'c1', owner: 'Dana Fox', lastIn: '', jobs: [], ...o })
const record = (o = {}) => rec.normalizeRecord({ id: 'r1', customer_id: 'c1', year: '2017', make: 'Toyota', model: 'Camry', vin: '', created_at: '2026-01-01', ...o })

test('a saved record joins a car by VIN or by owner and model', () => {
  const owners = new Map([['c1', 'Dana Fox']])
  const byOwner = rec.attachRecords([car()], [record()], owners)
  assert.equal(byOwner.length, 1)
  assert.equal(byOwner[0].record.id, 'r1')
  const byVin = rec.attachRecords([car({ vin: '4T1BF1FK5HU000001', model: 'Camry LE' })], [record({ vin: '4t1bf1fk5hu000001', model: 'Camry' })], owners)
  assert.equal(byVin.length, 1)
  assert.equal(byVin[0].record.id, 'r1')
  const other = rec.attachRecords([car({ ownerId: 'c2', owner: 'Lee Park' })], [record()], owners)
  assert.equal(other.length, 2)
  assert.equal(other[1].key, 'rec:r1')
  assert.equal(other[1].owner, 'Dana Fox')
})

test('a car added by hand shows up on its own, and a second record for the same car is folded in', () => {
  const owners = new Map([['c1', 'Dana Fox']])
  const added = rec.attachRecords([], [record({ id: 'r9', model: 'Corolla' })], owners)
  assert.equal(added.length, 1)
  assert.equal(added[0].model, 'Corolla')
  const twin = rec.attachRecords([car()], [record({ id: 'r1' }), record({ id: 'r2', created_at: '2026-02-01' })], owners)
  assert.equal(twin.length, 1)
  assert.equal(twin[0].record.id, 'r1')
  assert.equal(rec.matchKeys({ vin: '4T1BF1FK5HU000001', ownerId: 'c1', year: '2017', make: 'Toyota', model: 'Camry' }).own, 'own:c1|2017|toyota|camry')
})

test('service history lists repair orders with what they billed, plus loose invoices for the car', () => {
  const jobs = [
    { id: 'j1', ro: 'RO-1', concern: 'Brake noise', status: 'Complete', created: '2026-09-01T10:00:00Z', mileage: 80000 },
    { id: 'j2', ro: 'RO-2', concern: 'Oil change', status: 'In progress', created: '2026-10-01T10:00:00Z', mileage: 81000 },
  ]
  const d = o => ({ id: 'd', type: 'Invoice', status: 'Paid', number: 'INV-1', date: '2026-09-02T10:00:00Z', total: 480, paid: 480, jobId: 'j1', customerId: 'c1', vin: '', year: '2017', make: 'Toyota', model: 'Camry', ...o })
  const docs = [
    d({ id: 'd1' }),
    d({ id: 'd2', type: 'Estimate', status: 'Sent', jobId: 'j2', total: 90 }),
    d({ id: 'd3', jobId: '', number: 'INV-9', date: '2026-05-01T10:00:00Z', total: 120 }),
    d({ id: 'd4', jobId: '', customerId: 'someone-else', make: 'Honda', model: 'Civic' }),
    d({ id: 'd5', status: 'Void', jobId: 'j1' }),
  ]
  const items = hist.serviceHistory(jobs, docs, { vin: '', ownerId: 'c1', year: '2017', make: 'Toyota', model: 'Camry' })
  assert.deepEqual(items.map(i => i.id), ['job:j2', 'job:j1', 'doc:d3'])
  assert.equal(items[1].billed, 480)
  assert.equal(items[0].billed, null)
  assert.equal(items[0].estimate, 90)
  assert.equal(items[1].mileage, 80000)
  const t = hist.historyTotals(items)
  assert.deepEqual(t, { visits: 3, billed: 600, lastDate: '2026-10-01T10:00:00Z' })
})

/* ---------- PIN ---------- */

test('a PIN is checked, stored only as a salted hash and verified in constant time', () => {
  assert.equal(pin.validatePin('2468').ok, true)
  for (const bad of ['123', '123456789', '12ab', '1111', '1234', '4321', '', null, '0000'])
    assert.equal(pin.validatePin(bad).ok, false, String(bad))
  const h = pin.hashPin('2468')
  assert.ok(h.startsWith('s1$'))
  assert.equal(h.includes('2468'), false)
  assert.notEqual(pin.hashPin('2468'), h) // a new salt every time
  assert.equal(pin.verifyPin('2468', h), true)
  assert.equal(pin.verifyPin('2469', h), false)
  assert.equal(pin.verifyPin('2468', ''), false)
  assert.equal(pin.verifyPin('2468', 'garbage$x$y'), false)
})

test('five wrong PINs lock the person out for five minutes', () => {
  const now = 1_000_000
  let s = { failed: 0, lockedUntil: null }
  for (let i = 0; i < 4; i++) s = pin.afterWrongPin(s.failed, now)
  assert.deepEqual(s, { failed: 4, lockedUntil: null })
  s = pin.afterWrongPin(s.failed, now)
  assert.equal(s.lockedUntil, now + 5 * 60_000)
  assert.equal(pin.lockMinutesLeft(new Date(now + 3 * 60_000).toISOString(), now), 3)
  assert.equal(pin.lockMinutesLeft(new Date(now - 1).toISOString(), now), 0)
  assert.equal(pin.lockMinutesLeft(null, now), 0)
})

/* ---------- missing database objects ---------- */

test('a missing table or column is told apart from a real failure', () => {
  assert.equal(isMissingDbObject({ code: '42P01', message: 'relation "x" does not exist' }), true)
  assert.equal(isMissingDbObject({ code: '42703' }), true)
  assert.equal(isMissingDbObject({ code: 'PGRST205' }), true)
  assert.equal(isMissingDbObject({ message: 'Could not find the table \'public.x\' in the schema cache' }), true)
  assert.equal(isMissingDbObject({ code: '23505', message: 'duplicate key' }), false)
  assert.equal(isMissingDbObject({ code: '42501', message: 'permission denied' }), false)
  assert.equal(isMissingDbObject(null), false)
})
