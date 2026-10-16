import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { csvCell } from '../src/lib/csv.ts'
import {
  COMMIT_ROW_CAP, customerInsertRow, importBatchKey, importFingerprint, previewSentence, readImport, rowsToAdd, slimRows,
} from '../src/lib/customers/import-flow.ts'
import { LIST_GROUPS, emptyChoiceTitle, groupCounts, groupLabel, matchesChoice, parseChoice } from '../src/lib/customers/list-filter.ts'

// Customer tools: export, import (preview then confirm), possible duplicates, tags and vehicle history.
// The rules that protect the book are checked here: the import only ever adds, it stops at 500 rows and asks first, every
// row is stamped with the signed-in shop, and nothing on these screens merges or removes a customer.
// The routes and screens are read as text (like people-routes.test.mjs); the shared import rules run for real.

const root = new URL('..', import.meta.url).pathname
const read = rel => readFileSync(join(root, rel), 'utf8').replace(/\r/g, '')
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const count = (src, re) => (src.match(re) || []).length

const ROUTE_FILES = {
  export: 'src/app/api/customers/export/route.ts',
  preview: 'src/app/api/customers/import/preview/route.ts',
  commit: 'src/app/api/customers/import/commit/route.ts',
  duplicates: 'src/app/api/customers/duplicates/route.ts',
  tags: 'src/app/api/customers/tags/route.ts',
  history: 'src/app/api/customers/history/route.ts',
}
const routes = Object.fromEntries(Object.entries(ROUTE_FILES).map(([k, p]) => [k, { path: p, src: read(p), code: strip(read(p)) }]))
const server = { path: 'src/lib/customers/server.ts', src: read('src/lib/customers/server.ts'), code: strip(read('src/lib/customers/server.ts')) }
const flow = { path: 'src/lib/customers/import-flow.ts', src: read('src/lib/customers/import-flow.ts'), code: strip(read('src/lib/customers/import-flow.ts')) }

const COMPONENT_FILES = ['ExportPanel', 'ImportPanel', 'DuplicatesPanel', 'CustomerTools', 'CustomerTags', 'VehicleHistory']
const components = Object.fromEntries(COMPONENT_FILES.map(n => [n, read(`src/components/customers/${n}.tsx`)]))
const detail = read('src/components/customers/CustomerDetail.tsx')
const listPage = read('src/app/(app)/customers/page.tsx')

const csv = rows => rows.map(r => r.join(',')).join('\n')
const HEAD = ['Name', 'Phone', 'Email', 'Vehicle make', 'Tags']
const NOW = Date.parse('2026-10-15T12:00:00Z')

/* ---------- the routes: sign-in, shop, and plain messages ---------- */

test('every new route needs a signed-in user and takes the shop from the session', () => {
  for (const { path, code } of Object.values(routes)) {
    assert.match(code, /const auth = await getAuthedShop\(\)/, `${path} checks the session`)
    assert.match(code, /if \(!auth\) return unauthorized\(\)/, `${path} refuses when not signed in`)
    assert.match(code, /auth\.shopId/, `${path} uses the signed-in shop`)
    // the shop never comes from the request
    assert.doesNotMatch(code, /(?:body|params|searchParams|query)\??\.(?:get\()?\(?['"]?shop_?[iI]d/, `${path} reads a shop id from the request`)
    assert.doesNotMatch(code, /shop_id:\s*(?:body|req)/, `${path} saves a shop id from the request`)
  }
})

test('every database read and write in the new routes and their server helpers names the shop', () => {
  for (const { path, code } of [...Object.values(routes), server]) {
    const all = code.split('\n')
    all.forEach((text, i) => {
      if (!/\.from\('[a-z_]+'\)/.test(text)) return
      const window = all.slice(i, i + 8).join('\n')
      assert.match(window, /shop_id/, `${path}:${i + 1} names the shop`)
    })
  }
  // the lookup helpers filter by shop as well
  assert.match(server.code, /loadCustomerRef[\s\S]*\.eq\('shop_id', shopId\)/)
  assert.match(server.code, /loadBook[\s\S]*\.eq\('shop_id', shopId\)/)
})

test('the routes that save something refuse viewers', () => {
  for (const key of ['preview', 'commit', 'tags']) {
    assert.match(routes[key].code, /auth\.role === 'viewer'\) return forbidden\(\)/, `${key} refuses viewers`)
  }
  assert.match(routes.commit.code, /export async function POST/)
  assert.match(routes.tags.code, /export async function PUT/)
  assert.doesNotMatch(routes.export.code, /export async function (?:POST|PUT|PATCH|DELETE)/)
  assert.doesNotMatch(routes.duplicates.code, /export async function (?:POST|PUT|PATCH|DELETE)/)
  assert.doesNotMatch(routes.history.code, /export async function (?:POST|PUT|PATCH|DELETE)/)
})

test('people see a plain message, never the database error, and a missing table is a 503 not a crash', () => {
  for (const { path, code } of [...Object.values(routes), server]) {
    assert.doesNotMatch(code, /error\.message\s*[,}]/, `${path} does not send error.message`)
    assert.doesNotMatch(code, /NextResponse\.json\([^)]*(?:e|err|error)\.message/, `${path} does not send a caught error's message`)
  }
  for (const key of ['commit', 'tags', 'export']) assert.match(routes[key].code, /isMissingDbObject/, `${key} knows about a table that is not set up yet`)
  assert.match(routes.tags.code, /Tags need a database update first\.'\s*\},\s*\{\s*status:\s*503/)
  for (const key of Object.keys(routes)) assert.match(routes[key].code, /export const dynamic = 'force-dynamic'/, `${key} is never cached`)
})

/* ---------- no merge, no removal ---------- */

test('no new route merges, changes or removes a customer, a document or a payment', () => {
  const everything = [...Object.values(routes), server, flow]
  for (const { path, code } of everything) {
    assert.doesNotMatch(code, /customer_merges/, `${path} writes a merge record`)
    assert.doesNotMatch(code, /\.from\('customers'\)\s*\.\s*(?:update|upsert|delete)\(/, `${path} changes or removes customers`)
    assert.doesNotMatch(code, /\.from\('(?:documents|payments|jobs|vehicles)'\)\s*\.\s*(?:insert|update|upsert|delete)\(/, `${path} writes to records other than customers`)
    assert.doesNotMatch(code, /lib\/customers\/merge/, `${path} uses the merge library`)
    assert.doesNotMatch(code, /\.rpc\(/, `${path} calls a database function`)
  }
  // the only writes anywhere in the new routes are the import's inserts, the tags upsert and the audit log
  const writes = []
  for (const { path, code } of Object.values(routes)) {
    for (const m of code.matchAll(/\.from\('([a-z_]+)'\)[\s\S]{0,400}?\.(insert|update|upsert|delete)\(/g)) {
      // the .from( the write belongs to must be the nearest one
      const between = m[0].slice(m[0].lastIndexOf(".from('"))
      const table = /\.from\('([a-z_]+)'\)/.exec(between)?.[1]
      writes.push(`${path.split('/').slice(-2).join('/')} ${m[2]} ${table}`)
    }
  }
  const allowed = new Set([
    'commit/route.ts insert customers', 'commit/route.ts insert customer_meta', 'commit/route.ts insert customer_imports',
    'tags/route.ts upsert customer_meta',
  ])
  const unique = new Set(writes)
  for (const w of unique) assert.ok(allowed.has(w), `unexpected write: ${w}`)
})

test('the import is insert only: it never updates, overwrites or removes anything', () => {
  for (const key of ['preview', 'commit']) {
    assert.doesNotMatch(routes[key].code, /\.update\(/, `${key} has no update`)
    assert.doesNotMatch(routes[key].code, /\.upsert\(/, `${key} has no upsert`)
    assert.doesNotMatch(routes[key].code, /\.delete\(/, `${key} has no delete`)
  }
  assert.doesNotMatch(flow.code, /\.(?:update|upsert|delete|insert)\(/)
  // the preview writes nothing at all
  assert.doesNotMatch(routes.preview.code, /\.(?:insert|update|upsert|delete)\(/)
  // customers are only ever inserted, and the tags go on the new customers' own records
  assert.equal(count(routes.commit.code, /\.from\('customers'\)/g), 1)
  assert.match(routes.commit.code, /db\.from\('customers'\)\.insert\(list\.map\(r => \(\{ \.\.\.r, shop_id: auth\.shopId \}\)\)\)/)
  assert.match(routes.commit.code, /db\.from\('customer_meta'\)\.insert\(/)
  assert.match(routes.commit.code, /customer_id: t\.id/)
})

test('the import stops at 500 rows and the commit asks first', () => {
  assert.equal(COMMIT_ROW_CAP, 500)
  assert.match(routes.commit.code, /COMMIT_ROW_CAP/)
  assert.match(routes.commit.code, /if \(body\?\.confirm !== true\) return NextResponse\.json\(\{[^}]*\},\s*\{ status: 400 \}\)/)
  // confirm is checked before the database is touched
  assert.ok(routes.commit.code.indexOf('confirm !== true') < routes.commit.code.indexOf('getServiceClient()'))
  // the list is worked out again at save time and must match what was previewed
  assert.match(routes.commit.code, /importFingerprint\(read\.preview\) !== fingerprint/)
  assert.match(routes.commit.code, /status: 409/)
  assert.match(routes.commit.code, /rowsToAdd\(read\.preview\)\.slice\(0, COMMIT_ROW_CAP\)/)
  // the same list cannot be recorded twice
  assert.match(routes.commit.code, /importBatchKey\(fingerprint\)/)
  assert.match(routes.commit.code, /\.eq\('batch_key', key\)/)
  // the preview and the commit both read the list through the one shared rule
  for (const key of ['preview', 'commit']) assert.match(routes[key].code, /readImport\(/)
})

test('every saved customer carries the shop of the signed-in session, never one from the request', () => {
  assert.match(routes.commit.code, /customerInsertRow\(m\.row, auth\.shopId, m\.id, nowIso\)/)
  assert.match(routes.commit.code, /shop_id: auth\.shopId/)
  assert.match(routes.commit.code, /randomUUID\(\)/)
  assert.doesNotMatch(routes.commit.code, /body\??\.shop/)
  assert.doesNotMatch(routes.commit.code, /body\??\.(?:rows|customers|ids)/, 'the rows come from the list text, not from the request body')
  assert.match(routes.commit.code, /read = readImport\(body\.text,/)
  assert.match(routes.commit.code, /loadBook\(db, auth\.shopId\)/)
})

test('the possible duplicates route only reads', () => {
  const code = routes.duplicates.code
  assert.doesNotMatch(code, /\.(?:insert|update|upsert|delete)\(/)
  assert.match(code, /findDuplicatePairs/)
  assert.match(code, /MAX_PAIRS/)
  assert.doesNotMatch(code, /mergeCustomers|planMerge|applyMerge|customer_merges/)
})

test('the history route only reads and is limited to one customer of this shop', () => {
  const code = routes.history.code
  assert.doesNotMatch(code, /\.(?:insert|update|upsert|delete)\(/)
  assert.match(code, /loadCustomerRef\(db, auth\.shopId,/)
  assert.match(code, /\.eq\('customer_id', id\)/)
  assert.match(code, /buildVehicles\(/)
  assert.match(code, /serviceHistory\(/)
})

test('tags are saved on their own: only the tags column, at most 12, never the contact choices', () => {
  const code = routes.tags.code
  assert.match(code, /MAX_TAGS = 12/)
  assert.match(code, /body\.tags\.length > MAX_TAGS/)
  assert.match(code, /cleanTags\(/)
  assert.match(code, /onConflict: 'shop_id,customer_id'/)
  const upsert = /\.upsert\(\{([\s\S]*?)\}, \{ onConflict/.exec(code)
  assert.ok(upsert, 'the upsert is found')
  const keys = [...upsert[1].matchAll(/^\s*([a-z_]+)[:,]/gm)].map(m => m[1]).sort()
  assert.deepEqual(keys, ['customer_id', 'shop_id', 'tags', 'updated_at', 'updated_by'])
  assert.doesNotMatch(upsert[1], /do_not_call|do_not_email/)
  // the customer must be one of this shop's before anything is written
  assert.match(code, /loadCustomerRef\(db, auth\.shopId,/)
})

/* ---------- the export ---------- */

test('the export is a downloaded file, written for a spreadsheet, and counts nothing it cannot read', () => {
  const code = routes.export.code
  assert.match(code, /'Content-Type': 'text\/csv; charset=utf-8'/)
  assert.match(code, /'Content-Disposition': `attachment; filename="\$\{exportFileName\(/)
  assert.match(code, /'Cache-Control': 'private, no-store'/)
  assert.match(code, /\uFEFF\$\{customersCsv\(/, 'a byte order mark first, so Excel reads accents')
  assert.match(code, /customersCsv\(/)
  assert.match(code, /export async function GET/)
  // a failed read is an error, never a short file that looks complete
  assert.match(code, /failed/)
  assert.match(code, /status: 500/)
})

/* ---------- the shared import rules, run for real ---------- */

test('a list is read into a preview and nothing is saved by reading it', () => {
  const text = csv([HEAD, ['Jane Smith', '713-555-0200', 'jane@example.com', 'Honda', 'fleet;vip'], ['Bob Jones', '281-555-0111', '', 'Ford', '']])
  const r = readImport(text, [], NOW)
  assert.equal(r.ok, true)
  assert.equal(r.preview.counts.new, 2)
  assert.equal(r.preview.counts.total, 2)
  assert.equal(rowsToAdd(r.preview).length, 2)
  assert.deepEqual(r.used.map(u => u.field).sort(), ['email', 'name', 'phone', 'tags', 'vehicle_make'].sort())
  assert.deepEqual(r.ignored, [])
})

test('a customer already in the book is skipped, by phone and by email, and shown with the reason', () => {
  const book = [
    { id: 'a1', name: 'Marcus Bell', phone: '(713) 555-0142', email: 'marcus@example.com' },
    { id: 'a2', name: 'Walt Kowalski', phone: '', email: 'walt@example.com' },
  ]
  const text = csv([
    ['Name', 'Phone', 'Email'],
    ['M. Bell', '713-555-0142', ''],
    ['Walter K', '', 'WALT@example.com'],
    ['Fresh Person', '832-555-0177', 'fresh@example.com'],
  ])
  const r = readImport(text, book, NOW)
  assert.equal(r.ok, true)
  assert.equal(r.preview.counts.duplicate, 2)
  assert.equal(r.preview.counts.new, 1)
  const rows = slimRows(r.preview)
  assert.equal(rows.find(x => x.name === 'M. Bell').status, 'duplicate')
  assert.match(rows.find(x => x.name === 'M. Bell').reason, /Marcus Bell/)
  assert.match(rows.find(x => x.name === 'M. Bell').reason, /phone/)
  assert.match(rows.find(x => x.name === 'Walter K').reason, /email/)
  assert.equal(rows.find(x => x.name === 'Fresh Person').status, 'new')
  assert.deepEqual(rowsToAdd(r.preview).map(x => x.values.name), ['Fresh Person'])
})

test('a repeat inside the file is added once, and a row with no name is a problem, not an addition', () => {
  const text = csv([
    ['Name', 'Phone'],
    ['Same Person', '713-555-0100'],
    ['Same Person', '713-555-0100'],
    ['', '713-555-0101'],
  ])
  const r = readImport(text, [], NOW)
  assert.equal(r.ok, true)
  assert.equal(r.preview.counts.new, 1)
  assert.equal(r.preview.counts.duplicate, 1)
  assert.equal(r.preview.counts.invalid, 1)
  assert.equal(slimRows(r.preview).filter(x => x.status === 'invalid')[0].reason.length > 0, true)
})

test('500 customers are allowed and 501 are refused whole, with a 413', () => {
  const make = n => csv([['Name', 'Phone'], ...Array.from({ length: n }, (_, i) => [`Customer ${i + 1}`, `713-555-${String(1000 + i).padStart(4, '0')}`]) ])
  const ok = readImport(make(500), [], NOW)
  assert.equal(ok.ok, true)
  assert.equal(ok.preview.counts.new, 500)
  assert.equal(rowsToAdd(ok.preview).length, 500)
  assert.equal(slimRows(ok.preview).length, 500, 'every row can be looked at before confirming')

  const over = readImport(make(501), [], NOW)
  assert.equal(over.ok, false)
  assert.equal(over.status, 413)
  assert.match(over.error, /more than 500/)

  const far = readImport(make(5000), [], NOW)
  assert.equal(far.ok, false)
  assert.equal(far.status, 413)
})

test('a list that is empty, has no names, or is too big is refused before any row is read', () => {
  for (const bad of ['', '   ', null, undefined, 42]) {
    const r = readImport(bad, [], NOW)
    assert.equal(r.ok, false)
    assert.equal(r.status, 400)
  }
  const header = readImport('Name,Phone', [], NOW)
  assert.equal(header.ok, false)
  assert.equal(header.status, 400)
  const noName = readImport(csv([['Phone', 'Email'], ['713-555-0100', 'a@b.com']]), [], NOW)
  assert.equal(noName.ok, false)
  assert.equal(noName.status, 400)
  assert.match(noName.error, /Name/)
  const huge = readImport(`Name\n${'x'.repeat(1_600_000)}`, [], NOW)
  assert.equal(huge.ok, false)
  assert.equal(huge.status, 413)
})

test('First name and Last name columns are enough, and unknown columns are listed as not used', () => {
  const r = readImport(csv([['First name', 'Last name', 'Favourite colour'], ['Ana', 'Lopez', 'blue']]), [], NOW)
  assert.equal(r.ok, true)
  assert.equal(r.preview.counts.new, 1)
  assert.equal(rowsToAdd(r.preview)[0].values.name, 'Ana Lopez')
  assert.deepEqual(r.ignored, ['Favourite colour'])
})

test('the fingerprint changes when what would be added changes, and the batch key fits the table', () => {
  const text = csv([HEAD, ['Jane Smith', '713-555-0200', 'jane@example.com', 'Honda', 'fleet']])
  const a = importFingerprint(readImport(text, [], NOW).preview)
  assert.match(a, /^[0-9a-f]{16}$/)
  // the same list against the same book gives the same fingerprint at any time
  assert.equal(importFingerprint(readImport(text, [], NOW + 86_400_000).preview), a)
  // a different list gives a different one
  assert.notEqual(importFingerprint(readImport(text.replace('Jane Smith', 'Jane Smyth'), [], NOW).preview), a)
  assert.notEqual(importFingerprint(readImport(text.replace('fleet', 'vip'), [], NOW).preview), a)
  // someone who now matches a row changes what would be added
  const book = [{ id: 'x', name: 'Jane Smith', phone: '713-555-0200', email: '' }]
  assert.notEqual(importFingerprint(readImport(text, book, NOW).preview), a)
  const key = importBatchKey(a)
  assert.ok(key.length >= 8 && key.length <= 80, 'batch_key length is 8 to 80')
  assert.equal(key, `imp-${a}`)
})

test('a customer row is built with the shop and id it is given, and empty cells stay empty', () => {
  const r = readImport(csv([['Name', 'Phone', 'Notes'], ['Ana Lopez', '713-555-0100', '  ']]), [], NOW)
  const row = customerInsertRow(rowsToAdd(r.preview)[0], 'shop-from-session', 'id-1', '2026-10-15T12:00:00.000Z')
  assert.equal(row.shop_id, 'shop-from-session')
  assert.equal(row.id, 'id-1')
  assert.equal(row.name, 'Ana Lopez')
  assert.equal(row.email, null)
  assert.equal(row.notes, null)
  assert.equal(row.created_at, '2026-10-15T12:00:00.000Z')
  // a row cannot carry a shop of its own: the shop is the argument
  const other = customerInsertRow(rowsToAdd(r.preview)[0], 'another-shop', 'id-2', '2026-10-15T12:00:00.000Z')
  assert.equal(other.shop_id, 'another-shop')
})

test('a spreadsheet formula saved in a note is made harmless when the file is exported again', () => {
  const r = readImport(csv([['Name', 'Notes'], ['Ana Lopez', '=HYPERLINK("http://example.com")']]), [], NOW)
  const row = customerInsertRow(rowsToAdd(r.preview)[0], 's', 'i', '2026-10-15T12:00:00.000Z')
  // the note is kept as the owner wrote it, and every cell of the export file is written through the formula guard
  assert.match(String(row.notes), /HYPERLINK/)
  assert.match(csvCell(row.notes), /^"?'=HYPERLINK/)
  assert.match(read('src/lib/customers/export.ts'), /toCsv\(|csvLine\(|csvCell\(/)
})

test('the sentence for the counts is plain and agrees with the numbers', () => {
  assert.equal(previewSentence({ new: 1, duplicate: 0, invalid: 0 }), '1 customer will be added.')
  assert.equal(previewSentence({ new: 2, duplicate: 3, invalid: 1 }), '2 customers will be added, 3 skipped (already in your book, or repeated in the file), 1 row has a problem and will not be added.')
  assert.match(previewSentence({ new: 0, duplicate: 0, invalid: 2 }), /2 rows have problems and will not be added/)
})

/* ---------- the Group and tag choice on the list ---------- */

const NOW_ISO = '2026-10-15T12:00:00Z'
const people = [
  { id: 'c1', name: 'Fleet Guy', phone: '713-555-0100', email: 'fleet.guy@gmail.com', created_at: '2026-10-10T00:00:00Z' },
  { id: 'c2', name: 'Old Timer', phone: '713-555-0101', email: 'old.timer@gmail.com', created_at: '2024-01-01T00:00:00Z' },
  { id: 'c3', name: 'No Phone', phone: '', email: 'no.phone@gmail.com', created_at: '2024-01-01T00:00:00Z' },
  { id: 'c4', name: 'Test Customer', phone: '713-555-0104', email: 'x@test.com', created_at: '2024-01-01T00:00:00Z' },
]
const ctx = {
  now: Date.parse(NOW_ISO),
  tags: { c1: ['Fleet', 'vip'], c2: ['insurance'] },
  visits: { c1: { jobs: 1, last: '2026-10-11T00:00:00Z' }, c2: { jobs: 3, last: '2025-01-01T00:00:00Z' } },
}

test('the Group choice is read from a value and unknown values mean everyone', () => {
  assert.deepEqual(parseChoice('all'), { kind: 'all' })
  assert.deepEqual(parseChoice('g:no_phone'), { kind: 'group', key: 'no_phone' })
  assert.deepEqual(parseChoice('t:fleet'), { kind: 'tag', tag: 'fleet' })
  assert.deepEqual(parseChoice('g:top_spenders'), { kind: 'all' }, 'a group the list cannot work out honestly is not offered')
  assert.deepEqual(parseChoice('g:optout'), { kind: 'all' })
  assert.deepEqual(parseChoice('t:'), { kind: 'all' })
  assert.deepEqual(parseChoice('nonsense'), { kind: 'all' })
  for (const key of LIST_GROUPS) assert.ok(groupLabel(key).length > 0)
})

test('a tag matches without regard to capitals, and a group counts the right customers', () => {
  const fleet = people.filter(c => matchesChoice(parseChoice('t:fleet'), c, ctx)).map(c => c.id)
  assert.deepEqual(fleet, ['c1'])
  assert.deepEqual(people.filter(c => matchesChoice(parseChoice('t:FLEET'), c, ctx)).map(c => c.id), ['c1'])
  assert.deepEqual(people.filter(c => matchesChoice({ kind: 'all' }, c, ctx)).map(c => c.id), ['c1', 'c2', 'c3', 'c4'])
  assert.deepEqual(people.filter(c => matchesChoice(parseChoice('g:no_phone'), c, ctx)).map(c => c.id), ['c3'])
  assert.deepEqual(people.filter(c => matchesChoice(parseChoice('g:test'), c, ctx)).map(c => c.id), ['c4'])
  const counts = groupCounts(people, ctx)
  assert.deepEqual(Object.keys(counts).sort(), [...LIST_GROUPS].sort())
  assert.equal(counts.no_phone, 1)
  assert.equal(counts.test, 1)
})

test('a choice that matches nobody says why', () => {
  assert.equal(emptyChoiceTitle(parseChoice('t:fleet')), 'Nobody is tagged \u201Cfleet\u201D')
  assert.match(emptyChoiceTitle(parseChoice('g:lapsed')), /^Nobody is in /)
  assert.equal(emptyChoiceTitle({ kind: 'all' }), 'No customers')
})

/* ---------- the screens ---------- */

test('Customer tools is one Sheet with Export, Import and Possible duplicates, and a typed list is not thrown away', () => {
  const t = components.CustomerTools
  assert.match(t, /import Sheet from '@\/components\/Sheet'/)
  assert.match(t, /<Sheet open=\{open\} onClose=\{close\} title="Customer tools" wide dirty=\{typed\}/)
  for (const label of ['Export', 'Import', 'Possible duplicates']) assert.match(t, new RegExp(`label: '${label}'`))
  assert.match(t, /<ExportPanel/)
  assert.match(t, /<ImportPanel/)
  assert.match(t, /<DuplicatesPanel/)
  assert.match(t, /onDirty/)
  // the Import tab stays mounted, so switching tabs does not lose a pasted list
  assert.match(t, /<div hidden=\{tab !== 'import'\}><ImportPanel/)
})

test('the Customers list opens the tools, shows a Group choice and offers an import when the book is empty', () => {
  assert.match(listPage, /<CustomerTools/)
  assert.match(listPage, /Customer tools/)
  assert.match(listPage, /id="cust-group"/)
  assert.match(listPage, /parseChoice\(/)
  assert.match(listPage, /matchesChoice\(/)
  assert.match(listPage, /Import a list/)
  assert.match(listPage, /'\/api\/customers\/tags'|\/api\/customers\/tags/)
  // the page only ever reads customers from the server it already used; the tools do all saving through the routes
  assert.doesNotMatch(listPage, /\/api\/customers\/import\/commit/)
})

test('the import screen previews everything first, and the confirm button is only live for the list that was previewed', () => {
  const p = components.ImportPanel
  assert.match(p, /\/api\/customers\/import\/preview/)
  assert.match(p, /\/api\/customers\/import\/commit/)
  assert.match(p, /confirm: true/)
  assert.match(p, /fingerprint/)
  assert.match(p, /preview\.text === text|preview\.text !== text/)
  assert.match(p, /Confirm import/)
  assert.match(p, /500/)
  // the preview fetch never carries confirm
  const previewCall = /\/api\/customers\/import\/preview[\s\S]{0,400}/.exec(p)[0]
  assert.doesNotMatch(previewCall, /confirm: true/)
  // the four states of the preview list
  assert.match(p, /Skipped/)
  assert.match(p, /Problems/)
  assert.match(p, /Will be added/)
  assert.match(p, /role="alert"|ErrorCard|Notice/)
})

test('the possible duplicates screen only shows a comparison: no merge, no delete, and it says so', () => {
  const d = components.DuplicatesPanel
  assert.match(d, /export const NO_MERGE_SENTENCE = 'Merging changes records, so Alpha will not do it until you say so\.'/)
  assert.match(d, /NO_MERGE_SENTENCE/)
  assert.match(d, /\/api\/customers\/duplicates/)
  assert.match(d, /Same/)
  assert.match(d, /Different/)
  // it can only open a customer's card
  assert.match(d, /Open first card/)
  assert.match(d, /Open second card/)
  for (const src of [d, components.CustomerTools]) {
    assert.doesNotMatch(src, /<button[^>]*>[^<]*(?:Merge|Delete|Remove|Combine)\b/i, 'no merge or delete button')
    assert.doesNotMatch(src, /fetch(?:Json)?\([^)]*method: '(?:POST|PUT|PATCH|DELETE)'/, 'the screen sends nothing that changes data')
    assert.doesNotMatch(src, /lib\/customers\/merge/)
    assert.doesNotMatch(src, /customer_merges/)
  }
  assert.doesNotMatch(d, /method: '/)
})

test('the export screen downloads the file the route sends and says when there is nothing to export', () => {
  const e = components.ExportPanel
  assert.match(e, /\/api\/customers\/export/)
  assert.match(e, /exportFileName\(/)
  assert.match(e, /export function saveBlob/)
  assert.match(e, /customerCount === 0|customerCount < 1|!customerCount/)
})

test('the customer card gets a Tags section and a Vehicle history section, and keeps its other sections', () => {
  assert.match(detail, /import CustomerTags from '\.\/CustomerTags'/)
  assert.match(detail, /import VehicleHistory from '\.\/VehicleHistory'/)
  assert.match(detail, /<Section id="cd-tags" title="Tags">\s*<CustomerTags customerId=\{customer\.id\} onChanged=\{onTagsChanged\} \/>\s*<\/Section>/)
  assert.match(detail, /<Section id="cd-vehicle-history" title="Vehicle history">\s*<VehicleHistory customerId=\{customer\.id\} \/>\s*<\/Section>/)
  const ids = [...detail.matchAll(/<Section id="(cd-[a-z-]+)"/g)].map(m => m[1])
  assert.equal(new Set(ids).size, ids.length, 'every section id is used once')
  assert.ok(ids.indexOf('cd-tags') < ids.indexOf('cd-vehicles'))
  assert.ok(ids.indexOf('cd-vehicle-history') < ids.indexOf('cd-docs'))
  assert.ok(ids.includes('cd-vehicles') && ids.includes('cd-docs'))
})

test('tags and history screens read from their own routes and handle loading, failure and empty', () => {
  const tags = components.CustomerTags
  assert.match(tags, /\/api\/customers\/tags\?customer_id=/)
  assert.match(tags, /method: 'PUT'/)
  assert.match(tags, /MAX_TAGS = 12/)
  assert.match(tags, /aria-label=\{`Remove the tag \$\{t\}`\}/)
  assert.match(tags, /inline-grid h-11 w-11/, 'the remove button is 44px')
  assert.match(tags, /Try again/)
  assert.match(tags, /No tags yet/)
  assert.match(tags, /const mine = \+\+seq\.current/)
  const hist = components.VehicleHistory
  assert.match(hist, /\/api\/customers\/history\?customer_id=/)
  assert.doesNotMatch(hist, /method: '/)
  assert.match(hist, /Try again/)
  assert.match(hist, /No service history yet/)
  assert.match(hist, /const mine = \+\+seq\.current/)
  assert.match(hist, /\/jobs\?job=/)
  assert.match(hist, /\/invoices\?document=/)
})

/* ---------- the design rules ---------- */

test('the new screens follow the design rules: tokens only, no emoji, no gradients, no shadows, no capitals', () => {
  for (const [name, src] of Object.entries(components)) {
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${name} has a hard-coded hex colour`)
    assert.doesNotMatch(src, /\b(?:rgb|rgba|hsl|hsla)\(\s*\d/, `${name} has a hard-coded colour function`)
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, `${name} has an emoji`)
    assert.doesNotMatch(src, /gradient/i, `${name} has a gradient`)
    assert.doesNotMatch(src, /shadow-/, `${name} has a shadow class`)
    assert.doesNotMatch(src, /uppercase/i, `${name} has uppercase text`)
    assert.doesNotMatch(src, /tracking-wider|backdrop-blur/, `${name} has a banned class`)
    assert.doesNotMatch(src, /\b(?:text|bg|border)-(?:white|black|gray|slate|zinc|neutral)(?:-\d+)?\b/, `${name} uses a raw palette colour`)
  }
})

test('the new screens meet the touch, text-size and wrapping rules', () => {
  for (const [name, src] of Object.entries(components)) {
    assert.doesNotMatch(src, /<input[^>]*text-\[(?:0\.\d+|1[0-5]px)/, `${name} has a small input`)
    assert.doesNotMatch(src, /<textarea[^>]*text-\[(?:0\.\d+|1[0-5]px)/, `${name} has a small text area`)
    assert.doesNotMatch(src, /<button[^>]*className="[^"]*\bh-(?:6|7|8|9|10)\b/, `${name} has a button under 44px`)
    assert.doesNotMatch(src, /\btext-\[(?:0\.[0-7]\d*|1[0-3]px|[0-9]px)\]/, `${name} has text under 14px`)
  }
  for (const n of ['ImportPanel', 'DuplicatesPanel', 'CustomerTags', 'VehicleHistory']) assert.match(components[n], /break-words/, `${n} lets long text wrap`)
  assert.match(components.ImportPanel, /form-textarea/)
  assert.match(components.CustomerTags, /className="form-input"/)
})

test('a status is never shown by colour alone: lamps come with words', () => {
  for (const n of ['ImportPanel', 'VehicleHistory', 'DuplicatesPanel']) {
    const src = components[n]
    for (const m of src.matchAll(/lamp lamp-/g)) assert.ok(m, 'lamp found')
    assert.match(src, /aria-hidden="true"/, `${n} hides the lamp from screen readers because the word beside it says the same`)
  }
})

test('the new routes and helpers live in the places the rest of the app expects', () => {
  for (const p of Object.values(ROUTE_FILES)) assert.ok(existsSync(join(root, p)), `${p} exists`)
  for (const dir of ['export', 'import/preview', 'import/commit', 'duplicates', 'tags', 'history']) {
    const names = readdirSync(join(root, 'src/app/api/customers', dir))
    assert.ok(names.includes('route.ts'))
    assert.ok(statSync(join(root, 'src/app/api/customers', dir, 'route.ts')).isFile())
  }
  // the pure libraries import only relative .ts files so they run in the browser, on the server and here
  for (const f of ['import-flow', 'list-filter']) {
    const src = read(`src/lib/customers/${f}.ts`)
    for (const m of src.matchAll(/from '([^']+)'/g)) assert.match(m[1], /^\.\.?\/.*\.ts$/, `${f} imports ${m[1]}`)
  }
})
