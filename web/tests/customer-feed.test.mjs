import './helpers/browser-ui-render.mjs'
import { register } from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import server from 'react-dom/server'

register('./helpers/next-link-hooks.mjs', import.meta.url)

import {
  FEED_KIND_LIMIT, FEED_MAX_ITEMS, appointmentAt, buildFeed, feedPhoneKey, inspectionWord, readKind, sameNumber,
} from '../src/lib/customers/feed.ts'
import {
  FEED_FILTERS, FEED_PAGE, KIND_ICON, countByFilter, filterLabel, itemsFor, readFeedItems, showsTime, toneMark,
} from '../src/lib/customers/feed-view.ts'

// "Everything with this customer": the route that gathers one customer's paperwork, repair orders, appointments, texts,
// calls, inspections and notes, the pure rules behind it, and the section on the customer card.
// The route and the card are read as text (like customer-tools.test.mjs); the rules run for real; the screen is drawn on the
// server with made-up rows. Nobody could click through it here.

const root = new URL('..', import.meta.url).pathname
const read = rel => readFileSync(join(root, rel), 'utf8').replace(/\r/g, '')
const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const ROUTE = 'src/app/api/customers/feed/route.ts'
const route = { src: read(ROUTE), code: strip(read(ROUTE)) }
const feedLib = { src: read('src/lib/customers/feed.ts'), code: strip(read('src/lib/customers/feed.ts')) }
const feedComponent = read('src/components/customers/CustomerFeed.tsx')
const detail = read('src/components/customers/CustomerDetail.tsx')

const ME = '5a1f3c9e-1111-4222-8333-444455556666'
const OTHER = '9b2e4d8f-7777-4888-9999-aaaabbbbcccc'
const PHONE = '7135550142'

/* ---------- the route: sign-in, shop, customer, read only ---------- */

test('the feed route needs a signed-in user and takes the shop from the session, never from the request', () => {
  const { code } = route
  assert.match(code, /const auth = await getAuthedShop\(\)/)
  assert.match(code, /if \(!auth\) return unauthorized\(\)/)
  assert.match(code, /export const dynamic = 'force-dynamic'/)
  assert.doesNotMatch(code, /(?:body|params|searchParams|query)\??\.(?:get\()?\(?['"]?shop_?[iI]d/)
  assert.doesNotMatch(code, /shop_id:\s*(?:body|req)/)
  assert.doesNotMatch(code, /shopId\s*=\s*(?:req|body|params)/)
  // the only thing read from the request is the customer id
  const gets = [...code.matchAll(/searchParams\.get\(([^)]*)\)/g)].map(m => m[1])
  assert.deepEqual(gets, ["'customer_id'"])
  assert.doesNotMatch(code, /req\.json\(|await req\.text\(|formData\(/)
})

test('the customer must be one of this shop’s, or the answer is 404 and nothing else is read', () => {
  const { code } = route
  assert.match(code, /loadCustomerRef\(db, auth\.shopId, req\.nextUrl\.searchParams\.get\('customer_id'\)\)/)
  assert.match(code, /if \(!found\.customer\) return NextResponse\.json\(\{ ok: false, error: 'Customer not found\.' \}, \{ status: 404 \}\)/)
  assert.match(code, /if \(found\.failed\) return NextResponse\.json\(\{ ok: false, error: 'The customer could not be loaded\.' \}, \{ status: 500 \}\)/)
  // the customer is checked before any feed table is touched
  assert.ok(code.indexOf('loadCustomerRef(') < code.indexOf("from('documents')"))
  assert.ok(code.indexOf("status: 404") < code.indexOf("from('documents')"))
})

test('the feed route only reads', () => {
  const { code } = route
  assert.match(code, /export async function GET\(/)
  assert.doesNotMatch(code, /export async function (?:POST|PUT|PATCH|DELETE)/)
  assert.doesNotMatch(code, /\.(?:insert|update|upsert|delete)\(/)
  assert.doesNotMatch(code, /\.rpc\(/)
  assert.doesNotMatch(code, /writeAuditLog/)
})

test('every query names the shop, and every table that holds one customer’s rows is also limited to that customer', () => {
  const lines = route.code.split('\n')
  const tables = []
  lines.forEach((text, i) => {
    const m = /\.from\('([a-z_]+)'\)/.exec(text)
    if (!m) return
    const window = lines.slice(i, i + 4).join('\n')
    tables.push(m[1])
    assert.match(window, /\.eq\('shop_id', auth\.shopId\)/, `${m[1]} (line ${i + 1}) is limited to the signed-in shop`)
    if (['documents', 'jobs', 'customer_notes', 'dvi'].includes(m[1]) && !/in\('job_id'/.test(window)) {
      assert.match(window, /\.eq\('customer_id', id\)/, `${m[1]} (line ${i + 1}) is limited to this customer`)
    }
  })
  // a customer’s own row is read only to get the phone number, again limited to the shop and the customer
  assert.match(route.code, /from\('customers'\)\.select\('phone'\)\.eq\('shop_id', auth\.shopId\)\.eq\('id', id\)/)
  assert.deepEqual([...new Set(tables)].sort(), ['appointments', 'call_history', 'customer_notes', 'customers', 'documents', 'dvi', 'jobs', 'messages'])
  // the fallback for inspections is limited to the ids of this customer’s own repair orders
  assert.match(route.code, /\.eq\('shop_id', auth\.shopId\)\.in\('job_id', ids\)/)
  assert.match(route.code, /\(await jobs\)\.rows\.map/)
})

test('texts and calls are matched by the customer’s own number, the way the customer card does, and appointments by customer or number', () => {
  const { code } = route
  assert.match(code, /\.or\(`from_address\.ilike\.%\$\{phone\}%,to_address\.ilike\.%\$\{phone\}%`\)/)
  assert.match(code, /\.or\(`from_number\.ilike\.%\$\{phone\}%,to_number\.ilike\.%\$\{phone\}%`\)/)
  assert.match(code, /customer_id\.eq\.\$\{id\},phone\.ilike\.%\$\{phone\.slice\(-4\)\}%/)
  assert.match(code, /feedPhoneKey\(card\.data\?\.phone\)/)
  // the card’s own texts and calls use the same two filters
  assert.match(detail, /from_address\.ilike\.%\$\{phone10\}%,to_address\.ilike\.%\$\{phone10\}%/)
  assert.match(detail, /from_number\.ilike\.%\$\{phone10\}%,to_number\.ilike\.%\$\{phone10\}%/)
  // no number, no text or call lookup at all
  assert.match(code, /phone\s*\? readKind\('Texts'/)
  assert.match(code, /phone\s*\? readKind\('Calls'/)
})

test('each kind is read on its own, so one that fails or is missing never fails the whole feed', () => {
  const { code } = route
  for (const label of ['Estimates and invoices', 'Repair orders', 'Appointments', 'Texts', 'Calls', 'Inspections', 'Notes']) {
    assert.match(code, new RegExp(`readKind\\('${label}'`), `${label} is read through readKind`)
  }
  assert.equal([...code.matchAll(/await db\.from\(/g)].length, 1, 'only the phone lookup is awaited outside readKind')
  // the one answer after the customer is found is a success with the notes; a 500 is only for an unexpected crash
  assert.match(code, /return NextResponse\.json\(\{ ok: true, items, total, notes \}\)/)
  assert.equal([...code.matchAll(/status: 500/g)].length, 2, 'a 500 is only for the customer lookup failing and for an unexpected crash')
  assert.doesNotMatch(code, /error\.message\s*[,}]/)
  assert.doesNotMatch(code, /NextResponse\.json\([^)]*(?:e|err|error)\.message/)
  // a table that is not there is named by the db-missing rule inside readKind
  assert.match(feedLib.code, /isMissingDbObject/)
})

test('at most 40 rows of each kind are asked for, newest first, with only the columns needed', () => {
  assert.equal(FEED_KIND_LIMIT, 40)
  assert.equal(FEED_MAX_ITEMS, 120)
  const { code } = route
  assert.ok(![...code.matchAll(/\.select\('\*'\)/g)].length, 'no select *')
  for (const cols of [...code.matchAll(/const ([A-Z_]+_COLS) = '([^']+)'/g)]) assert.doesNotMatch(cols[2], /\*/, `${cols[1]} lists its columns`)
  const limits = [...code.matchAll(/\.limit\(([A-Za-z_]+)\)/g)].map(m => m[1])
  assert.ok(limits.length >= 7)
  for (const l of limits) assert.ok(l === 'FEED_KIND_LIMIT' || l === 'APPT_READ', `unexpected limit ${l}`)
  assert.match(code, /APPT_READ = 100/)
  // newest first on every kind
  const orders = [...code.matchAll(/\.order\('([a-z_]+)', \{ ascending: false \}\)/g)].map(m => m[1])
  assert.ok(orders.length >= 8)
  assert.doesNotMatch(code, /ascending: true/)
})

test('the columns and tables the route asks for are the ones the migrations and the rest of the app use', () => {
  const sql = f => read(f)
  const notes = sql('../supabase/migrations/053_customer_records.sql')
  const noteCols = /const NOTE_COLS = '([^']+)'/.exec(route.src)[1].split(',')
  const noteTable = /create table if not exists public\.customer_notes \(([\s\S]*?)\n\);/.exec(notes)[1]
  for (const c of [...noteCols, 'archived_at', 'shop_id']) assert.match(noteTable, new RegExp(`\\b${c}\\b`), `customer_notes has ${c}`)
  const dvi36 = sql('../supabase/migrations/036_dvi_customer_link.sql')
  assert.match(dvi36, /alter table public\.dvi add column if not exists customer_id/)
  const dviBase = sql('../web/supabase/migrations/006_schema_repair_and_security.sql')
  const dviTable = /CREATE TABLE IF NOT EXISTS public\.dvi \(([\s\S]*?)\n\);/.exec(dviBase)[1]
  for (const c of /const DVI_COLS_OLD = '([^']+)'/.exec(route.src)[1].split(',')) assert.match(dviTable, new RegExp(`\\b${c}\\b`), `dvi has ${c}`)
  const apptTable = /CREATE TABLE IF NOT EXISTS public\.appointments \(([\s\S]*?)\n\);/.exec(dviBase)[1]
  for (const c of /const APPT_COLS = '([^']+)'/.exec(route.src)[1].split(',')) assert.match(apptTable, new RegExp(`\\b${c}\\b`), `appointments has ${c}`)
  const base = sql('../supabase/schema.sql')
  const tableOf = name => new RegExp(`create table if not exists ${name} \\(([\\s\\S]*?)\\n\\);`).exec(base)[1]
  // ro_number is added by a database update that is not in the repo\u2019s SQL, so the route has a way to read without it
  for (const [table, key, optional] of [['documents', 'DOC_COLS', []], ['jobs', 'JOB_COLS', ['ro_number']], ['messages', 'MESSAGE_COLS', []]]) {
    const cols = new RegExp(`const ${key} = '([^']+)'`).exec(route.src)[1].split(',')
    for (const c of cols.filter(x => !optional.includes(x))) assert.match(tableOf(table), new RegExp(`\\b${c}\\b`), `${table} has ${c}`)
  }
  assert.match(route.code, /const JOB_COLS_NO_RO = JOB_COLS\.replace\('ro_number,', ''\)/)
  assert.match(route.code, /readKind\('Repair orders', \[[\s\S]*?select\(JOB_COLS\)[\s\S]*?select\(JOB_COLS_NO_RO\)/)
  // call_history is created outside the repo’s SQL; its columns are the ones the customer card already reads
  for (const c of /const CALL_COLS = '([^']+)'/.exec(route.src)[1].split(',')) assert.match(detail, new RegExp(`\\b${c}\\b`), `the card reads call_history.${c}`)
})

/* ---------- the pure rules: matching a number ---------- */

test('a customer’s number is matched on its last ten digits however it was typed, and a short one is not trusted', () => {
  assert.equal(feedPhoneKey('(713) 555-0142'), PHONE)
  assert.equal(feedPhoneKey('+1 713-555-0142'), PHONE)
  assert.equal(feedPhoneKey('5550142'), '5550142')
  assert.equal(feedPhoneKey('555-01'), '')
  assert.equal(feedPhoneKey(null), '')
  assert.equal(sameNumber('+17135550142', PHONE), true)
  assert.equal(sameNumber('(713) 555-0142', PHONE), true)
  assert.equal(sameNumber('+17135550199', PHONE), false)
  assert.equal(sameNumber('7135550142', ''), false)
  assert.equal(sameNumber(null, PHONE), false)
})

test('an appointment sits at its date and time, or the day it was entered when the date is missing', () => {
  assert.equal(appointmentAt('2026-10-16', '09:30', '2026-10-01T00:00:00Z'), '2026-10-16T09:30:00')
  assert.equal(appointmentAt('2026-10-16', '9:05:00', ''), '2026-10-16T09:05:00')
  assert.equal(appointmentAt('2026-10-16', '', ''), '2026-10-16T00:00:00')
  assert.equal(appointmentAt('', '09:30', '2026-10-01T10:00:00Z'), '2026-10-01T10:00:00Z')
  assert.equal(appointmentAt('later', '09:30', ''), '')
})

test('an inspection is described in the words the repair order uses', () => {
  assert.equal(inspectionWord({ customer_approved: true, sent_to_customer: true }), 'Customer approved work')
  assert.equal(inspectionWord({ sent_to_customer: true, overall_status: 'red' }), 'Waiting on customer')
  assert.equal(inspectionWord({ overall_status: 'pending' }), 'Not started')
  assert.equal(inspectionWord({ overall_status: '' }), 'Not started')
  assert.equal(inspectionWord({ overall_status: 'yellow' }), 'Being checked')
})

/* ---------- reading one kind without failing the rest ---------- */

const ok = rows => () => Promise.resolve({ data: rows, error: null })
const bad = error => () => Promise.resolve({ data: null, error })
const MISSING_TABLE = { code: '42P01', message: 'relation "public.customer_notes" does not exist' }
const MISSING_COLUMN = { code: '42703', message: 'column dvi.customer_id does not exist' }
const BROKEN = { code: '57014', message: 'canceling statement due to statement timeout: select secret_column from private_table' }

test('a kind that reads fine comes back with its rows and no note', async () => {
  const r = await readKind('Texts', [ok([{ id: 'a' }])])
  assert.deepEqual(r, { rows: [{ id: 'a' }], note: '' })
  assert.deepEqual(await readKind('Texts', [ok(null)]), { rows: [], note: '' })
})

test('a table that does not exist is an empty kind with a plain note, never an error', async () => {
  const r = await readKind('Notes', [bad(MISSING_TABLE)])
  assert.deepEqual(r.rows, [])
  assert.equal(r.note, 'Notes are not set up yet, so they are left out.')
})

test('any other failure, even a thrown one, is an empty kind with a plain note that leaks nothing', async () => {
  for (const attempt of [bad(BROKEN), () => Promise.reject(new Error('connection reset by peer 10.0.0.4')), () => { throw new Error('boom') }]) {
    const r = await readKind('Calls', [attempt])
    assert.deepEqual(r.rows, [])
    assert.equal(r.note, 'Calls could not be read, so they are left out.')
    assert.doesNotMatch(r.note, /secret|10\.0|boom|timeout|statement/)
  }
})

test('a second way of reading is tried only when the first said something is not there yet', async () => {
  const used = []
  const first = bad(MISSING_COLUMN)
  const second = () => { used.push('second'); return Promise.resolve({ data: [{ id: 'via-job' }], error: null }) }
  assert.deepEqual(await readKind('Inspections', [first, second]), { rows: [{ id: 'via-job' }], note: '' })
  assert.deepEqual(used, ['second'])
  used.length = 0
  const r = await readKind('Inspections', [bad(BROKEN), second])
  assert.deepEqual(used, [], 'a real failure does not try the other way')
  assert.equal(r.note, 'Inspections could not be read, so they are left out.')
  // both ways missing: still a plain note
  assert.equal((await readKind('Inspections', [bad(MISSING_COLUMN), bad(MISSING_TABLE)])).note, 'Inspections are not set up yet, so they are left out.')
  // the second way failing for a real reason is not called "not set up"
  assert.equal((await readKind('Inspections', [bad(MISSING_COLUMN), bad(BROKEN)])).note, 'Inspections could not be read, so they are left out.')
})

/* ---------- the feed itself ---------- */

const doc = (n, over = {}) => ({
  id: `doc${n}`, customer_id: ME, type: 'Invoice', status: 'Paid', doc_number: `INV-${n}`, created_at: `2026-0${(n % 9) + 1}-10T15:00:00+00:00`,
  parts: [{ qty: 2, unitPrice: 50 }], labors: [{ hours: 1, rate: 100 }], tax_rate: 8.25, apply_tax: true, amount_paid: 208.25, ...over,
})
const rows = (over = {}) => ({ docs: [], jobs: [], appointments: [], messages: [], calls: [], inspections: [], notes: [], ...over })
const who = { customerId: ME, phone: PHONE }

test('rows of every kind come back as one feed, newest first, with plain titles', () => {
  const { items, total } = buildFeed(rows({
    docs: [doc(1, { status: 'Unpaid', amount_paid: 0, created_at: '2026-09-01T15:00:00+00:00' })],
    jobs: [{ id: 'j1', customer_id: ME, ro_number: 'RO-2026-0045', concern: 'Brake noise', status: 'Completed', created_at: '2026-09-05T15:00:00+00:00', vehicle_year: '2018', vehicle_make: 'Toyota', vehicle_model: 'Camry' }],
    appointments: [{ id: 'a1', customer_id: ME, phone: '', service: 'Oil change', status: 'Scheduled', date: '2026-10-20', time: '09:30', created_at: '2026-09-02T00:00:00Z' }],
    messages: [{ id: 'm1', from_address: '+17135550142', to_address: '+18325550000', direction: 'inbound', body: 'Is my car ready?', created_at: '2026-09-06T15:00:00+00:00' }],
    calls: [{ id: 'c1', from_number: '+17135550142', to_number: '+18325550000', direction: 'inbound', duration_secs: 3, status: 'no-answer', start_time: '2026-09-07T15:00:00+00:00' }],
    inspections: [{ id: 'i1', customer_id: ME, vehicle: '2018 Toyota Camry', overall_status: 'red', sent_to_customer: true, customer_approved: false, created_at: '2026-09-04T15:00:00+00:00' }],
    notes: [{ id: 'n1', customer_id: ME, body: 'Prefers morning drop-off', pinned: true, author_name: 'Devin', created_at: '2026-09-03T15:00:00+00:00' }],
  }), { ...who, jobWord: s => (s === 'Completed' ? 'Work done' : s) })
  assert.equal(total, 7)
  assert.deepEqual(items.map(i => i.id), ['appt:a1', 'call:c1', 'msg:m1', 'job:j1', 'dvi:i1', 'note:n1', 'doc:doc1'])
  const by = Object.fromEntries(items.map(i => [i.id, i]))
  assert.equal(by['doc:doc1'].title, 'Invoice INV-1')
  assert.equal(by['doc:doc1'].amount, 208.25, 'the total is worked out the same way as everywhere else')
  assert.equal(by['doc:doc1'].tone, 'bad', 'an unpaid invoice with a balance owes money')
  assert.equal(by['job:j1'].detail, 'RO 2026-0045 · 2018 Toyota Camry · Work done')
  assert.equal(by['appt:a1'].at, '2026-10-20T09:30:00')
  assert.equal(by['call:c1'].title, 'Missed call')
  assert.equal(by['call:c1'].tone, 'bad')
  assert.equal(by['dvi:i1'].title, 'Inspection of 2018 Toyota Camry')
  assert.equal(by['dvi:i1'].detail, 'Waiting on customer')
  assert.equal(by['note:n1'].tone, 'warn')
  assert.equal(by['msg:m1'].title, 'Text from customer')
})

test('only this customer’s rows come through: other customers’ rows are dropped even if they reach the function', () => {
  const { items } = buildFeed(rows({
    docs: [doc(1), doc(2, { customer_id: OTHER }), doc(3, { customer_id: null })],
    jobs: [
      { id: 'jmine', customer_id: ME, ro_number: '1', concern: 'a', status: 'New', created_at: '2026-09-05T15:00:00Z' },
      { id: 'jother', customer_id: OTHER, ro_number: '2', concern: 'b', status: 'New', created_at: '2026-09-05T15:00:00Z' },
      { id: 'jnone', ro_number: '3', concern: 'c', status: 'New', created_at: '2026-09-05T15:00:00Z' },
    ],
    appointments: [
      { id: 'amine', customer_id: ME, phone: '', date: '2026-10-01', time: '10:00' },
      { id: 'aphone', customer_id: null, phone: '(713) 555-0142', date: '2026-10-02', time: '10:00' },
      { id: 'aother', customer_id: OTHER, phone: '7135550142', date: '2026-10-03', time: '10:00' },
      { id: 'astranger', customer_id: null, phone: '7135559999', date: '2026-10-04', time: '10:00' },
    ],
    messages: [
      { id: 'mine1', from_address: '+17135550142', to_address: '+1832', direction: 'inbound', body: 'hi', created_at: '2026-09-06T15:00:00Z' },
      { id: 'mine2', from_address: '+1832', to_address: '+17135550142', direction: 'outbound', body: 'hello', created_at: '2026-09-06T16:00:00Z' },
      { id: 'other', from_address: '+17135559999', to_address: '+1832', direction: 'inbound', body: 'not yours', created_at: '2026-09-06T17:00:00Z' },
    ],
    calls: [
      { id: 'cmine', from_number: '+17135550142', direction: 'inbound', duration_secs: 90, status: 'completed', start_time: '2026-09-07T15:00:00Z' },
      { id: 'cother', from_number: '+17135559999', direction: 'inbound', duration_secs: 90, status: 'completed', start_time: '2026-09-07T16:00:00Z' },
    ],
    inspections: [
      { id: 'imine', customer_id: ME, created_at: '2026-09-04T15:00:00Z' },
      { id: 'ijob', created_at: '2026-09-04T16:00:00Z' },
      { id: 'iother', customer_id: OTHER, created_at: '2026-09-04T17:00:00Z' },
    ],
    notes: [
      { id: 'nmine', customer_id: ME, body: 'x', created_at: '2026-09-03T15:00:00Z' },
      { id: 'nother', customer_id: OTHER, body: 'y', created_at: '2026-09-03T16:00:00Z' },
    ],
  }), who)
  assert.deepEqual(items.map(i => i.id).sort(), [
    'appt:amine', 'appt:aphone', 'call:cmine', 'doc:doc1', 'dvi:ijob', 'dvi:imine', 'job:jmine', 'msg:mine1', 'msg:mine2', 'note:nmine',
  ])
})

test('with no phone number on the card, no text, call or appointment is matched by number', () => {
  const { items } = buildFeed(rows({
    messages: [{ id: 'm', from_address: '+17135550142', to_address: '', direction: 'inbound', body: 'x', created_at: '2026-09-06T15:00:00Z' }],
    calls: [{ id: 'c', from_number: '+17135550142', direction: 'inbound', duration_secs: 90, start_time: '2026-09-07T15:00:00Z' }],
    appointments: [
      { id: 'a1', customer_id: null, phone: '7135550142', date: '2026-10-01', time: '10:00' },
      { id: 'a2', customer_id: ME, phone: '', date: '2026-10-02', time: '10:00' },
    ],
  }), { customerId: ME, phone: '' })
  assert.deepEqual(items.map(i => i.id), ['appt:a2'])
})

test('at most 40 rows of a kind and 120 items in all go back, and the count before the cut is kept', () => {
  const many = n => Array.from({ length: n }, (_, i) => i)
  const out = buildFeed(rows({
    docs: many(60).map(i => doc(i, { id: `d${i}`, created_at: `2026-01-01T${String(10 + (i % 10)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z` })),
    jobs: many(50).map(i => ({ id: `j${i}`, customer_id: ME, concern: `c${i}`, created_at: `2026-02-01T10:${String(i).padStart(2, '0')}:00Z` })),
    messages: many(50).map(i => ({ id: `m${i}`, from_address: PHONE, direction: 'inbound', body: 'x', created_at: `2026-03-01T10:${String(i).padStart(2, '0')}:00Z` })),
    calls: many(50).map(i => ({ id: `c${i}`, from_number: PHONE, direction: 'outbound', duration_secs: 60, start_time: `2026-04-01T10:${String(i).padStart(2, '0')}:00Z` })),
  }), who)
  assert.equal(out.total, 160)
  assert.equal(out.items.length, FEED_MAX_ITEMS)
  const kinds = (items, g) => items.filter(i => i.id.startsWith(g)).length
  const all = buildFeed(rows({
    docs: many(60).map(i => doc(i, { id: `d${i}` })),
    jobs: many(50).map(i => ({ id: `j${i}`, customer_id: ME, concern: `c${i}`, created_at: `2026-02-01T10:${String(i).padStart(2, '0')}:00Z` })),
  }), who)
  assert.equal(all.total, 80)
  assert.equal(kinds(all.items, 'doc:'), 40)
  assert.equal(kinds(all.items, 'job:'), 40)
  // newest first throughout
  const times = out.items.map(i => i.at)
  assert.deepEqual(times, [...times].sort((a, b) => b.localeCompare(a)))
})

test('a long message is clipped and the whole body is never sent', () => {
  const body = 'word '.repeat(500)
  const { items } = buildFeed(rows({
    messages: [{ id: 'm', from_address: PHONE, direction: 'inbound', body, created_at: '2026-09-06T15:00:00Z' }],
    notes: [{ id: 'n', customer_id: ME, body, pinned: false, created_at: '2026-09-06T14:00:00Z' }],
  }), who)
  const text = items.find(i => i.id === 'msg:m')
  const note = items.find(i => i.id === 'note:n')
  assert.ok(text.detail.length <= 160, `text detail is ${text.detail.length} long`)
  assert.ok(note.detail.length <= 240, `note detail is ${note.detail.length} long`)
  assert.ok(JSON.stringify(items).length < 1500)
})

test('a document that cannot be added up still shows, without a made-up amount, and an empty feed is empty', () => {
  const broken = doc(1, { parts: 'not a list', labors: null, tax_rate: 'abc', amount_paid: 'x' })
  const { items } = buildFeed(rows({ docs: [broken] }), who)
  assert.equal(items.length, 1)
  assert.equal(items[0].amount, 0)
  assert.deepEqual(buildFeed(rows(), who), { items: [], total: 0 })
})

test('the pure feed library imports only relative .ts files so it runs in the browser, on the server and here', () => {
  for (const f of ['feed', 'feed-view']) {
    const src = read(`src/lib/customers/${f}.ts`)
    for (const m of src.matchAll(/from '([^']+)'/g)) assert.match(m[1], /^\.\.?\/.*\.ts$/, `${f} imports ${m[1]}`)
  }
  assert.doesNotMatch(feedLib.code, /supabase|next\/|getServiceClient/)
})

/* ---------- what the screen does with the feed ---------- */

const item = (over = {}) => ({ id: 'doc:1', at: '2026-10-01T15:00:00+00:00', kind: 'invoice', group: 'paperwork', title: 'Invoice 1', detail: 'Paid', amount: 10, href: '/invoices?document=1', tone: 'good', ...over })

test('rows from the route are checked before they are drawn', () => {
  const list = readFeedItems([
    item(),
    item({ id: 'x', group: 'other' }),
    item({ id: 'y', kind: 'weird' }),
    item({ id: 'z', tone: 'purple' }),
    item({ id: '' }),
    null, 'text', 4,
    item({ id: 'ext', href: 'https://elsewhere.example/phish' }),
    item({ id: 'amt', amount: 'lots' }),
  ])
  assert.deepEqual(list.map(i => i.id), ['doc:1', 'ext', 'amt'])
  assert.equal(list[1].href, '', 'a link that leaves the app is dropped')
  assert.equal(list[2].amount, null)
  assert.deepEqual(readFeedItems(undefined), [])
  assert.deepEqual(readFeedItems({ not: 'a list' }), [])
})

test('the four groups and All have counts and plain labels, and the filter narrows the list', () => {
  assert.deepEqual([...FEED_FILTERS], ['all', 'paperwork', 'work', 'messages', 'notes'])
  assert.deepEqual(FEED_FILTERS.map(filterLabel), ['All', 'Paperwork', 'Work', 'Texts and calls', 'Notes'])
  const list = [item({ id: 'a' }), item({ id: 'b', group: 'work', kind: 'job' }), item({ id: 'c', group: 'messages', kind: 'text_in' }), item({ id: 'd', group: 'messages', kind: 'call_in' }), item({ id: 'e', group: 'notes', kind: 'note' })]
  assert.deepEqual(countByFilter(list), { all: 5, paperwork: 1, work: 1, messages: 2, notes: 1 })
  assert.deepEqual(itemsFor(list, 'messages').map(i => i.id), ['c', 'd'])
  assert.deepEqual(itemsFor(list, 'all').map(i => i.id), ['a', 'b', 'c', 'd', 'e'])
  assert.deepEqual(itemsFor([], 'work'), [])
  assert.equal(FEED_PAGE, 20)
})

test('a row that is not plain carries a lamp with words, never colour alone', () => {
  assert.deepEqual(toneMark(item({ tone: 'bad' })), { lamp: 'red', word: 'Owes money' })
  assert.deepEqual(toneMark(item({ tone: 'bad', kind: 'call_missed', detail: '' })), { lamp: 'red', word: 'Missed' })
  assert.deepEqual(toneMark(item({ tone: 'good', detail: 'Approved' })), { lamp: 'green', word: 'Approved' })
  assert.deepEqual(toneMark(item({ tone: 'good', detail: '' })), { lamp: 'green', word: 'Done' })
  assert.deepEqual(toneMark(item({ tone: 'warn', kind: 'appointment', detail: 'No Show' })), { lamp: 'amber', word: 'No Show' })
  assert.deepEqual(toneMark(item({ tone: 'warn', kind: 'note', detail: 'Prefers mornings' })), { lamp: 'amber', word: 'Pinned' })
  assert.equal(toneMark(item({ tone: 'neutral' })), null)
  for (const kind of Object.keys(KIND_ICON)) assert.ok(KIND_ICON[kind], `${kind} has an icon`)
  assert.equal(showsTime('text_in'), true)
  assert.equal(showsTime('call_missed'), true)
  assert.equal(showsTime('appointment'), true)
  assert.equal(showsTime('invoice'), false)
  assert.equal(showsTime('note'), false)
})

/* ---------- the screen, drawn on the server ---------- */

const { FeedView, default: CustomerFeed } = await import(new URL('../src/components/customers/CustomerFeed.tsx', import.meta.url).href)
const draw = el => server.renderToStaticMarkup(el)
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
const feed = (n, over = {}) => Array.from({ length: n }, (_, i) => item({ id: `doc:${i}`, title: `Invoice ${i}`, tone: 'neutral', detail: 'Sent', amount: 100 + i, at: `2026-10-${String(28 - (i % 27)).padStart(2, '0')}T15:00:00+00:00`, ...over }))

test('while it loads the screen shows a placeholder, not an empty list', () => {
  const html = draw(React.createElement(CustomerFeed, { customerId: ME }))
  assert.match(html, /aria-busy="true"/)
  assert.match(html, /Loading everything with this customer/)
  assert.match(html, /skeleton/)
  assert.doesNotMatch(html, /Nothing yet/)
})

test('with nothing to show it says so, and says what will appear', () => {
  const html = text(draw(React.createElement(FeedView, { items: [], notes: [], total: 0 })))
  assert.match(html, /Nothing yet for this customer/)
  assert.doesNotMatch(html, /Show more|Paperwork/)
})

test('when nothing came back because some parts could not be read, it does not claim the customer has nothing', () => {
  const html = text(draw(React.createElement(FeedView, { items: [], notes: ['Texts could not be read, so they are left out.'], total: 0 })))
  assert.match(html, /Some of this could not be shown/)
  assert.match(html, /Texts could not be read, so they are left out\./)
  assert.match(html, /in the parts that could be read/)
  assert.doesNotMatch(html, /Nothing yet for this customer\./)
})

test('the list shows the filter chips with counts, rows with their date, amount and lamp, and links where a row has one', () => {
  const items = [
    item({ id: 'doc:a', title: 'Invoice INV-7', detail: 'Unpaid, balance due', amount: 208.25, tone: 'bad', href: '/invoices?document=a' }),
    item({ id: 'call:b', kind: 'call_missed', group: 'messages', title: 'Missed call', detail: '', amount: null, tone: 'bad', href: '/messages' }),
    item({ id: 'note:c', kind: 'note', group: 'notes', title: 'Pinned note', detail: 'Prefers morning drop-off', amount: null, tone: 'warn', href: '' }),
    item({ id: 'doc:d', title: 'Estimate EST-2', kind: 'estimate', detail: 'Approved', amount: 99.5, tone: 'good', href: '/estimates?document=d' }),
  ]
  const html = draw(React.createElement(FeedView, { items, notes: [], total: 4 }))
  const words = text(html)
  for (const label of ['All', 'Paperwork', 'Work', 'Texts and calls', 'Notes']) assert.match(words, new RegExp(`${label} \\d`), `${label} chip has a count`)
  assert.match(words, /All 4/)
  assert.match(words, /Paperwork 2/)
  assert.match(words, /Texts and calls 1/)
  assert.match(words, /Work 0/)
  assert.match(html, /aria-pressed="true"[^>]*>All/)
  assert.match(words, /Owes money/)
  assert.match(words, /Missed/)
  assert.match(words, /Pinned/)
  assert.match(words, /\$208\.25/)
  assert.match(words, /\$99\.50/)
  assert.match(html, /lamp lamp-red/)
  assert.match(html, /lamp lamp-amber/)
  assert.match(html, /lamp lamp-green/)
  assert.match(html, /<a href="\/invoices\?document=a"/)
  assert.match(html, /<a href="\/messages"/)
  assert.match(html, /<a href="\/estimates\?document=d"/)
  assert.doesNotMatch(html, /<a href=""/)
  assert.match(words, /Prefers morning drop-off/)
  assert.match(words, /Oct 1, 2026|Sep 30, 2026|Oct \d+/, 'a date is shown')
  assert.match(html, /<h4[^>]*>(?:September|October) 2026<\/h4>/)
  assert.match(words, /Showing 4 of 4/)
  assert.doesNotMatch(words, /Show more/)
})

test('the first 20 rows show, with a Show more button that has 20 more behind it', () => {
  const html = draw(React.createElement(FeedView, { items: feed(45), notes: [], total: 45 }))
  assert.equal((html.match(/class="ledger-row/g) || []).length, 20)
  assert.match(text(html), /Showing 20 of 45/)
  assert.match(html, /<button type="button" class="btn btn-secondary">Show more<\/button>/)
})

test('a list cut at 120 says how many there were', () => {
  const words = text(draw(React.createElement(FeedView, { items: feed(30), notes: [], total: 213 })))
  assert.match(words, /newest 30 of 213/)
  assert.doesNotMatch(text(draw(React.createElement(FeedView, { items: feed(30), notes: [], total: 30 }))), /newest 30 of/)
})

test('notes about what could not be read are shown above the list, in words', () => {
  const notes = ['Notes are not set up yet, so they are left out.', 'Calls could not be read, so they are left out.']
  const html = draw(React.createElement(FeedView, { items: feed(2), notes, total: 2 }))
  const words = text(html)
  assert.match(words, /Some of this could not be shown/)
  for (const n of notes) assert.match(words, new RegExp(n.replace(/\./g, '\\.')))
  assert.ok(html.indexOf('Some of this could not be shown') < html.indexOf('aria-label="Show only"'))
  assert.match(html, /role="status"/)
})

test('no database or programming words leak into the drawn screen', () => {
  const html = text(draw(React.createElement(FeedView, { items: feed(3), notes: ['Texts could not be read, so they are left out.'], total: 3 })))
  assert.doesNotMatch(html, /undefined|\[object|NaN|null|relation "|schema cache|pgrst|sqlstate|customer_id|shop_id/i)
})

/* ---------- the screen’s source: fetching, states, design rules ---------- */

test('the screen loads from the feed route and has loading, error with a retry, empty and populated states', () => {
  const src = feedComponent
  assert.match(src, /\/api\/customers\/feed\?customer_id=\$\{encodeURIComponent\(customerId\)\}/)
  assert.match(src, /fetchJson\(/)
  assert.doesNotMatch(src, /method: '/, 'it only reads')
  assert.doesNotMatch(src, /shop_?id/i)
  assert.match(src, /const mine = \+\+seq\.current/)
  assert.match(src, /role="alert"/)
  assert.match(src, /Try again/)
  assert.match(src, /Everything with this customer could not be loaded\./)
  assert.match(src, /aria-busy="true"/)
  assert.match(src, /Nothing yet for this customer/)
  assert.match(src, /Show more/)
  assert.match(src, /setShown\(n => n \+ FEED_PAGE\)/)
  assert.match(src, /aria-pressed=\{on\}/)
  assert.match(src, /break-words/)
  assert.match(src, /import \{ fmtDay, fmtDayTime \} from '\.\/types'/, 'dates use the same formats as the rest of the card')
  assert.match(src, /import \{ formatCurrency \} from '@\/lib\/supabase'/, 'money is shown the way the rest of the card shows it')
  assert.match(src, /from '\.\/http'/)
})

test('the screen follows the design rules: tokens only, no emoji, no gradients, no shadows, no capitals, 44px targets, lamps with words', () => {
  const src = feedComponent
  assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(src, /\b(?:rgb|rgba|hsl|hsla)\(\s*\d/)
  assert.doesNotMatch(src, /\p{Extended_Pictographic}/u)
  assert.doesNotMatch(src, /gradient/i)
  assert.doesNotMatch(src, /shadow-/)
  assert.doesNotMatch(src, /uppercase/i)
  assert.doesNotMatch(src, /tracking-wider|backdrop-blur/)
  assert.doesNotMatch(src, /\b(?:text|bg|border)-(?:white|black|gray|slate|zinc|neutral)(?:-\d+)?\b/)
  assert.doesNotMatch(src, /<button[^>]*className="[^"]*\bh-(?:6|7|8|9|10)\b/)
  assert.doesNotMatch(src, /\btext-\[(?:0\.[0-7]\d*|1[0-3]px|[0-9]px)\]/)
  assert.match(src, /min-h-\[44px\]/, 'the filter chips are 44px tall')
  assert.match(src, /lamp lamp-\$\{mark\.lamp\}[^>]*aria-hidden="true"/, 'the lamp is hidden from readers because the word beside it says the same')
  assert.match(src, /\{mark\.word\}/)
  assert.match(src, /import Notice from '@\/components\/Notice'/)
})

/* ---------- the customer card ---------- */

test('the customer card has the feed section after Vehicle history, and every other section is still there', () => {
  assert.match(detail, /import CustomerFeed from '\.\/CustomerFeed'/)
  assert.match(detail, /<Section id="cd-feed" title="Everything with this customer">\s*<CustomerFeed customerId=\{customer\.id\} \/>\s*<\/Section>/)
  const ids = [...detail.matchAll(/<Section\s+id="(cd-[a-z-]+)"/g)].map(m => m[1])
  assert.equal(new Set(ids).size, ids.length, 'every section id is used once')
  assert.equal(ids.indexOf('cd-feed'), ids.indexOf('cd-vehicle-history') + 1, 'it follows Vehicle history directly')
  assert.ok(ids.indexOf('cd-feed') < ids.indexOf('cd-docs'))
  for (const id of ['cd-contact', 'cd-tags', 'cd-vehicles', 'cd-vehicle-history', 'cd-docs', 'cd-permissions', 'cd-touch', 'cd-alpha-calls', 'cd-jobs', 'cd-notes']) {
    assert.ok(ids.includes(id), `${id} is still on the card`)
  }
  // sections on this card do not collapse and the tools beside it load when the card opens, so the feed does the same
  assert.doesNotMatch(detail, /<details|aria-expanded/)
})

test('the customer card file keeps its plain line endings and has no byte order mark', () => {
  const raw = readFileSync(join(root, 'src/components/customers/CustomerDetail.tsx'))
  assert.notEqual(raw[0], 0xef, 'no byte order mark was added')
  assert.ok(!raw.includes(0x0d), 'the card keeps its plain line endings')
})
