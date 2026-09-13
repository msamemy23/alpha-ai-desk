import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const route = readFileSync(new URL('../src/app/api/parts-lookup/route.ts', import.meta.url), 'utf8')
const partsPage = readFileSync(new URL('../src/app/(app)/parts/page.tsx', import.meta.url), 'utf8')
const sendSms = readFileSync(new URL('../src/app/api/send-sms/route.ts', import.meta.url), 'utf8')
const aiAction = readFileSync(new URL('../src/app/api/ai-action/route.ts', import.meta.url), 'utf8')
const saveDocument = readFileSync(new URL('../src/app/api/save-document/route.ts', import.meta.url), 'utf8')
const smsConsent = readFileSync(new URL('../src/lib/sms-consent.ts', import.meta.url), 'utf8')
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
  assert.match(route, /sourceConfidence/)
  assert.doesNotMatch(partsPage, /AI-estimated|realistic pricing/i)
  assert.match(partsPage, /Prices only show when they are visible/)
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
  assert.match(route, /evidenceQuote/)
  assert.match(route, /price was not bound to the same product evidence/)
  assert.match(route, /function fetchAutoZoneCategoryEvidence/)
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
  assert.match(route, /PARTS_AI_TIMEOUT_MS = 45_000/)
  assert.match(route, /function isStrictAutoZoneCategoryUrl/)
  assert.match(route, /url\.protocol === 'https:'/)
  assert.match(route, /requestedByCanonicalUrl\.get\(canonicalUrl\(result\.url\)\)/)
  assert.match(route, /function readBoundedResponseText/)
  assert.match(route, /expected !== received/)
  assert.match(route, /contentType\.toLowerCase\(\)\.includes\('text\/html'\)/)
  assert.match(route, /\(\?:\\\$\\s\*\|USD\\s\+\)\\d/)
  assert.match(route, /directPageCandidates/)
  assert.match(route, /directPagesFetched/)
  assert.match(route, /tavilyExtractCandidates/)
  assert.match(route, /tavilyExtractFetched/)
  assert.match(route, /const mergedResults = new Map/)
  assert.match(route, /evidenceScore\(result\) > evidenceScore\(current\)/)
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

