import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function load(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const moduleRecord = { exports: {} }
  vm.runInNewContext(compiled, { module: moduleRecord, exports: moduleRecord.exports, require: name => { if (name in imports) return imports[name]; throw new Error(`Unexpected import ${name}`) }, ...globals })
  return moduleRecord.exports
}
const money = load('../src/lib/document-money.ts')
const catalog = load('../src/lib/ai/workflow/catalog.ts')
const reads = load('../src/lib/ai/read-verification.ts')
const researchIntent = load('../src/lib/ai/workflow/research-intent.ts')
const engine = load('../src/lib/ai/workflow/engine.ts', { './catalog': catalog, '@/lib/document-money': money, '@/lib/ai/read-verification': reads, './research-intent': researchIntent })

function harness(outputs = []) {
  let next = 0
  const state = engine.initialState()
  const calls = [], checkpoints = [], contexts = []
  const deps = {
    id: () => `id-${++next}`, shop: { labor_rate: 120, tax_rate: 8.25 },
    checkpoint: async state => { checkpoints.push(JSON.parse(JSON.stringify(state))) },
    model: async messages => {
      contexts.push(JSON.parse(messages[1].content))
      const output = outputs.shift()
      if (!output) throw new Error('No scripted decision')
      return typeof output === 'string' ? output : JSON.stringify(output)
    },
    execute: async (action, payload, key) => {
      calls.push({ action, payload, key })
      if (!key) return { ok: true, data: { customers: [] } }
      return { ok: true, data: { id: 'saved-record', doc_number: 'INV-TEST', type: 'Invoice', ...payload } }
    },
  }
  return { state, calls, deps, outputs, checkpoints, contexts, run: (message, turnId = `turn-${++next}`) => engine.runWorkflow(state, { message, turnId }, deps), confirm: id => engine.runWorkflow(state, { turnId: `confirm-${++next}`, confirmation: { id, decision: 'confirm' } }, deps) }
}
const task = patch => ({ action: 'createInvoice', patch })
const proof = (ref, quote) => ({ ref, quote })
const flat = (name = 'Maya', amount = 280, ref = 'priced') => ({ kind: 'propose', task: task({ type: 'Invoice', customer_name: name, labors: [{ operation: 'Agreed labor', amount }], apply_tax: false }), proofs: { 'labors.0.amount': proof(ref, `labor $${amount}`) } })

test('long incremental invoice retains phone, vehicle, declined email and no alignment beyond 30 turns', async () => {
  const h = harness([
    { kind: 'read', tool: 'searchCustomers', input: { query: 'Chris Paul' }, task: task({ type: 'Invoice', customer_name: 'Chris Paul' }) },
    { kind: 'ask', fields: ['vehicle_year'], message: 'What vehicle?' },
  ])
  assert.equal((await h.run('Make an invoice for Chris Paul, lower control arms.', 'start')).status, 'needs_input')
  h.outputs.push({ kind: 'ask', fields: ['parts_choice'], message: 'Which sides?', task: task({ vehicle_year: '2005', vehicle_make: 'Honda', vehicle_model: 'Accord' }) })
  await h.run('2005 Honda Accord', 'vehicle')
  h.outputs.push({ kind: 'ask', fields: ['parts_choice'], message: 'Which prices should I use?', task: { ...task({ customer_phone: '2815555551', customer_email: null, notes: 'Both front control arms. No alignment.' }), instructions: ['both front', 'no alignment', 'no email'] } })
  await h.run('Both front, 2815555551, no alignment, no email.', 'details')
  for (let i = 0; i < 35; i++) {
    h.outputs.push({ kind: 'answer', message: 'The active draft is retained.', sideQuestion: true })
    await h.run(`Side question ${i}`, `side-${i}`)
  }
  h.outputs.push({ kind: 'propose', task: task({ parts: [{ name: 'Duralast front left lower control arm', qty: 1, unitPrice: 99.99 }, { name: 'Duralast front right lower control arm', qty: 1, unitPrice: 79.99 }], labors: [{ operation: 'Replace both front lower control arms', hours: 3, rate: 120 }] }), proofs: { 'parts.0.unitPrice': proof('priced', '$99.99'), 'parts.1.unitPrice': proof('priced', '$79.99'), 'labors.0.hours': proof('priced', '3 hours'), 'labors.0.rate': { ref: 'shop', path: 'labor_rate' } } })
  const reply = await h.run('Use my quoted prices: left $99.99, right $79.99; 3 hours labor.', 'priced')
  assert.equal(reply.status, 'approval')
  assert.equal(reply.approval.total, 554.83)
  assert.equal(reply.approval.payload.customer_phone, '2815555551')
  assert.equal(reply.approval.payload.customer_email, null)
  assert.equal(reply.approval.payload.vehicle_year, '2005')
  assert.equal(reply.approval.payload.notes, 'Both front control arms. No alignment.')
  assert.equal(h.contexts.at(-1).conversation[0].id, 'start')
  assert.equal(h.calls.filter(c => c.key).length, 0)
  const result = await h.confirm(reply.approval.id)
  assert.equal(result.status, 'complete')
  assert.match(result.reply, /INV-TEST.*saved as a draft/)
  assert.match(result.reply, /\/invoices\?document=saved-record/)
  assert.equal(h.calls.filter(c => c.action === 'createCustomer').length, 0, 'invoice never depends on creating customer')
})

test('email and phone are optional for customer creation, with a real execution receipt', async () => {
  const h = harness([{ kind: 'propose', task: { action: 'createCustomer', patch: { name: 'QA No Contact' } } }])
  const review = await h.run('Create a customer QA No Contact, no email or phone.')
  assert.equal(review.status, 'approval')
  assert.equal((await h.confirm(review.approval.id)).status, 'complete')
  assert.equal(h.calls[0].action, 'createCustomer')
})

test('model trying to re-ask a retained phone is corrected before user sees it', async () => {
  const h = harness([
    { kind: 'ask', task: task({ type: 'Invoice', customer_name: 'Morgan', customer_phone: '5551234567' }), fields: ['customer_phone'], message: 'Phone again?' },
    { kind: 'ask', fields: ['labor_price'], message: 'What labor amount should I use?' },
  ])
  const result = await h.run('Morgan, 5551234567, labor invoice.')
  assert.equal(result.reply, 'What labor amount should I use?')
  assert.match(h.contexts[1].correction, /already supplied/)
})

test('model cannot bypass an active task with a task-related side question', async () => {
  const h = harness([
    { kind: 'propose', task: task({ type: 'Invoice', customer_name: 'QA' }), proofs: {} },
    { kind: 'answer', sideQuestion: true, message: 'The invoice is ready.' },
    { kind: 'answer', sideQuestion: true, message: 'The invoice is ready.' },
    { kind: 'answer', sideQuestion: true, message: 'The invoice is ready.' },
    { kind: 'answer', sideQuestion: true, message: 'The invoice is ready.' },
    { kind: 'answer', sideQuestion: true, message: 'The invoice is ready.' },
  ])
  const result = await h.run('Make an invoice')
  assert.equal(result.status, 'blocked')
  assert.equal(h.calls.length, 0)
})

test('optional email request is rejected even if no email has been supplied', async () => {
  const h = harness([{ kind: 'ask', task: task({ type: 'Invoice', customer_name: 'Alex' }), fields: ['customer_email'], message: 'Need email' }, { kind: 'ask', fields: ['labor_price'], message: 'What labor price?' }])
  assert.equal((await h.run('Invoice Alex')).reply, 'What labor price?')
  assert.match(h.contexts[1].correction, /optional/)
})

for (const text of ['[DONE]', 'I have created the invoice.', 'Created the invoice.', "I can't create an invoice here."]) {
  test(`model prose cannot substitute for execution: ${text}`, async () => {
    const h = harness(Array.from({ length: 5 }, () => ({ kind: 'answer', message: text })))
    const result = await h.run('Make an invoice')
    assert.equal(result.status, 'blocked')
    assert.equal(h.calls.length, 0)
  })
}

test('write disguised as a read cannot execute', async () => {
  const h = harness(Array.from({ length: 5 }, () => ({ kind: 'read', tool: 'deleteRecord', input: { table: 'documents', id: 'abc' } })))
  assert.equal((await h.run('Check invoices')).status, 'blocked')
  assert.equal(h.calls.length, 0)
})

test('unknown tools and unauthorized fields cannot reach an adapter', async () => {
  for (const output of [{ kind: 'read', tool: 'runSQL', input: {} }, { kind: 'propose', task: { action: 'createCustomer', patch: { name: 'A', shop_id: 'other' } } }]) {
    const h = harness(Array.from({ length: 5 }, () => output))
    assert.equal((await h.run('Create customer')).status, 'blocked')
    assert.equal(h.calls.length, 0)
  }
})

test('invented part prices and arbitrary labor hours are blocked, not silently accepted', async () => {
  const h = harness(Array.from({ length: 5 }, () => ({ kind: 'propose', task: task({ type: 'Invoice', customer_name: 'A', parts: [{ name: 'Left arm', qty: 1, unitPrice: 99.99 }], labors: [{ operation: 'Install', hours: 3, rate: 120 }] }), proofs: { 'labors.0.rate': { ref: 'shop', path: 'labor_rate' } } })))
  const reply = await h.run('Find real prices and create my invoice')
  assert.equal(reply.status, 'blocked')
  assert.match(reply.reply, /Need evidence/)
  assert.equal(h.calls.length, 0)
})

test('a number embedded inside a phone or another price is not price evidence', () => {
  const state = engine.initialState()
  state.turns.push({ id: 'u', text: 'Phone 2815555551. Cost $199.99.' })
  const action = { action: 'createInvoice', payload: { parts: [{ unitPrice: 99.99 }] }, proofs: { 'parts.0.unitPrice': proof('u', '$199.99') }, instructions: [] }
  assert.equal(engine.evidenceErrors(action, state, {}).length, 1)
})

test('search evidence produces a preliminary-price warning, never verified fitment', async () => {
  const h = harness([
    { kind: 'read', tool: 'lookupParts', input: { query: 'specified vehicle left arm AutoZone' } },
    { kind: 'propose', task: task({ type: 'Estimate', customer_name: 'QA', parts: [{ name: 'Left arm', brand: 'Duralast', qty: 1, unitPrice: 75 }], apply_tax: false }), proofs: { 'parts.0.unitPrice': { ref: 'id-1', path: 'options.0.parts.0.price' } } },
  ])
  h.deps.execute = async () => ({ ok: true, data: { options: [{ parts: [{ name: 'Left arm', brand: 'Duralast', position: 'Front Left', price: 75, url: 'https://retailer.invalid/item', sourceConfidence: 'search_result_only' }] }] } })
  const reply = await h.run('Use searched quote', 'u')
  assert.equal(reply.status, 'approval')
  assert.match(reply.approval.warnings.join(' '), /preliminary.*not been independently verified/)
})

test('matching price from a different searched item cannot prove the selected line', async () => {
  const state = engine.initialState()
  state.turns.push({ id: 'u', role: 'user', text: 'Use the selected arm.' })
  state.evidence.push({ id: 'search', tool: 'lookupParts', input: { query: 'arms' }, data: { options: [{ parts: [{ name: 'Different arm', position: 'Rear Right', price: 75 }] }] }, at: new Date().toISOString() })
  const action = { action: 'createInvoice', payload: { type: 'Invoice', customer_name: 'QA', parts: [{ name: 'Selected arm', position: 'Front Left', qty: 1, unitPrice: 75 }], apply_tax: false }, proofs: { 'parts.0.unitPrice': { ref: 'search', path: 'options.0.parts.0.price' } }, instructions: [] }
  assert.equal(engine.evidenceErrors(action, state, {}).length, 1)
})

test('double confirmation and lost response reuse one operation and one receipt', async () => {
  const h = harness([flat()])
  const review = await h.run('Maya labor $280, no tax', 'priced')
  const first = await h.confirm(review.approval.id)
  const second = await h.confirm(review.approval.id)
  assert.equal(first.status, 'complete')
  assert.deepEqual(first, second)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].key, review.approval.id)
})

test('plain yes after a saved review executes exactly that review without another model call', async () => {
  const h = harness([flat()])
  const review = await h.run('Maya labor $280, no tax', 'priced')
  const saved = await h.run('yes', 'approved')
  assert.equal(saved.status, 'complete')
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].key, review.approval.id)
  assert.equal(h.contexts.length, 1)
  assert.equal((await h.run('yes', 'approved')).status, 'complete')
  assert.equal(h.calls.length, 1)
})

test('uncertain save retry uses exactly the same approved payload/key', async () => {
  const h = harness([flat()])
  const review = await h.run('Maya labor $280, no tax', 'priced')
  const keys = []
  h.deps.execute = async (action, payload, key) => {
    keys.push(key)
    if (keys.length === 1) throw new Error('Lost network response')
    return { ok: true, data: { id: 'same-document', doc_number: 'INV-ONE', ...payload } }
  }
  assert.equal((await h.confirm(review.approval.id)).status, 'blocked')
  assert.equal(h.state.pending.status, 'uncertain')
  assert.equal((await h.run('Make a second one')).status, 'blocked')
  assert.equal((await h.confirm(review.approval.id)).status, 'complete')
  assert.deepEqual(keys, [review.approval.id, review.approval.id])
})

test('confirmed pre-write failure releases the review for correction', async () => {
  const h = harness([flat(), flat('Maya', 300, 'corrected')])
  const review = await h.run('Maya labor $280', 'priced')
  h.deps.execute = async () => ({ ok: false, error: 'The shop rejected this draft', outcome: 'failed' })
  const rejected = await h.confirm(review.approval.id)
  assert.equal(rejected.status, 'blocked')
  assert.equal(rejected.approval, undefined)
  assert.equal(h.state.pending, null)
  h.deps.execute = async (action, payload, key) => ({ ok: true, data: { id: 'corrected-document', doc_number: 'INV-CORRECTED', type: 'Invoice', ...payload }, key })
  const corrected = await h.run('Change it: labor $300', 'corrected')
  assert.equal(corrected.status, 'approval')
  assert.equal(corrected.approval.total, 300)
})

test('changed draft invalidates old approval and old monetary proof', async () => {
  const h = harness([flat()])
  const old = await h.run('Maya labor $280, no tax', 'priced')
  h.outputs.push(flat('Maya', 300, 'changed'))
  const fresh = await h.run('Change labor $300', 'changed')
  assert.equal(fresh.status, 'approval')
  assert.notEqual(old.approval.id, fresh.approval.id)
  assert.equal((await h.confirm(old.approval.id)).status, 'blocked')
  assert.equal(h.calls.length, 0)
  assert.equal((await h.confirm(fresh.approval.id)).status, 'complete')
  assert.equal(h.calls[0].payload.labors[0].amount, 300)
})

test('cancellation is durable and cannot later be confirmed', async () => {
  const h = harness([flat()])
  const reply = await h.run('Maya labor $280', 'priced')
  const cancelled = await engine.runWorkflow(h.state, { turnId: 'cancel', confirmation: { id: reply.approval.id, decision: 'cancel' } }, h.deps)
  assert.equal(cancelled.status, 'cancelled')
  assert.equal((await h.confirm(reply.approval.id)).status, 'cancelled')
  assert.equal(h.calls.length, 0)
})

test('turn ID collision is rejected and exact replay does not call model again', async () => {
  const h = harness([{ kind: 'answer', message: 'Hello.' }])
  const first = await h.run('Hello', 'u')
  assert.deepEqual(await h.run('Hello', 'u'), first)
  await assert.rejects(h.run('Delete everyone', 'u'), /reused with different input/)
  assert.equal(h.contexts.length, 1)
})

test('failed checkpoint prevents a write from starting', async () => {
  const h = harness([flat()])
  const reply = await h.run('Maya labor $280', 'priced')
  h.deps.checkpoint = async () => { throw new Error('Storage unavailable') }
  await assert.rejects(h.confirm(reply.approval.id), /Storage unavailable/)
  assert.equal(h.calls.length, 0)
})

test('saved result without record ID is not presented as completed', async () => {
  const h = harness([flat()])
  const reply = await h.run('Maya labor $280', 'priced')
  h.deps.execute = async () => ({ ok: true, data: { message: 'done' } })
  assert.equal((await h.confirm(reply.approval.id)).status, 'blocked')
})

test('provider outage retains facts and never performs a write', async () => {
  const h = harness([{ kind: 'ask', task: task({ type: 'Invoice', customer_name: 'Jo', customer_phone: '5551112222' }), fields: ['price'], message: 'What price?' }])
  await h.run('Jo 5551112222 invoice')
  h.deps.model = async () => { throw new Error('Provider unavailable') }
  assert.equal((await h.run('Continue')).status, 'blocked')
  assert.equal(h.state.task.payload.customer_phone, '5551112222')
  assert.equal(h.calls.length, 0)
})

test('completed-task evidence cannot price a later task', async () => {
  const staleProposal = { kind: 'propose', task: task({ type: 'Invoice', customer_name: 'New customer', parts: [{ name: 'New part', qty: 1, unitPrice: 75 }], apply_tax: false }), proofs: { 'parts.0.unitPrice': proof('id-1', '$75') } }
  const h = harness([
    { kind: 'read', tool: 'lookupParts', input: { query: 'old vehicle part' } },
    { kind: 'answer', message: 'The old lookup is complete.' },
    staleProposal,
    ...Array.from({ length: 4 }, () => staleProposal),
  ])
  const first = await h.run('Look up the old part', 'old')
  assert.equal(first.status, 'answer')
  const second = await h.run('Make a new invoice using that price', 'new')
  assert.equal(second.status, 'blocked')
  assert.match(second.reply, /Need evidence/)
  assert.equal(h.calls.filter(call => call.key).length, 0)
})

test('invalid persisted workflow state is rejected instead of reset', () => {
  assert.throws(() => engine.restoreState({ version: 1, turns: [], evidence: [], receipts: {}, facts: {}, task: { action: 'runSQL', payload: {}, proofs: {}, instructions: [] }, pending: null }), /invalid/i)
})

test('empty database default materializes as a new workflow session', () => {
  assert.deepEqual(engine.restoreState({}), engine.initialState())
})

test('malformed control-flag proofs do not strand a valid no-tax invoice draft', async () => {
  const h = harness([{
    kind: 'propose',
    task: task({
      type: 'Invoice',
      customer_name: 'QA',
      vehicle_year: 2005,
      vehicle_make: 'Honda',
      vehicle_model: 'Accord',
      parts: [
        { name: 'Front left lower control arm', qty: 1, unitPrice: 99.99 },
        { name: 'Front right lower control arm', qty: 1, unitPrice: 79.99 },
      ],
      labors: [{ operation: 'Replace both front lower control arms', hours: 3, rate: 120 }],
      apply_tax: false,
    }),
    proofs: {
      'parts.0.unitPrice': proof('u', 'left arm $99.99'),
      'parts.1.unitPrice': proof('u', 'right arm $79.99'),
      'labors.0.hours': proof('u', '3 hours at $120'),
      'labors.0.rate': proof('u', '3 hours at $120'),
      tax_rate: false,
      apply_tax: false,
    },
  }])
  const reply = await h.run('Prepare an invoice for QA: left arm $99.99, right arm $79.99, 3 hours at $120. No tax.', 'u')
  assert.equal(reply.status, 'approval')
  assert.equal(reply.approval.total, 539.98)
  assert.equal(reply.approval.payload.vehicle_year, '2005')
  assert.equal(h.calls.length, 0)
})

test('document requests automatically research missing AutoZone brake prices and labor before asking', async () => {
  const h = harness([{
    kind: 'propose',
    task: task({
      type: 'Invoice',
      customer_name: 'Jake Paul',
      customer_phone: '2819005556',
      vehicle_year: '2005',
      vehicle_make: 'Honda',
      vehicle_model: 'Accord',
      parts: [
        { name: 'AutoZone Front Brake Pad Set', position: 'Front', brand: 'Duralast', qty: 1, unitPrice: 80 },
        { name: 'AutoZone Front Brake Rotor', position: 'Front', brand: 'Duralast', qty: 2, unitPrice: 65 },
        { name: 'AutoZone Rear Brake Pad Set', position: 'Rear', brand: 'Duralast', qty: 1, unitPrice: 70 },
        { name: 'AutoZone Rear Brake Rotor', position: 'Rear', brand: 'Duralast', qty: 2, unitPrice: 55 },
      ],
      labors: [{ operation: 'Replace brake pads and rotors on all four wheels', hours: 3, rate: 120 }],
    }),
    proofs: {
      'parts.0.unitPrice': { ref: 'id-1', path: 'options.0.parts.0.price' },
      'parts.1.unitPrice': { ref: 'id-1', path: 'options.0.parts.1.price' },
      'parts.2.unitPrice': { ref: 'id-1', path: 'options.0.parts.2.price' },
      'parts.3.unitPrice': { ref: 'id-1', path: 'options.0.parts.3.price' },
      'labors.0.hours': { ref: 'id-1', path: 'laborGuidance.hours' },
      'labors.0.rate': { ref: 'shop', path: 'labor_rate' },
    },
  }])
  h.deps.execute = async (action, payload, key) => {
    h.calls.push({ action, payload, key })
    if (action === 'lookupParts') return {
      ok: true,
      data: {
        vehicle: '2005 Honda Accord',
        options: [{ parts: [
          { name: 'AutoZone Front Brake Pad Set', position: 'Front', brand: 'Duralast', store: 'AutoZone', price: 80, quantity: 1 },
          { name: 'AutoZone Front Brake Rotor', position: 'Front', brand: 'Duralast', store: 'AutoZone', price: 65, quantity: 2 },
          { name: 'AutoZone Rear Brake Pad Set', position: 'Rear', brand: 'Duralast', store: 'AutoZone', price: 70, quantity: 1 },
          { name: 'AutoZone Rear Brake Rotor', position: 'Rear', brand: 'Duralast', store: 'AutoZone', price: 55, quantity: 2 },
        ] }],
        laborGuidance: { operation: 'Replace brake pads and rotors on all four wheels', hours: 3, basis: 'standard_estimate' },
      },
    }
    return { ok: true, data: { id: 'saved-record', doc_number: 'INV-TEST', type: 'Invoice', ...payload } }
  }
  const reply = await h.run('Make an invoice for Jake Paul: 2005 Honda Accord, all four brakes and rotors from AutoZone, 2819005556. Look it up and make the invoice.', 'jake')
  assert.equal(reply.status, 'approval')
  assert.equal(h.calls[0].action, 'lookupParts')
  assert.equal(h.calls[0].payload.stores.join(','), 'AutoZone')
  assert.match(reply.approval.warnings.join(' '), /standard service estimate/i)
  assert.match(reply.approval.payload.parts[2].name, /Rear/i)
})

test('failed automatic research persists the task and retry keeps the original scope', async () => {
  const h = harness([{
    kind: 'propose',
    task: task({
      type: 'Invoice',
      customer_name: 'QA Retry',
      parts: [{
        name: 'AutoZone all four brake pads and rotors kit',
        position: 'Front and Rear',
        store: 'AutoZone',
        qty: 1,
        unitPrice: 250,
      }],
      labors: [{ operation: 'Replace brake pads and rotors on all four wheels', hours: 3, rate: 120 }],
      apply_tax: false,
    }),
    proofs: {
      'parts.0.unitPrice': { ref: 'id-2', path: 'kits.0.price' },
      'labors.0.hours': { ref: 'id-2', path: 'laborGuidance.hours' },
      'labors.0.rate': { ref: 'shop', path: 'labor_rate' },
    },
  }])
  const first = await h.run('Make an invoice for QA Retry: 2005 Honda Accord, all four brakes and rotors from AutoZone, 5555550123. Look it up and prepare it for review.', 'first')
  assert.equal(first.status, 'blocked')
  assert.equal(h.state.task?.action, 'createInvoice')
  assert.equal(h.state.facts.vehicle?.year, '2005')
  assert.equal(h.state.facts.retailer, 'AutoZone')
  assert.equal(h.state.facts.phone, '5555550123')

  h.deps.execute = async (action, payload, key) => {
    h.calls.push({ action, payload, key })
    if (action === 'lookupParts') return {
      ok: true,
      data: {
        vehicle: '2005 Honda Accord',
        options: [],
        kits: [{
          name: 'AutoZone all four brake pads and rotors kit',
          store: 'AutoZone',
          includes: 'Front and rear brake pads and rotors',
          positions: 'Front and Rear',
          url: 'https://www.autozone.com/brakes-and-traction-control/brake-pads/honda/accord/2005',
          price: 250,
        }],
        laborGuidance: { operation: 'Replace brake pads and rotors on all four wheels', hours: 3, basis: 'standard_estimate' },
      },
    }
    return { ok: true, data: { id: 'saved-record', doc_number: 'INV-TEST', type: 'Invoice', ...payload } }
  }
  const retry = await h.run('Retry the lookup to continue.', 'retry')
  const lookup = h.calls.filter(call => call.action === 'lookupParts').at(-1)
  assert.ok(lookup)
  assert.match(lookup.payload.query, /all four brakes and rotors/i)
  assert.equal(lookup.payload.stores.join(','), 'AutoZone')
  assert.equal(retry.status, 'approval')
  assert.equal(retry.approval.payload.customer_phone, '5555550123')
  assert.equal(retry.approval.payload.parts[0].unitPrice, 250)
})

test('researchable price questions are corrected instead of being shown to the user', async () => {
  const h = harness(Array.from({ length: 5 }, () => ({ kind: 'ask', fields: ['parts_choice', 'labor_hours'], message: 'Send me the exact part prices and labor hours.' })))
  h.deps.execute = async (action, payload, key) => {
    h.calls.push({ action, payload, key })
    if (action === 'lookupParts') return { ok: true, data: { options: [{ parts: [{ name: 'Front Brake Pad Set', position: 'Front', brand: 'Duralast', price: 80, quantity: 1 }] }], laborGuidance: { operation: 'Brake service', hours: 3, basis: 'standard_estimate' } } }
    return { ok: true, data: { id: 'saved-record', doc_number: 'INV-TEST', type: 'Invoice', ...payload } }
  }
  const reply = await h.run('Make an invoice for Jake Paul: 2005 Honda Accord all four brakes from AutoZone. Look it up.', 'research')
  assert.equal(reply.status, 'blocked')
  assert.match(reply.reply, /complete compatible set|retry/i)
  assert.equal(h.calls.filter(call => call.action === 'lookupParts').length, 1)
})

test('one user turn cannot fan out repeated parts lookups after partial evidence', async () => {
  const h = harness(Array.from({ length: 5 }, (_, index) => ({
    kind: 'read',
    tool: 'lookupParts',
    input: { query: `variant ${index + 1} for the same vehicle` },
  })))
  h.deps.execute = async (action, payload, key) => {
    h.calls.push({ action, payload, key })
    if (action === 'lookupParts') return {
      ok: true,
      data: {
        vehicle: '2005 Honda Accord',
        options: [{ parts: [
          { name: 'AutoZone Front Brake Pad Set', position: 'Front', store: 'AutoZone', price: 80, quantity: 1 },
          { name: 'AutoZone Front Brake Rotor', position: 'Front', store: 'AutoZone', price: 65, quantity: 2 },
        ] }],
        laborGuidance: { operation: 'Brake service', hours: 3, basis: 'standard_estimate' },
      },
    }
    return { ok: true, data: { id: 'saved-record', doc_number: 'INV-TEST', type: 'Invoice', ...payload } }
  }
  const reply = await h.run('Make an invoice for Repeat QA: 2005 Honda Accord, all four brakes and rotors from AutoZone, 5555550166. Look it up and prepare it for review.', 'repeat')
  assert.equal(reply.status, 'blocked')
  assert.match(reply.reply, /complete compatible set|No invoice was created/i)
  assert.equal(h.calls.filter(call => call.action === 'lookupParts').length, 1)
  assert.equal(h.contexts.length, 1, 'partial evidence stops the model before it can spend the turn on more searches')
})

test('research questions are blocked from the message text as well as the field list', async () => {
  const h = harness([{
    kind: 'ask',
    fields: ['vehicle_trim'],
    message: 'Can you provide the exact AutoZone part numbers and prices for every brake component?',
  }])
  h.deps.execute = async (action, payload, key) => {
    h.calls.push({ action, payload, key })
    if (action === 'lookupParts') return {
      ok: true,
      data: {
        vehicle: '2005 Honda Accord',
        options: [{ parts: [{ name: 'AutoZone Front Brake Rotor', position: 'Front', store: 'AutoZone', price: 65, quantity: 2 }] }],
        laborGuidance: { operation: 'Brake service', hours: 3, basis: 'standard_estimate' },
      },
    }
    return { ok: true, data: { id: 'saved-record', doc_number: 'INV-TEST', type: 'Invoice', ...payload } }
  }
  const reply = await h.run('Make an invoice for Text QA: 2005 Honda Accord, all four brakes and rotors from AutoZone, 5555550167. Look it up.', 'ask-text')
  assert.equal(reply.status, 'blocked')
  assert.match(reply.reply, /complete compatible set/i)
  assert.doesNotMatch(reply.reply, /part numbers/i)
  assert.equal(h.calls.filter(call => call.action === 'lookupParts').length, 1)
})

test('incomplete research does not re-ask fitment already supplied in the same conversation', async () => {
  const h = harness([{ kind: 'read', tool: 'lookupParts', input: { query: 'another variant' } }])
  h.deps.execute = async (action, payload, key) => {
    h.calls.push({ action, payload, key })
    if (action === 'lookupParts') return {
      ok: true,
      data: {
        vehicle: '2005 Honda Accord',
        options: [{ parts: [{ name: 'AutoZone Front Brake Rotor', position: 'Front', store: 'AutoZone', price: 65, quantity: 2 }] }],
        laborGuidance: { operation: 'Brake service', hours: 3, basis: 'standard_estimate' },
      },
    }
    return { ok: true, data: { id: 'saved-record', doc_number: 'INV-TEST', type: 'Invoice', ...payload } }
  }
  const reply = await h.run('Make an invoice for Fitment QA: 2005 Honda Accord, all four brakes and rotors from AutoZone. It has rear disc brakes. Look it up.', 'fitment')
  assert.equal(reply.status, 'blocked')
  assert.doesNotMatch(reply.reply, /Confirm the trim or rear brake type/i)
  assert.match(reply.reply, /No additional fitment detail is needed/i)
  assert.equal(h.calls.filter(call => call.action === 'lookupParts').length, 1)
})

test('a model fitment question is suppressed when the user already supplied that fact', async () => {
  const h = harness([{ kind: 'ask', fields: ['vehicle_trim'], message: 'What engine/trim is this 2005 Accord?' }])
  h.deps.execute = async (action, payload, key) => {
    h.calls.push({ action, payload, key })
    if (action === 'lookupParts') return {
      ok: true,
      data: {
        vehicle: '2005 Honda Accord',
        options: [{ parts: [{ name: 'AutoZone Front Brake Rotor', position: 'Front', store: 'AutoZone', price: 65, quantity: 2 }] }],
        laborGuidance: { operation: 'Brake service', hours: 3, basis: 'standard_estimate' },
      },
    }
    return { ok: true, data: { id: 'saved-record', doc_number: 'INV-TEST', type: 'Invoice', ...payload } }
  }
  const reply = await h.run('Make an invoice for Fitment Ask QA: 2005 Honda Accord, all four brakes and rotors from AutoZone. It has rear disc brakes. Look it up.', 'fitment-ask')
  assert.equal(reply.status, 'blocked')
  assert.doesNotMatch(reply.reply, /engine\/trim/i)
  assert.match(reply.reply, /No additional fitment detail is needed/i)
  assert.equal(h.calls.filter(call => call.action === 'lookupParts').length, 1)
})

test('all-four brake drafts cannot silently omit an axle or brake component', async () => {
  const frontOnly = { kind: 'propose', task: task({ type: 'Invoice', customer_name: 'Jake Paul', vehicle_year: '2005', vehicle_make: 'Honda', vehicle_model: 'Accord', parts: [{ name: 'Front Brake Rotor', position: 'Front', qty: 2, unitPrice: 80 }], labors: [{ operation: 'Front brake replacement', hours: 1.5, rate: 120 }] }), proofs: { 'parts.0.unitPrice': proof('u', 'front rotor $80'), 'labors.0.hours': proof('u', 'front brake 1.5 hours'), 'labors.0.rate': { ref: 'shop', path: 'labor_rate' } } }
  const h = harness(Array.from({ length: 5 }, () => frontOnly))
  h.deps.execute = async (action, payload, key) => action === 'lookupParts' ? { ok: true, data: { options: [{ parts: [{ name: 'Front Brake Rotor', position: 'Front', price: 80, quantity: 2 }] }], laborGuidance: { operation: 'Brake service', hours: 3, basis: 'standard_estimate' } } } : { ok: true, data: { id: 'saved-record', doc_number: 'INV-TEST', type: 'Invoice', ...payload } }
  const reply = await h.run('Make an invoice for Jake Paul: 2005 Honda Accord all four brakes and rotors. Look it up.', 'u')
  assert.equal(reply.status, 'blocked')
  assert.match(reply.reply, /all-four brake request is incomplete/i)
  assert.equal(h.calls.filter(call => call.key).length, 0)
})

test('a prior lookup for another vehicle or retailer cannot satisfy a new research request', async () => {
  const h = harness([])
  h.state.task = { action: 'createInvoice', payload: { type: 'Invoice', customer_name: 'QA', vehicle_year: '2018', vehicle_make: 'Honda', vehicle_model: 'Civic', notes: 'All four brakes and rotors' }, proofs: {}, instructions: [] }
  h.state.evidence.push({
    id: 'old-lookup',
    tool: 'lookupParts',
    input: { query: '2005 Honda Accord all four brakes from AutoZone', stores: ['AutoZone'] },
    data: {
      vehicle: '2005 Honda Accord', query: '2005 Honda Accord front brakes', positions: ['Front Left', 'Front Right'],
      options: [{ parts: [{ name: 'AutoZone front brake pads', position: 'Front', price: 80, url: 'https://www.autozone.com/old', store: 'AutoZone' }] }],
      kits: [], laborGuidance: { hours: 1.5 },
    },
    at: new Date().toISOString(),
  })
  const reply = await h.run("Look up new prices from O'Reilly for all four brakes on my 2018 Honda Civic.", 'new-research')
  assert.equal(reply.status, 'blocked')
  const lookup = h.calls.find(call => call.action === 'lookupParts')
  assert.ok(lookup)
  assert.match(lookup.payload.query, /2018 Honda Civic/i)
  assert.equal(lookup.payload.stores[0], "O'Reilly")
})

test('a stale lookup cannot prove a changed vehicle at proposal time', () => {
  const state = engine.initialState()
  state.turns.push({ id: 'current', role: 'user', text: 'Use the AutoZone price for my 2018 Honda Civic.' })
  state.evidence.push({
    id: 'old-lookup', tool: 'lookupParts', input: { query: '2005 Honda Accord AutoZone', stores: ['AutoZone'] },
    data: { vehicle: '2005 Honda Accord', options: [{ parts: [{ name: 'AutoZone Brake Rotor', position: 'Front', store: 'AutoZone', price: 80 }] }], kits: [] }, at: new Date().toISOString(),
  })
  const invoice = { action: 'createInvoice', payload: { type: 'Invoice', customer_name: 'QA', vehicle_year: '2018', vehicle_make: 'Honda', vehicle_model: 'Civic', parts: [{ name: 'AutoZone Brake Rotor', position: 'Front', store: 'AutoZone', qty: 1, unitPrice: 80 }], apply_tax: false }, proofs: { 'parts.0.unitPrice': { ref: 'old-lookup', path: 'options.0.parts.0.price' } }, instructions: [] }
  assert.equal(engine.evidenceErrors(invoice, state, {}).length, 1)
})

test('an explicit retailer change takes precedence over old priced lines', () => {
  const state = engine.initialState()
  state.turns.push({ id: 'current', role: 'user', text: "Use O'Reilly instead for this invoice." })
  state.evidence.push({
    id: 'old-lookup', tool: 'lookupParts', input: { query: '2018 Honda Civic AutoZone', stores: ['AutoZone'] },
    data: { vehicle: '2018 Honda Civic', options: [{ parts: [{ name: 'AutoZone Brake Rotor', position: 'Front', store: 'AutoZone', price: 80 }] }], kits: [] }, at: new Date().toISOString(),
  })
  const invoice = { action: 'createInvoice', payload: { type: 'Invoice', customer_name: 'QA', vehicle_year: '2018', vehicle_make: 'Honda', vehicle_model: 'Civic', parts: [{ name: 'Brake Rotor', position: 'Front', store: 'AutoZone', qty: 1, unitPrice: 80 }], apply_tax: false }, proofs: { 'parts.0.unitPrice': { ref: 'old-lookup', path: 'options.0.parts.0.price' } }, instructions: [] }
  assert.equal(engine.evidenceErrors(invoice, state, {}, "Use O'Reilly instead for this invoice.").length, 1)
})

test('all-four scope cannot combine unrelated axle lines into a complete kit', () => {
  const state = engine.initialState()
  state.turns.push({ id: 'u', role: 'user', text: 'Make an invoice for all four brakes and rotors.' })
  const invoice = {
    action: 'createInvoice',
    payload: {
      type: 'Invoice', customer_name: 'QA', apply_tax: false,
      parts: [
        { name: 'Front brake pad kit', position: 'Front', qty: 1, unitPrice: 80 },
        { name: 'Rear brake rotor', position: 'Rear', qty: 2, unitPrice: 60 },
      ],
      labors: [{ operation: 'Replace brakes', hours: 1.5, rate: 120 }],
    },
    proofs: {}, instructions: [],
  }
  assert.ok(engine.evidenceErrors(invoice, state, {}).some(error => /all-four brake request is incomplete/i.test(error)))
})

test('same-brand evidence for a different brake component cannot prove a line', () => {
  const state = engine.initialState()
  state.turns.push({ id: 'u', role: 'user', text: 'Use the rear brake pad.' })
  state.evidence.push({ id: 'search', tool: 'lookupParts', input: { query: 'brakes' }, data: { options: [{ parts: [{ name: 'Duralast Front Brake Rotor', position: 'Front', brand: 'Duralast', price: 80 }] }] }, at: new Date().toISOString() })
  const action = { action: 'createInvoice', payload: { type: 'Invoice', customer_name: 'QA', parts: [{ name: 'Duralast Rear Brake Pad', position: 'Rear', brand: 'Duralast', qty: 1, unitPrice: 80 }], apply_tax: false }, proofs: { 'parts.0.unitPrice': { ref: 'search', path: 'options.0.parts.0.price' } }, instructions: [] }
  assert.equal(engine.evidenceErrors(action, state, {}).length, 1)
})

for (const failure of [false, true]) test(`inventory answers require actual read evidence, outage=${failure}`, async () => {
  const h = harness([
    { kind: 'answer', message: '0 inventory items returned.' },
    { kind: 'read', tool: 'getInventory', input: {} },
    ...Array.from({ length: 3 }, () => ({ kind: 'answer', message: '0 inventory items returned.' })),
  ])
  h.deps.execute = async () => failure ? { ok: false, error: 'Database unavailable' } : { ok: true, data: { inventory: [] } }
  const reply = await h.run('How many inventory items do we have?')
  assert.equal(reply.status, failure ? 'blocked' : 'answer')
  if (failure) assert.doesNotMatch(reply.reply, /0 inventory/)
})

test('draft survives serialization and approval works after another server instance resumes', async () => {
  const h = harness([flat()])
  const review = await h.run('Maya labor $280', 'priced')
  const restored = JSON.parse(JSON.stringify(h.state))
  const result = await engine.runWorkflow(restored, { turnId: 'new-instance', confirmation: { id: review.approval.id, decision: 'confirm' } }, h.deps)
  assert.equal(result.status, 'complete')
  assert.equal(h.calls[0].payload.customer_name, 'Maya')
})

test('workflow schema and endpoint fail closed on tenant and lease boundaries', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20260913000439_durable_ai_workflows.sql', import.meta.url), 'utf8')
  const leaseSql = readFileSync(new URL('../supabase/migrations/20260913000510_harden_ai_workflow_leases.sql', import.meta.url), 'utf8')
  const route = readFileSync(new URL('../src/app/api/ai-workflow/route.ts', import.meta.url), 'utf8')
  assert.match(sql, /enable row level security/i)
  assert.match(sql, /revoke all.*authenticated/i)
  assert.match(sql, /primary key \(shop_id, user_id, session_id\)/)
  assert.match(sql, /for update/i)
  assert.match(sql, /lease_id=p_lease_id and lease_until>now\(\)/)
  assert.match(leaseSql, /renew_ai_workflow/)
  assert.match(leaseSql, /interval '10 minutes'/)
  assert.match(route, /setInterval\(renewLease, 30_000\)/)
  assert.match(route, /p_shop_id: auth.shopId, p_user_id: auth.userId/)
  assert.doesNotMatch(route, /hasInternalApiSecret|CRON_SECRET|INTERNAL_API_SECRET/)
})

