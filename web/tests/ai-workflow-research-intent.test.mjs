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

test('a general conversation without an invoice or estimate task does not trigger research', () => {
  assert.equal(inferResearchIntent({
    message: 'Can you look up the best brake pads for my car?',
    conversation: [{ role: 'user', text: 'I am comparing options.' }],
  }), null)
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

