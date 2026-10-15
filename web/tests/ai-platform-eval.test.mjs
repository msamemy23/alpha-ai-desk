/**
 * Offline evaluation suite for the assistant's workflow.
 *
 * Every case is a canned prompt plus the decisions a MOCKED model returns, and the
 * outcome we expect: which tools are called, which approval is shown, and that
 * nothing is written before an explicit Approve. No real model, provider, database
 * or network is ever called. Add a case here whenever the assistant gets something wrong.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { getActionInfo, ACTIONS } from '../src/lib/ai/action-risk.ts'
import { decideAction, defaultRules, normalizeRules } from '../src/lib/ai/shop-rules.ts'

function load(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const moduleRecord = { exports: {} }
  vm.runInNewContext(compiled, { URL, module: moduleRecord, exports: moduleRecord.exports, require: name => { if (name in imports) return imports[name]; throw new Error(`Unexpected import ${name}`) } })
  return moduleRecord.exports
}
const money = load('../src/lib/document-money.ts')
const catalog = load('../src/lib/ai/workflow/catalog.ts')
const reads = load('../src/lib/ai/read-verification.ts')
const researchIntent = load('../src/lib/ai/workflow/research-intent.ts')
const engine = load('../src/lib/ai/workflow/engine.ts', { './catalog': catalog, '@/lib/document-money': money, '@/lib/ai/read-verification': reads, './research-intent': researchIntent })

/** A fake shop: reads return canned data, writes are only recorded (never sent anywhere). */
function shopHarness(script, { readData = {}, stopWhen = null, rules = null } = {}) {
  let next = 0
  const state = engine.initialState()
  const calls = []
  const decisions = [...script]
  let modelCalls = 0
  const deps = {
    id: () => `id-${++next}`,
    shop: { labor_rate: 120, tax_rate: 8.25 },
    checkpoint: async () => {},
    model: async () => {
      modelCalls += 1
      const decision = decisions.shift()
      if (!decision) throw new Error('The mocked model ran out of scripted decisions')
      return JSON.stringify(decision)
    },
    execute: async (action, payload, key) => {
      calls.push({ action, payload, key })
      if (!key) return { ok: true, data: readData[action] ?? {} }
      return { ok: true, data: { id: 'saved-1', name: payload.name, ...payload } }
    },
    shouldStop: stopWhen ? () => stopWhen(calls) : undefined,
    checkAction: rules ? action => decideAction(rules, action) : undefined,
  }
  return {
    state, calls, deps, modelCalls: () => modelCalls,
    run: (message, turnId = `turn-${++next}`) => engine.runWorkflow(state, { message, turnId }, deps),
    confirm: (id, decision = 'confirm') => engine.runWorkflow(state, { turnId: `confirm-${++next}`, confirmation: { id, decision } }, deps),
    writes: () => calls.filter(call => call.key),
    readTools: () => calls.filter(call => !call.key).map(call => call.action),
  }
}

const propose = (action, patch, proofs) => ({ kind: 'propose', task: { action, patch }, ...(proofs ? { proofs } : {}) })

// ---------------------------------------------------------------- read questions
const READ_CASES = [
  {
    name: 'how many customers -> reads shop totals, answers, writes nothing',
    prompt: 'How many customers do I have?',
    script: [{ kind: 'read', tool: 'getShopStats', input: {} }, { kind: 'answer', message: 'The shop totals show 12 customers.' }],
    readData: { getShopStats: { customers: 12 } },
    expectReads: ['getShopStats'],
  },
  {
    name: 'stock question -> reads inventory before answering',
    prompt: 'Do we have any wiper blades in stock?',
    script: [{ kind: 'read', tool: 'getInventory', input: { query: 'wiper' } }, { kind: 'answer', message: '0 inventory items returned.' }],
    readData: { getInventory: { inventory: [] } },
    expectReads: ['getInventory'],
  },
  {
    name: 'who is on staff -> reads the staff list',
    prompt: 'Who is on staff?',
    script: [{ kind: 'read', tool: 'listStaff', input: {} }, { kind: 'answer', message: 'Sam is active.' }],
    readData: { listStaff: { staff: [{ id: 's1', name: 'Sam', active: true }] } },
    expectReads: ['listStaff'],
  },
]

for (const item of READ_CASES) {
  test(`eval read: ${item.name}`, async () => {
    const h = shopHarness(item.script, { readData: item.readData })
    const reply = await h.run(item.prompt)
    assert.equal(reply.status, 'answer')
    assert.deepEqual(h.readTools(), item.expectReads)
    assert.equal(h.writes().length, 0, 'a question never writes anything')
    assert.equal(reply.approval, undefined)
  })
}

// ---------------------------------------------------------------- proposals need Approve
const WRITE_CASES = [
  {
    name: 'add a customer',
    prompt: 'Add a customer named Maya Chen, no phone or email.',
    script: [propose('createCustomer', { name: 'Maya Chen' })],
    action: 'createCustomer',
    payload: { name: 'Maya Chen' },
  },
  {
    name: 'schedule a follow-up text needs a looked-up customer id',
    prompt: 'Text Maya Chen tomorrow to ask how the car is running.',
    reads: [{ kind: 'read', tool: 'searchCustomers', input: { query: 'Maya Chen' } }],
    readData: { searchCustomers: { customers: [{ id: 'cust-9', name: 'Maya Chen', phone: '5551230000' }] } },
    script: [
      propose('scheduleFollowUp', { customer_id: 'cust-9', customer_name: 'Maya Chen', channel: 'sms', scheduled_for: '2030-01-02T15:00:00.000Z', message_body: 'Hi Maya, how is the car running?' }),
    ],
    action: 'scheduleFollowUp',
    payload: { customer_id: 'cust-9', channel: 'sms' },
  },
  {
    name: 'change a job status uses an id from a look-up',
    prompt: 'Move the Chen job to In Progress.',
    reads: [{ kind: 'read', tool: 'searchCustomers', input: { query: 'Chen' } }],
    readData: { searchCustomers: { jobs: [{ id: 'job-77', customer_name: 'Maya Chen', status: 'Scheduled' }] } },
    script: [propose('updateJobStatus', { id: 'job-77', status: 'In Progress' })],
    action: 'updateJobStatus',
    payload: { id: 'job-77', status: 'In Progress' },
  },
  {
    name: 'void a document asks first',
    prompt: 'Void invoice 1042 (id doc-1042).',
    script: [propose('voidDocument', { id: 'doc-1042' })],
    action: 'voidDocument',
    payload: { id: 'doc-1042' },
  },
]

for (const item of WRITE_CASES) {
  test(`eval write: ${item.name}`, async () => {
    const script = [...(item.reads || []), ...item.script]
    const h = shopHarness(script, { readData: item.readData })
    const reply = await h.run(item.prompt)
    assert.equal(reply.status, 'approval', reply.reply)
    assert.equal(reply.approval.action, item.action)
    for (const [key, value] of Object.entries(item.payload)) assert.equal(reply.approval.payload[key], value)
    assert.equal(h.writes().length, 0, 'nothing is written before Approve')
    assert.ok(reply.approval.checks, 'every review says what was and was not verified')
    assert.ok(Array.isArray(reply.approval.checks.verified) && Array.isArray(reply.approval.checks.unverified))
    // The risk table knows this action, so the card can say if it can be undone before Approve.
    assert.notEqual(getActionInfo(item.action).reversibility, undefined)
    assert.ok(ACTIONS[item.action], `${item.action} has an entry in the risk table`)

    const cancelled = await h.confirm(reply.approval.id, 'cancel')
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(h.writes().length, 0, 'Cancel writes nothing')
  })
}

test('eval write: Approve executes exactly the reviewed action once, with the review id as the key', async () => {
  const h = shopHarness([propose('createCustomer', { name: 'Maya Chen' })])
  const reply = await h.run('Add a customer named Maya Chen, no phone or email.')
  const done = await h.confirm(reply.approval.id)
  assert.equal(done.status, 'complete')
  const writes = h.writes()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].action, 'createCustomer')
  assert.equal(writes[0].key, reply.approval.id)
  const again = await h.confirm(reply.approval.id)
  assert.equal(h.writes().length, 1, 'a repeated Approve is a receipt, not a second write')
  assert.equal(again.status, 'complete')
})

// ---------------------------------------------------------------- things it must refuse
test('eval refuse: a price with no source is blocked, never shown for approval', async () => {
  const bad = { kind: 'propose', task: { action: 'createInvoice', patch: { type: 'Invoice', customer_name: 'A', parts: [{ name: 'Left arm', qty: 1, unitPrice: 99.99 }], apply_tax: false } } }
  const h = shopHarness(Array.from({ length: 5 }, () => bad))
  const reply = await h.run('Quote a left control arm for A.')
  assert.equal(reply.status, 'blocked')
  assert.equal(h.writes().length, 0)
  assert.equal(reply.approval, undefined)
})

test('eval refuse: a write dressed up as a look-up never runs', async () => {
  const h = shopHarness(Array.from({ length: 5 }, () => ({ kind: 'read', tool: 'deleteRecord', input: { table: 'customers', id: 'c1' } })))
  const reply = await h.run('Clean up old customers.')
  assert.equal(reply.status, 'blocked')
  assert.equal(h.calls.length, 0)
})

test('eval refuse: an id the assistant invented is rejected', async () => {
  const h = shopHarness(Array.from({ length: 5 }, () => propose('voidDocument', { id: 'made-up-id' })))
  const reply = await h.run('Void the last invoice.')
  assert.equal(reply.status, 'blocked')
  assert.equal(h.writes().length, 0)
})

test('eval refuse: a field the catalog does not allow cannot reach the database layer', async () => {
  const h = shopHarness(Array.from({ length: 5 }, () => propose('createCustomer', { name: 'A', shop_id: 'someone-elses-shop' })))
  const reply = await h.run('Add A.')
  assert.equal(reply.status, 'blocked')
  assert.equal(h.calls.length, 0)
})

// ---------------------------------------------------------------- honesty about uncertainty
test('eval honesty: web prices are shown as unverified, with their sources', async () => {
  const lookup = {
    vehicle: '2012 Honda Civic',
    options: [{ parts: [{ name: 'AutoZone Front Brake Pad Set', position: 'Front', brand: 'Duralast', store: 'AutoZone', price: 54.99, quantity: 1, url: 'https://example.test/pads' }] }],
    laborGuidance: { operation: 'Replace front brake pads', hours: 1.2, basis: 'standard_estimate' },
  }
  const h = shopHarness([{
    kind: 'propose',
    task: { action: 'createInvoice', patch: { type: 'Invoice', customer_name: 'Jo Park', customer_phone: '2815550100', vehicle_year: '2012', vehicle_make: 'Honda', vehicle_model: 'Civic', parts: [{ name: 'AutoZone Front Brake Pad Set', position: 'Front', brand: 'Duralast', qty: 1, unitPrice: 54.99 }], labors: [{ operation: 'Replace front brake pads', hours: 1.2, rate: 120 }], apply_tax: false } },
    proofs: { 'parts.0.unitPrice': { ref: 'id-1', path: 'options.0.parts.0.price' }, 'labors.0.hours': { ref: 'id-1', path: 'laborGuidance.hours' }, 'labors.0.rate': { ref: 'shop', path: 'labor_rate' } },
  }], { readData: { lookupParts: lookup } })
  const reply = await h.run('Make an invoice for Jo Park: 2012 Honda Civic, front brake pads from AutoZone, 2815550100, no tax. Look it up and make the invoice.', 'jo')
  assert.equal(reply.status, 'approval', reply.reply)
  assert.equal(h.readTools()[0], 'lookupParts')
  assert.match(reply.approval.checks.unverified.join(' '), /web search/i)
  assert.match(reply.approval.warnings.join(' '), /preliminary/i)
  assert.match(reply.approval.warnings.join(' '), /standard service estimate/i)
  assert.match(reply.approval.checks.verified.join(' '), /calculated/i, 'the totals are calculated, and say so')
  assert.equal(reply.approval.sources?.[0]?.url, 'https://example.test/pads', 'the source link travels with the review')
  assert.match(reply.approval.checks.verified.join(' '), /1 source link/)
  assert.equal(h.writes().length, 0)
})

test('eval honesty: a typed-in price is labelled as used as given, not checked', async () => {
  const h = shopHarness([
    {
      kind: 'propose',
      task: { action: 'createInvoice', patch: { type: 'Invoice', customer_name: 'Maya', labors: [{ operation: 'Agreed labor', amount: 280 }], apply_tax: false } },
      proofs: { 'labors.0.amount': { ref: 'turn-1', quote: '$280' } },
    },
  ])
  const reply = await h.run('Invoice Maya $280 for agreed labor, no tax.', 'turn-1')
  assert.equal(reply.status, 'approval', reply.reply)
  assert.match(reply.approval.checks.unverified.join(' '), /as they were given|not checked/i)
})

// ---------------------------------------------------------------- Stop
test('eval stop: pressing Stop before the first step calls no model and changes nothing', async () => {
  const h = shopHarness([propose('createCustomer', { name: 'A' })], { stopWhen: () => true })
  const reply = await h.run('Add A.')
  assert.equal(reply.status, 'cancelled')
  assert.match(reply.reply, /nothing was changed/i)
  assert.equal(h.modelCalls(), 0)
  assert.equal(h.calls.length, 0)
})

test('eval stop: pressing Stop after a look-up stops before the next step', async () => {
  const h = shopHarness(
    [{ kind: 'read', tool: 'searchCustomers', input: { query: 'Maya' } }, propose('createCustomer', { name: 'Maya' })],
    { readData: { searchCustomers: { customers: [] } }, stopWhen: calls => calls.length >= 1 },
  )
  const reply = await h.run('Find Maya, or add her if she is not there.')
  assert.equal(reply.status, 'cancelled')
  assert.equal(h.writes().length, 0)
  assert.equal(h.pending, undefined)
})

test('eval stop: Stop before Approve runs keeps the review and writes nothing', async () => {
  let stop = false
  const h = shopHarness([propose('createCustomer', { name: 'Maya Chen' })], { stopWhen: () => stop })
  const reply = await h.run('Add Maya Chen.')
  assert.equal(reply.status, 'approval')
  stop = true
  const blocked = await h.confirm(reply.approval.id)
  assert.equal(blocked.status, 'blocked')
  assert.match(blocked.reply, /before anything was changed/i)
  assert.equal(blocked.approval.id, reply.approval.id, 'the review is still there to approve later')
  assert.equal(h.writes().length, 0)
  stop = false
  assert.equal((await h.confirm(reply.approval.id)).status, 'complete')
  assert.equal(h.writes().length, 1)
})

test('eval stop: once an approved change is running it is never abandoned half-way', async () => {
  let stop = false
  const h = shopHarness([propose('createCustomer', { name: 'Maya Chen' })], { stopWhen: () => stop })
  const reply = await h.run('Add Maya Chen.')
  const execute = h.deps.execute
  h.deps.execute = async (action, payload, key) => { if (key) stop = true; return execute(action, payload, key) }
  const done = await h.confirm(reply.approval.id)
  assert.equal(done.status, 'complete', 'the approved change finishes and returns its receipt')
  assert.equal(h.writes().length, 1)
})

// ---------------------------------------------------------------- shop rules
test('eval rules: an action the shop switched off is never offered for approval', async () => {
  const rules = normalizeRules({ permissions: { send: 'never' } })
  const h = shopHarness([propose('sendEstimateEmail', { doc_number: 'INV-1', email: 'jo@example.test' })], { rules })
  const reply = await h.run('Email invoice INV-1 to jo@example.test.')
  assert.equal(reply.status, 'blocked')
  assert.equal(reply.approval, undefined)
  assert.match(reply.reply, /nothing was saved or sent/i)
  assert.equal(h.writes().length, 0)
})

test('eval rules: the default rules still ask before changing anything', async () => {
  const rules = defaultRules()
  const h = shopHarness([propose('createCustomer', { name: 'Maya Chen' })], { rules })
  const reply = await h.run('Add Maya Chen.')
  assert.equal(reply.status, 'approval')
  assert.equal(h.writes().length, 0)
})

// ---------------------------------------------------------------- coverage of the risk table
test('every action the workflow can run has a plain-language risk entry', () => {
  for (const [name, tool] of Object.entries(catalog.CATALOG)) {
    const info = getActionInfo(name)
    assert.ok(info.title && info.title !== name || !tool.write, `${name} should have a readable title`)
    if (tool.write) {
      assert.ok(['save', 'send', 'charge'].includes(info.permission), `${name} is a ${info.permission}, not a harmless class`)
      assert.ok(ACTIONS[name], `${name} must be in the risk table, not the fail-safe default`)
    } else {
      assert.equal(info.permission, 'read', `${name} is a read`)
    }
  }
})

// ---------------------------------------------------------------- live progress
test('eval progress: a look-up shows running then done, and a review shows "Preparing your review"', async () => {
  const h = shopHarness([
    { kind: 'read', tool: 'searchCustomers', input: { query: 'Maya' } },
    propose('createCustomer', { name: 'Maya Chen' }),
  ], { readData: { searchCustomers: { customers: [] } } })
  const seen = []
  h.deps.progress = event => seen.push(event)
  const reply = await h.run('Add a customer named Maya Chen, no phone or email.')
  assert.equal(reply.status, 'approval')
  assert.deepEqual(seen.map(event => event.kind === 'tool' ? `${event.tool}:${event.status}` : event.label), [
    'Reading your request',
    'searchCustomers:running',
    'searchCustomers:ok',
    'Working out the next step',
    'Preparing your review',
  ])
  assert.equal(h.writes().length, 0, 'progress never writes anything')
})

test('eval progress: a failed look-up is reported as an error and a broken progress callback changes nothing', async () => {
  const h = shopHarness([{ kind: 'read', tool: 'getShopStats', input: {} }, { kind: 'answer', message: 'I could not read the shop totals.' }])
  const originalExecute = h.deps.execute
  h.deps.execute = async (action, payload, key) => action === 'getShopStats' ? { ok: false, error: 'down' } : originalExecute(action, payload, key)
  const seen = []
  h.deps.progress = event => { seen.push(event); throw new Error('the screen went away') }
  const reply = await h.run('How many customers do I have?')
  assert.equal(reply.status, 'answer')
  assert.ok(seen.some(event => event.kind === 'tool' && event.status === 'error' && event.detail), 'the failure is reported with a plain detail')
})
