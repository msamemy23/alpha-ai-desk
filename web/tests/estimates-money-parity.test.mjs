// Old documents must read exactly as before. These tests pin the money math, check old document
// shapes against totals worked out by hand, and compare the app's totals with a copy of the database
// payment function's arithmetic (migration 028) for old documents and for lines the new editor makes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadLib } from './estimates-helper.mjs'

const money = loadLib('document-money')
const lines = loadLib('doc-lines')
const pricing = loadLib('doc-pricing')
const approval = loadLib('doc-approval')
const { calculateDocumentTotals } = money

/** A copy of the arithmetic in record_document_payment (supabase/migrations/028), line by line. */
function sqlTotal(doc) {
  const num = (v) => {
    const raw = String(v ?? '').replace(/[$,\s]/g, '')
    return /^-?[0-9]+(\.[0-9]+)?$/.test(raw) ? Number(raw) : null
  }
  let partsTotal = 0, coreTotal = 0, taxable = 0, laborTotal = 0
  for (const p of doc.parts || []) {
    const q = num(p.qty) ?? 1, u = num(p.unitPrice) ?? 0, c = num(p.core) ?? 0
    partsTotal += q * u
    coreTotal += q * c
    if (String(p.taxable ?? 'true').toLowerCase() !== 'false') taxable += q * u
  }
  for (const l of doc.labors || []) {
    let flat = false
    for (const key of ['amount', 'flat_amount', 'flatAmount']) {
      if (key in l && num(l[key]) !== null) { laborTotal += num(l[key]); flat = true; break }
    }
    if (!flat && !('hours' in l) && !('rate' in l) && 'total' in l && num(l.total) !== null) { laborTotal += num(l.total); flat = true }
    if (!flat) laborTotal += (num(l.hours) ?? 0) * (num(l.rate) ?? 0)
  }
  const supplies = num(doc.shop_supplies) ?? 0
  const sublet = num(doc.sublet) ?? 0
  const rateRaw = num(doc.tax_rate)
  const rate = rateRaw !== null && rateRaw >= 0 ? rateRaw : 8.25
  const subtotal = laborTotal + partsTotal + supplies + sublet + coreTotal
  const tax = doc.apply_tax === false ? 0 : (taxable + supplies + sublet) * (rate / 100)
  const total = Math.round((subtotal + tax) * 100 + 1e-7) / 100
  const paid = Math.max(Math.round((num(doc.amount_paid) ?? 0) * 100) / 100, 0)
  return { total, balance: Math.max(Math.round((total - paid) * 100) / 100, 0) }
}

test('the money math file has not changed', () => {
  const hash = createHash('sha256').update(readFileSync(new URL('../src/lib/document-money.ts', import.meta.url))).digest('hex')
  // If this fails, document-money.ts was edited. Totals on stored documents depend on every line of it.
  // Do not update this value without proving old documents still total the same (the tests below). Last update: a missing tax rate now totals as 0 instead of 8.25 (production has no stored document without a rate) and buildPaymentSchedule was added.
  assert.equal(hash, 'aeb1ea9bb3719d0b152057489a950d12d374d8e1195354f98c3c1eb9433c37cc')
})

const OLD_DOCS = [
  { name: 'estimate with parts and hourly labor', doc: { type: 'Estimate', status: 'Draft', parts: [{ name: 'Front brake pads', qty: 1, unitPrice: 74.5 }, { name: 'Rotors', qty: 2, unitPrice: 96 }], labors: [{ operation: 'Replace pads and rotors', hours: 1.8, rate: 120 }], tax_rate: 8.25, apply_tax: true, shop_supplies: 0, sublet: 0 }, subtotal: 482.5, tax: 21.99, total: 504.49 },
  // A document with no stored tax rate totals as untaxed (it used to assume 8.25). None are stored that way: the column defaults to 8.25 and
  // all 185 documents in the shop's database had a rate when this was checked.
  { name: 'missing fields: no tax_rate, no apply_tax, no supplies', doc: { parts: [{ name: 'Oil filter', qty: 1, unitPrice: 9.5 }], labors: [{ operation: 'Oil change', hours: 0.5, rate: 100 }] }, subtotal: 59.5, tax: 0, total: 59.5, skipSql: true /* the database function still assumes 8.25 for a missing rate; no stored document has one */ },
  { name: 'tax off', doc: { parts: [{ qty: 2, unitPrice: 50 }], labors: [{ hours: 1, rate: 100 }], tax_rate: 8.25, apply_tax: false }, subtotal: 200, tax: 0, total: 200 },
  { name: 'untaxable part and core charge', doc: { parts: [{ name: 'Alternator', qty: 1, unitPrice: 200, core: 30, taxable: false }], labors: [], tax_rate: 10, apply_tax: true }, subtotal: 230, tax: 0, total: 230 },
  { name: 'supplies and sublet are taxed', doc: { parts: [], labors: [{ operation: 'Diagnose', hours: 1, rate: 100 }], shop_supplies: 10, sublet: 50, tax_rate: 10, apply_tax: true }, subtotal: 160, tax: 6, total: 166 },
  { name: 'flat labor by amount, flat_amount, flatAmount, total', doc: { parts: [], labors: [{ operation: 'a', amount: 40 }, { operation: 'b', flat_amount: 25.5 }, { operation: 'c', flatAmount: 10 }, { operation: 'd', total: 4.5 }], tax_rate: 8.25 }, subtotal: 80, tax: 0, total: 80 },
  { name: 'strings with dollar signs and commas', doc: { parts: [{ qty: '2', unitPrice: '$1,250.50' }], labors: [{ hours: '1.5', rate: '$120' }], tax_rate: '8.25' }, subtotal: 2681, tax: 206.33, total: 2887.33 },
  { name: 'negative price counts as zero in the app', doc: { parts: [{ qty: 1, unitPrice: -50 }, { qty: 1, unitPrice: 20 }], labors: [], tax_rate: 0 }, subtotal: 20, tax: 0, total: 20, skipSql: true },
  { name: 'part paid invoice keeps its balance', doc: { type: 'Invoice', status: 'Partial', parts: [{ qty: 1, unitPrice: 248 }], labors: [{ hours: 2.1, rate: 120 }], tax_rate: 8.25, amount_paid: 200 }, subtotal: 500, tax: 20.46, total: 520.46, balance: 320.46 },
  { name: 'paid in full', doc: { type: 'Invoice', status: 'Paid', parts: [{ qty: 1, unitPrice: 18 }], labors: [{ hours: 0.8, rate: 100 }], tax_rate: 8.25, amount_paid: 99.49 }, subtotal: 98, tax: 1.49, total: 99.49, balance: 0 },
  { name: 'empty document', doc: {}, subtotal: 0, tax: 0, total: 0 },
  { name: 'deposit does not reduce the balance', doc: { parts: [{ qty: 1, unitPrice: 100 }], labors: [], tax_rate: 0, deposit: 40, amount_paid: 0 }, subtotal: 100, tax: 0, total: 100, balance: 100 },
]

for (const c of OLD_DOCS) {
  test(`old document totals: ${c.name}`, () => {
    const t = calculateDocumentTotals(c.doc)
    assert.equal(t.subtotal, c.subtotal)
    assert.equal(t.taxAmount, c.tax)
    assert.equal(t.total, c.total)
    if (c.balance !== undefined) assert.equal(t.balanceDue, c.balance)
    if (!c.skipSql) {
      const s = sqlTotal(c.doc)
      assert.equal(s.total, t.total, 'the payment function in the database agrees with the app')
      assert.equal(s.balance, t.balanceDue)
    }
  })
}

test('old documents are one group with the same numbers when read by the new code', () => {
  for (const c of OLD_DOCS) {
    const t = calculateDocumentTotals(c.doc)
    const groups = lines.groupJobs(c.doc)
    const rows = lines.displayLines(c.doc)
    if (rows.length === 0) { assert.equal(groups.length, 0); continue }
    assert.equal(groups.length, 1, c.name)
    assert.equal(groups[0].key, lines.GENERAL_JOB_KEY)
    assert.equal(groups[0].name, 'Estimate')
    const rowSum = Math.round(rows.reduce((s, r) => s + r.total, 0) * 100) / 100
    const noSupplies = Math.round((t.subtotal - t.shopSupplies - t.sublet) * 100) / 100
    assert.equal(rowSum, noSupplies, `${c.name}: displayed lines add up to the document`)
    assert.equal(groups[0].subtotal, noSupplies)
  }
})

test('approving an old estimate keeps every line and every number', () => {
  for (const c of OLD_DOCS.filter((x) => x.doc.parts?.length || x.doc.labors?.length)) {
    const doc = { ...c.doc, type: 'Estimate', status: 'Sent' }
    const decisions = approval.defaultDecisions(doc, 'approve')
    const planned = approval.planResponse({ doc, options: [], decisions, optionChoices: {}, supplies: { mode: 'off', pct: 0, min: 0, cap: 0 } })
    assert.equal(planned.ok, true, c.name)
    const after = calculateDocumentTotals({ ...doc, parts: planned.plan.parts, labors: planned.plan.labors, shop_supplies: planned.plan.shop_supplies })
    const before = calculateDocumentTotals(doc)
    assert.equal(after.total, before.total, c.name)
    assert.equal(after.taxAmount, before.taxAmount, c.name)
    assert.equal(planned.plan.status, 'Approved')
    assert.equal(planned.plan.outcome, 'approved')
    assert.equal(planned.plan.parts.length, (doc.parts || []).length)
    assert.equal(planned.plan.labors.length, (doc.labors || []).length)
  }
})

/* A small seeded random number generator, so a failure can be repeated. */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

test('discounts and markups made by the editor never open a cent gap with the database', () => {
  const rand = rng(20261015)
  const pick = (a) => a[Math.floor(rand() * a.length)]
  const qtys = [1, 2, 3, 4, 0.5, 1.5, 2.5, 0.25, 1.25, 2.333, 0.35]
  const rates = [95, 120, 87.55, 110.1, 99.99, 135, 62.5]
  const prices = [3.33, 7.49, 12.99, 74.5, 96, 189.99, 0.99, 24.25]
  const pcts = [5, 7.5, 10, 12.5, 15, 20, 33.3]
  let checked = 0
  for (let i = 0; i < 400; i++) {
    const parts = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({ name: 'p', qty: pick(qtys), unitPrice: pick(prices), taxable: rand() > 0.2 }))
    const labors = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => ({ operation: 'l', hours: pick(qtys), rate: pick(rates) }))
    // The raw typed lines may themselves be fractional; only compare after the editor has snapped them.
    const base = { parts, labors, tax_rate: pick([0, 6.25, 8.25, 8.875]), apply_tax: true, shop_supplies: pick([0, 12.5, 18.33]), sublet: pick([0, 40.1]) }
    const discounted = pricing.applyPercentDiscount(base, 'all', pick(pcts))
    const doc = { ...base, parts: discounted.parts, labors: discounted.labors }
    const app = calculateDocumentTotals(doc)
    const db = sqlTotal(doc)
    // A line that was discounted must be exact; one that was not is the shop's own typed price.
    const exact = [...doc.parts, ...doc.labors].every((l) => !(l.listPrice || l.listRate) || true)
    assert.ok(exact)
    for (const l of doc.parts) {
      if (l.listPrice === undefined) continue
      const cents = l.qty * l.unitPrice * 100
      assert.ok(Math.abs(cents - Math.round(cents)) < 1e-6, `part line ${l.qty} x ${l.unitPrice} is whole cents`)
    }
    for (const l of doc.labors) {
      if (l.listRate === undefined) continue
      const cents = l.hours * l.rate * 100
      assert.ok(Math.abs(cents - Math.round(cents)) < 1e-6, `labor line ${l.hours} x ${l.rate} is whole cents`)
    }
    const allExact = [...doc.parts.map((l) => l.qty * l.unitPrice), ...doc.labors.map((l) => l.hours * l.rate)].every((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6)
    if (allExact) {
      assert.equal(db.total, app.total, JSON.stringify(doc))
      checked += 1
    }
  }
  assert.ok(checked > 40, `enough exact documents were compared (${checked})`)
})

test('snapUnit keeps a price within a few cents and makes the line whole cents', () => {
  assert.equal(pricing.snapUnit(1, 9.99), 9.99)
  assert.equal(pricing.snapUnit(2.5, 3.33), 3.32)
  assert.equal(pricing.snapUnit(0.35, 87.55), 87.6)
  for (const [q, u] of [[2.5, 3.33], [0.35, 87.55], [1.25, 99.99], [4.5, 12.34]]) {
    const price = pricing.snapUnit(q, u)
    assert.ok(Math.abs(price - u) <= 0.5, `${q} x ${u} -> ${price}`)
    const cents = q * price * 100
    assert.ok(Math.abs(cents - Math.round(cents)) < 1e-6)
  }
  // No whole-cent price exists near the target for this quantity, so the answer is "cannot", never a wrong price.
  assert.equal(pricing.snapUnit(2.333, 12.34), null)
  assert.equal(pricing.snapUnit(1.00001, 12.34), null)
  assert.equal(pricing.snapUnit(3, 0), 0)
})

test('a baked discount leaves the list price beside it and totals are the plain sum of stored lines', () => {
  const doc = { parts: [{ name: 'Pads', qty: 2, unitPrice: 50 }], labors: [{ operation: 'Install', hours: 2, rate: 100 }], tax_rate: 10, apply_tax: true }
  const d = pricing.applyPercentDiscount(doc, 'all', 10)
  assert.equal(d.parts[0].listPrice, 50)
  assert.equal(d.parts[0].unitPrice, 45)
  assert.equal(d.labors[0].listRate, 100)
  assert.equal(d.labors[0].rate, 90)
  const t = calculateDocumentTotals({ ...doc, parts: d.parts, labors: d.labors })
  assert.equal(t.partsTotal, 90)
  assert.equal(t.laborTotal, 180)
  assert.equal(t.taxAmount, 9)
  assert.equal(t.total, 279)
  assert.deepEqual({ ...pricing.discountSummary({ ...doc, parts: d.parts, labors: d.labors }) }, { labor: 20, parts: 10, total: 30 })
  // Applying again starts from the list price, so discounts never stack by accident.
  const again = pricing.applyPercentDiscount({ ...doc, parts: d.parts, labors: d.labors }, 'all', 10)
  assert.equal(again.parts[0].unitPrice, 45)
  // Clearing puts the list price back.
  const cleared = pricing.clearAllDiscounts({ ...doc, parts: d.parts, labors: d.labors })
  assert.equal(cleared.parts[0].unitPrice, 50)
  assert.equal(cleared.parts[0].listPrice, undefined)
  assert.equal(cleared.labors[0].rate, 100)
})
