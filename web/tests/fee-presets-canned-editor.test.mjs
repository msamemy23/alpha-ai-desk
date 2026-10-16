// Two screens that were written but could not be reached are now reachable: Settings, Usual charges (the fee presets the Add a fee
// sheet offers) and the editor for a canned job's vehicle versions, keywords and extra fees (opened from the canned job's form).
// Pure functions are tested directly. The screens are checked by reading the source: that they are listed and rendered, save
// through the routes that already existed, check before saving with the same clean-up the server applies, and show all four states.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { loadLib } from './estimates-helper.mjs'

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const plain = (x) => JSON.parse(JSON.stringify(x))
/** Every line of the source that is not a comment, so a word in a comment cannot satisfy or break a check. */
const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

const prefsLib = loadLib('doc-prefs')
const fees = loadLib('fee-presets-editor')
const canned = loadLib('canned-match')
const extrasLib = loadLib('canned-extras-editor')

/* ───────────────────── 1. Usual charges: the typed rows become the stored list ───────────────────── */

const row = (over = {}) => ({ id: 'a', name: 'Tire disposal', amount: '5', taxable: true, kind: 'fee', ...over })

test('usual charges: typed rows become the stored list, cleaned, and rows left empty are ignored', () => {
  const r = fees.rowsToFees([
    row({ id: 'a', name: '  Tire   disposal ', amount: '$5' }),
    row({ id: 'b', name: 'Machine shop', amount: '1,250.456', taxable: false, kind: 'sublet' }),
    row({ id: 'c', name: '', amount: '' }),
    row({ id: 'd', name: '  ', amount: ' ' }),
  ])
  assert.deepEqual(plain(r.errors), {})
  assert.equal(r.problem, '')
  assert.deepEqual(plain(r.fees), [
    { id: 'a', name: 'Tire disposal', amount: 5, taxable: true, kind: 'fee' },
    { id: 'b', name: 'Machine shop', amount: 1250.46, taxable: false, kind: 'sublet' },
  ])
  // Nothing typed at all is a valid, empty list (it removes every saved charge).
  assert.deepEqual(plain(fees.rowsToFees([])), { fees: [], errors: {}, problem: '' })
})

test('usual charges: what the screen builds is exactly what the server keeps, so no row is lost when it saves', () => {
  const list = fees.rowsToFees([row({ id: 'a' }), row({ id: 'b', name: 'Towing', amount: '85.5', kind: 'sublet', taxable: false })]).fees
  // The settings route runs the body through normalizePrefs; the fees it keeps are the fees that were sent.
  assert.deepEqual(plain(prefsLib.normalizePrefs({ fees: list }).fees), plain(list))
  assert.deepEqual(plain(prefsLib.normalizeFees(list)), plain(list))
  // The Add a fee sheet fills its boxes from name, amount, taxable and kind: all four survive.
  for (const f of list) for (const k of ['id', 'name', 'amount', 'taxable', 'kind']) assert.ok(k in f, k)
})

test('usual charges: each problem is named on its row, and nothing is silently dropped', () => {
  const bad = fees.rowsToFees([
    row({ id: 'a', name: '', amount: '5' }),
    row({ id: 'b', amount: 'abc' }),
    row({ id: 'c', name: 'Zero', amount: '0' }),
    row({ id: 'd', name: 'Negative', amount: '-5' }),
    row({ id: 'e', name: 'Huge', amount: '100000.01' }),
    row({ id: 'f', name: 'x'.repeat(61), amount: '5' }),
    row({ id: 'g', name: 'Same name', amount: '5' }),
    row({ id: 'h', name: 'SAME NAME', amount: '6' }),
    row({ id: 'i', name: 'Half typed', amount: '' }),
    row({ id: 'j', name: '', amount: '12' }),
  ])
  assert.deepEqual(Object.keys(plain(bad.errors)).sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'h', 'i', 'j'])
  assert.match(bad.errors.a.name, /what the charge is for/)
  assert.match(bad.errors.b.amount, /Enter the amount/)
  assert.match(bad.errors.c.amount, /above \$0/)
  assert.match(bad.errors.e.amount, /\$100,000/)
  assert.match(bad.errors.f.name, /60 characters/)
  assert.match(bad.errors.h.name, /same name|already has this name/i)
  // The valid row is still built; the screen blocks the save while any row has an error.
  assert.deepEqual(plain(bad.fees.map((f) => f.id)), ['g'])
  // The limits are inclusive: $100,000.00 and a 60 character name are fine.
  const edge = fees.rowsToFees([row({ id: 'a', name: 'y'.repeat(60), amount: '100000' })])
  assert.deepEqual(plain(edge.errors), {})
  assert.equal(edge.fees[0].amount, 100000)
})

test('usual charges: more than 20 is a plain message, and the amounts are never used for any money maths', () => {
  const many = Array.from({ length: 21 }, (_, i) => row({ id: `r${i}`, name: `Charge ${i}`, amount: String(i + 1) }))
  assert.match(fees.rowsToFees(many).problem, /up to 20 usual charges/)
  assert.equal(fees.rowsToFees(many.slice(0, 20)).problem, '')
  assert.equal(fees.rowsToFees(many.slice(0, 20)).fees.length, 20)
  assert.equal(fees.MAX_FEES, 20)
  assert.doesNotMatch(code(read('lib/fee-presets-editor.ts')), /document-money|calculateDocumentTotals|taxRate|fetch\(|supabase/)
})

test('usual charges: stored charges come back as rows and back again unchanged, with unique ids', () => {
  const stored = prefsLib.normalizeFees([
    { id: 'x', name: 'Tire disposal', amount: 5, taxable: true, kind: 'fee' },
    { id: 'x', name: 'Towing', amount: 85.5, taxable: false, kind: 'sublet' },
    { name: 'Environmental fee', amount: 3.25 },
  ])
  const rows = fees.feesToRows(stored)
  assert.equal(new Set(rows.map((r) => r.id)).size, 3)
  assert.equal(rows[0].amount, '5.00')
  assert.equal(rows[1].amount, '85.50')
  assert.equal(rows[1].kind, 'sublet')
  assert.equal(rows[2].taxable, true)
  const back = fees.rowsToFees(rows)
  assert.deepEqual(plain(back.errors), {})
  assert.deepEqual(plain(back.fees.map(({ name, amount, taxable, kind }) => ({ name, amount, taxable, kind }))), plain(stored.map(({ name, amount, taxable, kind }) => ({ name, amount, taxable, kind }))))
  assert.equal(fees.sameRows(rows, fees.feesToRows(stored).map((r, i) => ({ ...r, id: rows[i].id }))), true)
  assert.equal(fees.sameRows(rows, rows.map((r, i) => (i === 0 ? { ...r, amount: '6.00' } : r))), false)
  assert.equal(fees.sameRows(rows, rows.map((r, i) => (i === 0 ? { ...r, name: `  ${r.name} ` } : r))), true)
  // New ids never repeat an id already in use.
  const taken = new Set(rows.map((r) => r.id))
  for (let i = 0; i < 50; i++) { const id = fees.newFeeId(taken); assert.ok(!taken.has(id)); taken.add(id) }
  const blank = plain(fees.newFeeRow([]))
  assert.match(blank.id, /^fee-/)
  assert.deepEqual({ ...blank, id: '' }, { id: '', name: '', amount: '', taxable: true, kind: 'fee' })
})

/* ───────────────────── 2. Usual charges: the Settings section ───────────────────── */

test('usual charges: Settings lists the section, renders it, and the section saves through the existing settings route', () => {
  const settings = read('app/(app)/settings/page.tsx')
  assert.match(settings, /import FeePresetsSection from '@\/components\/settings\/FeePresetsSection'/)
  assert.match(settings, /type SectionId = 'shop' \| 'pricing' \| 'fees' \| 'ai'/)
  assert.match(settings, /\{ id: 'fees', label: 'Usual charges', sub: 'Fees you add to bills often', icon: 'dollar', hasFields: false \}/)
  assert.match(settings, /\{s\.id === 'fees' && <FeePresetsSection \/>\}/)
  // The earlier section is untouched.
  assert.match(settings, /\{ id: 'pricing', label: 'Parts pricing', sub: 'Markup rules for part prices', icon: 'tag', hasFields: false \}/)
  assert.match(settings, /\{s\.id === 'pricing' && <MarkupSection \/>\}/)

  const section = read('components/settings/FeePresetsSection.tsx')
  assert.match(section, /import \{ getPrefs, savePrefs \} from '@\/components\/documents\/api'/)
  assert.match(section, /import \{ MAX_FEES, feesToRows, newFeeRow, rowIsBlank, rowsToFees, sameRows \} from '@\/lib\/fee-presets-editor'/)
  // Checked before saving; saving starts from a fresh read and replaces only `fees`; a failed read stops the save.
  assert.match(section, /const result = useMemo\(\(\) => rowsToFees\(rows\), \[rows\]\)/)
  assert.match(section, /Object\.keys\(result\.errors\)\.length > 0 \|\| result\.problem/)
  assert.match(section, /const fresh = await getPrefs\(\)/)
  assert.match(section, /Your current settings could not be checked, so nothing was saved/)
  assert.match(section, /savePrefs\(\{ \.\.\.fresh\.data\.prefs, fees: result\.fees \}\)/)
  assert.match(section, /charges were kept\. Check each name and amount, then save again/)
  // Four states, a read-only mode, the database-update note, and words with the lamps.
  assert.match(section, /aria-label="Loading usual charges"/)
  assert.match(section, /<ErrorCard title="Usual charges did not load"[^>]*onRetry=\{\(\) => void read\(\)\}/)
  assert.match(section, /No usual charges yet\. Add one/)
  assert.match(section, /Only the owner, an admin or a manager can change these charges/)
  assert.match(section, /Usual charges need a database update first/)
  assert.match(section, /lamp lamp-red[\s\S]*?<strong>Not saved\.<\/strong>/)
  assert.match(section, /Unsaved changes/)
  // It never reaches a document, a payment, a message or the database directly.
  assert.doesNotMatch(code(section), /saveDocumentFields|createDocument|supabase|from\('documents'\)|postPayment|sendNow|docAction|fetch\(/)
})

test('usual charges: the same settings route is used with its own clean-up, and no table or migration was added', () => {
  const route = read('app/api/document-data/[kind]/route.ts')
  assert.match(route, /const prefs = normalizePrefs\(body\.prefs\)/)
  assert.match(route, /from\('document_settings'\)\.upsert\(/)
  assert.match(route, /if \(!WRITE_MANAGERS\.has\(auth\.role\)\) return forbidden\(\)/)
  assert.match(read('lib/doc-prefs.ts'), /fees: normalizeFees\(r\.fees\)/)
  const api = read('components/documents/api.ts')
  assert.match(api, /export const savePrefs = \(prefs: DocPrefs\) => api<\{ prefs: DocPrefs \}>\('\/api\/document-data\/settings', \{ method: 'PUT', body: \{ prefs \} \}\)/)
  const migrations = new URL('../../supabase/migrations/', import.meta.url)
  for (const f of readdirSync(migrations)) assert.doesNotMatch(readFileSync(new URL(f, migrations), 'utf8'), /fee_preset|usual_charges/i, f)
})

test('usual charges: what is saved here is what the Add a fee sheet offers', () => {
  const sheet = read('components/documents/PricingSheets.tsx')
  assert.match(sheet, /setName\(p\.name\); setAmount\(String\(p\.amount\)\); setTaxable\(p\.taxable\); setKind\(p\.kind\)/)
  assert.match(sheet, /<p className="form-label">Your usual charges<\/p>/)
  // The editor offers the same two kinds the sheet does.
  const section = read('components/settings/FeePresetsSection.tsx')
  assert.match(section, /<option value="fee">Shop fee<\/option>/)
  assert.match(section, /<option value="sublet">Outside work<\/option>/)
  assert.match(section, /Charge sales tax on this/)
})

/* ───────────────────── 3. Canned job editor: the typed rows become the stored details ───────────────────── */

const draft = (over = {}) => ({
  keywords: 'brake pads, Squeaky brakes, BRAKE PADS',
  versions: [
    { id: 'v1', label: 'Camry 2012 to 2018', makes: 'Toyota', models: 'Camry', yearFrom: '2012', yearTo: '2018', hours: '1.8', laborPrice: '', ownParts: false, parts: [] },
    { id: 'v2', label: 'Any Ford truck', makes: 'Ford', models: '', yearFrom: '', yearTo: '', hours: '', laborPrice: '$220', ownParts: true,
      parts: [{ key: 'p1', name: 'Heavy duty pads', part_number: 'hd-1', cost: '$89.50', qty: '2' }, { key: 'p2', name: '', part_number: '', cost: '', qty: '1' }] },
    { id: 'v3', label: '', makes: '', models: '', yearFrom: '', yearTo: '', hours: '', laborPrice: '', ownParts: false, parts: [] },
  ],
  fees: [
    { key: 'f1', name: ' Brake  fluid disposal ', amount: '$4.5', taxable: false, kind: 'fee' },
    { key: 'f2', name: '', amount: '', taxable: true, kind: 'fee' },
  ],
  ...over,
})
const version = (over = {}) => ({ id: 'vx', label: 'A version', makes: 'Toyota', models: '', yearFrom: '', yearTo: '', hours: '', laborPrice: '', ownParts: false, parts: [], ...over })
const job = { id: 'j1', name: 'Front brake pads', labor_hours: 1.5, labor_rate: 120, parts: [{ name: 'Standard pads', part_number: 'sp-1', cost: 60, qty: 1 }] }

test('canned editor: typed rows become the stored details, in the types the matcher reads, and empty rows are ignored', () => {
  const r = extrasLib.draftToExtras(draft(), canned.EMPTY_EXTRAS)
  assert.equal(r.ok, true)
  assert.equal(r.problem, '')
  assert.deepEqual(plain(r.errors), { versions: {}, fees: {} })
  assert.deepEqual(plain(r.extras.keywords), ['brake pads', 'Squeaky brakes'])
  assert.deepEqual(plain(r.extras.variants), [
    { id: 'v1', label: 'Camry 2012 to 2018', fit: { makes: ['Toyota'], models: ['Camry'], yearFrom: 2012, yearTo: 2018 }, hours: 1.8, laborPrice: null, parts: null },
    { id: 'v2', label: 'Any Ford truck', fit: { makes: ['Ford'], models: [], yearFrom: null, yearTo: null }, hours: null, laborPrice: 220, parts: [{ name: 'Heavy duty pads', part_number: 'hd-1', cost: 89.5, qty: 2 }] },
  ])
  assert.deepEqual(plain(r.extras.fees), [{ name: 'Brake fluid disposal', amount: 4.5, taxable: false, kind: 'fee' }])
  // The server runs the same clean-up on the same data, so saving changes nothing.
  assert.deepEqual(plain(canned.normalizeExtras(JSON.parse(JSON.stringify(r.extras)))), plain(r.extras))
})

test('canned editor: details with no box here (job-wide fit, customer note, inspection words) are carried over untouched', () => {
  const base = canned.normalizeExtras({ fit: { makes: ['Honda'], models: [], yearFrom: 2010, yearTo: null }, note: 'Pads are bedded in on the road test.', inspectionKeys: ['pads worn'], keywords: ['old'], variants: [], fees: [] })
  const r = extrasLib.draftToExtras(draft(), base)
  assert.deepEqual(plain(r.extras.fit), { makes: ['Honda'], models: [], yearFrom: 2010, yearTo: null })
  assert.equal(r.extras.note, 'Pads are bedded in on the road test.')
  assert.deepEqual(plain(r.extras.inspectionKeys), ['pads worn'])
  assert.deepEqual(plain(r.extras.keywords), ['brake pads', 'Squeaky brakes'])
  // Taking everything off keeps them too.
  const cleared = extrasLib.draftToExtras({ keywords: '', versions: [], fees: [] }, base)
  assert.equal(cleared.ok, true)
  assert.equal(cleared.extras.note, base.note)
  assert.deepEqual(plain(cleared.extras.variants), [])
})

test('canned editor: stored details open as rows and save back unchanged, and an empty job is an empty draft', () => {
  const r = extrasLib.draftToExtras(draft(), canned.EMPTY_EXTRAS)
  const back = extrasLib.extrasToDraft(r.extras)
  assert.equal(back.keywords, 'brake pads, Squeaky brakes')
  assert.equal(back.versions[0].yearFrom, '2012')
  assert.equal(back.versions[1].laborPrice, '220.00')
  assert.equal(back.versions[1].ownParts, true)
  assert.equal(back.versions[0].ownParts, false)
  assert.equal(back.fees[0].amount, '4.50')
  assert.deepEqual(plain(extrasLib.draftToExtras(back, canned.EMPTY_EXTRAS).extras), plain(r.extras))
  assert.equal(extrasLib.sameExtrasDraft(back, extrasLib.extrasToDraft(r.extras)), true)
  assert.equal(extrasLib.sameExtrasDraft(back, { ...back, keywords: `${back.keywords}, more` }), false)
  assert.equal(extrasLib.sameExtrasDraft(back, { ...back, keywords: ` ${back.keywords} ` }), true)
  const none = extrasLib.extrasToDraft(canned.EMPTY_EXTRAS)
  assert.deepEqual(plain(none), { keywords: '', versions: [], fees: [] })
  assert.deepEqual(plain(extrasLib.draftToExtras(none, canned.EMPTY_EXTRAS).extras), plain(canned.EMPTY_EXTRAS))
})

test('canned editor: every version problem is named on its box, and nothing is silently dropped', () => {
  const r = extrasLib.draftToExtras({ keywords: '', fees: [], versions: [
    version({ id: 'a', label: '' }),
    version({ id: 'b', makes: '', models: '' }),
    version({ id: 'c', yearFrom: '20x5' }),
    version({ id: 'd', makes: '', yearFrom: '2018', yearTo: '2012' }),
    version({ id: 'e', hours: 'abc' }),
    version({ id: 'f', hours: '-2' }),
    version({ id: 'g', laborPrice: 'free' }),
    version({ id: 'h', label: 'x'.repeat(61) }),
    version({ id: 'i', ownParts: true, parts: [
      { key: 'p1', name: '', part_number: '', cost: '5', qty: '1' },
      { key: 'p2', name: 'Pads', part_number: '', cost: 'abc', qty: '1' },
      { key: 'p3', name: 'Pads', part_number: '', cost: '5', qty: '0' },
      { key: 'p4', name: 'Pads', part_number: '', cost: '5', qty: '1.5' },
      { key: 'p5', name: 'Fine', part_number: '', cost: '', qty: '1' },
    ] }),
    version({ id: 'ok' }),
  ] }, canned.EMPTY_EXTRAS)
  assert.equal(r.ok, false)
  assert.deepEqual(Object.keys(plain(r.errors.versions)).sort(), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'])
  assert.match(r.errors.versions.a.label, /Name this version/)
  assert.match(r.errors.versions.b.fit, /which cars this fits/)
  assert.match(r.errors.versions.c.yearFrom, /4-digit year/)
  assert.equal(r.errors.versions.c.fit, undefined)
  assert.match(r.errors.versions.d.yearTo, /before the first year/)
  assert.match(r.errors.versions.e.hours, /Enter hours/)
  assert.match(r.errors.versions.f.hours, /Enter hours/)
  assert.match(r.errors.versions.g.laborPrice, /Enter a price/)
  assert.match(r.errors.versions.h.label, /60 characters/)
  assert.deepEqual(Object.keys(plain(r.errors.versions.i.parts)).sort(), ['p1', 'p2', 'p3', 'p4'])
  assert.match(r.errors.versions.i.parts.p1.name, /Name this part/)
  assert.match(r.errors.versions.i.parts.p2.cost, /Enter a price/)
  assert.match(r.errors.versions.i.parts.p3.qty, /whole number/)
  assert.match(r.errors.versions.i.parts.p4.qty, /whole number/)
  assert.equal(extrasLib.versionHasErrors(r.errors.versions.a), true)
  assert.equal(extrasLib.versionHasErrors(r.errors.versions.ok), false)
  // Only the good version is built.
  assert.deepEqual(plain(r.extras.variants.map((v) => v.id)), ['ok'])
})

test('canned editor: fee, keyword and count problems are plain, and the limits are the ones the server applies', () => {
  const fe = extrasLib.draftToExtras({ keywords: '', versions: [], fees: [
    { key: 'a', name: '', amount: '5', taxable: true, kind: 'fee' },
    { key: 'b', name: 'Disposal', amount: '', taxable: true, kind: 'fee' },
    { key: 'c', name: 'Zero', amount: '0', taxable: true, kind: 'fee' },
    { key: 'd', name: 'x'.repeat(61), amount: '5', taxable: true, kind: 'fee' },
    { key: 'e', name: 'Towing', amount: '85', taxable: false, kind: 'sublet' },
  ] }, canned.EMPTY_EXTRAS)
  assert.deepEqual(Object.keys(plain(fe.errors.fees)).sort(), ['a', 'b', 'c', 'd'])
  assert.match(fe.errors.fees.a.name, /what the fee is for/)
  assert.match(fe.errors.fees.b.amount, /Enter the amount/)
  assert.match(fe.errors.fees.c.amount, /above \$0/)
  assert.match(fe.errors.fees.d.name, /60 characters/)
  assert.deepEqual(plain(fe.extras.fees), [{ name: 'Towing', amount: 85, taxable: false, kind: 'sublet' }])

  const kw = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(', ')
  assert.equal(extrasLib.draftToExtras({ keywords: kw(20), versions: [], fees: [] }, canned.EMPTY_EXTRAS).ok, true)
  assert.match(extrasLib.draftToExtras({ keywords: kw(21), versions: [], fees: [] }, canned.EMPTY_EXTRAS).errors.keywords, /up to 20 keywords/)
  assert.match(extrasLib.draftToExtras({ keywords: 'k'.repeat(41), versions: [], fees: [] }, canned.EMPTY_EXTRAS).errors.keywords, /40 characters/)
  assert.deepEqual(plain(extrasLib.parseList('a, B\n b ,, A ,c')), ['a', 'B', 'c'])

  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i))
  const v31 = extrasLib.draftToExtras({ keywords: '', fees: [], versions: many(31, (i) => version({ id: `v${i}`, label: `V${i}` })) }, canned.EMPTY_EXTRAS)
  assert.match(v31.problem, /up to 30 versions/)
  assert.equal(v31.ok, false)
  assert.equal(extrasLib.draftToExtras({ keywords: '', fees: [], versions: many(30, (i) => version({ id: `v${i}`, label: `V${i}` })) }, canned.EMPTY_EXTRAS).ok, true)
  const f11 = extrasLib.draftToExtras({ keywords: '', versions: [], fees: many(11, (i) => ({ key: `f${i}`, name: `Fee ${i}`, amount: '1', taxable: true, kind: 'fee' })) }, canned.EMPTY_EXTRAS)
  assert.match(f11.problem, /up to 10 fees/)
  assert.equal(extrasLib.draftToExtras({ keywords: '', versions: [], fees: many(10, (i) => ({ key: `f${i}`, name: `Fee ${i}`, amount: '1', taxable: true, kind: 'fee' })) }, canned.EMPTY_EXTRAS).ok, true)
  assert.equal(extrasLib.MAX_VERSIONS, 30)
  assert.equal(extrasLib.MAX_FEES, 10)
  assert.equal(extrasLib.MAX_KEYWORDS, 20)
})

test('canned editor: a saved version is the one an estimate picks for that car, with its own hours, flat price, parts and the job fees', () => {
  const extras = extrasLib.draftToExtras(draft(), canned.EMPTY_EXTRAS).extras
  const camry = { year: 2015, make: 'Toyota', model: 'Camry' }
  const ford = { year: 2019, make: 'Ford', model: 'F-150' }
  const honda = { year: 2015, make: 'Honda', model: 'Civic' }
  const lateCamry = { year: 2020, make: 'Toyota', model: 'Camry' }
  assert.equal(canned.bestVariant(extras, camry).id, 'v1')
  assert.equal(canned.bestVariant(extras, ford).id, 'v2')
  assert.equal(canned.bestVariant(extras, honda), null)
  assert.equal(canned.bestVariant(extras, lateCamry), null)

  // Own hours: 1.8 h at the job's rate, the job's parts, and the extra fee.
  const a = canned.buildJobLines(job, extras, { vehicle: camry, shopRate: 100 })
  assert.equal(a.variantLabel, 'Camry 2012 to 2018')
  assert.equal(a.labors[0].hours, 1.8)
  assert.equal(a.labors[0].rate, 120)
  assert.equal(a.total, 280.5)
  // Flat labor price and parts of their own replace hours times rate and the job's parts.
  const b = canned.buildJobLines(job, extras, { vehicle: ford, shopRate: 100 })
  assert.equal(b.labors[0].amount, 220)
  assert.deepEqual(plain(b.parts.map((p) => p.name)), ['Heavy duty pads', 'Brake fluid disposal'])
  assert.equal(b.total, 403.5)
  // A car that fits no version gets the job as it always was, plus the fee.
  const c = canned.buildJobLines(job, extras, { vehicle: honda, shopRate: 100 })
  assert.equal(c.variantLabel, '')
  assert.equal(c.total, 244.5)
  const fee = b.parts.find((p) => p.kind === 'fee')
  assert.deepEqual(plain({ qty: fee.qty, unitPrice: fee.unitPrice, taxable: fee.taxable }), { qty: 1, unitPrice: 4.5, taxable: false })
  // Different parts with no rows means no parts for that car, which is not the same as the job's parts.
  const none = extrasLib.draftToExtras({ keywords: '', fees: [], versions: [version({ id: 'n', ownParts: true, parts: [] })] }, canned.EMPTY_EXTRAS).extras
  assert.deepEqual(plain(none.variants[0].parts), [])
  assert.equal(canned.buildJobLines(job, none, { vehicle: { year: 2015, make: 'Toyota', model: 'Camry' }, shopRate: 100 }).parts.length, 0)
  // The jobs that fit the car are listed first, and a keyword finds the job in the search.
  assert.deepEqual(plain(canned.jobsForVehicle([job], { j1: extras }, camry).map((x) => x.variant.id)), ['v1'])
  assert.ok(canned.searchScore({ ...job, name: 'Brakes' }, extras, 'squeaky') > 0)
  assert.equal(canned.searchScore({ ...job, name: 'Brakes' }, canned.EMPTY_EXTRAS, 'squeaky'), 0)
})

test('canned editor: the more specific version wins, and a version needs cars to fit or it is refused', () => {
  const extras = extrasLib.draftToExtras({ keywords: '', fees: [], versions: [
    version({ id: 'make', label: 'Any Toyota', makes: 'Toyota' }),
    version({ id: 'model', label: 'Camry 2010 and newer', makes: 'Toyota', models: 'Camry', yearFrom: '2010' }),
  ] }, canned.EMPTY_EXTRAS).extras
  assert.equal(canned.bestVariant(extras, { year: 2015, make: 'Toyota', model: 'Camry' }).id, 'model')
  assert.equal(canned.bestVariant(extras, { year: 2005, make: 'Toyota', model: 'Camry' }).id, 'make')
  // The server drops a version with no fit, so the editor must refuse it instead of letting it vanish.
  assert.equal(canned.normalizeExtras({ variants: [{ id: 'x', label: 'Nothing', fit: {} }] }).variants.length, 0)
  assert.equal(extrasLib.draftToExtras({ keywords: '', fees: [], versions: [version({ makes: '', models: '' })] }, canned.EMPTY_EXTRAS).ok, false)
})

test('canned editor: the words shown for a version and for a job say what is there', () => {
  assert.equal(extrasLib.fitSummary({ makes: 'Toyota, Lexus', models: 'Camry', yearFrom: '2012', yearTo: '2018' }), 'Toyota or Lexus Camry, 2012 to 2018')
  assert.equal(extrasLib.fitSummary({ makes: '', models: '', yearFrom: '2012', yearTo: '' }), '2012 and newer')
  assert.equal(extrasLib.fitSummary({ makes: '', models: '', yearFrom: '', yearTo: '2008' }), '2008 and older')
  assert.equal(extrasLib.fitSummary({ makes: '', models: '', yearFrom: '', yearTo: '' }), '')
  assert.equal(extrasLib.versionSummary(draft().versions[0]), 'Toyota Camry, 2012 to 2018 · 1.8 h')
  assert.equal(extrasLib.versionSummary(draft().versions[1]), 'Ford · $220 flat labor · 1 part')
  assert.equal(extrasLib.versionSummary(extrasLib.blankVersion()), 'No cars chosen yet')
  const ex = extrasLib.draftToExtras(draft(), canned.EMPTY_EXTRAS).extras
  assert.equal(extrasLib.describeExtras(ex), '2 versions, 2 keywords, 1 extra fee')
  assert.equal(extrasLib.describeExtras(canned.EMPTY_EXTRAS), 'Nothing added yet')
  assert.equal(extrasLib.describeExtras({ ...canned.EMPTY_EXTRAS, keywords: ['a'] }), '1 keyword')
  // Turning on parts of their own starts from the job's parts.
  const rows = extrasLib.partsToDrafts(job.parts)
  assert.deepEqual(plain(rows.map(({ name, part_number, cost, qty }) => ({ name, part_number, cost, qty }))), [{ name: 'Standard pads', part_number: 'sp-1', cost: '60.00', qty: '1' }])
  assert.deepEqual(plain(extrasLib.partsToDrafts(null)), [])
  const keys = new Set(Array.from({ length: 50 }, () => extrasLib.newDraftKey('v')))
  assert.equal(keys.size, 50)
})

/* ───────────────────── 4. Canned job editor: the screens ───────────────────── */

test('canned editor: the form opens it for a saved job only, and the page shows it in its own sheet and returns to the form', () => {
  const page = read('app/(app)/canned-jobs/page.tsx')
  assert.match(page, /import ExtrasSheet from '@\/components\/canned-jobs\/ExtrasSheet'/)
  assert.match(page, /type Panel = null \| 'form' \| 'pick' \| 'extras' \| 'delete' \| 'discard'/)
  assert.match(page, /onOpenExtras=\{editing && editing !== 'new' \? \(\) => setPanel\('extras'\) : undefined\}/)
  assert.match(page, /\{panel === 'extras' && original && <ExtrasSheet key=\{original\.id\} job=\{original\} onBack=\{\(\) => setPanel\('form'\)\} \/>\}/)
  // The job's own save is the one it always was: the extras sheet never writes the canned_jobs table.
  assert.match(page, /supabase\.from\('canned_jobs'\)\.insert\(\{ \.\.\.row, shop_id: shopId/)
  assert.match(page, /supabase\.from\('canned_jobs'\)\.update\(\{ \.\.\.row, updated_at: now \}\)/)

  const form = read('components/canned-jobs/JobForm.tsx')
  assert.match(form, /onOpenExtras\?: \(\) => void/)
  assert.match(form, /<Section title="Versions, keywords and fees">/)
  assert.match(form, /Edit versions, keywords and fees/)
  assert.match(form, /Save this job first\. Then you can add versions, keywords and fees to it\./)
})

test('canned editor: the sheet loads, checks, re-reads, and saves through the existing canned-extras route, with every state', () => {
  const sheet = read('components/canned-jobs/ExtrasSheet.tsx')
  assert.match(sheet, /import \{ getExtras, saveExtras \} from '@\/components\/documents\/api'/)
  assert.match(sheet, /const r = await getExtras\(\)/)
  assert.match(sheet, /normalizeExtras\(r\.data\.extras\?\.\[job\.id\]\)/)
  // Checked first; then a fresh read; a failed read stops the save; then the one save call for this job.
  assert.match(sheet, /if \(!result\.ok\) \{/)
  assert.match(sheet, /const fresh = await getExtras\(\)/)
  assert.match(sheet, /could not be checked, so nothing was saved/)
  assert.match(sheet, /const checked = draftToExtras\(draft, current\)/)
  assert.match(sheet, /const r = await saveExtras\(job\.id, checked\.extras\)/)
  // Four states, the database-update note, and leaving with unsaved changes.
  assert.match(sheet, /aria-label="Loading versions, keywords and fees"/)
  assert.match(sheet, /<ErrorCard title="The details for this job did not load"[^>]*onRetry=\{\(\) => void read\(\)\}/)
  assert.match(sheet, /No versions yet\. Add one when/)
  assert.match(sheet, /No extra fees\. Add one if/)
  assert.match(sheet, /Versions, keywords and fees need a database update first/)
  assert.match(sheet, /title="Discard your changes\?"/)
  assert.match(sheet, /<strong>Not saved\.<\/strong>/)
  assert.match(sheet, /Unsaved changes/)
  // The sheet never writes the job itself, a document or the database directly.
  assert.doesNotMatch(code(sheet), /supabase|from\('canned_jobs'\)|saveDocumentFields|createDocument|postPayment|sendNow|docAction|fetch\(/)
  // The save call that had no caller now has one, and only here.
  const used = []
  const walk = (dir) => {
    for (const e of readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const rel = `${dir}${e.name}`
      if (e.isDirectory()) walk(`${rel}/`)
      else if (/\.tsx?$/.test(e.name) && /import\s*\{[^}]*\bsaveExtras\b[^}]*\}\s*from\s*'[^']*documents\/api'/.test(readFileSync(new URL(rel, import.meta.url), 'utf8'))) used.push(rel)
    }
  }
  walk('../src/')
  assert.deepEqual(used, ['../src/components/canned-jobs/ExtrasSheet.tsx'])
})

test('canned editor: the route accepts only what the editor sends and cleans it with the same function', () => {
  const route = read('app/api/document-data/[kind]/route.ts')
  assert.match(route, /const data = normalizeExtras\(body\.extras\)/)
  assert.match(route, /if \(!jobId \|\| jobId\.length > 64\) return jsonError\('cannedJobId required', 400\)/)
  assert.match(route, /if \(auth\.role === 'viewer'\) return forbidden\(\)/)
  assert.match(read('components/documents/api.ts'), /export const saveExtras = \(cannedJobId: string, extras: CannedExtras\) => api<\{ extras: CannedExtras \}>\('\/api\/document-data\/canned-extras', \{ method: 'PUT', body: \{ cannedJobId, extras \} \}\)/)
  // The Add a canned job sheet reads the same extras once they are saved.
  assert.match(read('components/documents/useDocExtras.ts'), /getExtras\(\)/)
  const lib = read('lib/canned-extras-editor.ts')
  assert.match(lib, /import \{ normalizeExtras \} from '@\/lib\/canned-match'/)
  assert.doesNotMatch(code(lib), /document-money|calculateDocumentTotals|fetch\(|supabase/)
})

/* ───────────────────── 5. House style for the new screens ───────────────────── */

test('both new screens follow the design rules: tokens only, no emoji, real icons, phone-sized targets', () => {
  const files = ['components/settings/FeePresetsSection.tsx', 'components/canned-jobs/ExtrasSheet.tsx', 'components/canned-jobs/JobForm.tsx']
  const icons = read('components/Icon.tsx')
  for (const f of files) {
    const src = code(read(f))
    assert.doesNotMatch(src, /(?:text|bg|border)-\[#|text-white|bg-white|text-gray-|bg-gray-|uppercase|tracking-wider|gradient|shadow-|backdrop-blur/, f)
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, f)
    for (const m of src.matchAll(/<Icon name="(\w+)"/g)) assert.match(icons, new RegExp(`\\b${m[1]}:`), `${f} uses icon ${m[1]}`)
    // Inputs are the shared 16px form classes, never a bare input.
    for (const m of src.matchAll(/<(input|select|textarea)\b[^>]*?className="([^"]*)"/g)) {
      if (/type="checkbox"/.test(m[0])) continue
      assert.match(m[2], /form-(input|select|textarea)/, `${f}: ${m[0].slice(0, 60)}`)
    }
  }
  // Small buttons are still 44px tall on a phone (btn-sm is 44px below the sm breakpoint).
  assert.match(readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8'), /\.btn-sm \{ @apply min-h-\[44px\]/)
  // Every figure that is money or a count uses the tabular class.
  assert.match(read('components/canned-jobs/ExtrasSheet.tsx'), /className="form-input num" inputMode="decimal"/)
  assert.match(read('components/settings/FeePresetsSection.tsx'), /className="form-input num" inputMode="decimal"/)
})
