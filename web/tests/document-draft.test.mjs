import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function loadTsModule(relativePath, stubs = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText

  const testModule = { exports: {} }
  const sandbox = {
    exports: testModule.exports,
    module: testModule,
    require: (id) => {
      if (id in stubs) return stubs[id]
      throw new Error(`Unexpected import in test module: ${id}`)
    },
  }

  vm.runInNewContext(compiled, sandbox, { filename: relativePath })
  return testModule.exports
}

const money = loadTsModule('../src/lib/document-money.ts')
const draftTools = loadTsModule('../src/lib/ai/document-draft.ts', {
  '@/lib/document-money': money,
})

const aiPage = readFileSync(new URL('../src/app/(app)/ai/page.tsx', import.meta.url), 'utf8')

test('hard final invoice total wins over mistaken model line totals while preserving itemized work', () => {
  const userText = 'ok he has another car a 2018 jeep wrangler for 380.00 its for 4 four brakes and coolant tank and turning signal light bulbs for $430. i need a invoice'
  const parsed = {
    tool: 'proposeDocument',
    type: 'Invoice',
    customer: 'Bruce Swinton',
    vehicle: '2018 Jeep Wrangler',
    parts: [
      { name: 'Brakes (All 4 Wheels) - Customer Supplied Parts + Labor Flat Rate', qty: 1, unitPrice: 380 },
      { name: 'Coolant Tank & Turn Signal Bulbs - Customer Supplied Parts + Labor Flat Rate', qty: 1, unitPrice: 430 },
    ],
    labors: [],
    apply_tax: true,
    tax_rate: 8.25,
  }

  assert.equal(draftTools.extractHardTotal(userText, parsed), 430)

  const normalized = draftTools.normalizeDocumentDraft(parsed, { userText })
  assert.equal(normalized.apply_tax, false)
  assert.equal(normalized.tax_rate, 0)
  assert.equal(normalized.parts.length, 0)
  assert.equal(
    JSON.stringify(normalized.labors.map((line) => line.operation)),
    JSON.stringify(['Four wheel brake service', 'Replace coolant tank', 'Replace turn signal light bulbs'])
  )

  const total = normalized.labors.reduce((sum, line) => sum + money.laborLineTotal(line), 0)
  assert.equal(total, 430)
  assert.ok(normalized.labors.every((line) => money.laborLineTotal(line) > 0))
})

test('parts-and-labor shorthand creates a nonzero flat labor invoice line', () => {
  const normalized = draftTools.normalizeDocumentDraft(
    {
      tool: 'proposeDocument',
      type: 'Invoice',
      customer: 'John',
      parts: [],
      labors: [],
    },
    { userText: 'i need a invoice for john 4 brakes for 240 parts and labor' }
  )

  assert.equal(normalized.parts.length, 0)
  assert.equal(normalized.labors.length, 1)
  assert.equal(normalized.labors[0].operation, 'Four wheel brake service')
  assert.equal(money.laborLineTotal(normalized.labors[0]), 240)
})

test('proposal cards use UTF-8-safe payload encoding instead of raw btoa/atob JSON', () => {
  assert.match(aiPage, /TextEncoder/)
  assert.match(aiPage, /TextDecoder/)
  assert.match(aiPage, /normalizeDocumentDraft/)
  assert.doesNotMatch(aiPage, /btoa\(JSON\.stringify/)
  assert.doesNotMatch(aiPage, /JSON\.parse\(atob/)
})
