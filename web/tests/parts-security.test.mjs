import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const route = readFileSync(new URL('../src/app/api/parts-lookup/route.ts', import.meta.url), 'utf8')
const partsPage = readFileSync(new URL('../src/app/(app)/parts/page.tsx', import.meta.url), 'utf8')
const sendSms = readFileSync(new URL('../src/app/api/send-sms/route.ts', import.meta.url), 'utf8')
const aiAction = readFileSync(new URL('../src/app/api/ai-action/route.ts', import.meta.url), 'utf8')
const saveDocument = readFileSync(new URL('../src/app/api/save-document/route.ts', import.meta.url), 'utf8')
const smsConsent = readFileSync(new URL('../src/lib/sms-consent.ts', import.meta.url), 'utf8')
const priceEvidence = readFileSync(new URL('../src/lib/ai/price-evidence.js', import.meta.url), 'utf8')
const tavilyExtract = route.slice(
  route.indexOf('async function extractAutoZoneCategoryEvidence'),
  route.indexOf('async function searchParts')
)

test('parts lookup is authenticated, shop scoped, rate limited, and audited', () => {
  assert.match(route, /getAuthedShop/)
  assert.match(route, /\.eq\('shop_id', auth\.shopId\)/)
  assert.match(route, /checkRateLimit/)
  assert.match(route, /writeAuditLog/)
})

test('parts lookup strips unverified prices instead of inventing them', () => {
  assert.match(route, /sanitizeParsedParts/)
  assert.match(route, /priceAppearsInEvidence/)
  assert.match(route, /hasVisiblePrice/)
  assert.match(route, /visiblePriceMatches/)
  assert.match(route, /sourceConfidence/)
  assert.doesNotMatch(partsPage, /AI-estimated|realistic pricing/i)
  assert.match(partsPage, /only shows prices it can verify/)
  assert.match(partsPage, /No exact prices verified/)
  assert.match(route, /balancedBrakeQueries/)
  assert.match(route, /amazon: 'amazon\.com'/)
  assert.match(route, /urlMatchesStores/)
  assert.match(route, /SERPER_API_KEY/)
  assert.match(route, /google\.serper\.dev\/search/)
  assert.match(route, /canonicalUrl/)
  assert.match(route, /laborGuidance/)
})

test('AutoZone category evidence is deterministic, fitment-bound, and price-backed', () => {
  assert.match(route, /function autoZoneCategoryUrls/)
  assert.match(route, /stores\.includes\('autozone\.com'\)/)
  assert.match(route, /\^\\d\{4\}\$/)
  assert.match(route, /brakes-and-traction-control\/\$\{category\}\/\$\{make\}\/\$\{model\}\/\$\{vehicle\.year\}/)
  assert.match(route, /function visibleHtmlEvidence/)
  assert.match(route, /function priceAppearsNearIdentity/)
  assert.match(route, /function evidenceQuoteAppearsInSource/)
  assert.match(route, /function evidenceQuoteHasOnePrice/)
  assert.match(route, /parseAutoZoneCategoryEvidence/)
  assert.match(route, /const deterministic = parseAutoZoneCategoryEvidence/)
  assert.match(route, /evidenceQuote/)
  assert.match(route, /price was not bound to the same product evidence/)
  assert.match(route, /function fetchAutoZoneCategoryEvidence/)
  assert.match(route, /function autoZoneCategoryUrlMatchesVehicle/)
  assert.match(route, /const vehicleBoundResults = rawResults\.filter/)
  assert.match(route, /function extractAutoZoneCategoryEvidence/)
  assert.match(route, /https:\/\/api\.tavily\.com\/extract/)
  assert.match(tavilyExtract, /'Authorization': `Bearer \$\{TAVILY_API_KEY\}`/)
  assert.match(tavilyExtract, /urls: requestedUrls/)
  assert.match(tavilyExtract, /extract_depth: 'advanced'/)
  assert.match(tavilyExtract, /format: 'text'/)
  assert.match(tavilyExtract, /timeout: TAVILY_EXTRACT_TIMEOUT_SECONDS/)
  assert.match(tavilyExtract, /contentType\.toLowerCase\(\)\.includes\('application\/json'\)/)
  assert.match(tavilyExtract, /results\?: \{ url\?: string; raw_content\?: string \}/)
  assert.doesNotMatch(tavilyExtract, /api_key:/)
  assert.doesNotMatch(tavilyExtract, /chunks_per_source/)
  assert.match(route, /MAX_TAVILY_EXTRACT_URLS = 20/)
  assert.match(route, /MAX_TAVILY_EXTRACT_BYTES = 1_000_000/)
  assert.match(route, /MAX_DIRECT_PAGE_BYTES = 2_000_000/)
  // The model is only a bounded enrichment step: a slow or missing model must not hold up the retailer lookup.
  assert.match(route, /PARTS_AI_TIMEOUT_MS = 12_000/)
  assert.match(route, /function isStrictAutoZoneCategoryUrl/)
  assert.match(route, /const title = isStrictAutoZoneCategoryUrl\(richer\.url\) \? 'AutoZone fitment category'/)
  assert.match(route, /url\.protocol === 'https:'/)
  assert.match(route, /requestedByCanonicalUrl\.get\(canonicalUrl\(result\.url\)\)/)
  assert.match(route, /function readBoundedResponseText/)
  assert.match(route, /expected !== received/)
  assert.match(route, /contentType\.toLowerCase\(\)\.includes\('text\/html'\)/)
  assert.match(priceEvidence, /DOLLARS_PRICE_PATTERN/)
  assert.match(priceEvidence, /dollars\?\(\?:\\s\+and\\s\+/)
  assert.match(route, /hasVisiblePrice\(evidence\)/)
  assert.match(route, /directPageCandidates/)
  assert.match(route, /directPagesFetched/)
  assert.match(route, /tavilyExtractCandidates/)
  assert.match(route, /tavilyExtractFetched/)
  assert.match(route, /const mergedResults = new Map/)
  assert.match(route, /evidenceScore\(result\) > evidenceScore\(current\)/)
  assert.match(route, /const parserPriority = \(result: SearchResult\)/)
  assert.match(route, /AutoZone fitment category \(Tavily extract\)/)
  assert.match(route, /AutoZone fitment category \(hosted browser\)/)
  assert.match(route, /parserPriority\(right\) - parserPriority\(left\)/)
  assert.match(route, /\|\| evidenceScore\(right\) - evidenceScore\(left\)/)
})

test('SMS and AI shop actions have rate limit, audit, and idempotency safeguards', () => {
  for (const source of [sendSms, aiAction]) {
    assert.match(source, /checkRateLimit/)
    assert.match(source, /writeAuditLog/)
    assert.match(source, /Idempotency|idempotency/i)
  }
})

test('financial and SMS safeguards are durable and tenant-bound', () => {
  assert.doesNotMatch(sendSms, /sentSmsKeys/)
  assert.match(sendSms, /claim_sms_send_operation/)
  assert.match(sendSms, /isSmsOptedOut/)
  assert.match(smsConsent, /shop_id/)
  assert.match(saveDocument, /Paid or partially paid documents are financially immutable/)
})


// The next tests run the real helper functions from the route. They are cut out of the source and compiled,
// because the route itself needs the framework and the database to load.
import ts from 'typescript'

function loadRouteHelpers(names) {
  const pick = (name) => {
    const start = route.search(new RegExp(`^(export )?function ${name}\\b`, 'm'))
    assert.ok(start >= 0, `${name} is missing from the route`)
    const end = route.indexOf('\n}\n', start)
    return route.slice(start, end + 3).replace(/^export /, '')
  }
  const source = names.map(pick).join('\n\n') + `\nreturn { ${names.join(', ')} }`
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText
  return new Function(js)()
}

const diagnostics = (over = {}) => ({
  requestedQueries: 4, completedQueries: 4, providerResults: 0, retailerResults: 0, shoppingCandidates: 0, shoppingResults: 0,
  shoppingCompletedQueries: 0, directPageCandidates: 0, directPagesFetched: 0, tavilyExtractCandidates: 0, tavilyExtractFetched: 0,
  browserPageCandidates: 0, browserPagesFetched: 0, browserFailures: 0, providerAttempts: 4, providerFailures: 0, providers: ['serper'], ...over,
})
const vehicle = { year: '2015', make: 'Honda', model: 'Accord' }

test('a failed lookup says why, and asks for trim or engine only when the retailer asked for it', () => {
  const { describePriceAvailability } = loadRouteHelpers(['describePriceAvailability'])
  const priced = describePriceAvailability({ vehicle, results: [], diagnostics: diagnostics(), sourceBackedItems: 3 })
  assert.equal(priced.state, 'priced')
  assert.equal(priced.reason, 'source_backed_price_found')

  const noVehicle = describePriceAvailability({ vehicle: { year: '', make: 'Honda', model: '' }, results: [], diagnostics: diagnostics(), sourceBackedItems: 0 })
  assert.equal(noVehicle.reason, 'vehicle_context_missing')
  assert.match(noVehicle.actionable, /year, make, and model/)

  const asksTrim = describePriceAvailability({
    vehicle, diagnostics: diagnostics({ directPageCandidates: 2 }), sourceBackedItems: 0,
    results: [{ title: 'AutoZone', url: 'https://www.autozone.com/x', content: 'Please select your trim to see compatible brake pads.' }],
  })
  assert.equal(asksTrim.fitmentRequired, true)
  assert.deepEqual(asksTrim.fitmentFields, ['trim'])

  const providerDown = describePriceAvailability({ vehicle, results: [], diagnostics: diagnostics({ providerAttempts: 4, providerFailures: 4 }), sourceBackedItems: 0 })
  assert.equal(providerDown.reason, 'research_provider_unavailable')
  assert.equal(providerDown.fitmentRequired, false)
  assert.match(providerDown.actionable, /not needed/)

  const pageNoPrices = describePriceAvailability({ vehicle, results: [], diagnostics: diagnostics({ directPageCandidates: 2, providerFailures: 0 }), sourceBackedItems: 0 })
  assert.equal(pageNoPrices.reason, 'retailer_page_did_not_expose_prices')
  assert.equal(pageNoPrices.fitmentRequired, false)

  const nothing = describePriceAvailability({ vehicle, results: [], diagnostics: diagnostics(), sourceBackedItems: 0 })
  assert.equal(nothing.reason, 'no_source_backed_price')
  assert.equal(nothing.coverage.sourceBackedItems, 0)
})

test('a plain brake request is understood without the AI model', () => {
  const { fallbackDecomposition } = loadRouteHelpers(['fallbackDecomposition'])
  const all = fallbackDecomposition('2015 Honda Accord front and rear brakes from AutoZone')
  assert.deepEqual(all.vehicle, { year: '2015', make: 'Honda', model: 'Accord' })
  assert.deepEqual(all.positions, ['Front Left', 'Front Right', 'Rear Left', 'Rear Right'])
  assert.equal(all.searchQueries.length, 4)
  assert.ok(all.searchQueries.every((q) => q.startsWith('2015 Honda Accord')))

  const rear = fallbackDecomposition('2012 Toyota Camry rear brake pads')
  assert.deepEqual(rear.positions, ['Rear Left', 'Rear Right'])
  assert.deepEqual(rear.searchQueries, ['2012 Toyota Camry rear brake pads', '2012 Toyota Camry rear brake rotors'])

  const front = fallbackDecomposition('2018 Ford F150 brakes')
  assert.deepEqual(front.positions, ['Front Left', 'Front Right'])

  const other = fallbackDecomposition('alternator for a 2010 Chevy Malibu')
  assert.deepEqual(other.positions, [])
  assert.equal(other.vehicle.year, '2010')
})

test('a retailer named in the request is searched even when the screen sent no store list', () => {
  const { inferStoresFromQuery } = loadRouteHelpers(['inferStoresFromQuery'])
  assert.deepEqual(inferStoresFromQuery('2015 Honda Accord brakes from AutoZone'), ['autozone.com'])
  assert.deepEqual(inferStoresFromQuery("o'reilly and napa prices for a 2012 Camry alternator").sort(), ['napaonline.com', 'oreillyauto.com'])
  assert.deepEqual(inferStoresFromQuery('2015 Honda Accord brakes'), [])
})

test('the browser fallback is read-only, bounded, and only for the strict category pages', () => {
  assert.match(route, /urls\.filter\(isStrictAutoZoneCategoryUrl\)\.slice\(0, 3\)/)
  assert.match(route, /runHostedBrowser\(url, \[\{ type: 'wait', ms: 1_500 \}\], \{ timeoutMs: 10_000 \}\)/)
  assert.match(route, /if \(!hasVisiblePrice\(evidence\)\) return \{ result: null, failed: false \}/)
  assert.match(route, /canonicalUrl\(browser\.url \|\| ''\) !== canonicalUrl\(url\)/)
  const hosted = readFileSync(new URL('../src/lib/hosted-browser.ts', import.meta.url), 'utf8')
  assert.match(hosted, /timeoutMs\?: number/)
  assert.match(hosted, /Math\.min\(35_000, Math\.max\(5_000/)
})

test('the Parts screen tells the person why nothing was priced', () => {
  assert.match(partsPage, /result\.availability\?\.actionable/)
  assert.match(partsPage, /Open the source links below and check the price yourself/)
  assert.match(route, /warnings\.unshift\(availability\.actionable\)/)
})
