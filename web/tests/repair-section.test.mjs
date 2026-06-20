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
    URL,
    fetch: async () => ({ ok: false, json: async () => ({}), text: async () => '' }),
    process: { env: {} },
    AbortSignal: { timeout: () => undefined },
    require: (id) => {
      if (id in stubs) return stubs[id]
      throw new Error(`Unexpected import in test module: ${id}`)
    },
  }

  vm.runInNewContext(compiled, sandbox, { filename: relativePath })
  return testModule.exports
}

const repairSources = loadTsModule('../src/lib/repair/sources.ts')
const repairRoute = readFileSync(new URL('../src/app/api/repair-search/route.ts', import.meta.url), 'utf8')
const repairManualRoute = readFileSync(new URL('../src/app/api/repair-manual/route.ts', import.meta.url), 'utf8')
const repairPage = readFileSync(new URL('../src/app/(app)/repair/page.tsx', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../src/app/(app)/layout.tsx', import.meta.url), 'utf8')
const capabilities = readFileSync(new URL('../src/lib/ai/capabilities.ts', import.meta.url), 'utf8')
const router = readFileSync(new URL('../src/lib/ai/router.ts', import.meta.url), 'utf8')
const aiPage = readFileSync(new URL('../src/app/(app)/ai/page.tsx', import.meta.url), 'utf8')

test('repair query parser normalizes shorthand vehicle and DTC requests', () => {
  const parsed = repairSources.parseRepairQuery('find P0420 diagnostic procedure for 04 civic')

  assert.equal(parsed.year, '2004')
  assert.equal(parsed.make, 'Honda')
  assert.equal(parsed.model, 'civic')
  assert.equal(parsed.dtc, 'P0420')
  assert.doesNotMatch(parsed.component, /\bcivic\b/i)
})

test('repair draft is explicitly source-required and technician-review only', () => {
  const draft = repairSources.buildRepairDraft(
    '2005 Honda Civic front lower control arms',
    { year: '2005', make: 'Honda', model: 'Civic' },
    'front lower control arms'
  )

  assert.equal(draft.status, 'draft_needs_technician_review')
  assert.equal(draft.sourceRequired, true)
  assert.match(draft.warnings.join(' '), /Technician must verify/i)
  assert.match(draft.checklist.join(' '), /torque specs/i)
})

test('manual URL normalization is allowlisted to CHARM and LEMON only', () => {
  const charm = repairSources.normalizeManualUrl('http://charm.li/Honda/2005/#brakes')
  assert.equal(charm.provider, 'CHARM')
  assert.equal(charm.url, 'https://charm.li/Honda/2005/')

  const lemon = repairSources.normalizeManualUrl('https://lemon-manuals.la/Honda/2018/')
  assert.equal(lemon.provider, 'LEMON')
  assert.equal(lemon.url, 'https://lemon-manuals.la/Honda/2018/')

  assert.equal(repairSources.normalizeManualUrl('https://example.com/Honda/2018/'), null)
  assert.equal(repairSources.normalizeManualUrl('not-a-url'), null)
})

test('repair search returns workflow coverage and safety gates', async () => {
  const result = await repairSources.searchRepairSources('2005 Honda Civic front lower control arms')

  assert.equal(result.workflow.vehicleMatch.level, 'year_make_model')
  assert.equal(result.workflow.coverage.hasManual, true)
  assert.equal(result.workflow.coverage.hasOfficialData, true)
  assert.match(result.workflow.safetyGates.join(' '), /No torque specs/i)
  assert.match(result.draft.checklist.join(' '), /alignment/i)
})

test('repair search API is authenticated, rate limited, audited, and source-backed', () => {
  assert.match(repairRoute, /getAuthedShop/)
  assert.match(repairRoute, /checkRateLimit/)
  assert.match(repairRoute, /writeAuditLog/)
  assert.match(repairRoute, /repair\.search/)
  assert.match(repairRoute, /searchRepairSources/)
})

test('repair manual preview API is authenticated, rate limited, audited, and source allowlisted', () => {
  assert.match(repairManualRoute, /getAuthedShop/)
  assert.match(repairManualRoute, /checkRateLimit/)
  assert.match(repairManualRoute, /writeAuditLog/)
  assert.match(repairManualRoute, /repair\.manual\.preview/)
  assert.match(repairManualRoute, /readRepairManualPage/)
  assert.match(repairManualRoute, /Only CHARM and LEMON/)
})

test('repair UI exposes workflow, manual reader, source stack, saved drafts, and estimate handoff', () => {
  assert.match(layout, /href: '\/repair'/)
  assert.match(repairPage, /LEMON/)
  assert.match(repairPage, /CHARM/)
  assert.match(repairPage, /NHTSA/)
  assert.match(repairPage, /Repair Workflow/)
  assert.match(repairPage, /Source Stack/)
  assert.match(repairPage, /Manual Reader/)
  assert.match(repairPage, /Manual Tree/)
  assert.match(repairPage, /Pinned Sources/)
  assert.match(repairPage, /Safety Gates/)
  assert.match(repairPage, /\/api\/repair-manual/)
  assert.match(repairPage, /Technician verification required/)
  assert.match(repairPage, /alpha_repair_drafts/)
  assert.match(repairPage, /Build Estimate Draft/)
})

test('repair agent, tool, skill, router, and chat handoff are registered', () => {
  assert.match(capabilities, /id: 'repair'/)
  assert.match(capabilities, /name: 'repairSearch'/)
  assert.match(capabilities, /id: 'source_backed_repair_research'/)
  assert.match(router, /repair_lookup/)
  assert.match(router, /REPAIR_TERMS/)
  assert.match(aiPage, /route\.intent === 'repair_lookup'/)
  assert.match(aiPage, /\/api\/repair-search/)
  assert.match(aiPage, /I will not invent torque specs/)
})
