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
const repairPresentation = loadTsModule('../src/lib/repair/presentation.ts')
const repairRoute = readFileSync(new URL('../src/app/api/repair-search/route.ts', import.meta.url), 'utf8')
const repairManualRoute = readFileSync(new URL('../src/app/api/repair-manual/route.ts', import.meta.url), 'utf8')
const repairProcedureRoute = readFileSync(new URL('../src/app/api/repair-procedures/route.ts', import.meta.url), 'utf8')
const repairEstimateRoute = readFileSync(new URL('../src/app/api/repair-estimate/route.ts', import.meta.url), 'utf8')
const repairPage = readFileSync(new URL('../src/app/(app)/repair/page.tsx', import.meta.url), 'utf8')
const layout = readFileSync(new URL('../src/app/(app)/layout.tsx', import.meta.url), 'utf8')
const capabilities = readFileSync(new URL('../src/lib/ai/capabilities.ts', import.meta.url), 'utf8')
const router = readFileSync(new URL('../src/lib/ai/router.ts', import.meta.url), 'utf8')
const aiPage = readFileSync(new URL('../src/app/(app)/ai/page.tsx', import.meta.url), 'utf8')
const repairMigration = readFileSync(new URL('../../supabase/migrations/20260620_repair_workspace.sql', import.meta.url), 'utf8')

test('repair query parser normalizes shorthand vehicle and DTC requests', () => {
  const parsed = repairSources.parseRepairQuery('find P0420 diagnostic procedure for 04 civic')

  assert.equal(parsed.year, '2004')
  assert.equal(parsed.make, 'Honda')
  assert.equal(parsed.model, 'civic')
  assert.equal(parsed.dtc, 'P0420')
  assert.match(parsed.component, /catalyst|catalytic|converter|oxygen|exhaust/i)
  assert.doesNotMatch(parsed.component, /\bcivic\b/i)
})

test('P0420 removal follow-up stays on catalyst/exhaust context', async () => {
  const parsed = repairSources.parseRepairQuery('2005 Honda Civic P0420 show me the removal')

  assert.equal(parsed.year, '2005')
  assert.equal(parsed.make, 'Honda')
  assert.equal(parsed.model, 'civic')
  assert.equal(parsed.dtc, 'P0420')
  assert.match(parsed.component, /catalytic converter|exhaust|oxygen sensor/i)

  const result = await repairSources.searchRepairSources('2005 Honda Civic P0420 show me the removal')
  assert.equal(result.normalizedVehicle.year, '2005')
  assert.equal(result.normalizedVehicle.make, 'Honda')
  assert.equal(result.normalizedVehicle.model, 'civic')
  assert.match(result.draft.operation, /catalytic converter|exhaust|oxygen sensor/i)
  assert.ok(result.operationLines.some((line) => line.system === 'emissions/exhaust'))
  assert.doesNotMatch(result.manualMatches.map((item) => item.title).join(' '), /Brake Fluid Level Sensor|Cabin Air|GMC Sierra/i)
})

test('P0300 order follow-up maps to firing order instead of losing vehicle context', () => {
  const parsed = repairSources.parseRepairQuery('2012 Chevrolet Silverado P0300 firing order cylinder order')

  assert.equal(parsed.year, '2012')
  assert.equal(parsed.make, 'Chevrolet')
  assert.equal(parsed.model, 'silverado')
  assert.equal(parsed.dtc, 'P0300')
  assert.match(parsed.component, /firing order|cylinder order|misfire/i)
})

test('repair parser can use remembered vehicle for fuse and wiring follow-ups', () => {
  const parsed = repairSources.parseRepairQuery('fuse box fuse relay location diagram', {
    year: '2005',
    make: 'Honda',
    model: 'civic',
  })

  assert.equal(parsed.year, '2005')
  assert.equal(parsed.make, 'Honda')
  assert.equal(parsed.model, 'civic')
  assert.match(parsed.component, /fuse|relay|diagram/i)
})

test('repair presentation leads with a plain mechanic answer and direct action links', async () => {
  const result = await repairSources.searchRepairSources('2005 Honda Civic P0420')
  const view = repairPresentation.buildRepairPresentation('2005 Honda Civic P0420', result)

  assert.match(view.plainAnswer, /P0420/)
  assert.match(view.plainAnswer, /testing before selling parts/i)
  assert.equal(view.needsExactVehicle, true)
  assert.equal(view.primaryActionLabel, 'Pick Engine First')
  assert.ok(view.actionLinks.length > 0)
  assert.ok(view.actionLinks.every((link) => link.url.startsWith('http')))
  assert.ok(view.actionLinks.some((link) => link.confidence === 'manual_choice'))
  assert.ok(view.vehicleChoices.length > 0)
  assert.match(view.mechanicSummary, /engine|Manual/i)
  assert.match(view.jobCard.sourceState, /Manual|source|page/i)
  assert.ok(view.askNext.includes('show me diagram'))
})

test('P0420 location follow-up stays on catalyst and asks for engine', async () => {
  const result = await repairSources.searchRepairSources('2012 Honda Accord P0420 component location bank 1 sensor location catalyst exhaust oxygen sensor')
  const view = repairPresentation.buildRepairPresentation('where is location?', result)

  assert.equal(view.primaryIntent, 'location')
  assert.match(view.plainAnswer, /catalyst, exhaust, and oxygen sensor area/i)
  assert.match(view.plainAnswer, /2\.4L 4-cylinder or 3\.5L V6/i)
  assert.equal(view.checkHeading, 'Location To Check')
  assert.ok(view.checks.some((item) => /upstream/i.test(item)))
  assert.ok(view.checks.some((item) => /downstream/i.test(item)))
  assert.equal(view.primaryActionLabel, 'Pick Engine First')
  assert.ok(view.askNext.includes('2.4L 4-cylinder'))
  assert.ok(view.askNext.includes('3.5L V6'))
  assert.doesNotMatch(view.mechanicSummary, /fuse box/i)
})

test('engine choice is parsed and stops exact-engine gating', async () => {
  const parsed = repairSources.parseRepairQuery('2012 Honda Accord P0420 2.4L Automatic')
  assert.equal(parsed.engine, '2.4L')
  assert.equal(parsed.transmission, 'Automatic')

  const result = await repairSources.searchRepairSources('2012 Honda Accord P0420 2.4L Automatic')
  const view = repairPresentation.buildRepairPresentation('2012 Honda Accord P0420 2.4L Automatic', result)
  assert.equal(result.normalizedVehicle.engine, '2.4L')
  assert.equal(view.needsExactVehicle, false)
})

test('repair presentation recognizes diagram intent and keeps exact vehicle gate first', async () => {
  const result = await repairSources.searchRepairSources('2005 Honda Civic P0420 wiring diagram')
  const view = repairPresentation.buildRepairPresentation('2005 Honda Civic P0420 wiring diagram', result)

  assert.equal(view.primaryIntent, 'diagram')
  assert.equal(view.primaryActionLabel, 'Pick Engine First')
  assert.ok(view.askNext.includes('show me testing steps'))
  assert.ok(view.vehicleChoices.every((choice) => choice.url.startsWith('http')))
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
  assert.ok(Array.isArray(result.manualMatches))
  assert.ok(result.operationLines.some((line) => /control arms/i.test(line.label)))
  assert.equal(result.safetyProfile.level, 'elevated')
  assert.equal(typeof result.coverageDashboard.indexedPages, 'number')
})

test('repair estimate draft itemizes locked totals and does not confuse shorthand years for money', async () => {
  const quote = await repairSources.searchRepairSources('2018 Jeep Wrangler four brakes coolant tank turn signal bulbs total $430')
  assert.equal(quote.estimateDraft.targetTotal, 430)
  assert.equal(quote.estimateDraft.totalLocked, true)
  assert.match(quote.operationLines.map((line) => line.label).join(' '), /Four wheel brake service/i)
  assert.match(quote.operationLines.map((line) => line.label).join(' '), /coolant reservoir/i)
  assert.match(quote.operationLines.map((line) => line.label).join(' '), /turn signal/i)
  assert.equal(Math.round(quote.estimateDraft.labors.reduce((sum, line) => sum + Number(line.amount || 0), 0) * 100) / 100, 430)

  const lookup = await repairSources.searchRepairSources('open comet browser and search for brakes for 04 civic')
  assert.equal(lookup.normalizedVehicle.year, '2004')
  assert.equal(lookup.estimateDraft.targetTotal, null)
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

test('repair procedure and estimate APIs are authenticated, audited, and migration-aware', () => {
  assert.match(repairProcedureRoute, /getAuthedShop/)
  assert.match(repairProcedureRoute, /checkRateLimit/)
  assert.match(repairProcedureRoute, /writeAuditLog/)
  assert.match(repairProcedureRoute, /repair\.procedure_card\.create/)
  assert.match(repairProcedureRoute, /migrationRequired/)
  assert.match(repairProcedureRoute, /repair_procedure_cards/)

  assert.match(repairEstimateRoute, /getAuthedShop/)
  assert.match(repairEstimateRoute, /checkRateLimit/)
  assert.match(repairEstimateRoute, /writeAuditLog/)
  assert.match(repairEstimateRoute, /repair\.estimate\.create/)
  assert.match(repairEstimateRoute, /documents/)
  assert.match(repairEstimateRoute, /Enter a locked total or verified line pricing/)
})

test('repair workspace migration defines shop-scoped procedure cards and sessions', () => {
  assert.match(repairMigration, /repair_procedure_cards/)
  assert.match(repairMigration, /repair_research_sessions/)
  assert.match(repairMigration, /shop_id/)
  assert.match(repairMigration, /enable row level security/i)
  assert.match(repairMigration, /shop_profiles/)
})

test('repair UI exposes workflow tabs, manual reader, source stack, saved drafts, and estimate handoff', () => {
  assert.match(layout, /href: '\/repair'/)
  assert.match(repairPage, /LEMON/)
  assert.match(repairPage, /CHARM/)
  assert.match(repairPage, /NHTSA/)
  assert.match(repairPage, /MAIN_TABS/)
  assert.match(repairPage, /Easy Answer/)
  assert.match(repairPage, /AI Repair/)
  assert.match(repairPage, /Mechanic Answer/)
  assert.match(repairPage, /mechanicSummary/)
  assert.match(repairPage, /Use This Engine/)
  assert.match(repairPage, /Repair Summary/)
  assert.match(repairPage, /Ask Next/)
  assert.match(repairPage, /primaryActionLabel/)
  assert.match(repairPage, /Open The Info/)
  assert.match(repairPage, /Pick Engine First/)
  assert.match(repairPage, /checkHeading/)
  assert.match(repairPage, /What To Check First/)
  assert.match(repairPage, /Do Not Assume/)
  assert.match(repairPage, /Next Shop Action/)
  assert.match(repairPage, /Repair Workflow/)
  assert.match(repairPage, /Source Stack/)
  assert.match(repairPage, /Manual Reader/)
  assert.match(repairPage, /Manual Tree/)
  assert.match(repairPage, /Estimate Builder/)
  assert.match(repairPage, /Shop Notes/)
  assert.match(repairPage, /Diagram Viewer/)
  assert.match(repairPage, /Pinned Sources/)
  assert.match(repairPage, /Safety Gates/)
  assert.match(repairPage, /\/api\/repair-manual/)
  assert.match(repairPage, /\/api\/repair-estimate/)
  assert.match(repairPage, /\/api\/repair-procedures/)
  assert.match(repairPage, /URLSearchParams\(window\.location\.search\)/)
  assert.match(repairPage, /runSearch\(urlQuery\)/)
  assert.match(repairPage, /Technician verification required/)
  assert.match(repairPage, /alpha_repair_drafts/)
  assert.match(repairPage, /Create Estimate Draft/)
  assert.match(repairPage, /ai_repair_mode/)
})

test('repair agent, tool, skill, router, and chat handoff are registered', () => {
  assert.match(capabilities, /id: 'repair'/)
  assert.match(capabilities, /name: 'repairSearch'/)
  assert.match(capabilities, /id: 'source_backed_repair_research'/)
  assert.match(router, /repair_lookup/)
  assert.match(router, /REPAIR_TERMS/)
  assert.match(aiPage, /route\.intent === 'repair_lookup'/)
  assert.match(aiPage, /\/api\/repair-search/)
  assert.match(aiPage, /mechanicSummary/)
  assert.match(capabilities, /Repair Workspace/)
  assert.match(aiPage, /do not invent torque specs/i)
  assert.match(aiPage, /repairOnlyMode/)
  assert.match(aiPage, /toggleRepairMode/)
  assert.match(aiPage, /runRepairLookup/)
  assert.match(aiPage, /Repair mode toggle/)
  assert.match(aiPage, /RepairResultCard/)
  // The chat answers like a person and pastes the real manual content inline —
  // the old "Mechanic Answer" form boxes are intentionally gone.
  assert.doesNotMatch(aiPage, /Mechanic Answer/)
  assert.match(aiPage, /REPAIR_VOICE_PROMPT/)
  assert.match(aiPage, /From the manual/)
  assert.match(aiPage, /renderProcedureHtml/)
  assert.match(aiPage, /procedureText/)
  assert.match(aiPage, /proxiedImage/)
  assert.match(aiPage, /Use This Engine/)
  assert.match(aiPage, /primaryActionLabel/)
  assert.match(aiPage, /checkHeading/)
  assert.doesNotMatch(aiPage, /Repair Mode Result/)
  assert.doesNotMatch(aiPage, /Source Stack/)
  assert.doesNotMatch(aiPage, /Deep manual matches/)
  assert.doesNotMatch(aiPage, /Repair research for/)
  assert.match(aiPage, /repairResult/)
  assert.match(aiPage, /lastRepairContextRef/)
  assert.match(aiPage, /REPAIR_FOLLOWUP_TERMS/)
  assert.match(aiPage, /firing order cylinder order/)
  assert.match(aiPage, /fallbackVehicle/)
  assert.match(aiPage, /removalTerms/)
  assert.match(aiPage, /component location bank 1 sensor location/)
  assert.match(aiPage, /lastRepairContextRef\.current = latestRepair/)
  assert.match(aiPage, /view\.actionLinks\.map/)
  assert.match(aiPage, /link\.detail/)
  assert.match(aiPage, /Repair workspace/)
  assert.match(aiPage, /repairWorkspaceUrl/)
  assert.match(aiPage, /REPAIR ONLY MODE/)
  assert.match(aiPage, /Repair Only Mode/)
})
