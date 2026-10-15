import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLib } from './estimates-helper.mjs'

const money = loadLib('document-money')
const lines = loadLib('doc-lines')
const pricing = loadLib('doc-pricing')
const approval = loadLib('doc-approval')
const history = loadLib('doc-history')
const list = loadLib('doc-list')
const prefs = loadLib('doc-prefs')
const warranty = loadLib('doc-warranty')
const canned = loadLib('canned-match')
const links = loadLib('doc-links')
const publicDoc = loadLib('doc-public')
const email = loadLib('doc-email')

const plain = (x) => JSON.parse(JSON.stringify(x))
const OFF = { mode: 'off', pct: 0, min: 0, cap: 0 }

const brakeJob = () => ({
  type: 'Estimate', status: 'Sent', doc_number: 'EST-2026-0007', customer_name: 'Maria Lopez', vehicle_year: '2018', vehicle_make: 'Honda', vehicle_model: 'Civic',
  tax_rate: 10, apply_tax: true, shop_supplies: 10, sublet: 0, internal_notes: 'private', customer_phone: '555', customer_email: 'maria@example.com',
  labors: [
    { operation: 'Brake pads and rotors', hours: 2, rate: 100, job: 'Front brakes' },
    { operation: 'Oil change', hours: 0.5, rate: 100, job: 'Oil change' },
  ],
  parts: [
    { name: 'Pads', qty: 1, unitPrice: 60, job: 'Front brakes', cost: 25 },
    { name: 'Rotors', qty: 2, unitPrice: 50, job: 'Front brakes', cost: 30 },
    { name: 'Oil', qty: 1, unitPrice: 30, job: 'Oil change' },
  ],
})

/* ───────────── doc-lines ───────────── */

test('jobs: lines group by job name, ignoring case and spacing', () => {
  const doc = { labors: [{ hours: 1, rate: 100, job: 'Brakes' }, { hours: 1, rate: 50, job: '  brakes ' }], parts: [{ qty: 1, unitPrice: 10, job: 'BRAKES' }, { qty: 1, unitPrice: 5 }] }
  const groups = lines.groupJobs(doc)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].key, 'brakes')
  assert.equal(groups[0].lineCount, 3)
  assert.equal(groups[0].subtotal, 160)
  assert.equal(groups[1].key, lines.GENERAL_JOB_KEY)
  assert.equal(groups[1].name, 'Other items')
})

test('jobs: totals per job add up to the document minus supplies and outside work', () => {
  const doc = brakeJob()
  const t = money.calculateDocumentTotals(doc)
  const groups = lines.groupJobs(doc)
  assert.equal(groups.length, 2)
  const sum = Math.round(groups.reduce((s, g) => s + g.subtotal, 0) * 100) / 100
  assert.equal(sum, Math.round((t.subtotal - t.shopSupplies - t.sublet) * 100) / 100)
  assert.equal(groups[0].name, 'Front brakes')
  assert.equal(groups[0].subtotal, 360)
  assert.equal(groups[0].tax, 16)
})

test('jobs: keepJobs and renameJob return new arrays and leave the document alone', () => {
  const doc = brakeJob()
  const kept = lines.keepJobs(doc, ['oil change'])
  assert.equal(kept.parts.length, 1)
  assert.equal(kept.labors.length, 1)
  assert.equal(doc.parts.length, 3)
  const renamed = lines.renameJob(doc, 'front brakes', 'Brakes, front')
  assert.equal(renamed.parts[0].job, 'Brakes, front')
  assert.equal(doc.parts[0].job, 'Front brakes')
})

test('display lines: parts, labor, core charges and fees read in plain words', () => {
  const doc = {
    labors: [{ operation: 'Replace alternator', hours: 1.5, rate: 100 }, { operation: 'Diagnose', amount: 80 }],
    parts: [{ name: 'Alternator', brand: 'Acme', qty: 1, unitPrice: 200, core: 25, warranty: '12 months' }, lines.makeFeeLine({ name: 'Disposal fee', amount: 5, taxable: false })],
  }
  const rows = lines.displayLines(doc)
  assert.deepEqual(plain(rows.map((r) => r.kind)), ['labor', 'labor', 'part', 'core', 'fee'])
  assert.equal(rows[0].detail, '1.5 hr at $100.00 per hour')
  assert.equal(rows[1].detail, 'Flat price')
  assert.equal(rows[2].detail, 'Acme')
  assert.equal(rows[2].warranty, '12 months')
  assert.equal(rows[3].total, 25)
  assert.equal(rows[4].total, 5)
  const fee = lines.makeFeeLine({ name: '', amount: -3, taxable: true, kind: 'sublet', job: ' Tires ' })
  assert.equal(fee.unitPrice, 0)
  assert.equal(fee.name, 'Outside work')
  assert.equal(fee.job, 'Tires')
})

test('display lines: a discount shows the list total and never changes the stored price', () => {
  const base = { parts: [{ name: 'Pads', qty: 2, unitPrice: 50 }], labors: [{ operation: 'Install', hours: 2, rate: 100 }] }
  const d = pricing.applyPercentDiscount(base, 'all', 10)
  const rows = lines.displayLines({ parts: d.parts, labors: d.labors })
  assert.equal(rows[0].total, 180)
  assert.equal(rows[0].listTotal, 200)
  assert.equal(rows[1].total, 90)
  assert.equal(rows[1].listTotal, 100)
})

test('supplements: stamping approved lines leaves only new work waiting', () => {
  const doc = brakeJob()
  assert.equal(lines.hasUnapprovedLines(doc), true)
  const stamped = lines.stampApproved(doc)
  assert.equal(lines.hasUnapprovedLines(stamped), false)
  const withNew = { ...doc, ...stamped, parts: [...stamped.parts, { name: 'Wiper blades', qty: 1, unitPrice: 20, job: 'Supplement 1' }] }
  assert.equal(lines.hasUnapprovedLines(withNew), true)
  assert.equal(lines.unapprovedOnly(withNew).parts.length, 1)
  const groups = lines.groupJobs(withNew)
  assert.deepEqual(plain(groups.map((g) => [g.name, g.approved])), [['Front brakes', true], ['Oil change', true], ['Supplement 1', false]])
})

/* ───────────── pricing ───────────── */

test('markup matrix: tiers by cost, markup or margin, rounding', () => {
  const m = pricing.normalizeMatrix({ mode: 'markup', roundTo: 'cent', tiers: [{ upTo: 10, pct: 100 }, { upTo: 100, pct: 50 }, { upTo: null, pct: 30 }] })
  assert.equal(pricing.matrixPrice(m, 5), 10)
  assert.equal(pricing.matrixPrice(m, 40), 60)
  assert.equal(pricing.matrixPrice(m, 200), 260)
  assert.equal(pricing.matrixPrice(m, 0), null)
  const margin = pricing.normalizeMatrix({ mode: 'margin', tiers: [{ upTo: null, pct: 40 }] })
  assert.equal(pricing.matrixPrice(margin, 60), 100)
  const dollar = pricing.normalizeMatrix({ mode: 'markup', roundTo: 'dollar', tiers: [{ upTo: null, pct: 33 }] })
  assert.equal(pricing.matrixPrice(dollar, 10), 14)
  assert.equal(pricing.matrixPrice(pricing.normalizeMatrix(null), 10), null)
  assert.equal(pricing.normalizeMatrix({ mode: 'margin', tiers: [{ upTo: null, pct: 200 }] }).tiers[0].pct, 95)
})

test('labor rates: technician beats kind of work beats shop rate', () => {
  const rates = pricing.normalizeRates({ defaultRate: 110, types: [{ name: 'Diagnostic', rate: 150 }], techs: [{ name: 'Sam', rate: 140 }, { name: '', rate: 5 }] })
  assert.equal(rates.techs.length, 1)
  assert.equal(pricing.laborRateFor(rates, { tech: 'sam', type: 'Diagnostic' }, 120), 140)
  assert.equal(pricing.laborRateFor(rates, { type: 'diagnostic' }, 120), 150)
  assert.equal(pricing.laborRateFor(rates, {}, 120), 110)
  assert.equal(pricing.laborRateFor(pricing.normalizeRates({}), {}, 120), 120)
  assert.equal(pricing.laborRateFor(pricing.normalizeRates({}), {}, null), 0)
})

test('shop supplies: percent of labor, parts or both with a floor and a cap', () => {
  const rule = pricing.normalizeSupplies({ mode: 'both', pct: 10, min: 5, cap: 40 })
  assert.equal(pricing.suppliesFor(rule, { laborTotal: 100, partsTotal: 100 }), 20)
  assert.equal(pricing.suppliesFor(rule, { laborTotal: 10, partsTotal: 10 }), 5)
  assert.equal(pricing.suppliesFor(rule, { laborTotal: 500, partsTotal: 500 }), 40)
  assert.equal(pricing.suppliesFor(pricing.normalizeSupplies({ mode: 'labor', pct: 10 }), { laborTotal: 0, partsTotal: 99 }), 0)
  assert.equal(pricing.suppliesFor(OFF, { laborTotal: 100, partsTotal: 100 }), 0)
})

test('shop supplies: follow the rule after work is declined, but never overwrite a typed amount', () => {
  const rule = pricing.normalizeSupplies({ mode: 'both', pct: 10 })
  const before = { laborTotal: 200, partsTotal: 100 }
  const after = { laborTotal: 100, partsTotal: 50 }
  assert.equal(pricing.suppliesAfterChange(rule, 30, before, after), 15)
  assert.equal(pricing.suppliesAfterChange(rule, 25, before, after), 25)
  assert.equal(pricing.suppliesAfterChange(OFF, 30, before, after), 30)
})

test('flat dollar discount on one line, hourly and flat labor', () => {
  const part = pricing.partDiscountPatch({ qty: 2, unitPrice: 50 }, { amount: 10 })
  assert.equal(part.unitPrice, 45)
  assert.equal(part.listPrice, 50)
  const hourly = pricing.laborDiscountPatch({ hours: 2, rate: 100 }, { amount: 20 })
  assert.equal(hourly.rate, 90)
  const flat = pricing.laborDiscountPatch({ amount: 80 }, { pct: 25 })
  assert.equal(flat.amount, 60)
  assert.equal(flat.listAmount, 80)
  const none = pricing.partDiscountPatch({ qty: 1, unitPrice: 50 }, { pct: 0 })
  assert.equal(none.listPrice, undefined)
  assert.equal(none.unitPrice, 50)
  // fees and outside work are never discounted by a percent-off-everything
  const d = pricing.applyPercentDiscount({ parts: [lines.makeFeeLine({ name: 'Disposal', amount: 10, taxable: true }), { qty: 1, unitPrice: 100 }], labors: [] }, 'all', 50)
  assert.equal(d.parts[0].unitPrice, 10)
  assert.equal(d.parts[1].unitPrice, 50)
})

test('effective labor rate and parts margin', () => {
  const doc = { labors: [{ hours: 2, rate: 90 }, { hours: 1, rate: 120 }, { amount: 500 }], parts: [{ qty: 2, unitPrice: 50, cost: 30 }, { qty: 1, unitPrice: 99 }] }
  assert.equal(pricing.effectiveLaborRate(doc), 100)
  assert.equal(pricing.effectiveLaborRate({ labors: [{ amount: 5 }] }), null)
  assert.deepEqual(plain(pricing.partsMargin(doc)), { cost: 60, price: 100, profit: 40, pct: 40 })
})

/* ───────────── dates, links, hashes ───────────── */

test('expiry: before, today, soon, expired, and no date', () => {
  assert.equal(approval.expiryState('', '2026-10-15').state, 'none')
  assert.equal(approval.expiryState('2026-11-30', '2026-10-15').state, 'ok')
  assert.equal(approval.expiryState('2026-10-17', '2026-10-15').state, 'soon')
  assert.equal(approval.expiryState('2026-10-15', '2026-10-15').state, 'today')
  assert.equal(approval.expiryState('2026-10-14', '2026-10-15').state, 'expired')
  assert.equal(approval.expiryWords('2026-10-17', '2026-10-15'), 'Good for 2 more days')
  assert.equal(approval.expiryWords('2026-10-12', '2026-10-15'), 'Expired 3 days ago')
  assert.equal(approval.addDaysIso('2026-12-20', 30), '2027-01-19')
  assert.equal(approval.isIsoDay('2026-02-30'), false)
  assert.equal(approval.isIsoDay('2026-02-28'), true)
})

test('link state: revoked beats done beats expired', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  assert.equal(approval.linkState({ expires_at: '2026-11-01T00:00:00Z' }, now), 'active')
  assert.equal(approval.linkState({ expires_at: '2026-10-01T00:00:00Z' }, now), 'expired')
  assert.equal(approval.linkState({ expires_at: '2026-10-01T00:00:00Z', completed_at: '2026-09-30T00:00:00Z' }, now), 'done')
  assert.equal(approval.linkState({ revoked_at: '2026-10-14T00:00:00Z', completed_at: '2026-09-30T00:00:00Z' }, now), 'revoked')
})

test('tokens: random, long, and checked before any lookup', () => {
  const a = links.newLinkToken()
  const b = links.newLinkToken()
  assert.equal(a.length, 24)
  assert.notEqual(a, b)
  assert.equal(links.isLinkToken(a), true)
  assert.equal(links.isLinkToken('3f0c2a54-6a1b-4a58-9a3d-2b4c1d9e8f10'), true)
  assert.equal(links.isLinkToken("x'; drop table"), false)
  assert.equal(links.isLinkToken('short'), false)
  assert.equal(links.isLinkToken(undefined), false)
  assert.equal(links.siteOrigin('https://shop.example.com/', 'http://localhost:3000'), 'https://shop.example.com')
  assert.equal(links.siteOrigin('', 'http://localhost:3000'), 'http://localhost:3000')
  assert.equal(links.deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari/604.1'), 'Safari on iPhone or iPad')
  assert.equal(links.clientIp({ get: (n) => (n === 'x-forwarded-for' ? '203.0.113.9, 10.0.0.1' : null) }), '203.0.113.9')
})

test('content hash: changes with any line, price, tax or note, and not with private fields', async () => {
  const doc = brakeJob()
  const h = await approval.contentHash(doc)
  assert.equal(h.length, 64)
  assert.equal(await approval.contentHash(brakeJob()), h)
  const changes = [
    { ...doc, parts: doc.parts.map((p, i) => (i === 0 ? { ...p, unitPrice: 61 } : p)) },
    { ...doc, labors: doc.labors.slice(1) },
    { ...doc, tax_rate: 8.25 },
    { ...doc, notes: 'different' },
    { ...doc, shop_supplies: 11 },
    { ...doc, vehicle_model: 'Accord' },
  ]
  for (const c of changes) assert.notEqual(await approval.contentHash(c), h)
  assert.equal(await approval.contentHash({ ...doc, internal_notes: 'changed', customer_phone: '999', parts: doc.parts.map((p) => ({ ...p, cost: 1 })) }), h)
  assert.equal(approval.stableStringify({ b: 1, a: [2, { d: undefined, c: 3 }] }), '{"a":[2,{"c":3}],"b":1}')
})

test('signature record: verifies, and any change is caught', async () => {
  const image = 'data:image/png;base64,AAAA'
  const rec = {
    documentId: 'doc-1', docNumber: 'EST-2026-0007', contentHash: 'abc', signerName: 'Maria Lopez', signedAt: '2026-10-15T15:00:00.000Z',
    ip: '203.0.113.9', userAgent: 'UA', decisions: { 'front brakes': 'approve' }, options: {}, note: '', signatureHash: await approval.sha256Hex(image), method: 'drawn',
  }
  const stored = await approval.signatureRecordHash(rec)
  assert.deepEqual(plain(await approval.verifySignatureRecord(rec, stored, image)).ok, true)
  for (const tampered of [{ ...rec, signerName: 'Someone Else' }, { ...rec, signedAt: '2026-10-16T15:00:00.000Z' }, { ...rec, decisions: { 'front brakes': 'decline' } }, { ...rec, contentHash: 'abd' }, { ...rec, ip: '198.51.100.1' }]) {
    assert.equal((await approval.verifySignatureRecord(tampered, stored, image)).ok, false)
  }
  assert.equal((await approval.verifySignatureRecord(rec, stored, 'data:image/png;base64,BBBB')).ok, false)
  assert.equal((await approval.verifySignatureRecord(rec, '', image)).ok, false)
})

/* ───────────── planning a customer response ───────────── */

const plan = (doc, decisions, extra = {}) => approval.planResponse({ doc, options: [], decisions, optionChoices: {}, supplies: OFF, ...extra })

test('response: approve everything keeps all lines, marks them approved, sets status', () => {
  const doc = brakeJob()
  const r = plan(doc, { 'front brakes': 'approve', 'oil change': 'approve' })
  assert.equal(r.ok, true)
  assert.equal(r.plan.outcome, 'approved')
  assert.equal(r.plan.status, 'Approved')
  assert.equal(r.plan.parts.length, 3)
  assert.ok(r.plan.parts.every((p) => p.approved === true))
  assert.equal(r.plan.totalAfter, r.plan.totalBefore)
})

test('response: decline one job removes its lines and the total is the rest, priced the normal way', () => {
  const doc = brakeJob()
  const r = plan(doc, { 'front brakes': 'decline', 'oil change': 'approve' })
  assert.equal(r.plan.outcome, 'partial')
  assert.equal(r.plan.labors.length, 1)
  assert.equal(r.plan.parts.length, 1)
  const after = money.calculateDocumentTotals({ ...doc, parts: r.plan.parts, labors: r.plan.labors, shop_supplies: r.plan.shop_supplies })
  // oil: 0.5 x 100 + 30 = 80, tax on 30 + 10 supplies = 4, total 94
  assert.equal(after.total, 94)
  assert.equal(r.plan.totalAfter, 94)
  assert.equal(r.plan.declined.length, 1)
  assert.equal(r.plan.declined[0].job, 'Front brakes')
  assert.equal(r.plan.declined[0].amount, 376)
  assert.deepEqual(plain(r.plan.declined[0].lines.map((l) => l.total)), [200, 60, 100])
})

test('response: decline everything keeps the quote as written and marks it declined', () => {
  const doc = brakeJob()
  const r = plan(doc, { 'front brakes': 'decline', 'oil change': 'decline' })
  assert.equal(r.plan.outcome, 'declined')
  assert.equal(r.plan.status, 'Declined')
  assert.equal(r.plan.parts.length, 3)
  assert.equal(r.plan.totalAfter, r.plan.totalBefore)
  assert.equal(r.plan.declined.length, 2)
})

test('response: a supplement that is declined leaves the approved work alone', () => {
  const base = lines.stampApproved(brakeJob())
  const doc = { ...brakeJob(), ...base, status: 'Approved', parts: [...base.parts, { name: 'Wipers', qty: 1, unitPrice: 20, job: 'Supplement 1' }] }
  const r = plan(doc, { 'supplement 1': 'decline' })
  assert.equal(r.ok, true)
  assert.equal(r.plan.outcome, 'declined')
  assert.equal(r.plan.status, 'Approved')
  assert.equal(r.plan.parts.length, 3)
  assert.ok(!r.plan.parts.some((p) => p.name === 'Wipers'))
})

test('response: answers must match the jobs on the page', () => {
  const doc = brakeJob()
  assert.equal(plan(doc, { 'front brakes': 'approve' }).ok, false)
  assert.equal(plan(doc, { 'front brakes': 'approve', 'oil change': 'maybe' }).ok, false)
  assert.equal(plan(doc, { 'front brakes': 'approve', 'oil change': 'approve', 'tires': 'approve' }).ok, false)
  assert.equal(plan(doc, {}).ok, false)
  assert.match(plan(doc, {}).error, /approve or decline/i)
})

test('response: nothing waiting is not an error', () => {
  const doc = { ...brakeJob(), ...lines.stampApproved(brakeJob()), status: 'Approved' }
  const r = plan(doc, {})
  assert.equal(r.ok, true)
  assert.equal(r.plan.nothingToDecide, true)
  assert.equal(r.plan.outcome, 'approved')
})

test('response: shop supplies follow the rule when work is declined, unless the writer typed them', () => {
  const doc = { ...brakeJob(), shop_supplies: 37.6 }
  const rule = { mode: 'both', pct: 10, min: 0, cap: 0 }
  // 376 labor+parts... front brakes 200+110 (parts 60+100) = 360, oil 50+30 = 80: base 440, 10% = 44. Not 37.6, so typed.
  const typed = plan(doc, { 'front brakes': 'decline', 'oil change': 'approve' }, { supplies: rule })
  assert.equal(typed.plan.shop_supplies, 37.6)
  const ruled = plan({ ...doc, shop_supplies: 46 }, { 'front brakes': 'decline', 'oil change': 'approve' }, { supplies: rule })
  assert.equal(ruled.plan.shop_supplies, 46)
  const exact = plan({ ...doc, shop_supplies: 44 }, { 'front brakes': 'decline', 'oil change': 'approve' }, { supplies: rule })
  assert.equal(exact.plan.shop_supplies, 8)
})

test('options: the chosen choice is added to the document and the others are not', () => {
  const doc = { ...brakeJob(), labors: [], parts: [], shop_supplies: 0 }
  const group = approval.normalizeOptionGroup({
    id: 'o1', name: 'Pads', position: 0, status: 'open',
    choices: [
      { id: 'good', label: 'Good', parts: [{ name: 'Economy pads', qty: 1, unitPrice: 40 }], labors: [{ operation: 'Install pads', hours: 1, rate: 100 }] },
      { id: 'best', label: 'Best', recommended: true, parts: [{ name: 'Ceramic pads', qty: 1, unitPrice: 90 }], labors: [{ operation: 'Install pads', hours: 1, rate: 100 }] },
    ],
  })
  assert.equal(group.choices.length, 2)
  const base = { doc, options: [group], decisions: {}, supplies: OFF }
  const best = approval.planResponse({ ...base, optionChoices: { o1: 'best' } })
  assert.equal(best.ok, true)
  assert.equal(best.plan.parts[0].name, 'Ceramic pads')
  assert.equal(best.plan.parts[0].job, 'Pads')
  assert.equal(best.plan.parts[0].option, 'Best')
  assert.equal(best.plan.status, 'Approved')
  assert.equal(best.plan.totalAfter, 199)
  const none = approval.planResponse({ ...base, optionChoices: { o1: 'none' } })
  assert.equal(none.plan.outcome, 'declined')
  assert.equal(none.plan.status, 'Declined')
  assert.equal(approval.planResponse({ ...base, optionChoices: {} }).ok, false)
  assert.equal(approval.planResponse({ ...base, optionChoices: { o1: 'nope' } }).ok, false)
  assert.equal(approval.planResponse({ ...base, optionChoices: { o1: 'best', o9: 'best' } }).ok, false)
  assert.deepEqual(plain(approval.defaultOptionChoices([group])), { o1: 'best' })
  assert.equal(approval.choiceTotals(group.choices[1], { tax_rate: 10, apply_tax: true }).total, 199)
})

test('preview totals match the plan the server would apply', () => {
  const doc = brakeJob()
  const pre = approval.previewTotals({ doc, options: [], decisions: { 'front brakes': 'decline' }, optionChoices: {}, supplies: OFF })
  const real = plan(doc, { 'front brakes': 'decline', 'oil change': 'approve' })
  assert.equal(pre.total, real.plan.totalAfter)
  const none = approval.previewTotals({ doc, options: [], decisions: { 'front brakes': 'decline', 'oil change': 'decline' }, optionChoices: {}, supplies: OFF })
  assert.equal(none.total, 0)
})

/* ───────────── history ───────────── */

test('history: describes added, removed and changed lines and the total moving', () => {
  const before = brakeJob()
  const after = { ...before, parts: [{ ...before.parts[0], unitPrice: 70 }, before.parts[1], { name: 'Wipers', qty: 1, unitPrice: 20 }], labors: before.labors.slice(0, 1), notes: 'Call first' }
  const c = history.describeChange(before, after)
  assert.equal(c.changed, true)
  assert.equal(c.material, true)
  assert.ok(c.changes.includes('Added Wipers, $20.00'))
  assert.ok(c.changes.includes('Removed Oil change (Oil change), $50.00'.replace(' (Oil change)', ' (Oil change)')))
  assert.ok(c.changes.some((x) => x.startsWith('Changed Pads: $60.00 to $70.00')))
  assert.ok(c.changes.includes('Notes changed'))
  assert.match(c.summary, /Total \$\d/)
  assert.equal(history.describeChange(before, { ...before }).changed, false)
  const quiet = history.describeChange(before, { ...before, internal_notes: 'x' })
  assert.equal(quiet.material, false)
  assert.ok(quiet.changes.includes('Private notes changed'))
})

test('history: timeline merges events and payments, newest first', () => {
  const t = history.mergeTimeline(
    [{ id: 'e1', kind: 'sent', actor: 'Shop', summary: 'Sent by text', created_at: '2026-10-14T10:00:00Z' }],
    [{ id: 'p1', amount: 50, method: 'Cash', paid_at: '2026-10-15T09:00:00Z' }],
  )
  assert.equal(t[0].id, 'pay-p1')
  assert.equal(t[0].summary, '$50.00 by Cash')
  assert.equal(history.statusEventKind('Unpaid', 'Void'), 'void')
  assert.equal(history.statusEventKind('Void', 'Draft'), 'restored')
  assert.equal(history.whenLabel('2026-10-15T15:42:00', Date.parse('2026-10-15T20:00:00')), 'Today 3:42 PM')
  assert.equal(history.linkLine({ sentAt: '2026-10-14T10:00:00', viewedAt: null, views: 0, answeredAt: null, answer: '' }, Date.parse('2026-10-15T10:00:00')), 'Sent yesterday 10:00 am, not opened yet')
})

/* ───────────── list ───────────── */

const docRow = (o, link) => list.makeRow({ id: o.id || 'd' + Math.random(), type: 'Estimate', status: 'Draft', doc_number: 'EST-1', customer_name: 'Maria', parts: [], labors: [], created_at: '2026-10-10T10:00:00Z', ...o }, link)

test('list: filters by status, viewed, expiring and overdue', () => {
  const today = '2026-10-15'
  const rows = [
    docRow({ id: 'a', status: 'Draft' }),
    docRow({ id: 'b', status: 'Sent', expires_date: '2026-10-16' }, { sentAt: 'x', viewedAt: '2026-10-14T00:00:00Z', views: 2, answeredAt: null, answer: '' }),
    docRow({ id: 'c', status: 'Approved' }),
    docRow({ id: 'd', status: 'Declined' }),
    docRow({ id: 'e', status: 'Void' }),
    docRow({ id: 'f', type: 'Invoice', status: 'Unpaid', due_date: '2026-10-01', labors: [{ hours: 1, rate: 100 }] }),
    docRow({ id: 'g', type: 'Invoice', status: 'Paid', labors: [{ hours: 1, rate: 100 }], amount_paid: 108.25 }),
  ]
  const ids = (f) => rows.filter((r) => list.matchesFilter(f, r, today)).map((r) => r.doc.id)
  assert.deepEqual(ids('all'), ['a', 'b', 'c', 'd', 'f', 'g'])
  assert.deepEqual(ids('waiting'), ['b'])
  assert.deepEqual(ids('viewed'), ['b'])
  assert.deepEqual(ids('expiring'), ['b'])
  assert.deepEqual(ids('declined'), ['d'])
  assert.deepEqual(ids('void'), ['e'])
  assert.deepEqual(ids('unpaid'), ['f'])
  assert.deepEqual(ids('overdue'), ['f'])
  assert.deepEqual(ids('paid'), ['g'])
})

test('list: search finds every word across number, customer, car and the work itself', () => {
  const r = docRow({ id: 'a', customer_name: 'Maria Lopez', vehicle_make: 'Honda', vehicle_model: 'Civic', labors: [{ operation: 'Brake pads and rotors' }], parts: [{ name: 'Ceramic pads', part_number: 'CX-77' }] })
  assert.equal(list.matchesSearch(r, 'maria brake'), true)
  assert.equal(list.matchesSearch(r, 'civic cx-77'), true)
  assert.equal(list.matchesSearch(r, 'maria tires'), false)
  assert.equal(list.matchesSearch(r, '   '), true)
})

test('list: sort and date range', () => {
  const rows = [
    docRow({ id: 'a', created_at: '2026-10-01T00:00:00Z', customer_name: 'Zed', labors: [{ hours: 1, rate: 10 }] }),
    docRow({ id: 'b', created_at: '2026-10-03T00:00:00Z', customer_name: 'Amy', labors: [{ hours: 1, rate: 50 }] }),
    docRow({ id: 'c', created_at: '2026-10-02T00:00:00Z', customer_name: 'Bob', labors: [{ hours: 1, rate: 30 }] }),
  ]
  const order = (s) => list.sortRows(rows, s).map((r) => r.doc.id).join('')
  assert.equal(order('newest'), 'bca')
  assert.equal(order('oldest'), 'acb')
  assert.equal(order('amount_high'), 'bca')
  assert.equal(order('amount_low'), 'acb')
  assert.equal(order('customer'), 'bca')
  assert.equal(list.inRange({ doc_date: '2026-10-10' }, '7d', '2026-10-15'), true)
  assert.equal(list.inRange({ doc_date: '2026-10-01' }, '7d', '2026-10-15'), false)
  assert.equal(list.inRange({ doc_date: '2026-01-01' }, 'year', '2026-10-15'), true)
  assert.equal(list.inRange({ doc_date: '2025-12-31' }, 'year', '2026-10-15'), false)
  const q = list.runQuery(rows, { filter: 'all', sort: 'amount_high', range: 'any', search: 'amy' }, '2026-10-15')
  assert.deepEqual(q.map((r) => r.doc.id), ['b'])
})

test('list: hints say what needs attention', () => {
  const today = '2026-10-15'
  const now = Date.parse('2026-10-15T12:00:00Z')
  assert.equal(list.rowHint(docRow({ status: 'Sent', expires_date: '2026-10-10' }), today, now).text, 'Expired')
  assert.equal(list.rowHint(docRow({ status: 'Sent', expires_date: '2026-10-15' }), today, now).text, 'Expires today')
  assert.equal(list.rowHint(docRow({ status: 'Sent', sent_at: '2026-10-10T00:00:00Z' }), today, now).text, 'No answer after 5 days')
  assert.equal(list.rowHint(docRow({ status: 'Sent' }, { sentAt: 'x', viewedAt: '2026-10-11T00:00:00Z', views: 1, answeredAt: null, answer: '' }), today, now).text, 'Looked at it, no answer yet')
  assert.equal(list.rowHint(docRow({ status: 'Draft' }), today, now), null)
  assert.equal(list.rowHint(docRow({ type: 'Invoice', status: 'Unpaid', due_date: '2026-10-10', labors: [{ hours: 1, rate: 10 }] }), today, now).text, 'Overdue 5 days')
})

test('export: cells that could run as formulas are neutralised and quotes are escaped', () => {
  assert.equal(list.csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`)
  assert.equal(list.csvCell('+1 555'), "'+1 555")
  assert.equal(list.csvCell('-5'), "'-5")
  assert.equal(list.csvCell('@sum'), "'@sum")
  assert.equal(list.csvCell('Smith, John'), '"Smith, John"')
  assert.equal(list.csvCell('plain'), 'plain')
  const csv = list.rowsToCsv([docRow({ id: 'a', customer_name: '=cmd|x', doc_number: 'EST-9', labors: [{ hours: 1, rate: 100 }], tax_rate: 0 })])
  const [head, row] = csv.split('\r\n')
  assert.equal(head.split(',')[0], 'Number')
  assert.ok(row.includes("'=cmd|x"))
  assert.ok(row.includes('100.00'))
})

test('saved views: only known filters survive and the list is bounded', () => {
  const v = list.normalizeViews([{ id: '1', name: '  Waiting   on  me ', query: { filter: 'waiting', sort: 'oldest', range: '30d', search: 'x' } }, { id: '2', name: 'bad', query: { filter: 'drop table', sort: 'zzz' } }, { name: 'no id' }, null])
  assert.equal(v.length, 2)
  assert.equal(v[0].name, 'Waiting on me')
  assert.equal(v[1].query.filter, 'all')
  assert.equal(v[1].query.sort, 'newest')
  assert.equal(list.normalizeViews('nope').length, 0)
  assert.equal(list.sameQuery({ filter: 'all', sort: 'newest', range: 'any', search: ' a ' }, { filter: 'all', sort: 'newest', range: 'any', search: 'a' }), true)
})

test('paging: every document is loaded in ranges that cover the whole table', () => {
  assert.deepEqual(plain(list.pageRanges(0, 300, 500)), [])
  assert.deepEqual(plain(list.pageRanges(250, 300, 500)), [[0, 249]])
  assert.deepEqual(plain(list.pageRanges(2300, 300, 500)), [[0, 299], [300, 799], [800, 1299], [1300, 1799], [1800, 2299]])
  const r = list.pageRanges(2301, 300, 500)
  assert.deepEqual(plain(r[r.length - 1]), [2300, 2300])
})

/* ───────────── settings ───────────── */

test('settings: anything stored becomes a safe complete object', () => {
  const d = prefs.normalizePrefs(null)
  assert.equal(d.estimateExpiryDays, 30)
  assert.equal(d.requireSignature, true)
  assert.equal(d.accent, '')
  assert.match(d.smsTemplate, /\{link\}/)
  const p = prefs.normalizePrefs({ estimateExpiryDays: 9999, invoiceDueDays: -4, accent: '#AABBCC', terms: 'x'.repeat(9000), requireSignature: false, fees: [{ name: 'Disposal', amount: '5', taxable: false }, { name: '', amount: 1 }, { name: 'neg', amount: -1 }], warranty: [{ label: 'Brakes — 12 Months / 12,000 Miles', exclusions: 'Mine' }, { label: '' }], rogue: 'x' })
  assert.equal(p.estimateExpiryDays, 365)
  assert.equal(p.invoiceDueDays, 0)
  assert.equal(p.accent, '#aabbcc')
  assert.equal(p.terms.length, 6000)
  assert.equal(p.requireSignature, false)
  assert.equal(p.fees.length, 1)
  assert.equal(p.fees[0].taxable, false)
  assert.equal(p.warranty.length, 1)
  assert.equal('rogue' in p, false)
  assert.equal(prefs.normalizePrefs({ accent: 'red; background:url(x)' }).accent, '')
})

test('settings: readable text color, text message template, due dates', () => {
  assert.equal(prefs.readableOn('#ffffff'), '#000000')
  assert.equal(prefs.readableOn('#101820'), '#ffffff')
  assert.equal(prefs.readableOn('nope'), '#ffffff')
  const sms = prefs.renderSms('Hi {name}, {type} {number} from {shop}: {total}. {link} {bogus}', { shop: 'Southline Auto', name: 'Maria', type: 'estimate', number: 'EST-1', total: '$94.00', link: 'https://x.test/sign/abc' })
  assert.equal(sms, 'Hi Maria, estimate EST-1 from Southline Auto: $94.00. https://x.test/sign/abc')
  assert.equal(prefs.dueFrom('2026-10-15', 30), '2026-11-14')
  assert.equal(prefs.dueFrom('2026-10-15', 0), null)
})

/* ───────────── warranty ───────────── */

test('warranty: presets name no shop and the shop name is filled in', () => {
  for (const p of warranty.WARRANTY_PRESETS) {
    assert.ok(!/alpha/i.test(p.exclusions), p.label)
    assert.ok(!/houston|\(\d{3}\)/i.test(p.exclusions), p.label)
  }
  const brakes = warranty.WARRANTY_PRESETS.find((p) => p.label.startsWith('Brakes'))
  assert.match(brakes.exclusions, /\{shop\}/)
  const text = warranty.renderWarrantyText(brakes.exclusions, 'Southline Auto Repair')
  assert.ok(text.includes('Southline Auto Repair'))
  assert.ok(!text.includes('{shop}'))
  assert.equal(warranty.renderWarrantyText('x {shop}', ''), 'x our shop')
})

test('warranty: labels are unchanged and the shop wording wins', () => {
  const labels = warranty.WARRANTY_PRESETS.map((p) => p.label)
  assert.ok(labels.includes('Oil Change — 3 Months / 3,000 Miles'))
  assert.ok(labels.includes('Brakes — 12 Months / 12,000 Miles'))
  assert.equal(labels.length, 15)
  const merged = warranty.mergeWarrantyPresets(warranty.WARRANTY_PRESETS, [{ label: 'Brakes — 12 Months / 12,000 Miles', months: 24, exclusions: 'Our own words' }])
  const b = merged.find((p) => p.label.startsWith('Brakes'))
  assert.equal(b.exclusions, 'Our own words')
  assert.equal(b.months, 24)
  assert.equal(b.mileage, 12000)
  assert.equal(warranty.warrantyHeadline(12, '12000'), '12 months or 12,000 miles')
  assert.equal(warranty.warrantyHeadline(0, 0), '')
})

test('warranty: detection picks the same preset as before', () => {
  const pick = (op, name = '') => warranty.detectWarrantyLabel({ labors: [{ operation: op }], parts: [{ name }] })
  assert.equal(pick('Oil change', 'full synthetic oil'), 'Oil Change (Synthetic) — 6 Months / 6,000 Miles')
  assert.equal(pick('Oil change'), 'Oil Change — 3 Months / 3,000 Miles')
  assert.equal(pick('Replace front pads'), 'Brakes — 12 Months / 12,000 Miles')
  assert.equal(pick('Engine rebuild'), 'Engine Rebuild — 12 Months / 12,000 Miles')
  assert.equal(pick('Replace alternator'), 'Electrical / Diagnostics — 6 Months / 6,000 Miles')
  assert.equal(pick('Wash'), 'No Warranty')
})

/* ───────────── canned jobs ───────────── */

const civic = { year: 2018, make: 'Honda', model: 'Civic' }
const oilJob = { id: 'j1', name: 'Oil change', category: 'Maintenance', labor_hours: 0.5, labor_rate: 100, parts: [{ name: 'Oil filter', cost: 9.5, qty: 1 }, { name: 'Oil 5 qt', cost: 42, qty: 1 }] }

test('canned jobs: with no extras, a job adds exactly the lines it always did (plus its job name)', () => {
  const built = canned.buildJobLines(oilJob, canned.EMPTY_EXTRAS, { vehicle: civic, shopRate: 120 })
  assert.equal(built.labors.length, 1)
  assert.deepEqual(plain({ ...built.labors[0], job: undefined }), plain({ operation: 'Oil change', tech: '', hours: 0.5, rate: 100 }))
  assert.equal(built.labors[0].job, 'Oil change')
  assert.deepEqual(plain({ ...built.parts[0], job: undefined }), plain({ name: 'Oil filter', brand: '', qty: 1, unitPrice: 9.5, taxable: true, status: 'Ordered' }))
  const t = money.calculateDocumentTotals({ parts: built.parts, labors: built.labors, tax_rate: 0 })
  assert.equal(t.total, 101.5)
  assert.equal(built.total, 101.5)
  // a job with no hours adds no labor line, and a blank rate uses the shop rate
  const noHours = canned.buildJobLines({ ...oilJob, labor_hours: 0 }, canned.EMPTY_EXTRAS, { vehicle: civic, shopRate: 120 })
  assert.equal(noHours.labors.length, 0)
  const noRate = canned.buildJobLines({ ...oilJob, labor_rate: 0 }, canned.EMPTY_EXTRAS, { vehicle: civic, shopRate: 120 })
  assert.equal(noRate.labors[0].rate, 120)
})

test('canned jobs: the variant for this car sets hours, a fixed price or different parts', () => {
  const extras = canned.normalizeExtras({
    keywords: 'lube, oil service',
    note: 'Includes a free tire pressure check.',
    fees: [{ name: 'Oil disposal', amount: 3, taxable: false }],
    variants: [
      { id: 'v1', label: 'Honda 4-cylinder', fit: { makes: ['honda'], yearFrom: 2016 }, hours: 0.4, parts: [{ name: 'Oil filter (Honda)', cost: 11, qty: 1 }] },
      { id: 'v2', label: 'Civic only', fit: { makes: ['Honda'], models: ['civic'] }, laborPrice: 39.99 },
      { id: 'v3', label: 'Old Fords', fit: { makes: ['Ford'], yearTo: 2005 }, hours: 1 },
    ],
  })
  assert.equal(extras.variants.length, 3)
  assert.equal(canned.bestVariant(extras, civic).id, 'v2')
  assert.equal(canned.bestVariant(extras, { year: 2018, make: 'Honda', model: 'Accord' }).id, 'v1')
  assert.equal(canned.bestVariant(extras, { year: 2002, make: 'Ford', model: 'F-150' }).id, 'v3')
  assert.equal(canned.bestVariant(extras, { year: 2020, make: 'Ford', model: 'F-150' }), null)
  const civicJob = canned.buildJobLines(oilJob, extras, { vehicle: civic, shopRate: 120 })
  assert.equal(civicJob.variantLabel, 'Civic only')
  assert.equal(civicJob.labors[0].amount, 39.99)
  assert.equal(civicJob.labors[0].note, 'Includes a free tire pressure check.')
  assert.equal(civicJob.parts.length, 3)
  const fee = civicJob.parts.find((p) => p.kind === 'fee')
  assert.equal(fee.unitPrice, 3)
  assert.equal(fee.taxable, false)
  const accord = canned.buildJobLines(oilJob, extras, { vehicle: { year: 2018, make: 'Honda', model: 'Accord' }, shopRate: 120 })
  assert.equal(accord.labors[0].hours, 0.4)
  assert.equal(accord.parts[0].name, 'Oil filter (Honda)')
  const ignored = canned.buildJobLines(oilJob, extras, { vehicle: civic, shopRate: 120, variant: null })
  assert.equal(ignored.labors[0].hours, 0.5)
})

test('canned jobs: fits, vehicle suggestions and search ranking', () => {
  assert.equal(canned.fitsVehicle(null, civic), true)
  assert.equal(canned.fitsVehicle({ makes: ['Honda'], models: [], yearFrom: 2019, yearTo: null }, civic), false)
  assert.equal(canned.fitsVehicle({ makes: [], models: ['civ'], yearFrom: null, yearTo: null }, civic), true)
  assert.equal(canned.fitsVehicle({ makes: ['Honda'], models: [], yearFrom: 2010, yearTo: null }, { year: null, make: 'Honda', model: '' }), false)
  const extras = { j1: canned.normalizeExtras({ variants: [{ label: 'Honda', fit: { makes: ['Honda'] }, hours: 0.4 }] }), j2: canned.normalizeExtras({ fit: { makes: ['Ford'] } }), j3: canned.normalizeExtras({ fit: { makes: ['Honda'] } }) }
  const jobs = [oilJob, { id: 'j2', name: 'Ford thing' }, { id: 'j3', name: 'Honda timing belt' }, { id: 'j4', name: 'Anything' }]
  const hits = canned.jobsForVehicle(jobs, extras, civic)
  assert.deepEqual(plain(hits.map((h) => h.job.id)), ['j1', 'j3'])
  assert.equal(hits[0].variant.label, 'Honda')
  assert.equal(canned.jobsForVehicle(jobs, extras, { year: null, make: '', model: '' }).length, 0)
  const kw = canned.normalizeExtras({ keywords: ['lube service'] })
  assert.ok(canned.searchScore(oilJob, kw, 'oil') > canned.searchScore({ ...oilJob, name: 'Other', description: 'oil' }, canned.EMPTY_EXTRAS, 'oil'))
  assert.ok(canned.searchScore({ id: 'x', name: 'Other' }, kw, 'lube') > 0)
  assert.equal(canned.searchScore(oilJob, kw, 'brakes'), 0)
})

test('canned jobs: an inspection finding finds the job the shop made for it', () => {
  const jobs = [{ id: 'a', name: 'Brake pads and rotors, front' }, { id: 'b', name: 'Wiper blades' }, { id: 'c', name: 'Cabin air filter' }]
  const extras = { c: canned.normalizeExtras({ inspectionKeys: ['pollen filter', 'cabin filter dirty'] }) }
  assert.equal(canned.matchFinding('Front brake pads worn to 2mm', jobs, extras).id, 'a')
  assert.equal(canned.matchFinding('Cabin filter dirty', jobs, extras).id, 'c')
  assert.equal(canned.matchFinding('Wipers', jobs, extras), null)
  assert.equal(canned.matchFinding('Coolant looks brown', jobs, extras), null)
  assert.equal(canned.matchFinding('', jobs, extras), null)
})

test('labor history: what the shop has charged for similar work, same car first', () => {
  const docs = [
    { vehicle_make: 'Honda', vehicle_model: 'Civic', labors: [{ operation: 'Replace front brake pads', hours: 1.5, rate: 120 }] },
    { vehicle_make: 'Honda', vehicle_model: 'Civic', labors: [{ operation: 'Front brake pads replacement', hours: 2, rate: 120 }] },
    { vehicle_make: 'Ford', vehicle_model: 'F-150', labors: [{ operation: 'Replace front brake pads', hours: 3, rate: 110 }] },
    { vehicle_make: 'Honda', vehicle_model: 'Civic', labors: [{ operation: 'Replace front brake pads', amount: 200 }, { operation: 'Alignment', hours: 1, rate: 90 }] },
  ]
  const h = canned.laborHistory(docs, 'front brake pads', civic)
  assert.equal(h.count, 2)
  assert.equal(h.averageHours, 1.75)
  assert.equal(h.sameCar, true)
  assert.equal(h.low, 1.5)
  assert.equal(h.high, 2)
  const any = canned.laborHistory(docs, 'front brake pads', { year: 2020, make: 'Toyota', model: 'Camry' })
  assert.equal(any.count, 3)
  assert.equal(any.sameCar, false)
  assert.equal(canned.laborHistory(docs, 'transmission rebuild', civic), null)
  assert.equal(canned.laborHistory(docs, 'x', civic), null)
})

/* ───────────── what the customer sees ───────────── */

test('customer page: private fields never reach the page', async () => {
  const doc = { ...brakeJob(), warranty_type: 'Brakes — 12 Months / 12,000 Miles', warranty_months: 12, warranty_mileage: 12000, warranty_exclusions: 'Covered by {shop}.', expires_date: '2026-11-01', deposit: 50 }
  const pub = await publicDoc.buildPublicDocument({
    doc, options: [], prefs: prefs.normalizePrefs({ terms: 'Net 30', accent: '#336699' }),
    shop: { name: 'Southline Auto', address: '1 Main', phone: '555-0100', email: 'shop@example.com', hasLogo: false }, todayIso: '2026-10-15',
  })
  const json = JSON.stringify(pub)
  assert.ok(!json.includes('private'), 'private notes stay home')
  assert.ok(!json.includes('maria@example.com'))
  assert.ok(!json.includes('"cost"'))
  assert.ok(!json.includes('customer_phone'))
  assert.equal(pub.kind, 'estimate')
  assert.equal(pub.groups.length, 2)
  assert.equal(pub.totals.total, money.calculateDocumentTotals(doc).total)
  assert.equal(pub.warranty.text, 'Covered by Southline Auto.')
  assert.equal(pub.warranty.headline, '12 months or 12,000 miles')
  assert.equal(pub.needsAnswer, true)
  assert.equal(pub.canRespond, true)
  assert.equal(pub.expiry.state, 'ok')
  assert.equal(pub.pay.available, false)
  assert.equal(pub.pay.deposit, 50)
  assert.equal(pub.accent, '#336699')
  assert.equal(pub.contentHash, await approval.sha256Hex(approval.stableStringify([approval.canonicalDocument(doc), []])))
  // An option the shop changes after the customer opened the page changes the fingerprint too.
  const group = (price) => approval.normalizeOptionGroup({ id: 'o1', name: 'Pads', status: 'open', choices: [{ id: 'a', label: 'Good', parts: [{ name: 'Pads', qty: 1, unitPrice: price }], labors: [] }] })
  const withOption = (price) => publicDoc.buildPublicDocument({ doc, options: [group(price)], prefs: prefs.normalizePrefs({}), shop: { name: 'S', address: '', phone: '', email: '', hasLogo: false }, todayIso: '2026-10-15' })
  assert.notEqual((await withOption(40)).contentHash, (await withOption(41)).contentHash)
  assert.notEqual((await withOption(40)).contentHash, pub.contentHash)
})

test('customer page: expired, voided and declined estimates cannot be answered', async () => {
  const build = (o) => publicDoc.buildPublicDocument({ doc: { ...brakeJob(), ...o }, options: [], prefs: prefs.normalizePrefs({}), shop: { name: 'S', address: '', phone: '', email: '', hasLogo: false }, todayIso: '2026-10-15' })
  assert.equal((await build({ expires_date: '2026-10-01' })).canRespond, false)
  assert.match((await build({ expires_date: '2026-10-01' })).closedReason, /expired/i)
  assert.equal((await build({ status: 'Void' })).canRespond, false)
  assert.equal((await build({ status: 'Declined' })).canRespond, false)
  const invoice = await build({ type: 'Invoice', status: 'Unpaid', amount_paid: 20 })
  assert.equal(invoice.kind, 'invoice')
  assert.equal(invoice.needsAnswer, false)
  assert.equal(invoice.canRespond, true)
  assert.equal(invoice.totals.balanceDue, money.calculateDocumentTotals({ ...brakeJob(), amount_paid: 20 }).balanceDue)
})

/* ───────────── email ───────────── */

test('email: names, notes and links are escaped, totals match the document', async () => {
  const doc = { ...brakeJob(), customer_name: '<script>alert(1)</script>', notes: '' }
  doc.labors[0].operation = 'Pads & "rotors"'
  const pub = await publicDoc.buildPublicDocument({ doc, options: [], prefs: prefs.normalizePrefs({ intro: 'Thanks <b>so much</b>' }), shop: { name: 'Shop <One>', address: '1 Main', phone: '555-0100', email: '', hasLogo: true }, todayIso: '2026-10-15' })
  const mail = email.buildSendEmail({ doc: pub, shop: { name: 'Shop <One>', address: '1 Main', phone: '555-0100', email: '', hasLogo: true }, link: 'https://x.test/sign/abc?x=1&y=2', logoUrl: 'https://x.test/api/sign/logo?t=abc', pixelUrl: 'https://x.test/api/sign/pixel?t=abc', linkGoodThrough: 'Nov 14, 2026' })
  assert.ok(!mail.html.includes('<script>'))
  assert.ok(!mail.html.includes('<b>so much'))
  assert.ok(mail.html.includes('&lt;script&gt;'))
  assert.ok(mail.html.includes('Pads &amp; &quot;rotors&quot;'))
  assert.ok(mail.html.includes('href="https://x.test/sign/abc?x=1&amp;y=2"'))
  assert.ok(mail.html.includes('api/sign/pixel?t=abc'))
  assert.ok(mail.html.includes('api/sign/logo?t=abc'))
  assert.ok(mail.html.includes(email.usd(pub.totals.total)))
  assert.equal(mail.subject, 'Estimate EST-2026-0007 from Shop <One>')
  assert.ok(mail.text.includes('https://x.test/sign/abc'))
  assert.ok(!/alpha/i.test(mail.html))
  const signed = email.buildSignedCopyEmail({ doc: pub, shop: { name: 'S', address: '', phone: '', email: '', hasLogo: false }, link: 'https://x.test/sign/abc', logoUrl: null, signerName: 'Maria', signedAt: '2026-10-15T15:00:00Z', outcomeWords: 'Approved 1, declined 1', declined: [{ job: 'Front brakes', amount: 376 }], recordId: 'abcdef0123456789' })
  assert.ok(signed.html.includes('Front brakes, $376.00'))
  assert.ok(signed.html.includes('abcdef012345'))
  const notice = email.buildShopNotice({ doc: pub, shop: { name: 'S', address: '', phone: '', email: '', hasLogo: false }, customerName: 'Maria', outcomeWords: 'Approved all work', note: 'Call me <now>', declined: [], openUrl: 'https://x.test/estimates?document=1' })
  assert.ok(notice.html.includes('Call me &lt;now&gt;'))
})
