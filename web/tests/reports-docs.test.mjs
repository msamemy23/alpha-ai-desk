import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateDocumentTotals, getLaborFlatAmount, laborLineTotal, partLineTotal, quantityFromUnknown, nonNegativeMoney } from '../src/lib/document-money.ts'
import { balanceFor, keyOf } from '../src/lib/reports.ts'
import { docFrom, dayOfStamp, isMissingSchemaError, vehicleKeyOf, DOC_COLUMNS, DOC_COLUMNS_EXTRA } from '../src/lib/report-docs.ts'
import { RAW, ALL_RAW } from './helpers-reports.mjs'

const str = v => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** The conversion the Reports screen used before this work, kept here word for word so the new one can be held to it. */
function oldDocFrom(raw) {
  const t = calculateDocumentTotals(raw)
  const labors = (Array.isArray(raw.labors) ? raw.labors : []).filter(l => !!l && typeof l === 'object')
  const parts = (Array.isArray(raw.parts) ? raw.parts : []).filter(l => !!l && typeof l === 'object')
  const ops = labors.map(l => ({ name: str(l.operation ?? l.description ?? l.name).trim(), amount: laborLineTotal(l) })).filter(o => o.name || o.amount > 0)
  const hours = labors.filter(l => str(l.tech).trim()).map(l => ({
    tech: str(l.tech).trim(),
    hours: getLaborFlatAmount(l) === null ? quantityFromUnknown(l.hours, 0) : 0,
    amount: laborLineTotal(l),
  }))
  const items = parts.map(p => ({ name: str(p.name).trim(), qty: quantityFromUnknown(p.qty, 1), amount: partLineTotal(p), cost: Math.round(nonNegativeMoney(p.cost) * quantityFromUnknown(p.qty, 1) * 100) / 100 })).filter(i => i.name)
  const status = str(raw.status)
  const day = v => { const s = str(v); if (!s) return ''; if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s; const d = new Date(s); return isNaN(d.getTime()) ? '' : keyOf(d) }
  return {
    id: str(raw.id), type: str(raw.type), number: str(raw.doc_number).trim(), status,
    date: day(raw.doc_date) || day(raw.created_at),
    customerId: raw.customer_id ? str(raw.customer_id) : null, customer: str(raw.customer_name).trim(),
    total: t.total, labor: t.laborTotal, parts: t.partsTotal, fees: Math.round((t.shopSupplies + t.sublet + t.coreTotal) * 100) / 100, tax: t.taxAmount,
    paid: t.amountPaid, balance: balanceFor(status, t.balanceDue), method: str(raw.payment_method),
    ops, items: items.map(i => ({ ...i })), hours,
  }
}

const MONEY_FIELDS = ['id', 'type', 'number', 'status', 'date', 'customerId', 'customer', 'total', 'labor', 'parts', 'fees', 'tax', 'paid', 'balance', 'method', 'ops', 'hours']

function assertSameNumbers(raw) {
  const a = oldDocFrom(raw), b = docFrom(raw)
  for (const k of MONEY_FIELDS) assert.deepEqual(b[k], a[k], `${raw.id}: ${k} differs`)
  assert.equal(b.items.length, a.items.length, `${raw.id}: item count`)
  b.items.forEach((it, i) => {
    assert.equal(it.name, a.items[i].name); assert.equal(it.qty, a.items[i].qty)
    assert.equal(it.amount, a.items[i].amount); assert.equal(it.cost, a.items[i].cost)
  })
}

test('docFrom gives the same money as the conversion the screen used before, on every fixture', () => {
  for (const raw of ALL_RAW) assertSameNumbers(raw)
})

test('docFrom gives the same money on old, partial and odd rows', () => {
  const odd = [
    {}, { id: 'x' }, { id: 'a', type: 'Invoice', parts: null, labors: null },
    { id: 'b', type: 'Invoice', parts: 'nope', labors: [null, 4, 'x', { operation: 'Flush', amount: '$1,200.50' }] },
    { id: 'c', type: 'Invoice', tax_rate: '0', parts: [{ name: 'Part', qty: '2', unitPrice: '3.335' }], labors: [{ operation: 'Job', hours: '1.25', rate: '88.88' }] },
    { id: 'd', type: 'Invoice', tax_rate: -4, apply_tax: false, shop_supplies: '12.345', sublet: 'abc', amount_paid: '9e2', parts: [{ name: 'X', qty: -1, unitPrice: 5 }] },
    { id: 'e', type: 'Receipt', status: ' PAID ', created_at: 'garbage', doc_date: '2026-13-45', parts: [{ name: '', qty: 3, unitPrice: 9 }], labors: [{ tech: 'Sam', hours: 3 }] },
    { id: 'f', type: 'Invoice', status: 'paid', created_at: '2026-03-08T02:30:00Z', parts: [{ name: 'Big', qty: 1, unitPrice: 99999999.99, core: 10 }], amount_paid: 5 },
  ]
  for (const raw of odd) assertSameNumbers(raw)
})

test('docFrom gives the same money on many generated rows', () => {
  let seed = 12345
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 }
  const pick = a => a[Math.floor(rnd() * a.length)]
  for (let i = 0; i < 400; i++) {
    const raw = {
      id: `g${i}`, type: pick(['Invoice', 'Receipt', 'Estimate']), status: pick(['Paid', 'Sent', 'Draft', 'Void', '', 'Approved']),
      doc_date: pick(['2026-01-15', '', '2025-12-31']), created_at: pick(['2026-02-01T10:00:00Z', '']),
      customer_id: pick([null, 'c1', 'c2']), customer_name: pick(['Ann', ' Bob  ', '', 'Walk-in']),
      tax_rate: pick([undefined, 0, 8.25, '6.25', 'x', 12.5]), apply_tax: pick([undefined, true, false]),
      shop_supplies: pick([undefined, 0, 7.5, '3']), sublet: pick([undefined, 0, 40]), amount_paid: pick([undefined, 0, 50, 1000.5, '12']),
      payment_method: pick([undefined, 'cash', 'Card', 'historical_import']),
      parts: Array.from({ length: Math.floor(rnd() * 4) }, () => ({ name: pick(['Pads', 'Oil', '']), qty: pick([undefined, 1, 2, '3', 0.5, -1]), unitPrice: pick([undefined, 9.99, '14.5', 100, 0.333]), taxable: pick([undefined, true, false]), cost: pick([undefined, 4, '2.5']), core: pick([undefined, 0, 15]) })),
      labors: Array.from({ length: Math.floor(rnd() * 4) }, () => ({ operation: pick(['Brakes', 'Oil change', '']), tech: pick(['', 'Sam', 'lee']), hours: pick([undefined, 1, 0.5, '2', 1.333]), rate: pick([undefined, 95, '110.5']), amount: pick([undefined, undefined, 60, '45.50']) })),
    }
    assertSameNumbers(raw)
  }
})

test('docFrom reads the extra fields and leaves them empty when the row has none', () => {
  const d = docFrom(RAW.brakes)
  assert.equal(d.advisor, 'Dana'); assert.equal(d.vehicle, '2017 Toyota Camry'); assert.equal(d.vehicleKey, 'vin:4T1BF1FK5HU000001')
  assert.equal(d.taxable, 210); assert.equal(d.taxRate, 8.25); assert.equal(d.supplies, 10); assert.equal(d.sublet, 0); assert.equal(d.core, 0)
  assert.equal(d.signatureRequestedAt, '2026-09-30'); assert.equal(d.signedAt, '2026-10-01'); assert.equal(d.jobId, 'j1')
  assert.deepEqual(d.lines, [{ name: 'Replace front brakes', hours: 2, amount: 200, tech: 'Sam', flat: false }])
  const old = docFrom(RAW.old)
  assert.equal(old.advisor, ''); assert.equal(old.vehicle, ''); assert.equal(old.vehicleKey, ''); assert.equal(old.signedAt, ''); assert.equal(old.jobId, null)
  assert.equal(old.date, '2026-08-15', 'with no document date the day it was entered is used')
  assert.deepEqual(old.lines, [{ name: 'Tune up', hours: 0, amount: 150, tech: '', flat: true }])
  const oil = docFrom(RAW.oil)
  assert.deepEqual(oil.lines.map(l => l.flat), [false, true], 'a flat line has no hours')
  assert.equal(oil.hours[1].hours, 0)
})

test('docFrom works out the part and tax amounts the way the editor does', () => {
  const alt = docFrom(RAW.alternator)
  assert.equal(alt.total, 550.63); assert.equal(alt.tax, 20.63); assert.equal(alt.balance, 450.63); assert.equal(alt.paid, 100)
  assert.equal(alt.core, 30); assert.equal(alt.sublet, 40); assert.equal(alt.fees, 70)
  assert.equal(docFrom(RAW.old).paid, 0)
  assert.equal(docFrom(RAW.old).total, 186.81)
  assert.equal(docFrom({ ...RAW.brakes, apply_tax: false }).taxRate, 0)
})

test('day of a timestamp keeps a plain date and rejects nonsense', () => {
  assert.equal(dayOfStamp('2026-10-14'), '2026-10-14')
  assert.equal(dayOfStamp(''), ''); assert.equal(dayOfStamp(null), ''); assert.equal(dayOfStamp('not a date'), '')
  assert.match(dayOfStamp('2026-10-14T12:00:00Z'), /^2026-10-1[34]$/)
})

test('a missing column or table is recognised, other errors are not', () => {
  assert.equal(isMissingSchemaError({ code: '42703', message: 'column documents.cashier does not exist' }), true)
  assert.equal(isMissingSchemaError({ code: '42P01', message: 'relation "x" does not exist' }), true)
  assert.equal(isMissingSchemaError({ code: 'PGRST204', message: "Could not find the 'x' column of 'documents' in the schema cache" }), true)
  assert.equal(isMissingSchemaError({ code: 'PGRST205', message: 'Could not find the table' }), true)
  assert.equal(isMissingSchemaError(new Error('column "cashier" does not exist')), true)
  assert.equal(isMissingSchemaError({ code: '42501', message: 'permission denied for table documents' }), false)
  assert.equal(isMissingSchemaError({ code: '', message: 'Failed to fetch' }), false)
  assert.equal(isMissingSchemaError(null), false)
})

test('a car gets the same key every time, from the most exact thing known', () => {
  assert.equal(vehicleKeyOf({ vehicle_vin: '4t1bf1fk5hu000001' }, 'c1'), 'vin:4T1BF1FK5HU000001')
  assert.equal(vehicleKeyOf({ vehicle_vin: 'short', vehicle_plate: 'abc 123' }, 'c1'), 'plate:ABC123')
  assert.equal(vehicleKeyOf({ vehicle_year: 2015, vehicle_make: 'Ford', vehicle_model: 'F-150' }, 'c3'), 'car:c3:2015 ford f-150')
  assert.equal(vehicleKeyOf({ vehicle_make: 'Ford', vehicle_model: 'F-150' }, ''), '', 'a make and model with no customer is not a key')
  assert.equal(vehicleKeyOf({}, 'c1'), '')
})

test('the extra columns include every base column', () => {
  for (const c of DOC_COLUMNS.split(',')) assert.ok(DOC_COLUMNS_EXTRA.split(',').includes(c), c)
  for (const c of ['cashier', 'signature_signed_at', 'vehicle_vin']) assert.ok(DOC_COLUMNS_EXTRA.split(',').includes(c), c)
  assert.ok(!DOC_COLUMNS.includes('cashier'))
})
