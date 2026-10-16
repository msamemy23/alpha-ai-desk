// The estimate and invoice screen now reaches the finished sheets (void, restore, history, declined work, canned
// versions, whole-document discount and fees, templates) and the parts markup editor in Settings. These tests read the
// source to prove each sheet is imported and rendered, that a locked document is never offered anything that changes
// its money, that nothing new writes totals or reaches a send or payment function, and they run the pure logic that
// was added. Money maths itself is covered by estimates-logic and estimates-money-parity.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { loadLib } from './estimates-helper.mjs'

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const page = read('components/DocumentsPage.tsx')
const editor = read('components/documents/DocEditor.tsx')
const list = read('components/documents/DocList.tsx')

const screen = loadLib('doc-screen')
const plain = (x) => JSON.parse(JSON.stringify(x))
const omit = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))

/** Every line of the source that is not a comment, so a word in a comment cannot satisfy or break a check. */
const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

/* ───────────────────── 1. Void and restore ───────────────────── */

test('void: the menu offers delete for drafts and void ones, void for anything sent, and neither once money is taken', () => {
  assert.equal(screen.removeOffer({ status: 'Draft' }), 'delete')
  assert.equal(screen.removeOffer({ status: 'Void' }), 'delete')
  for (const status of ['Sent', 'Approved', 'Unpaid', 'Declined']) assert.equal(screen.removeOffer({ status, amount_paid: 0 }), 'void', status)
  for (const status of ['Paid', 'Partial']) assert.equal(screen.removeOffer({ status }), 'blocked', status)
  // A payment on the ledger blocks it even when the status has not caught up.
  assert.equal(screen.removeOffer({ status: 'Unpaid', amount_paid: 25 }), 'blocked')
  assert.equal(screen.removeOffer({ status: 'Void', amount_paid: '10.00' }), 'blocked')
  assert.equal(screen.hasMoneyTaken({ status: 'Sent', amount_paid: 0 }), false)
  assert.equal(screen.hasMoneyTaken({ status: 'Sent', amount_paid: '0.01' }), true)
})

test('void: the reason is written into the private shop notes without losing what was there', () => {
  assert.equal(screen.voidNoteLine('voided', 'Oct 15, 2026', '  Wrong   car\n'), 'Voided Oct 15, 2026: Wrong car')
  assert.equal(screen.voidNoteLine('restored', 'Oct 16, 2026'), 'Restored Oct 16, 2026')
  assert.equal(screen.appendNote('', 'Voided: x'), 'Voided: x')
  assert.equal(screen.appendNote(undefined, 'Voided: x'), 'Voided: x')
  assert.equal(screen.appendNote('Needs the other pads.\n\n', 'Voided: x'), 'Needs the other pads.\nVoided: x')
  assert.equal(screen.isVoid({ status: 'Void' }), true)
  assert.equal(screen.isVoid({ status: 'Draft' }), false)
  assert.equal(screen.mayHaveLinks({ sent_at: '2026-10-01T10:00:00Z' }), true)
  assert.equal(screen.mayHaveLinks({ signature_requested_at: '2026-10-01T10:00:00Z' }), true)
  assert.equal(screen.mayHaveLinks({ sent_at: null }), false)
})

test('void: the sheets are imported and rendered, and only the void entry leads to the void sheet', () => {
  assert.match(page, /import \{ DeleteForm, RestoreForm, VoidForm \} from '\.\/documents\/ActionSheets'/)
  for (const tag of ['<VoidForm', '<RestoreForm', '<DeleteForm']) assert.ok(page.includes(tag), `${tag} is rendered`)
  assert.match(page, /sheet === 'void'/)
  assert.match(page, /sheet === 'restore'/)
  // The menu decides from removeOffer: void only when it says void, restore only for a void document.
  assert.match(page, /removal === 'void' \? \[\{ key: 'void'/)
  assert.match(page, /formVoid \? \[\{ key: 'restore'/)
  assert.match(page, /removal === 'delete' \? \[\{ key: 'delete'/)
  // The sheets go through the existing action route helper, nothing new.
  assert.match(page, /docAction\(id, 'void', \{ reason \}\)/)
  assert.match(page, /docAction\(id, 'restore'\)/)
})

test('void: a voided document offers no send, signature, payment, plan or convert, and its lines are read only', () => {
  for (const key of ["key: 'send'", "key: 'sign'", "key: 'pay'", "key: 'plan'", "key: 'convert'"]) {
    const at = page.indexOf(key)
    assert.ok(at > 0, key)
    const head = page.slice(Math.max(0, at - 220), at)
    assert.match(head, /!formVoid/, `${key} is hidden for a voided document`)
  }
  assert.match(editor, /const closed = status === 'Void'/)
  assert.match(editor, /const frozen = locked \|\| closed/)
  // Every place the lines or money can be edited follows frozen, which includes locked.
  assert.doesNotMatch(editor, /readOnly=\{locked\}/)
  assert.match(editor, /part=\{line\} readOnly=\{frozen\}/)
  assert.match(editor, /labor=\{line\} staff=\{staff\} readOnly=\{frozen\}/)
  assert.match(editor, /\{!frozen && \(\s*<button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick=\{addPart\}/)
  assert.match(editor, /\{!frozen && \(\s*<button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick=\{addLabor\}/)
  assert.match(editor, /Restore \$\{noun\}/)
})

test('void: the list gets a Voided chip only once something is voided, and All is unchanged', () => {
  assert.match(list, /case 'void': return s === 'Void'/)
  assert.match(list, /hasVoid \? \[\{ id: 'void' as ListFilter, label: 'Voided' \}\] : \[\]/)
  assert.match(list, /case 'all': return true/)
})

/* ───────────────────── 2. Change history ───────────────────── */

test('history: an earlier version brings back only the fields a version holds, never status, number or payments', () => {
  const snapshot = {
    parts: [{ name: 'Pads', qty: 1, unitPrice: 60 }], labors: [{ operation: 'Install', hours: 1, rate: 100 }],
    shop_supplies: 5, tax_rate: 8.25, apply_tax: true, notes: 'Old note', customer_name: 'Ana',
    // Old versions saved by the server carry the status they had; none of these may reach the form.
    status: 'Void', doc_number: 'INV-0001', amount_paid: 500, payment_method: 'Cash', id: 'x', shop_id: 'someone-else', created_at: '2020-01-01', signature_signed_at: '2026-01-01', locked: true,
  }
  const patch = screen.snapshotToFormPatch(snapshot)
  assert.deepEqual(Object.keys(patch).sort(), ['apply_tax', 'customer_name', 'labors', 'notes', 'parts', 'shop_supplies', 'tax_rate'])
  for (const forbidden of ['status', 'doc_number', 'amount_paid', 'payment_method', 'id', 'shop_id', 'created_at', 'signature_signed_at', 'locked']) {
    assert.equal(forbidden in patch, false, forbidden)
  }
  assert.deepEqual(plain(screen.snapshotToFormPatch(null)), {})
  assert.deepEqual(plain(screen.snapshotToFormPatch([1, 2])), {})
  assert.deepEqual(plain(screen.snapshotToFormPatch('parts')), {})
})

test('history: the sheet is imported and rendered, and put back is offered only when the document is open', () => {
  assert.match(page, /import HistorySheet from '\.\/documents\/HistorySheet'/)
  assert.ok(page.includes('<HistorySheet'))
  assert.match(page, /sheet === 'history'/)
  assert.match(page, /key: 'history', label: 'Change history'/)
  assert.match(page, /canPutBack=\{!formLocked && !formVoid\}/)
  // Defence in depth: the handler refuses even if something called it for a locked or voided document.
  assert.match(page, /const putBack = \(snapshot: Record<string, unknown>, label: string\) => \{\s*if \(isLocked\(form\.status\) \|\| isVoid\(form\)\) return/)
  // It fills the form. It does not save: the only saves are the existing save() and the notes line for a void.
  const body = page.slice(page.indexOf('const putBack'), page.indexOf('/* ---------- void and restore'))
  assert.doesNotMatch(body, /saveDocumentFields|createDocument|fetch\(/)
  assert.match(body, /snapshotToFormPatch\(snapshot\)/)
  // The sheet itself only draws the button when the page says it may.
  const sheet = read('components/documents/HistorySheet.tsx')
  assert.match(sheet, /canPutBack \? \(\s*<button/)
})

test('history: after a good save of a saved document the server is told what it looked like before; this never blocks the save', () => {
  const save = page.slice(page.indexOf('const save = async'), page.indexOf('/** Send, sign, pay and convert'))
  const logAt = save.indexOf("logHistory({ documentId: editing, kind: 'edited'")
  const savedAt = save.indexOf('const result = await saveDocumentFields(editing, data)')
  const throwAt = save.indexOf("if (!result.ok) throw new Error(result.error || 'Save failed')")
  assert.ok(savedAt > 0 && throwAt > savedAt && logAt > throwAt, 'logged only after the save succeeded')
  assert.match(save, /void logHistory\(/)
  // The log call carries no money of its own: only the earlier document the server compares against what it stored.
  assert.doesNotMatch(save.slice(logAt, logAt + 200), /parts|labors|total|amount/)
})

/* ───────────────────── 3. Declined work ───────────────────── */

const quotedJob = () => ({
  id: 'dw1', job: 'Front brakes', amount: 412.34, customer_id: 'c1', customer_name: 'Maria Lopez', vehicle: '2018 Honda Civic',
  lines: [{ description: 'Replace pads and rotors', total: 200 }, { description: 'Pads', total: 60.5 }, { description: 'Rotors', total: 100 }],
})
const maria = { id: 'c1', name: 'Maria Lopez', phone: '555-0100', email: 'maria@example.com', vehicle_year: '2018', vehicle_make: 'Honda', vehicle_model: 'Civic', vehicle_vin: 'VIN1', vehicle_plate: 'ABC123', vehicle_mileage: '90210' }

test('declined work: a car typed as words is split into year, make and model', () => {
  assert.deepEqual(plain(screen.vehicleFromText('2018 Honda Civic')), { vehicle_year: '2018', vehicle_make: 'Honda', vehicle_model: 'Civic' })
  assert.deepEqual(plain(screen.vehicleFromText('Ford F-150 Lariat')), { vehicle_year: '', vehicle_make: 'Ford', vehicle_model: 'F-150 Lariat' })
  assert.deepEqual(plain(screen.vehicleFromText('  1999   Mazda ')), { vehicle_year: '1999', vehicle_make: 'Mazda', vehicle_model: '' })
  assert.equal(screen.vehicleFromText(''), null)
  assert.equal(screen.vehicleFromText(null), null)
  assert.equal(screen.vehicleFromText('2018'), null)
})

test('declined work: make-a-new-estimate builds a draft form only, with no status, number, send time or payment', () => {
  const { fields, lineCount } = screen.declinedDraft(quotedJob(), maria, 'Oct 1, 2026')
  assert.equal(lineCount, 3)
  const allowed = new Set(['labors', 'customer_id', 'customer_name', 'customer_phone', 'customer_email', 'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_vin', 'vehicle_plate', 'vehicle_mileage', 'internal_notes'])
  for (const key of Object.keys(fields)) assert.ok(allowed.has(key), `unexpected field ${key}`)
  for (const banned of ['status', 'doc_number', 'type', 'sent_at', 'amount_paid', 'payment_method', 'id', 'shop_id', 'signature_signed_at', 'parts']) assert.equal(banned in fields, false, banned)
  assert.equal(fields.customer_id, 'c1')
  assert.equal(fields.customer_phone, '555-0100')
  // The customer's own record is used for the car when it is the same car.
  assert.equal(fields.vehicle_vin, 'VIN1')
  assert.match(fields.internal_notes, /Started from work declined Oct 1, 2026: Front brakes, quoted at \$412\.34\./)
  assert.match(fields.internal_notes, /Replace pads and rotors \$200\.00; Pads \$60\.50; Rotors \$100\.00/)
})

test('declined work: the quoted lines come back as flat prices that add up to what the customer was quoted, before tax', () => {
  const { fields } = screen.declinedDraft(quotedJob(), maria, 'Oct 1, 2026')
  const money = loadLib('document-money')
  const labors = plain(fields.labors)
  for (const l of labors) {
    assert.equal(l.pricing, 'flat')
    assert.equal(l.job, 'Front brakes')
    assert.equal(money.getLaborFlatAmount(l), l.amount)
  }
  const t = money.calculateDocumentTotals({ parts: [], labors, tax_rate: 8.25, apply_tax: true, shop_supplies: 0 })
  assert.equal(t.laborTotal, 360.5)
  assert.equal(t.total, 360.5)
})

test('declined work: no lines, no customer record, a different car and bad numbers all come out safe', () => {
  const manual = screen.declinedDraft({ job: '  Tires  ', amount: 480, customer_id: null, customer_name: 'Walk-in Sam', vehicle: 'Land Rover Discovery', lines: [] }, null, 'Oct 2, 2026')
  const labors = plain(manual.fields.labors)
  assert.equal(manual.lineCount, 1)
  assert.deepEqual(labors, [{ operation: 'Tires', tech: '', pricing: 'flat', amount: 480, job: 'Tires' }])
  assert.equal(manual.fields.customer_name, 'Walk-in Sam')
  assert.equal('customer_id' in manual.fields, false)
  assert.equal(manual.fields.vehicle_make, 'Land')
  const odd = screen.declinedDraft({ job: 'x', amount: 'abc', lines: [{ description: 'Bad', total: -5 }, { description: '', total: 9 }, { description: 'NaN', total: 'x' }] }, null, 'Oct 3, 2026')
  assert.deepEqual(plain(odd.fields.labors).map((l) => l.amount), [0, 0])
  // A customer whose saved car differs from the declined car keeps the declined car.
  const other = screen.declinedDraft({ ...quotedJob(), vehicle: '2012 Toyota Camry' }, maria, 'Oct 1, 2026')
  assert.equal(other.fields.vehicle_make, 'Toyota')
  assert.equal(other.fields.vehicle_model, 'Camry')
  assert.equal('vehicle_vin' in other.fields, false)
})

const between = (src, from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a + from.length)
  assert.ok(a >= 0 && b > a, `markers ${from} .. ${to}`)
  return src.slice(a, b)
}

test('declined work: the sheet is imported, rendered and reachable from the estimates header, with a count', () => {
  assert.match(page, /import DeclinedSheet from '\.\/documents\/DeclinedSheet'/)
  assert.ok(page.includes('<DeclinedSheet'))
  assert.match(page, /sheet === 'declined'/)
  assert.match(page, /declinedCount=\{declined\.count\}/)
  assert.match(page, /onDeclined=\{type === 'Estimate' \? openDeclined : undefined\}/)
  assert.match(list, /isEstimate && onDeclined && \(/)
  assert.match(list, /Declined work/)
  assert.match(list, /declinedCount \? <span className="tag tag-amber num">/)
  const work = read('app/(app)/work/page.tsx')
  assert.match(work, /href: '\/estimates\?declined=1', label: 'Declined work'/)
  assert.match(page, /get\('declined'\) === '1'/)
})

test('declined work: making an estimate only fills the editor; the declined row is closed out after the draft is saved', () => {
  const make = between(page, 'const makeFromDeclined', '/* ---------- void and restore')
  assert.doesNotMatch(make, /saveDocumentFields|createDocument|fetch\(|sendDoc|openSend|postPayment|recordPayment|docAction/)
  assert.match(make, /void openNew\(settings, undefined, customers, undefined, undefined, \{/)
  // The ref is set inside openNew after the editor is open, so a failed start cannot close out a declined job.
  assert.match(page, /setEditing\('new'\)\s*\n\s*if \(seed\?\.declinedId\) declinedSource\.current = seed\.declinedId/)
  assert.match(page, /declinedSource\.current = null\s*\n\s*setEditing\(null\)/)
  const hook = read('components/documents/useDeclinedWork.ts')
  assert.match(hook, /getDeclinedWork\(\)/)
  assert.match(hook, /updateDeclinedWork\(/)
  assert.doesNotMatch(code(hook), /send|payment|sign|fetch\(/i)
})

/* ───────────────────── 4. Canned jobs with versions for different cars ───────────────────── */

const canned = loadLib('canned-match')
const brakeJob = { id: 'job1', name: 'Front brakes', category: 'Brakes', description: null, labor_hours: 1.5, labor_rate: 0, total_price: 0, parts: [{ name: 'Pads', cost: 40, qty: 1 }] }
const brakeExtras = canned.normalizeExtras({
  variants: [{ id: 'v-ford', label: 'Ford trucks', fit: { makes: ['Ford'] }, hours: 2.5, parts: [{ name: 'Truck pads', cost: 70, qty: 1 }] }],
  fees: [{ name: 'Shop disposal', amount: 5, taxable: false }],
  note: 'Rotors checked at no charge.',
})

test('canned jobs: only a job with a version, a fee or a note needs a look before it is added', () => {
  assert.equal(screen.cannedNeedsChoice(null), false)
  assert.equal(screen.cannedNeedsChoice(undefined), false)
  assert.equal(screen.cannedNeedsChoice(canned.EMPTY_EXTRAS), false)
  assert.equal(screen.cannedNeedsChoice({ variants: [], fees: [], note: '   ' }), false)
  assert.equal(screen.cannedNeedsChoice(canned.normalizeExtras({ keywords: ['brake'], fit: { makes: ['Ford'] } })), false)
  assert.equal(screen.cannedNeedsChoice(brakeExtras), true)
  assert.equal(screen.cannedNeedsChoice(canned.normalizeExtras({ fees: [{ name: 'Fee', amount: 3 }] })), true)
  assert.equal(screen.cannedNeedsChoice(canned.normalizeExtras({ note: 'Call first.' })), true)
})

test('canned jobs: the right version for the car is chosen, and any other car gets the job as saved', () => {
  const f150 = canned.buildJobLines(brakeJob, brakeExtras, { vehicle: { year: 2019, make: 'Ford', model: 'F-150' }, shopRate: 110 })
  assert.equal(f150.variantLabel, 'Ford trucks')
  assert.equal(f150.labors[0].hours, 2.5)
  assert.equal(f150.labors[0].rate, 110)
  assert.equal(f150.parts[0].name, 'Truck pads')
  const civic = canned.buildJobLines(brakeJob, brakeExtras, { vehicle: { year: 2018, make: 'Honda', model: 'Civic' }, shopRate: 110 })
  assert.equal(civic.variantLabel, '')
  assert.equal(civic.labors[0].hours, 1.5)
  assert.equal(civic.parts[0].name, 'Pads')
  // The fee and the customer note ride along either way, and the lines are grouped under the job name.
  assert.equal(civic.parts[1].name, 'Shop disposal')
  assert.equal(civic.labors[0].note, 'Rotors checked at no charge.')
  assert.equal(civic.labors[0].job, 'Front brakes')
})

test('canned jobs: a job with nothing extra builds the same lines the one-tap list has always added', () => {
  const built = canned.buildJobLines(brakeJob, canned.EMPTY_EXTRAS, { vehicle: { year: null, make: '', model: '' }, shopRate: 120 })
  // The one-tap list: one labor line at the shop rate and each part as typed, ordered and taxable.
  assert.deepEqual(plain(built.labors).map((l) => omit(l, ['job'])), [{ operation: 'Front brakes', tech: '', hours: 1.5, rate: 120 }])
  assert.deepEqual(plain(built.parts).map((l) => omit(l, ['job'])), [{ name: 'Pads', brand: '', qty: 1, unitPrice: 40, taxable: true, status: 'Ordered' }])
  assert.equal(built.total, 220)
})

test('canned jobs: the sheet is imported and rendered, loads versions only when opened, and the one-tap add is still there', () => {
  assert.match(page, /import CannedSheet from '\.\/documents\/CannedSheet'/)
  assert.ok(page.includes('<CannedSheet'))
  const open = between(page, 'const openCanned', 'const addCanned')
  assert.match(open, /void loadExtras\(\)/)
  assert.match(page, /getExtras\(\)/)
  // The old one-tap function is untouched and is what a plain job still uses.
  assert.match(page, /const addCanned = \(j: CannedJob\) => \{/)
  assert.match(page, /setNotice\(\{ kind: 'ok', text: `Added \$\{j\.name\}\. Check the prices, then save\.` \}\)/)
  assert.match(page, /addCanned\(j\) \}\}/)
  assert.match(page, /quickAdd=\{j => \{ if \(isLocked\(form\.status\) \|\| isVoid\(form\)\) closeSheet\(\); else addCanned\(j\) \}\}/)
  // If the versions cannot load, the old list is still shown, with a note and a Try again.
  assert.match(page, /Versions for different cars did not load, so jobs add as saved\./)
  assert.match(page, /onClick=\{\(\) => addCanned\(j\)\}/)
  assert.match(editor, /\{!frozen && \(p\.onAddCanned \|\| p\.onTemplates\) && \(/)
  assert.match(editor, /\{p\.onAddCanned && \(\s*<button type="button" className="btn btn-secondary w-full justify-center sm:w-auto" onClick=\{p\.onAddCanned\}>/)
})

test('canned jobs: adding from the sheet only changes the open form, never a locked or void document, and saves nothing', () => {
  const add = between(page, 'const addBuiltJob', '/* ---------- whole-document discount')
  assert.match(add, /if \(isLocked\(form\.status\) \|\| isVoid\(form\)\) \{ closeSheet\(\); return \}/)
  assert.match(add, /setForm\(f => \(\{/)
  assert.doesNotMatch(add, /saveDocumentFields|createDocument|fetch\(|calcTotals|sendDoc|openSend|postPayment|recordPayment|docAction/)
  const sheetSrc = read('components/documents/CannedSheet.tsx')
  assert.doesNotMatch(code(sheetSrc), /fetch\(|saveDocumentFields|postPayment|sendNow/)
})

/* ───────────────────── 5. Whole-document discount and fee lines ───────────────────── */

// calcTotals itself, loaded from supabase.ts with its two client packages stubbed out. It is not edited or copied.
const calcTotals = (() => {
  const source = readFileSync(new URL('../src/lib/supabase.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const mod = { exports: {} }
  const stubs = { '@supabase/supabase-js': { createClient: () => ({}) }, '@supabase/ssr': { createBrowserClient: () => ({}) } }
  const sandbox = { exports: mod.exports, module: mod, process: { env: {} }, require: (id) => (id in stubs ? stubs[id] : loadLib(id.replace('@/lib/', ''))) }
  vm.runInNewContext(compiled, sandbox)
  return (doc) => plain(mod.exports.calcTotals(doc))
})()
const pricing = loadLib('doc-pricing')
const cents = (n) => Math.round(n * 100)

const sampleDoc = () => ({
  tax_rate: 8.25,
  apply_tax: true,
  shop_supplies: 12.5,
  parts: [
    { name: 'Pads', qty: 1, unitPrice: 89.99, taxable: true, job: 'Front brakes' },
    { name: 'Rotor', qty: 2, unitPrice: 64.37, taxable: true, job: 'Front brakes', core: 5 },
    { name: 'Oil filter', qty: 3, unitPrice: 7.33, taxable: true },
    { name: 'Clips', qty: 4, unitPrice: 0.99, taxable: false },
    { name: 'Tire disposal', qty: 1, unitPrice: 4, taxable: false, kind: 'fee' },
  ],
  labors: [
    { operation: 'Brakes', tech: '', hours: 1.75, rate: 115 },
    { operation: 'Oil change', tech: '', hours: 0.5, rate: 99.99 },
    { operation: 'Inspection', tech: '', pricing: 'flat', amount: 49.95 },
  ],
})

const handTotals = (doc) => ({
  parts: doc.parts.reduce((s, l) => s + cents(Number(l.qty) * Number(l.unitPrice)), 0),
  labor: doc.labors.reduce((s, l) => s + (l.pricing === 'flat' ? cents(Number(l.amount)) : cents(Number(l.hours) * Number(l.rate))), 0),
})

test('discount: totals after applying match calcTotals, and the discount never touches the money maths', () => {
  for (const scope of ['all', 'labor', 'parts']) {
    for (const pct of [5, 10, 15, 33, 100]) {
      const doc = sampleDoc()
      const r = plain(pricing.applyPercentDiscount(doc, scope, pct))
      const after = { ...doc, parts: r.parts, labors: r.labors }
      const t = calcTotals(after)
      const hand = handTotals(after)
      // Each line is a whole number of cents, so the document total is exactly the sum of its lines.
      assert.equal(cents(t.partsTotal), hand.parts, `${scope} ${pct}% parts`)
      assert.equal(cents(t.laborTotal), hand.labor, `${scope} ${pct}% labor`)
      // The same prices typed by hand, with no discount markers on the lines, give exactly the same totals.
      const typed = {
        ...doc,
        parts: r.parts.map((l) => omit(l, ['listPrice', 'discountPct'])),
        labors: r.labors.map((l) => omit(l, ['listRate', 'listAmount', 'discountPct'])),
      }
      assert.deepEqual(calcTotals(typed), t, `${scope} ${pct}% typed by hand`)
      // What the customer is told they saved is what came off the lines. It is worked out from unrounded prices, so a line
      // whose price lands on half a cent (0.5 h at 99.99) can differ by one cent from the rounded line totals; never more.
      const saved = pricing.discountSummary(after)
      const before = calcTotals(doc)
      const came = cents(before.partsTotal + before.laborTotal) - cents(t.partsTotal + t.laborTotal)
      assert.ok(Math.abs(came - cents(saved.total)) <= doc.parts.length + doc.labors.length, `${scope} ${pct}% saved ${came} vs ${cents(saved.total)}`)
      assert.ok(came >= 0)
      // The tax is worked out on the discounted parts only; fees and outside work are never discounted.
      assert.equal(after.parts[4].unitPrice, 4)
      if (scope === 'labor') assert.deepEqual(plain(r.parts), plain(doc.parts))
      if (scope === 'parts') assert.deepEqual(plain(r.labors), plain(doc.labors))
    }
  }
})

test('discount: taking it off puts every price back and calcTotals gives exactly the original totals', () => {
  for (const scope of ['all', 'labor', 'parts']) {
    for (const pct of [5, 10, 15, 33, 100]) {
      const doc = sampleDoc()
      const original = calcTotals(doc)
      const applied = plain(pricing.applyPercentDiscount(doc, scope, pct))
      const discounted = { ...doc, parts: applied.parts, labors: applied.labors }
      const cleared = plain(pricing.clearAllDiscounts(discounted))
      const back = { ...doc, parts: cleared.parts, labors: cleared.labors }
      assert.deepEqual(calcTotals(back), original, `${scope} ${pct}%`)
      assert.deepEqual(back.parts, doc.parts, `${scope} ${pct}% parts`)
      assert.deepEqual(back.labors, doc.labors, `${scope} ${pct}% labor`)
      assert.equal(pricing.discountSummary(back).total, 0)
    }
  }
  // Applying twice starts again from the original prices, so it never compounds.
  const doc = sampleDoc()
  const once = plain(pricing.applyPercentDiscount(doc, 'all', 10))
  const twice = plain(pricing.applyPercentDiscount({ ...doc, parts: once.parts, labors: once.labors }, 'all', 10))
  assert.deepEqual(calcTotals({ ...doc, parts: twice.parts, labors: twice.labors }), calcTotals({ ...doc, parts: once.parts, labors: once.labors }))
})

test('fees: a fee line adds exactly its amount (and its tax when taxable), and removing it gives the original totals back', () => {
  const lines = loadLib('doc-lines')
  const doc = sampleDoc()
  const original = calcTotals(doc)
  const taxableFee = plain(lines.makeFeeLine({ name: 'Environmental fee', amount: 6.5, taxable: true, kind: 'fee', job: 'Front brakes' }))
  const plainFee = plain(lines.makeFeeLine({ name: 'Towing', amount: 80, taxable: false, kind: 'sublet' }))
  const withTaxable = calcTotals({ ...doc, parts: [...doc.parts, taxableFee] })
  assert.equal(cents(withTaxable.partsTotal) - cents(original.partsTotal), 650)
  assert.equal(cents(withTaxable.taxablePartsTotal) - cents(original.taxablePartsTotal), 650)
  assert.equal(withTaxable.laborTotal, original.laborTotal)
  const withPlain = calcTotals({ ...doc, parts: [...doc.parts, plainFee] })
  assert.equal(cents(withPlain.partsTotal) - cents(original.partsTotal), 8000)
  assert.equal(withPlain.taxAmount, original.taxAmount)
  assert.equal(withPlain.taxablePartsTotal, original.taxablePartsTotal)
  // Remove them again.
  const removed = [...doc.parts, taxableFee, plainFee].filter((l) => l !== taxableFee && l !== plainFee)
  assert.deepEqual(calcTotals({ ...doc, parts: removed }), original)
  // A fee after a discount: the fee is not discounted, and taking the discount off still gives the original plus the fee.
  const d = plain(pricing.applyPercentDiscount(doc, 'all', 20))
  const discountedWithFee = calcTotals({ ...doc, parts: [...d.parts, taxableFee], labors: d.labors })
  const cleared = plain(pricing.clearAllDiscounts({ ...doc, parts: [...d.parts, taxableFee], labors: d.labors }))
  assert.deepEqual(calcTotals({ ...doc, parts: cleared.parts, labors: cleared.labors }), withTaxable)
  assert.ok(discountedWithFee.total < withTaxable.total)
})

test('discount and fees: a discount or a fee cannot be offered, applied or saved on a paid, part paid or void document', () => {
  // The editor block is behind the same frozen flag as every other way to change a line.
  const block = between(editor, '{!frozen && (p.onDiscount || p.onAddFee) && (', 'Discount and fees</h3>')
  assert.ok(block.length > 0)
  assert.match(editor, /const frozen = locked \|\| closed/)
  assert.match(editor, /const locked = isLocked\(status\)/)
  // The page refuses as well, in case a sheet was open when the document changed.
  assert.match(page, /const linesClosed = \(\) => isLocked\(form\.status\) \|\| isVoid\(form\)/)
  const handlers = between(page, 'const linesClosed', '/* ---------- templates')
  assert.equal((handlers.match(/if \(linesClosed\(\)\) \{ closeSheet\(\); return \}/g) || []).length, 2)
  assert.match(page, /onDiscount=\{\(\) => \{ if \(!linesClosed\(\)\)/)
  assert.match(page, /onAddFee=\{\(\) => \{ if \(!linesClosed\(\)\)/)
})

test('discount and fees: the sheets are imported and rendered, change only the open form, and write nothing themselves', () => {
  assert.match(page, /import \{ DiscountForm, FeeForm \} from '\.\/documents\/PricingSheets'/)
  assert.ok(page.includes('<DiscountForm'))
  assert.ok(page.includes('<FeeForm'))
  assert.match(page, /sheet === 'discount'/)
  assert.match(page, /sheet === 'fee'/)
  const handlers = between(page, 'const linesClosed', '/* ---------- templates')
  // Only the lines change. No total, tax, payment or balance is set here, and nothing is saved, sent or paid.
  assert.doesNotMatch(handlers, /\b(total|subtotal|balance_due|amount_paid|tax_amount|tax_rate|shop_supplies|deposit|status)\b\s*:/)
  assert.doesNotMatch(handlers, /saveDocumentFields|createDocument|fetch\(|calcTotals|sendDoc|openSend|postPayment|recordPayment|docAction|sendNow/)
  assert.match(handlers, /setForm\(f => \(\{ \.\.\.f, parts: r\.parts, labors: r\.labors \}\)\)/)
  assert.match(handlers, /parts: \[\.\.\.\(\(f\.parts \|\| \[\]\) as Record<string, unknown>\[\]\), line\]/)
  // The finished forms themselves reach only the pricing helpers.
  const forms = read('components/documents/PricingSheets.tsx')
  assert.doesNotMatch(code(forms), /fetch\(|saveDocumentFields|postPayment|sendNow|supabase\.from/)
  // calcTotals still delegates to the one money function and was not changed.
  assert.match(read('lib/supabase.ts'), /export function calcTotals\(doc: Record<string, unknown>\) \{[^}]*return calculateDocumentTotals\(doc\)\s*\}/)
})

/* ───────────────────── 6. Templates ───────────────────── */

const savedTemplate = () => ({
  id: 't1',
  name: 'Front brakes',
  parts: [{ name: 'Pads', qty: 1, unitPrice: 80, taxable: true, status: 'Installed', approved: true, job: 'Front brakes' }, { name: 'Rotor', qty: 2, unitPrice: 60, taxable: true }],
  labors: [{ operation: 'Brake job', tech: '', hours: 2, rate: 110, approved: true, job: 'Front brakes' }],
  shop_supplies: 15,
  notes: 'Brakes checked at 50 mph.',
  warranty_type: '12 months / 12,000 miles',
})

test('templates: the lines are added after what is already there, as fresh lines, and the template itself is not changed', () => {
  const doc = { status: 'Draft', parts: [{ name: 'Wipers', qty: 1, unitPrice: 20 }], labors: [], customer_name: 'Maria', doc_number: 'E-1042' }
  const tpl = savedTemplate()
  const before = JSON.stringify(tpl)
  const use = screen.applyTemplate(doc, tpl)
  const patch = plain(use.patch)
  assert.equal(JSON.stringify(tpl), before)
  assert.equal(use.addedParts, 2)
  assert.equal(use.addedLabors, 1)
  assert.deepEqual(patch.parts.map((l) => l.name), ['Wipers', 'Pads', 'Rotor'])
  assert.equal(patch.parts[1].status, 'Ordered')
  assert.equal('approved' in patch.parts[1], false)
  assert.equal('approved' in patch.labors[0], false)
  assert.equal(patch.labors[0].hours, 2)
  // Only lines, supplies and notes: never the customer, the car, the number, the status or anything about payments.
  assert.deepEqual(Object.keys(patch).sort(), ['labors', 'notes', 'parts', 'shop_supplies'])
  assert.equal(use.warranty, '12 months / 12,000 miles')
  // The totals of the result are the document's lines plus the template's, through the one money function.
  const t = calcTotals({ ...doc, ...patch })
  assert.equal(cents(t.partsTotal), cents(20 + 80 + 120))
  assert.equal(cents(t.laborTotal), cents(220))
})

test('templates: notes, supplies and warranty fill in only where the document has none of its own', () => {
  const tpl = savedTemplate()
  const own = screen.applyTemplate({ status: 'Sent', parts: [], labors: [], notes: 'Customer waiting.', shop_supplies: 9, warranty_type: '90 days' }, tpl)
  const patch = plain(own.patch)
  assert.equal('notes' in patch, false)
  assert.equal('shop_supplies' in patch, false)
  assert.equal(own.warranty, '')
  const bare = screen.applyTemplate({ status: 'Draft', notes: '   ', shop_supplies: 0, warranty_type: 'No Warranty' }, tpl)
  assert.equal(plain(bare.patch).notes, 'Brakes checked at 50 mph.')
  assert.equal(plain(bare.patch).shop_supplies, 15)
  assert.equal(bare.warranty, '12 months / 12,000 miles')
  // A template that is only a name adds nothing and changes nothing.
  const empty = screen.applyTemplate({ status: 'Draft', parts: [{ name: 'x' }] }, { parts: [], labors: [], shop_supplies: 0, notes: '', warranty_type: 'No Warranty' })
  assert.deepEqual(plain(empty.patch), {})
  assert.equal(empty.warranty, '')
  const odd = screen.applyTemplate({ status: 'Draft' }, { parts: [null, 'x', 5, { name: 'Good', qty: 1, unitPrice: 3 }], labors: 'nope' })
  assert.deepEqual(plain(odd.patch).parts.map((l) => l.name), ['Good'])
})

test('templates: a paid, part paid, paid-on or void document is never changed by a template', () => {
  const tpl = savedTemplate()
  for (const status of ['Paid', 'Partial', 'Void']) assert.equal(screen.applyTemplate({ status, parts: [], labors: [] }, tpl), null, status)
  assert.equal(screen.applyTemplate({ status: 'Unpaid', amount_paid: 40, parts: [], labors: [] }, tpl), null)
  assert.notEqual(screen.applyTemplate({ status: 'Unpaid', amount_paid: 0, parts: [], labors: [] }, tpl), null)
})

test('templates: a name is suggested from the first job, else the first line', () => {
  assert.equal(screen.templateName({ labors: [{ operation: 'Brake job', job: 'Front brakes' }], parts: [] }), 'Front brakes')
  assert.equal(screen.templateName({ labors: [{ operation: '  Oil   change ' }], parts: [] }), 'Oil change')
  assert.equal(screen.templateName({ labors: [], parts: [{ name: 'Wipers' }] }), 'Wipers')
  assert.equal(screen.templateName({}), '')
})

test('templates: the picker and the save form are imported and rendered, load only when opened, and tell a failed load', () => {
  assert.match(page, /import \{ SaveTemplateForm, TemplatePicker \} from '\.\/documents\/TemplateSheet'/)
  assert.ok(page.includes('<TemplatePicker'))
  assert.ok(page.includes('<SaveTemplateForm'))
  assert.match(page, /sheet === 'templates'/)
  assert.match(page, /sheet === 'savetemplate'/)
  // Read when the picker opens, not when the page loads.
  assert.equal((page.match(/getTemplates\(\)/g) || []).length, 1)
  assert.match(between(page, 'const openTemplates', 'const startFromTemplate'), /void loadTemplates\(\)/)
  // A failed read shows the reason with Try again; the unavailable and empty notes come from the picker itself.
  assert.match(page, /templatesError \? \(\s*<div>\s*<ErrorMsg>\{templatesError\}<\/ErrorMsg>\s*<button type="button" className="btn btn-secondary mt-3" onClick=\{\(\) => void loadTemplates\(\)\}>Try again/)
  assert.match(page, /available=\{templatesAvailable\}/)
  const picker = read('components/documents/TemplateSheet.tsx')
  assert.match(picker, /Templates need a database update first/)
  assert.match(picker, /No templates yet/)
})

test('templates: starting from one is only offered while the lines can change, and only edits the open form', () => {
  assert.match(editor, /\{!frozen && \(p\.onAddCanned \|\| p\.onTemplates\) && \(/)
  assert.match(editor, /Start from a template/)
  assert.match(page, /onTemplates=\{openTemplates\}/)
  const handlers = between(page, 'const loadTemplates', '/* ---------- render')
  const start = between(handlers, 'const startFromTemplate', 'const removeTemplate')
  assert.match(start, /const use = linesClosed\(\) \? null : applyTemplate\(/)
  assert.match(start, /setForm\(f => \(\{ \.\.\.f, \.\.\.use\.patch \}\)\)/)
  assert.doesNotMatch(start, /saveDocumentFields|createDocument|fetch\(|calcTotals|sendDoc|openSend|postPayment|recordPayment|docAction|sendNow/)
  assert.match(handlers, /const openTemplates = \(\) => \{\s*if \(linesClosed\(\)\) return/)
})

test('templates: saving one stores the lines, supplies, customer notes and warranty, and never the private notes, customer or car', () => {
  const save = between(page, 'const saveAsTemplate', '/* ---------- render')
  assert.match(save, /saveTemplate\(\{/)
  assert.doesNotMatch(save, /internal_notes|customer_|vehicle_|doc_number|phone|email|signature/)
  assert.match(save, /needsUpdate \? 'Templates need a database update first\./)
  assert.match(page, /\{ key: 'template', label: 'Save as a template'/)
  assert.doesNotMatch(code(save), /saveDocumentFields|createDocument|sendDoc|openSend|postPayment|recordPayment|docAction|sendNow/)
})

/* ───────────────────── 7. Parts markup rules in Settings ───────────────────── */

const editorLib = loadLib('markup-editor')
const rulesDraft = (over = {}) => ({
  enabled: true,
  mode: 'markup',
  roundTo: 'cent',
  rows: [{ key: 'a', upTo: '10', pct: '100' }, { key: 'b', upTo: '100', pct: '50' }, { key: 'c', upTo: '', pct: '30' }],
  ...over,
})

test('markup rules: what is typed becomes the stored rules, in order, and bad rows are named', () => {
  const ok = editorLib.draftToMatrix(rulesDraft({ rows: [{ key: 'c', upTo: '', pct: '30' }, { key: 'a', upTo: '$10', pct: '100%' }, { key: 'b', upTo: '100', pct: '50' }, { key: 'x', upTo: '', pct: '' }] }))
  assert.deepEqual(plain(ok.matrix), { enabled: true, mode: 'markup', tiers: [{ upTo: 10, pct: 100 }, { upTo: 100, pct: 50 }, { upTo: null, pct: 30 }], roundTo: 'cent' })
  assert.deepEqual(plain(ok.rowErrors), {})
  assert.equal(ok.problem, '')
  const bad = editorLib.draftToMatrix(rulesDraft({ rows: [
    { key: 'a', upTo: 'abc', pct: '10' },
    { key: 'b', upTo: '20', pct: '' },
    { key: 'c', upTo: '-5', pct: '10' },
    { key: 'd', upTo: '30', pct: '10' },
    { key: 'e', upTo: '30.00', pct: '20' },
    { key: 'f', upTo: '', pct: '10' },
    { key: 'g', upTo: '', pct: '20' },
    { key: 'h', upTo: '40', pct: '5000' },
  ] }))
  assert.deepEqual(Object.keys(plain(bad.rowErrors)).sort(), ['a', 'b', 'c', 'e', 'g', 'h'])
  assert.equal(bad.matrix.tiers.length, 2)
  const margin = editorLib.draftToMatrix(rulesDraft({ mode: 'margin', rows: [{ key: 'a', upTo: '', pct: '96' }] }))
  assert.match(margin.rowErrors.a, /95%/)
  assert.match(editorLib.draftToMatrix(rulesDraft({ rows: [] })).problem, /at least one rule/)
  assert.equal(editorLib.draftToMatrix(rulesDraft({ enabled: false, rows: [] })).problem, '')
  // The draft round trip keeps the rules, and an untouched draft counts as unchanged.
  const stored = ok.matrix
  const back = editorLib.matrixToDraft(stored)
  assert.deepEqual(plain(editorLib.draftToMatrix(back).matrix), plain(stored))
  assert.equal(editorLib.sameDraft(back, editorLib.matrixToDraft(stored)), true)
  assert.equal(editorLib.sameDraft(back, { ...back, enabled: !back.enabled }), false)
})

test('markup rules: the preview and the suggestion use matrixPrice, and the same rules give the same price', () => {
  const rules = editorLib.draftToMatrix(rulesDraft()).matrix
  assert.equal(pricing.matrixPrice(rules, 5), 10)
  assert.equal(pricing.matrixPrice(rules, 40), 60)
  assert.equal(pricing.matrixPrice(rules, 200), 260)
  assert.equal(editorLib.markupSuggestion(rules, 40), pricing.matrixPrice(rules, 40))
  assert.equal(editorLib.markupSuggestion(rules, 200), 260)
  assert.equal(editorLib.topIsCapped(rules), null)
  const capped = editorLib.draftToMatrix(rulesDraft({ rows: [{ key: 'a', upTo: '50', pct: '40' }] })).matrix
  assert.equal(editorLib.topIsCapped(capped), 50)
  assert.equal(editorLib.markupSuggestion(capped, 80), null)
  assert.equal(pricing.tierSummary(rules, rules.tiers[1], 1), '$10.00 to $100.00: 50% markup')
})

test('markup rules: nothing is suggested unless the shop turned the rules on, and rules saved before the switch stay off', () => {
  const on = editorLib.draftToMatrix(rulesDraft()).matrix
  const off = editorLib.draftToMatrix(rulesDraft({ enabled: false })).matrix
  assert.equal(editorLib.markupSuggestion(off, 40), null)
  assert.equal(editorLib.markupSuggestion(on, 40), 60)
  assert.equal(editorLib.markupSuggestion(null, 40), null)
  assert.equal(editorLib.markupSuggestion(undefined, 40), null)
  // On with no rules suggests nothing.
  assert.equal(editorLib.markupSuggestion({ ...on, tiers: [] }, 40), null)
  // A cost of zero, or no cost, never gets a price.
  assert.equal(editorLib.markupSuggestion(on, 0), null)
  assert.equal(editorLib.markupSuggestion(on, ''), null)
  // Rules stored by an earlier version carry no switch, so they load as off. A shop that never opened this screen gets off.
  const old = pricing.normalizeMatrix({ mode: 'markup', roundTo: 'cent', tiers: [{ upTo: null, pct: 40 }] })
  assert.equal(old.enabled, false)
  assert.equal(editorLib.markupSuggestion(old, 100), null)
  assert.equal(pricing.matrixPrice(old, 100), 140)
  assert.equal(pricing.normalizeMatrix(null).enabled, false)
  assert.equal(pricing.normalizeMatrix({ enabled: 'yes' }).enabled, false)
  assert.equal(pricing.normalizeMatrix({ enabled: true }).enabled, true)
  const prefs = loadLib('doc-prefs')
  assert.equal(prefs.normalizePrefs(null).matrix.enabled, false)
  assert.equal(prefs.DEFAULT_PREFS.matrix.enabled, false)
  assert.equal(prefs.normalizePrefs({ matrix: { enabled: true, tiers: [{ upTo: null, pct: 20 }] } }).matrix.enabled, true)
})

test('markup rules: a suggestion is a button on the part, never applied by itself, and only offered while the lines can change', () => {
  // The part card shows the suggestion only for an open card with a cost, and applies it only on the button.
  const cards = read('components/documents/LineCards.tsx')
  assert.match(cards, /const suggestion = tools\?\.suggestPrice && cost > 0 && !readOnly \? tools\.suggestPrice\(cost\) : null/)
  assert.match(cards, /onClick=\{\(\) => onChange\(\{ unitPrice: suggestion, listPrice: undefined, discountPct: undefined \}\)\}>Use it/)
  // The editor passes tools only when the page gave it a suggestion function, and never for a frozen document.
  assert.match(editor, /const partTools = p\.suggestPrice && !frozen \? \{ jobNames: jobNames\(form as Record<string, unknown>\), suggestPrice: p\.suggestPrice \} : undefined/)
  assert.match(editor, /tools=\{partTools\}/)
  // The page passes the function only when the rules are on and there is at least one.
  assert.match(page, /suggestPrice=\{docPrefs\.prefs\.matrix\.enabled && docPrefs\.prefs\.matrix\.tiers\.length > 0 \? \(cost: number\) => markupSuggestion\(docPrefs\.prefs\.matrix, cost\) : undefined\}/)
  // No loop over existing lines: the suggestion is only ever computed for one cost at a time.
  assert.doesNotMatch(code(page), /matrixPrice|markupSuggestion\([^)]*\bmap\b/)
})

test('markup rules: the Settings section is listed, loads when opened, edits only the rules through the settings route, and previews with matrixPrice', () => {
  const settings = read('app/(app)/settings/page.tsx')
  assert.match(settings, /import MarkupSection from '@\/components\/settings\/MarkupSection'/)
  assert.match(settings, /\{ id: 'pricing', label: 'Parts pricing', sub: 'Markup rules for part prices', icon: 'tag', hasFields: false \}/)
  assert.match(settings, /\{s\.id === 'pricing' && <MarkupSection \/>\}/)
  const section = read('components/settings/MarkupSection.tsx')
  assert.match(section, /import \{ getPrefs, savePrefs \} from '@\/components\/documents\/api'/)
  assert.match(section, /import \{ matrixPrice, tierFor, tierSummary \} from '@\/lib\/doc-pricing'/)
  assert.match(section, /matrixPrice\(matrix, cost\)/)
  assert.match(section, /savePrefs\(\{ \.\.\.fresh\.data\.prefs, matrix: result\.matrix \}\)/)
  // Saving starts from a fresh read, and a failed read stops the save.
  assert.match(section, /Your current settings could not be checked, so nothing was saved/)
  // Four states, a read-only mode for people who may not edit, and words with the lamps.
  assert.match(section, /aria-label="Loading markup rules"/)
  assert.match(section, /<ErrorCard title="Markup rules did not load"[^>]*onRetry=\{\(\) => void read\(\)\}/)
  assert.match(section, /No rules yet\. Add one/)
  assert.match(section, /Only the owner, an admin or a manager can change these rules/)
  assert.match(section, /Markup rules need a database update first/)
  // Never reaches a document, a payment or a message.
  assert.doesNotMatch(code(section), /saveDocumentFields|createDocument|supabase\.from|from\('documents'\)|postPayment|sendNow|sendDoc|calcTotals|docAction/)
  assert.doesNotMatch(code(read('lib/markup-editor.ts')), /fetch\(|supabase|saveDocumentFields/)
})

test('markup rules: reading the settings fails loudly instead of returning defaults that a save would write over the real ones', () => {
  const server = read('lib/doc-server.ts')
  assert.match(server, /Promise<\{ prefs: DocPrefs; available: boolean; failed: boolean \}>/)
  assert.match(server, /if \(error\) return \{ prefs: normalizePrefs\(null\), available: !isMissingSchema\(error\), failed: !isMissingSchema\(error\) \}/)
  assert.match(server, /return \{ prefs: normalizePrefs\(data\?\.data\), available: true, failed: false \}/)
  const route = read('app/api/document-data/[kind]/route.ts')
  assert.match(route, /if \(readFailed\) return failed\('The settings could not be loaded\.'\)/)
  // The other callers keep reading { prefs } and are not affected.
  assert.match(read('lib/doc-respond.ts'), /loadPrefs\(db, link\.shop_id\)/)
})

/* ───────────────────── Everything together ───────────────────── */

const NEW_FILES = [
  'lib/doc-screen.ts',
  'lib/markup-editor.ts',
  'components/documents/useDeclinedWork.ts',
  'components/documents/useDocPrefs.ts',
  'components/settings/MarkupSection.tsx',
]
const TOUCHED_FILES = [
  'components/DocumentsPage.tsx',
  'components/documents/DocEditor.tsx',
  'components/documents/DocList.tsx',
  'components/documents/ActionSheets.tsx',
  'components/documents/CannedSheet.tsx',
  'app/(app)/settings/page.tsx',
  'app/(app)/work/page.tsx',
]

test('nothing new sends a customer anything, takes a payment, or reaches the sheets that were left unwired', () => {
  // The send, sign and pay calls in the page are the ones that were already there, in the same number.
  assert.equal((page.match(/fetch\(/g) || []).length, 4)
  assert.equal((page.match(/\/api\/send-document/g) || []).length, 1)
  assert.equal((page.match(/\/api\/sign/g) || []).length, 2)
  assert.equal((page.match(/postPayment/g) || []).length, 2)
  assert.doesNotMatch(page, /sendNow|previewSend|SendSheet|OptionsSheet|ApprovalPanel|saveOptionGroup|deleteOptionGroup|getOptions|getLinkSummaries|getSignature/)
  for (const file of [...NEW_FILES, 'components/documents/DocEditor.tsx', 'components/documents/DocList.tsx', 'components/documents/ActionSheets.tsx']) {
    const src = read(file)
    const imports = src.split('\n').filter((l) => /^import /.test(l)).join('\n')
    assert.doesNotMatch(imports, /SendSheet|OptionsSheet|ApprovalPanel|sendNow|previewSend|postPayment|api\/sign|SignatureForm/, file)
    assert.doesNotMatch(code(src), /\/api\/send-document|\/api\/sign|sendNow\(|postPayment\(|\/api\/make-call|\/api\/ai-call|sms|telnyx/i, file)
  }
  // The money files and the signature flow are not touched by this work.
  assert.match(read('lib/supabase.ts'), /export function calcTotals\(doc: Record<string, unknown>\) \{[^}]*return calculateDocumentTotals\(doc\)\s*\}/)
})

test('nothing new writes totals: the only save is the existing one, and the new handlers only set lines, notes and the like', () => {
  // The save, the payment plan (both already there) and the private shop note that records a void or restore: nothing else.
  assert.equal((page.match(/saveDocumentFields\(/g) || []).length, 3)
  assert.equal((page.match(/saveDocumentFields\(id, \{ internal_notes: next \}\)/g) || []).length, 1)
  assert.equal((page.match(/saveDocumentFields\(target\.id, \{ payment_plan: plan \}\)/g) || []).length, 1)
  assert.equal((page.match(/createDocument\(/g) || []).length, 1)
  for (const file of NEW_FILES) assert.doesNotMatch(code(read(file)), /saveDocumentFields|createDocument|MONEY_FIELDS|\.from\('documents'\)|amount_paid\s*:/, file)
})

test('design rules: tokens only, no emoji, no uppercase or wide tracking, plain sentence case, on everything added here', () => {
  const banned = [
    [/\btext-white\b|\bbg-white\b/, 'white'],
    [/\b(?:text|bg|border|ring|from|to|via)-gray-\d/, 'gray scale'],
    [/\b(?:bg|text|border)-\[#/, 'hardcoded hex colour'],
    [/#[0-9a-fA-F]{3,8}\b(?![^'"`]*[a-z]{4})/, 'hex colour'],
    [/gradient/, 'gradient'],
    [/\bshadow(?:-[a-z0-9]+)?\b/, 'shadow'],
    [/backdrop-blur/, 'blur'],
    [/\buppercase\b|\btracking-wide(?:r|st)\b/, 'uppercase or wide tracking'],
    [/\p{Extended_Pictographic}/u, 'emoji'],
  ]
  for (const file of [...NEW_FILES, ...TOUCHED_FILES]) {
    // The one existing line that draws a signature as dark ink on white paper is not part of this work.
    const src = code(read(file)).split('\n').filter((l) => !l.includes('a signature is dark ink on white paper')).join('\n')
    for (const [re, what] of banned) assert.doesNotMatch(src, re, `${file}: ${what}`)
  }
})

test('design rules: the new screens have a loading, error, empty and filled state, and every new button is a real size', () => {
  const section = read('components/settings/MarkupSection.tsx')
  for (const word of ['skeleton', 'ErrorCard', 'No rules yet', 'Unsaved changes']) assert.ok(section.includes(word), word)
  // Inputs are the shared 16px form controls and buttons are the shared 44px ones; nothing is sized by hand below that.
  assert.doesNotMatch(section, /className="[^"]*\b(?:h|min-h)-\[(?:[1-3]\d|4[0-3])px\]/)
  assert.doesNotMatch(section, /text-\[(?:1[0-5]|[0-9])px\]/)
  assert.match(section, /className="form-input num"/)
  // The new editor buttons use the shared button classes.
  for (const label of ['Discount', 'Add a fee', 'Start from a template']) assert.match(editor, new RegExp(`className="btn btn-secondary[^"]*"[^>]*>\\s*<Icon name="[a-z]+" className="h-5 w-5" />\\s*${label}`), label)
})
