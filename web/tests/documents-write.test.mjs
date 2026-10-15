// The server route the estimate and invoice screens write through, and the rules behind it. A fake database records every
// call so the tests can prove what was and was not written: right shop, no forged money, no double conversions or payments.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { loadLib } from './estimates-helper.mjs'

const rules = loadLib('doc-write')
const plain = (x) => JSON.parse(JSON.stringify(x))

/* ───────── the rules, on their own ───────── */

test('pickDocFields keeps only the columns a screen may set', () => {
  const out = rules.pickDocFields({ type: 'Estimate', shop_id: 'someone-else', id: 'x', amount_paid: 500, customer_name: 'Ana', notes: 'hi' })
  assert.deepEqual(Object.keys(out).sort(), ['customer_name', 'notes', 'type'])
})

test('a new document must have a real type and cannot start paid', () => {
  assert.equal(rules.checkNewDocument({ type: 'Estimate' }).ok, true)
  assert.equal(rules.checkNewDocument({ type: 'Estimate' }).fields.status, 'Draft')
  assert.equal(rules.checkNewDocument({}).ok, false)
  assert.equal(rules.checkNewDocument({ type: 'Estimate', status: 'Paid' }).ok, false)
  assert.equal(rules.checkNewDocument({ type: 'Invoice', status: 'Partial' }).ok, false)
  assert.equal(rules.checkNewDocument({ type: 'Invoice', status: 'Whatever' }).ok, false)
  assert.equal(rules.checkNewDocument({ type: 'Invoice', amount_paid: 40 }).ok, false)
  assert.equal(rules.checkNewDocument([]).ok, false)
  assert.equal(rules.checkNewDocument(null).ok, false)
})

test('a payment is rounded to cents and needs a retry key', () => {
  const ok = rules.checkPayment({ amount: '123.456', method: 'Cash', note: '  paid   in\nfull ', idempotencyKey: 'abcdefgh1234' })
  assert.equal(ok.ok, true)
  assert.equal(ok.input.amount, 123.46)
  assert.equal(ok.input.note, 'paid in full')
  assert.equal(rules.checkPayment({ amount: 10, idempotencyKey: 'abcdefgh1234' }).input.method, 'unspecified')
  for (const amount of [0, -5, 'abc', NaN, Infinity, 2_000_000, 0.001]) {
    assert.equal(rules.checkPayment({ amount, method: 'Cash', idempotencyKey: 'abcdefgh1234' }).ok, false, String(amount))
  }
  assert.equal(rules.checkPayment({ amount: 10, method: 'Cash' }).ok, false)
  assert.equal(rules.checkPayment({ amount: 10, method: 'Cash', idempotencyKey: 'short' }).ok, false)
  assert.equal(rules.checkPayment({ amount: 10, method: '<script>', idempotencyKey: 'abcdefgh1234' }).ok, false)
})

test('only an open estimate with no money on it converts', () => {
  assert.equal(rules.checkConvert({ type: 'Estimate', status: 'Draft' }).ok, true)
  assert.equal(rules.checkConvert({ type: 'Estimate', status: 'Approved', amount_paid: 0 }).ok, true)
  assert.equal(rules.checkConvert({ type: 'Invoice', status: 'Draft' }).ok, false)
  assert.equal(rules.checkConvert({ type: 'Estimate', status: 'Void' }).ok, false)
  assert.equal(rules.checkConvert({ type: 'Estimate', status: 'Partial' }).ok, false)
  assert.equal(rules.checkConvert({ type: 'Estimate', status: 'Sent', amount_paid: 20 }).ok, false)
})

test('payment errors show plain words, not database text', () => {
  assert.match(rules.paymentErrorText('payment exceeds remaining balance 5'), /more than the balance/)
  assert.doesNotMatch(rules.paymentErrorText('relation "public.payments" violates something'), /public|relation/)
})

/* ───────── the route, with a fake database ───────── */

function makeDb(script) {
  const calls = []
  const db = {
    calls,
    rpc(name, args) { calls.push({ op: 'rpc', name, args }); return Promise.resolve(script.rpc ? script.rpc(name, args) : { data: null, error: null }) },
    from(table) {
      const state = { table, op: 'select', filters: [], payload: undefined }
      const chain = {
        select() { return chain }, limit() { return chain }, order() { return chain },
        eq(col, val) { state.filters.push([col, val]); return chain },
        insert(p) { state.op = 'insert'; state.payload = p; return chain },
        update(p) { state.op = 'update'; state.payload = p; return chain },
        delete() { state.op = 'delete'; return chain },
        maybeSingle() { return run(true) }, single() { return run(true) },
        then(res, rej) { return run(false).then(res, rej) },
      }
      const run = (single) => {
        calls.push({ op: state.op, table, filters: state.filters.slice(), payload: state.payload })
        const out = script.from ? script.from(state, single) : { data: single ? null : [], error: null }
        return Promise.resolve(out)
      }
      return chain
    },
  }
  return db
}

function loadRoute({ auth, db, rate = { ok: true } }) {
  const source = readFileSync(new URL('../src/app/api/documents/route.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const events = []
  const stubs = {
    next: null,
    'next/server': {},
    '@/lib/supabase': { getServiceClient: () => db },
    '@/lib/api-auth': {
      getAuthedShop: async () => auth,
      getSessionUser: async () => ({ email: 'writer@example.com' }),
      unauthorized: () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
      forbidden: () => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    },
    '@/lib/rate-limit': { checkRateLimit: () => rate },
    '@/lib/doc-server': {
      jsonError: (message, status, extra = {}) => new Response(JSON.stringify({ error: message, ...extra }), { status }),
      jsonOk: (body, status = 200) => new Response(JSON.stringify(body), { status }),
      logEvent: async (_db, e) => { events.push(e); return true },
      staffLabel: () => 'Writer',
    },
    '@/lib/doc-write': rules,
  }
  const mod = { exports: {} }
  const sandbox = { exports: mod.exports, module: mod, Response, Date, JSON, Number, String, Object, Array, Math, Promise, Set, console, require: (id) => { if (id in stubs) return stubs[id]; throw new Error('Unexpected import ' + id) } }
  vm.runInNewContext(compiled, sandbox, { filename: 'route.ts' })
  return { POST: mod.exports.POST, events }
}

const call = async (route, body) => {
  const res = await route.POST({ json: async () => body })
  return { status: res.status, body: await res.json() }
}
const owner = { userId: 'user-1', shopId: 'shop-A', role: 'owner' }
const writes = (db) => db.calls.filter((c) => ['insert', 'update', 'delete'].includes(c.op))

test('signed-out callers and viewers cannot write', async () => {
  const db = makeDb({})
  assert.equal((await call(loadRoute({ auth: null, db }), { action: 'number', type: 'Estimate' })).status, 401)
  assert.equal((await call(loadRoute({ auth: { ...owner, role: 'viewer' }, db }), { action: 'number', type: 'Estimate' })).status, 403)
  assert.equal(db.calls.length, 0)
})

test('number: uses the signed-in shop, never one from the request', async () => {
  const db = makeDb({ rpc: () => ({ data: 'EST-2026-0042', error: null }) })
  const route = loadRoute({ auth: owner, db })
  const res = await call(route, { action: 'number', type: 'Estimate', shopId: 'shop-B', shop_id: 'shop-B' })
  assert.equal(res.status, 200)
  assert.equal(res.body.docNumber, 'EST-2026-0042')
  assert.deepEqual(plain(db.calls[0].args), { p_shop_id: 'shop-A', p_type: 'Estimate' })
  assert.equal((await call(route, { action: 'number', type: 'Quote' })).status, 400)
})

test('create: forces the caller shop and drops money fields the screen should not set', async () => {
  const db = makeDb({
    rpc: () => ({ data: 'INV-2026-0007', error: null }),
    from: (s) => {
      if (s.op === 'insert') return { data: { id: 'doc-1', ...s.payload }, error: null }
      if (s.table === 'customers') return { data: { id: 'cust-1' }, error: null }
      return { data: null, error: null }
    },
  })
  const route = loadRoute({ auth: owner, db })
  const res = await call(route, { action: 'create', data: { type: 'Invoice', customer_id: 'cust-1', customer_name: 'Ana', shop_id: 'shop-B', id: 'forced-id', amount_paid: 0, status: 'Draft' } })
  assert.equal(res.status, 200)
  const insert = writes(db)[0]
  assert.equal(insert.table, 'documents')
  assert.equal(insert.payload.shop_id, 'shop-A')
  assert.equal(insert.payload.doc_number, 'INV-2026-0007')
  assert.equal('id' in insert.payload, false)
  assert.equal('amount_paid' in insert.payload, false)
  // The customer was looked up inside the caller's shop.
  const lookup = db.calls.find((c) => c.table === 'customers')
  assert.deepEqual(plain(lookup.filters), [['id', 'cust-1'], ['shop_id', 'shop-A']])
  assert.equal(route.events[0].kind, 'created')
})

test('create: refuses a customer from another shop and writes nothing', async () => {
  const db = makeDb({ from: (s) => (s.table === 'customers' ? { data: null, error: null } : { data: null, error: null }) })
  const res = await call(loadRoute({ auth: owner, db }), { action: 'create', data: { type: 'Estimate', customer_id: 'cust-of-shop-B' } })
  assert.equal(res.status, 400)
  assert.equal(writes(db).length, 0)
})

test('create: refuses a paid status and an unknown type', async () => {
  const db = makeDb({})
  const route = loadRoute({ auth: owner, db })
  assert.equal((await call(route, { action: 'create', data: { type: 'Invoice', status: 'Paid' } })).status, 400)
  assert.equal((await call(route, { action: 'create', data: { type: 'Contract' } })).status, 400)
  assert.equal(writes(db).length, 0)
})

test('create: a duplicate number gets a plain answer, not a database message', async () => {
  const db = makeDb({ from: (s) => (s.op === 'insert' ? { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "documents_shop_id_doc_number_key"' } } : { data: null, error: null }) })
  const res = await call(loadRoute({ auth: owner, db }), { action: 'create', data: { type: 'Estimate', doc_number: 'EST-2026-0001' } })
  assert.equal(res.status, 409)
  assert.doesNotMatch(JSON.stringify(res.body), /constraint|documents_shop_id/)
})

test('convert: an open estimate becomes an invoice once', async () => {
  const doc = { id: 'doc-1', type: 'Estimate', status: 'Approved', doc_number: 'EST-2026-0003', amount_paid: 0 }
  const db = makeDb({
    rpc: () => ({ data: 'INV-2026-0011', error: null }),
    from: (s) => (s.op === 'update' ? { data: [{ id: 'doc-1' }], error: null } : { data: doc, error: null }),
  })
  const route = loadRoute({ auth: owner, db })
  const res = await call(route, { action: 'convert', documentId: 'doc-1' })
  assert.equal(res.status, 200)
  assert.equal(res.body.docNumber, 'INV-2026-0011')
  const update = writes(db)[0]
  assert.deepEqual(plain(update.filters), [['id', 'doc-1'], ['shop_id', 'shop-A'], ['type', 'Estimate']])
  assert.equal(update.payload.type, 'Invoice')
  assert.equal(update.payload.status, 'Draft')
  assert.equal(route.events[0].kind, 'converted')
})

test('convert: a second press after the first one is turned away', async () => {
  const doc = { id: 'doc-1', type: 'Estimate', status: 'Approved', amount_paid: 0 }
  const db = makeDb({ rpc: () => ({ data: 'INV-2026-0012', error: null }), from: (s) => (s.op === 'update' ? { data: [], error: null } : { data: doc, error: null }) })
  const res = await call(loadRoute({ auth: owner, db }), { action: 'convert', documentId: 'doc-1' })
  assert.equal(res.status, 409)
})

test('convert: refuses invoices, void and paid documents before taking a number', async () => {
  for (const doc of [{ type: 'Invoice', status: 'Draft' }, { type: 'Estimate', status: 'Void' }, { type: 'Estimate', status: 'Partial' }, { type: 'Estimate', status: 'Sent', amount_paid: 10 }]) {
    const db = makeDb({ from: () => ({ data: { id: 'doc-1', ...doc }, error: null }) })
    const res = await call(loadRoute({ auth: owner, db }), { action: 'convert', documentId: 'doc-1' })
    assert.equal(res.status, 409, JSON.stringify(doc))
    assert.equal(db.calls.some((c) => c.op === 'rpc'), false)
    assert.equal(writes(db).length, 0)
  }
})

test('convert: another shop document looks like it does not exist', async () => {
  const db = makeDb({ from: () => ({ data: null, error: null }) })
  const res = await call(loadRoute({ auth: owner, db }), { action: 'convert', documentId: 'doc-of-shop-B' })
  assert.equal(res.status, 404)
  const lookup = db.calls[0]
  assert.deepEqual(plain(lookup.filters), [['id', 'doc-of-shop-B'], ['shop_id', 'shop-A']])
})

test('payment: asks the database function with the signed-in user and cents', async () => {
  const db = makeDb({
    rpc: () => ({ data: { amount_paid: 50, status: 'Partial', balance_due: 70.25, total: 120.25 }, error: null }),
    from: (s) => (s.table === 'documents' ? { data: { id: 'doc-1', doc_number: 'INV-1', type: 'Invoice', status: 'Unpaid' }, error: null } : { data: [], error: null }),
  })
  const route = loadRoute({ auth: owner, db })
  const res = await call(route, { action: 'payment', documentId: 'doc-1', amount: '50', method: 'Cash', note: 'front desk', idempotencyKey: 'pay-doc-1-abcdef' })
  assert.equal(res.status, 200)
  assert.equal(res.body.result.balance_due, 70.25)
  const rpc = db.calls.find((c) => c.op === 'rpc')
  assert.equal(rpc.name, 'record_document_payment_server')
  assert.deepEqual(plain(rpc.args), { p_user_id: 'user-1', p_document_id: 'doc-1', p_amount: 50, p_method: 'Cash', p_note: 'front desk', p_idempotency_key: 'pay-doc-1-abcdef' })
  assert.equal(writes(db).some((c) => c.table === 'payments' || c.table === 'documents'), false, 'the route itself never writes money rows')
  assert.equal(route.events[0].kind, 'payment')
})

test('payment: bad input never reaches the database', async () => {
  const db = makeDb({})
  const route = loadRoute({ auth: owner, db })
  for (const body of [
    { action: 'payment', amount: 0, method: 'Cash', idempotencyKey: 'pay-doc-1-abcdef', documentId: 'doc-1' },
    { action: 'payment', amount: 10, method: 'Cash', idempotencyKey: '', documentId: 'doc-1' },
    { action: 'payment', amount: 10, method: 'Cash', idempotencyKey: 'pay-doc-1-abcdef' },
  ]) assert.equal((await call(route, body)).status, 400)
  assert.equal(db.calls.length, 0)
})

test('payment: a document of another shop or a void one takes no payment', async () => {
  let doc = null
  const db = makeDb({ from: () => ({ data: doc, error: null }) })
  const route = loadRoute({ auth: owner, db })
  const body = { action: 'payment', documentId: 'doc-1', amount: 10, method: 'Cash', idempotencyKey: 'pay-doc-1-abcdef' }
  assert.equal((await call(route, body)).status, 404)
  doc = { id: 'doc-1', status: 'Void' }
  assert.equal((await call(route, body)).status, 409)
  assert.equal(db.calls.some((c) => c.op === 'rpc'), false)
})

test('payment: a refusal from the database is shown in plain words', async () => {
  const db = makeDb({
    rpc: () => ({ data: null, error: { code: 'P0001', message: 'payment exceeds remaining balance (public.documents row 123)' } }),
    from: () => ({ data: { id: 'doc-1', status: 'Unpaid' }, error: null }),
  })
  const res = await call(loadRoute({ auth: owner, db }), { action: 'payment', documentId: 'doc-1', amount: 999, method: 'Cash', idempotencyKey: 'pay-doc-1-abcdef' })
  assert.equal(res.status, 400)
  assert.doesNotMatch(JSON.stringify(res.body), /public\.|row 123/)
})

test('payment: a database without the payment function says it needs an update', async () => {
  const db = makeDb({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }), from: () => ({ data: { id: 'doc-1', status: 'Unpaid' }, error: null }) })
  const res = await call(loadRoute({ auth: owner, db }), { action: 'payment', documentId: 'doc-1', amount: 10, method: 'Cash', idempotencyKey: 'pay-doc-1-abcdef' })
  assert.equal(res.status, 503)
})

test('payment: sending the same payment again keeps one history line', async () => {
  const db = makeDb({
    rpc: () => ({ data: { amount_paid: 10 }, error: null }),
    from: (s) => (s.table === 'document_events' ? { data: [{ id: 'evt-1' }], error: null } : { data: { id: 'doc-1', status: 'Partial' }, error: null }),
  })
  const route = loadRoute({ auth: owner, db })
  const res = await call(route, { action: 'payment', documentId: 'doc-1', amount: 10, method: 'Cash', idempotencyKey: 'pay-doc-1-abcdef' })
  assert.equal(res.status, 200)
  assert.equal(route.events.length, 0)
})

test('an unknown action and a flood are both turned away', async () => {
  const db = makeDb({})
  assert.equal((await call(loadRoute({ auth: owner, db }), { action: 'drop-everything' })).status, 400)
  assert.equal((await call(loadRoute({ auth: owner, db, rate: { ok: false } }), { action: 'number', type: 'Estimate' })).status, 429)
})
