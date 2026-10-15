import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function load(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const moduleRecord = { exports: {} }
  vm.runInNewContext(compiled, { module: moduleRecord, exports: moduleRecord.exports })
  return moduleRecord.exports
}

const { inferResearchIntent } = load('../src/lib/ai/workflow/research-intent.ts')

test('Jake Paul reproduction resumes a price/labor-waiting invoice when he casually asks to look it up', () => {
  const result = inferResearchIntent({
    message: 'Look it up and make me an invoice.',
    task: {
      action: 'createInvoice',
      payload: { type: 'Invoice', customer_name: 'Jake Paul', vehicle_year: '2016', vehicle_make: 'Dodge', vehicle_model: 'Charger', notes: 'Replace front lower control arms', parts: [{ name: 'front lower control arms', qty: 2 }], labors: [{ operation: 'Replace front lower control arms' }] },
      instructions: ['Waiting for parts prices and labor details'],
    },
    conversation: [{ role: 'user', text: 'I need both front lower control arms and labor for my 2016 Dodge Charger.' }],
  })
  assert.equal(result?.stores.join(','), '')
  assert.equal(result?.wantsParts, true)
  assert.equal(result?.wantsLabor, true)
  assert.match(result?.query || '', /2016 Dodge Charger/i)
  assert.match(result?.query || '', /front lower control arms/i)
})

test('an invoice service with no priced lines implicitly starts pricing research', () => {
  const result = inferResearchIntent({
    message: 'Make an estimate for replacing the water pump on my 2012 Honda Civic.',
    task: { action: 'createEstimate', payload: { vehicle_year: 2012, vehicle_make: 'Honda', vehicle_model: 'Civic', labors: [{ operation: 'Replace water pump' }] } },
  })
  assert.equal(result?.wantsParts, true)
  assert.equal(result?.wantsLabor, true)
  assert.match(result?.query || '', /2012 Honda Civic/i)
  assert.match(result?.query || '', /water pump/i)
})

test('a plain look-up with no invoice or estimate is read-only research, never a document', () => {
  const result = inferResearchIntent({
    message: 'Can you look up the best brake pads for my car?',
    conversation: [{ role: 'user', text: 'I am comparing options.' }],
  })
  assert.equal(result?.createsDocument, false)
  assert.equal(result?.wantsParts, true)
  assert.equal(result?.wantsLabor, false)
})

test('chat that is not about a repair does not start research', () => {
  assert.equal(inferResearchIntent({ message: 'How is the weather today?', conversation: [{ role: 'user', text: 'Hello' }] }), null)
})

test('an invoice request is marked as creating a document, a look-up is not', () => {
  const invoice = inferResearchIntent({ message: 'Make an invoice for front brakes on a 2015 Honda Accord from AutoZone.', conversation: [] })
  assert.equal(invoice?.createsDocument, true)
  const lookup = inferResearchIntent({ message: 'Look on AutoZone for front brakes on a 2015 Honda Accord.', conversation: [{ role: 'user', text: 'Earlier I asked for an invoice for a different car.' }] })
  assert.equal(lookup?.createsDocument, false)
  assert.equal(lookup?.vehicle?.make, 'Honda')
})

test('trim, engine and brake type are read from a plain answer, including engine sizes with a decimal', () => {
  const answer = inferResearchIntent({
    message: 'The trim is Sport, engine is 2.4L. Rear brakes are disc.',
    conversation: [{ role: 'user', text: 'Look on AutoZone for brakes on a 2015 Honda Accord.' }],
    research: { query: '2015 Honda Accord brakes', stores: ['AutoZone'], wantsParts: true, wantsLabor: false, createsDocument: false, documentType: 'Estimate' },
  })
  assert.equal(answer?.fitment?.trim, 'Sport')
  assert.equal(answer?.fitment?.engine, '2.4L')
  assert.equal(answer?.fitment?.brakeType, 'disc')
  assert.match(answer?.query || '', /engine 2\.4L/)
})

test('a priced labor line does not hide missing parts prices', () => {
  const result = inferResearchIntent({
    message: 'Make an invoice for front brakes on a 2015 Honda Accord, 1.5 hours labor.',
    task: { action: 'createInvoice', payload: { labors: [{ operation: 'Brakes', hours: 1.5, rate: 120 }], parts: [{ name: 'Front brake pads' }] } },
    conversation: [],
  })
  assert.equal(result?.wantsParts, true)
})

test('AutoZone and all-four brake wording are retained without inventing a price or trim', () => {
  const result = inferResearchIntent({
    message: 'Search AutoZone for all four brakes on my 2018 Toyota Camry and make an invoice with labor.',
    task: { action: 'createInvoice', payload: { vehicle_year: '2018', vehicle_make: 'Toyota', vehicle_model: 'Camry' } },
  })
  assert.equal(result?.stores.join(','), 'AutoZone')
  assert.equal(result?.wantsParts, true)
  assert.equal(result?.wantsLabor, true)
  assert.match(result?.query || '', /AutoZone/i)
  assert.match(result?.query || '', /all four brakes/i)
  assert.doesNotMatch(result?.query || '', /\b(?:SE|LE|XLE|V6)\b/)
  assert.doesNotMatch(result?.query || '', /\$\d/)
})

test('current retailer and vehicle override stale conversational context', () => {
  const result = inferResearchIntent({
    message: 'Look up the new prices from O\'Reilly for my 2018 Honda Civic.',
    task: {
      action: 'createInvoice',
      payload: { vehicle_year: '2018', vehicle_make: 'Honda', vehicle_model: 'Civic', notes: 'Replace front brake pads' },
    },
    conversation: [
      { role: 'user', text: 'Price AutoZone parts for my 2005 Honda Accord.' },
      { role: 'assistant', text: 'AutoZone prices were unavailable.' },
    ],
  })
  assert.equal(result?.stores.join(','), "O'Reilly")
  assert.equal(result?.vehicle?.year, '2018')
  assert.equal(result?.vehicle?.make, 'Honda')
  assert.equal(result?.vehicle?.model, 'Civic')
  assert.match(result?.query || '', /2018 Honda Civic/i)
  assert.doesNotMatch(result?.query || '', /2005 Honda Accord/i)
})

test('remembered retailer remains active when a follow-up omits the store name', () => {
  const result = inferResearchIntent({
    message: 'Get the prices and add them to the invoice.',
    facts: { retailer: "O'Reilly" },
    task: { action: 'createInvoice', payload: { vehicle_year: '2018', vehicle_make: 'Honda', vehicle_model: 'Civic', notes: 'Replace front brake pads' } },
  })
  assert.equal(result?.stores.join(','), "O'Reilly")
})

test('retry keeps same-vehicle service and retailer scope after a failed lookup', () => {
  const result = inferResearchIntent({
    message: 'Retry the lookup to continue.',
    facts: { retailer: 'AutoZone' },
    task: { action: 'createInvoice', payload: { type: 'Invoice', vehicle_year: '2005', vehicle_make: 'Honda', vehicle_model: 'Accord' } },
    conversation: [
      { role: 'user', text: 'Make an invoice for QA: 2005 Honda Accord, all four brakes and rotors from AutoZone. Look it up and prepare it for review.' },
      { role: 'assistant', text: 'The retailer lookup did not return usable prices. Retry to continue.' },
    ],
  })
  assert.equal(result?.stores.join(','), 'AutoZone')
  assert.match(result?.query || '', /all four brakes and rotors/i)
  assert.match(result?.query || '', /AutoZone/i)
  assert.match(result?.query || '', /2005 Honda Accord/i)
})

test('current scope stays ahead of accumulated task instructions', () => {
  const result = inferResearchIntent({
    message: 'Make an invoice for the new brake job: 2005 Honda Accord, all four brakes and rotors from AutoZone. Look it up and prepare it for review.',
    facts: { retailer: 'AutoZone' },
    task: {
      action: 'createInvoice',
      payload: { type: 'Invoice', vehicle_year: '2005', vehicle_make: 'Honda', vehicle_model: 'Accord' },
      instructions: [
        'Research requested before drafting: 2005 Honda Accord; an old customer request with unrelated notes '.repeat(8),
        'A second stale research attempt with old pricing context '.repeat(8),
      ],
    },
    conversation: [
      { role: 'user', text: 'Retry the old lookup to continue.' },
    ],
  })
  assert.match(result?.query || '', /new brake job/i)
  assert.match(result?.query || '', /all four brakes and rotors/i)
  assert.ok((result?.query || '').indexOf('new brake job') < (result?.query || '').indexOf('old customer request'))
})

