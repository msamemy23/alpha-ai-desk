import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { apiFail, apiOk, optionalStringArray, readJsonObject, requireString, getIdempotencyKey } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { normalizePartsQuery as normalizePartsLookupQuery } from '@/lib/ai/desktop-actions'
import { getUserChatGptTransport } from '@/lib/chatgpt-connection'
import { chatGptModel, fetchOpenAIChatCompletion } from '@/lib/openai-oauth-server'
import { parseAutoZoneCategoryEvidence } from '@/lib/ai/autozone-category-parser'
import { hasExactlyOneVisiblePrice, hasVisiblePrice, priceAppearsInEvidence, visiblePriceMatches } from '@/lib/ai/price-evidence'
import { runHostedBrowser } from '@/lib/hosted-browser'
import type { OpenAIOAuthTransport } from '@openai-oauth/core'

export const dynamic = 'force-dynamic'

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ''
const SERPER_API_KEY = process.env.SERPER_API_KEY || ''
// Parts research must remain useful when the connected model is slow or
// unavailable. Common vehicle/brake requests are parsed locally, and model
// parsing is only a bounded enrichment step.
const PARTS_AI_TIMEOUT_MS = 12_000

interface PartResult {
  position: string
  name: string
  partNumber: string
  price: number
  url: string
  store: string
  inStock: boolean | null
  storeLocation: string | null
  quantity: number
  evidenceQuote?: string
  sourceConfidence: 'verified_exact_product_page' | 'search_result_only'
}

interface PartOption {
  tier: 'budget' | 'mid' | 'premium'
  brand: string
  parts: PartResult[]
  partsTotal: number
}

interface KitOption {
  name: string
  brand: string
  price: number
  url: string
  store: string
  includes: string
  positions: string
  evidenceQuote?: string
  sourceConfidence: 'verified_exact_product_page' | 'search_result_only'
}

interface PartsLookupResult {
  vehicle: string
  query: string
  positions: string[]
  options: PartOption[]
  kits: KitOption[]
  taxRate: number | null
  laborHours: number | null
  laborRate: number | null
  laborGuidance?: {
    operation: string
    hours: number
    basis: 'standard_estimate'
    sourceConfidence: 'estimated'
    note: string
  }
  searchUrls: { store: string; url: string }[]
  sourceConfidence: 'verified_exact_product_page' | 'search_result_only' | 'price_unavailable'
  availability: {
    state: 'priced' | 'price_unavailable'
    reason: 'source_backed_price_found' | 'vehicle_context_missing' | 'retailer_page_did_not_expose_prices' | 'research_provider_unavailable' | 'no_source_backed_price'
    actionable: string
    fitmentRequired: boolean
    fitmentFields: string[]
    coverage: { requestedCategories: number; sourceResults: number; sourceBackedItems: number }
  }
  warnings: string[]
}

const STORE_DOMAINS: Record<string, string> = {
  autozone: 'autozone.com',
  'auto zone': 'autozone.com',
  oreilly: 'oreillyauto.com',
  "o'reilly": 'oreillyauto.com',
  napa: 'napaonline.com',
  rockauto: 'rockauto.com',
  advance: 'advanceautoparts.com',
  'advance auto': 'advanceautoparts.com',
  pepboys: 'pepboys.com',
  'pep boys': 'pepboys.com',
  amazon: 'amazon.com',
  ebay: 'ebay.com',
  'e bay': 'ebay.com',
}

function normalizeStoreFilter(stores?: string[]) {
  const domains = (stores || [])
    .map(store => STORE_DOMAINS[store.toLowerCase().trim()] || store.toLowerCase().trim())
    .filter(Boolean)
    .filter(store => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(store))
  return Array.from(new Set(domains)).slice(0, 6)
}

function inferStoresFromQuery(query: string) {
  const normalized = ` ${query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `
  const aliases: { names: string[]; domain: string }[] = [
    { names: ['autozone', 'auto zone'], domain: 'autozone.com' },
    { names: ['oreilly', 'o reilly'], domain: 'oreillyauto.com' },
    { names: ['napa'], domain: 'napaonline.com' },
    { names: ['advance', 'advance auto'], domain: 'advanceautoparts.com' },
    { names: ['pepboys', 'pep boys'], domain: 'pepboys.com' },
    { names: ['rockauto', 'rock auto'], domain: 'rockauto.com' },
    { names: ['amazon'], domain: 'amazon.com' },
    { names: ['ebay', 'e bay'], domain: 'ebay.com' },
  ]
  return aliases
    .filter(({ names }) => names.some(name => normalized.includes(` ${name} `)))
    .map(({ domain }) => domain)
}

function urlMatchesStores(url: string, stores: string[]) {
  if (!stores.length) return true
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    return stores.some(store => hostname === store || hostname.endsWith(`.${store}`))
  } catch {
    return false
  }
}

function canonicalUrl(value: string) {
  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    return `${url.origin}${url.pathname}`.replace(/\/$/, '').toLowerCase()
  } catch {
    return ''
  }
}

function standardLaborGuidance(query: string, partType: string, positions: string[]) {
  const text = `${query} ${partType}`.toLowerCase()
  const allFour = positions.length >= 4 || /(?:all\s+four|four|4)\s+(?:wheel\s+)?brakes?/i.test(text)
  let hours: number | null = null
  let operation = ''
  if (/brake|rotor|pad|caliper/.test(text)) {
    hours = allFour || (text.includes('front') && text.includes('rear')) ? 3 : 1.5
    operation = allFour ? 'Replace brake pads and rotors on all four wheels' : 'Replace brake pads and rotors on one axle'
  } else if (/lower\s*control\s*arm/.test(text)) {
    const pair = positions.length >= 2 || /both|left\s+and\s+right|front\s+(?:left|right).*front\s+(?:left|right)/.test(text)
    hours = pair ? 3 : 1.5
    operation = pair ? 'Replace both lower control arms' : 'Replace lower control arm'
  } else if (/strut|shock/.test(text)) {
    hours = /both|pair|axle|front\s+and\s+rear/.test(text) ? 3 : 1.5
    operation = /both|pair|axle/.test(text) ? 'Replace struts or shocks on one axle' : 'Replace strut or shock'
  } else if (/oil\s+change/.test(text)) { hours = 0.5; operation = 'Oil change' }
  else if (/alternator/.test(text)) { hours = 2; operation = 'Replace alternator' }
  else if (/starter/.test(text)) { hours = 1.5; operation = 'Replace starter' }
  else if (/water\s+pump/.test(text)) { hours = 2.5; operation = 'Replace water pump' }
  else if (/timing\s+belt/.test(text)) { hours = 3.5; operation = 'Replace timing belt' }
  else if (/head\s+gasket/.test(text)) { hours = 10; operation = 'Replace head gasket' }
  else if (/(?:a\s*\/\s*c|ac|air\s+condition).*(?:compressor)/.test(text)) { hours = 2.5; operation = 'Replace A/C compressor' }
  else if (/radiator/.test(text)) { hours = 2; operation = 'Replace radiator' }
  else if (/battery/.test(text)) { hours = 0.5; operation = 'Replace battery' }
  else if (/tie\s*rod/.test(text)) { hours = 1.5; operation = 'Replace tie rod' }
  else if (/wheel\s+bearing|hub/.test(text)) { hours = 2.5; operation = 'Replace wheel bearing or hub' }
  else if (/axle|cv\s*joint/.test(text)) { hours = 1.5; operation = 'Replace axle or CV joint' }
  if (hours === null) return null
  return { operation, hours, basis: 'standard_estimate' as const, sourceConfidence: 'estimated' as const, note: 'Generic shop baseline; verify the labor time before treating the invoice as final.' }
}

function balancedBrakeQueries(query: string, vehicle: string, partType: string, positions: string[], queries: string[]) {
  const text = `${query} ${partType}`.toLowerCase()
  const allFour = positions.length >= 4 || /(?:all\s+four|four|4)\s+(?:wheel\s+)?brakes?/i.test(text)
  if (!allFour || !/brake|rotor|pad/.test(text)) return Array.from(new Set(queries)).slice(0, 8)
  const base = vehicle.trim() || query.trim()
  return Array.from(new Set([
    `${base} front brake pads`,
    `${base} front brake rotors`,
    `${base} rear brake pads`,
    `${base} rear brake rotors`,
    ...queries,
  ])).slice(0, 8)
}

function normalizedEvidence(value: string) {
  return value
    .toLowerCase()
    .replace(/[’`*_]/g, "'")
    .replace(/[^a-z0-9$.'%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function evidenceQuoteAppearsInSource(quote: unknown, evidence: string) {
  if (typeof quote !== 'string' || !quote.trim()) return false
  const normalizedQuote = normalizedEvidence(quote)
  return normalizedQuote.length >= 8 && normalizedEvidence(evidence).includes(normalizedQuote)
}

function evidenceQuoteHasOnePrice(price: unknown, quote: unknown) {
  if (typeof quote !== 'string' || !quote.trim()) return false
  return hasExactlyOneVisiblePrice(price, quote)
}

function priceAppearsNearIdentity(price: unknown, identity: { name?: unknown; brand?: unknown; partNumber?: unknown; position?: unknown; includes?: unknown }, evidence: string) {
  if (typeof identity.name !== 'string' || identity.name.trim().length < 3) return false
  if (!priceAppearsInEvidence(price, evidence)) return false
  const normalized = evidence.replace(/,/g, '')
  const value = Number(price)
  const priceMatches = visiblePriceMatches(evidence).filter(match => match.value === value)
  const lower = normalized.toLowerCase()
  const exactAnchors = [identity.partNumber, identity.name, [identity.brand, identity.name].filter(Boolean).join(' ')]
    .filter((item): item is string => typeof item === 'string' && item.trim().length >= 3)
    .map(item => item.trim().toLowerCase())
  const position = typeof identity.position === 'string' ? identity.position.toLowerCase().match(/\b(front|rear|left|right)\b/g) || [] : []
  if (priceMatches.some(match => exactAnchors.some(anchor => {
    const index = lower.indexOf(anchor)
    const start = Math.max(0, (match.index || 0) - 600)
    const end = Math.min(lower.length, (match.index || 0) + 600)
    const window = lower.slice(start, end)
    return index >= 0 && Math.abs(index - (match.index || 0)) <= 600 && position.every(token => window.includes(token))
  }))) return true

  // Category pages frequently change punctuation or insert badges between a
  // title and its price. Require several identity tokens in the same bounded
  // window instead of accepting a price from an unrelated product row.
  const ignored = new Set(['the', 'and', 'for', 'with', 'front', 'rear', 'left', 'right', 'brake', 'brakes', 'pad', 'pads', 'rotor', 'rotors', 'disc', 'discs', 'kit', 'set', 'pair'])
  const identityTokens = [...new Set(exactAnchors.flatMap(anchor => anchor.split(/[^a-z0-9]+/).filter(token => token.length >= 3 && !ignored.has(token))))]
  if (identityTokens.length < 2) return false
  return priceMatches.some(match => {
    const start = Math.max(0, (match.index || 0) - 600)
    const end = Math.min(lower.length, (match.index || 0) + 600)
    const window = lower.slice(start, end)
    const tokenMatches = identityTokens.filter(token => window.includes(token)).length
    const positionMatches = position.length === 0 || position.some(token => window.includes(token))
    return tokenMatches >= 2 && positionMatches
  })
}

function sanitizeParsedParts(parsed: { options?: PartOption[]; kits?: KitOption[] }, rawResults: { title: string; url: string; content: string }[], stores: string[] = []) {
  const evidenceByUrl = new Map<string, string>()
  for (const result of rawResults) {
    const evidence = `${result.title}\n${result.content}`
    evidenceByUrl.set(result.url, evidence)
    const canonical = canonicalUrl(result.url)
    if (canonical) evidenceByUrl.set(canonical, evidence)
  }
  const evidenceForUrl = (url: string) => evidenceByUrl.get(url) || evidenceByUrl.get(canonicalUrl(url))
  const warnings: string[] = ['Search snippets are preliminary leads. Exact product price, side/vehicle fitment and availability have not been independently verified. Labor hours use Alpha\'s labeled standard estimate unless a supplied or verified source is present.']

  const options = (parsed.options || []).map(option => {
    const parts = (option.parts || []).flatMap(part => {
      const evidence = evidenceForUrl(part.url)
      if (!part.url || !urlMatchesStores(part.url, stores) || !evidence) {
        warnings.push(`Dropped ${part.name || 'part'} because its source URL was not in the search results.`)
        return []
      }
      if (!priceAppearsInEvidence(part.price, evidence)) {
        warnings.push(`Dropped ${part.name || 'part'} because its price was not visible in the source result.`)
        return []
      }
      if (!priceAppearsNearIdentity(part.price, part, evidence)) {
        warnings.push(`Dropped ${part.name || 'part'} because its price was not bound to the same product evidence.`)
        return []
      }
      if (!evidenceQuoteAppearsInSource(part.evidenceQuote, evidence) || !evidenceQuoteHasOnePrice(part.price, part.evidenceQuote) || !priceAppearsNearIdentity(part.price, part, String(part.evidenceQuote))) {
        warnings.push(`Dropped ${part.name || 'part'} because the source did not provide an exact product-and-price evidence quote.`)
        return []
      }
      const price = Number(part.price)
      const sourceConfidence: PartResult['sourceConfidence'] = 'search_result_only'
      return [{
        ...part,
        price,
        quantity: Number(part.quantity || 1),
        inStock: null,
        storeLocation: null,
        sourceConfidence,
      }]
    })
    return {
      ...option,
      parts,
      partsTotal: parts.reduce((sum, part) => sum + Number(part.price || 0) * Number(part.quantity || 1), 0),
    }
  }).filter(option => option.parts.length > 0).slice(0, 3)

  const kits = (parsed.kits || []).flatMap(kit => {
    const evidence = evidenceForUrl(kit.url)
    if (!kit.url || !urlMatchesStores(kit.url, stores) || !evidence) {
      warnings.push(`Dropped ${kit.name || 'kit'} because its source URL was not in the search results.`)
      return []
    }
    if (!priceAppearsInEvidence(kit.price, evidence)) {
      warnings.push(`Dropped ${kit.name || 'kit'} because its price was not visible in the source result.`)
      return []
    }
    if (!priceAppearsNearIdentity(kit.price, kit, evidence)) {
      warnings.push(`Dropped ${kit.name || 'kit'} because its price was not bound to the same product evidence.`)
      return []
    }
    if (!evidenceQuoteAppearsInSource(kit.evidenceQuote, evidence) || !evidenceQuoteHasOnePrice(kit.price, kit.evidenceQuote) || !priceAppearsNearIdentity(kit.price, kit, String(kit.evidenceQuote))) {
      warnings.push(`Dropped ${kit.name || 'kit'} because the source did not provide an exact product-and-price evidence quote.`)
      return []
    }
    const sourceConfidence: KitOption['sourceConfidence'] = 'search_result_only'
    return [{
      ...kit,
      price: Number(kit.price),
      sourceConfidence,
    }]
  }).slice(0, 3)

  return {
    options,
    kits,
    warnings: warnings.slice(0, 8),
    sourceConfidence: options.length || kits.length
      ? 'search_result_only' as const
      : 'price_unavailable' as const,
  }
}

type PartsSearchDiagnostics = {
  requestedQueries: number
  completedQueries: number
  providerResults: number
  retailerResults: number
  shoppingCandidates: number
  shoppingResults: number
  shoppingCompletedQueries: number
  directPageCandidates: number
  directPagesFetched: number
  tavilyExtractCandidates: number
  tavilyExtractFetched: number
  browserPageCandidates: number
  browserPagesFetched: number
  browserFailures: number
  providerAttempts: number
  providerFailures: number
  providers: string[]
}

/**
 * This is intentionally separate from product parsing. A failed search or a
 * client-rendered retailer page is a research availability problem, not proof
 * that a vehicle needs more fitment details. We ask for trim/engine only when
 * a returned retailer source explicitly asks for it.
 */
export function describePriceAvailability(input: {
  vehicle: VehicleFitment
  results: SearchResult[]
  diagnostics: PartsSearchDiagnostics
  sourceBackedItems: number
}) {
  const requestedCategories = input.diagnostics.directPageCandidates || input.diagnostics.requestedQueries
  const sourceText = input.results.map(result => `${result.title}\n${result.content}`).join('\n').toLowerCase()
  const fitmentFields = [
    /(?:select|choose|enter|provide)[^\n.]{0,80}\btrim\b/.test(sourceText) ? 'trim' : '',
    /(?:select|choose|enter|provide)[^\n.]{0,80}\bengine\b/.test(sourceText) ? 'engine' : '',
  ].filter(Boolean)
  const fitmentRequired = fitmentFields.length > 0
  const coverage = {
    requestedCategories,
    sourceResults: input.results.length,
    sourceBackedItems: input.sourceBackedItems,
  }
  if (input.sourceBackedItems > 0) {
    return {
      state: 'priced' as const,
      reason: 'source_backed_price_found' as const,
      actionable: 'Prices are tied to the listed retailer evidence. Confirm availability and final vehicle fitment with the retailer before checkout.',
      fitmentRequired: false,
      fitmentFields: [] as string[],
      coverage,
    }
  }
  if (!/^\d{4}$/.test(input.vehicle.year) || !input.vehicle.make.trim() || !input.vehicle.model.trim()) {
    return {
      state: 'price_unavailable' as const,
      reason: 'vehicle_context_missing' as const,
      actionable: 'Add the vehicle year, make, and model before looking up compatible parts.',
      fitmentRequired: false,
      fitmentFields: [] as string[],
      coverage,
    }
  }
  if (fitmentRequired) {
    return {
      state: 'price_unavailable' as const,
      reason: 'no_source_backed_price' as const,
      actionable: `The retailer source requests ${fitmentFields.join(' and ')} before it can select a compatible product.`,
      fitmentRequired: true,
      fitmentFields,
      coverage,
    }
  }
  if (input.diagnostics.providerAttempts > 0 && input.diagnostics.providerFailures >= input.diagnostics.providerAttempts && input.diagnostics.retailerResults === 0 && input.diagnostics.browserPagesFetched === 0) {
    return {
      state: 'price_unavailable' as const,
      reason: 'research_provider_unavailable' as const,
      actionable: 'The search provider did not return usable retailer evidence. Retry later; additional trim or engine details are not needed for this failure.',
      fitmentRequired: false,
      fitmentFields: [] as string[],
      coverage,
    }
  }
  if (input.diagnostics.directPageCandidates > 0) {
    return {
      state: 'price_unavailable' as const,
      reason: 'retailer_page_did_not_expose_prices' as const,
      actionable: 'The retailer did not expose a source-bound public price for this vehicle/category. Retry later or choose a specific source-backed product; trim is not required unless the retailer asks for it.',
      fitmentRequired: false,
      fitmentFields: [] as string[],
      coverage,
    }
  }
  return {
    state: 'price_unavailable' as const,
    reason: 'no_source_backed_price' as const,
    actionable: 'No source-backed price was returned. Retry later or provide a retailer product link; no additional fitment details are needed yet.',
    fitmentRequired: false,
    fitmentFields: [] as string[],
    coverage,
  }
}

type PartsAiMessage = { role: 'system' | 'user'; content: string }

type PartsAiConfig = {
  key: string
  base: string
  model: string
  oauthTransport: OpenAIOAuthTransport | null
}

async function callPartsAi(config: PartsAiConfig, messages: PartsAiMessage[], maxTokens: number) {
  if (!config.oauthTransport && !config.key) throw new Error('Parts AI enrichment is unavailable')
  const signal = AbortSignal.timeout(PARTS_AI_TIMEOUT_MS)
  if (config.oauthTransport) {
    const completion = await fetchOpenAIChatCompletion(config.oauthTransport, {
      model: chatGptModel(config.model),
      messages,
      max_tokens: maxTokens,
    }, signal)
    if (!completion.ok) {
      const message = completion.data && typeof completion.data === 'object' && 'error' in completion.data
        ? String((completion.data as { error?: { message?: unknown } }).error?.message || 'ChatGPT request failed')
        : 'ChatGPT request failed'
      throw new Error(message)
    }
    return completion.data
  }

  const res = await fetch(`${config.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model, messages, max_tokens: maxTokens, temperature: 0.1 }),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof data?.error?.message === 'string' ? data.error.message : `AI provider returned ${res.status}`)
  return data
}

function fallbackDecomposition(query: string) {
  const vehicleMatch = query.match(/\b((?:19|20)\d{2})\s+([A-Za-z][A-Za-z-]+)\s+([A-Za-z0-9][A-Za-z0-9-]*)\b/i)
  const vehicle = {
    year: vehicleMatch?.[1] || '',
    make: vehicleMatch?.[2] || '',
    model: vehicleMatch?.[3] || '',
  }
  const lower = query.toLowerCase()
  const allFour = /\b(?:all\s+four|four|4)\s+(?:wheel\s+)?brakes?\b/.test(lower)
    || (/\bfront\b/.test(lower) && /\brear\b/.test(lower))
  const rear = /\brear\b/.test(lower) && !/\bfront\b/.test(lower)
  const front = /\bfront\b/.test(lower) || (!rear && /\bbrakes?\b/.test(lower))
  const positions = allFour
    ? ['Front Left', 'Front Right', 'Rear Left', 'Rear Right']
    : rear
      ? ['Rear Left', 'Rear Right']
      : front
        ? ['Front Left', 'Front Right']
        : []
  const vehicleText = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
  const brakeRequest = /\b(?:brake|pad|pads|rotor|rotors|disc|discs)\b/.test(lower)
  const partType = brakeRequest ? 'brake pads and rotors' : query.trim().slice(0, 160)
  const axleQueries = allFour
    ? ['front brake pads', 'front brake rotors', 'rear brake pads', 'rear brake rotors']
    : rear
      ? ['rear brake pads', 'rear brake rotors']
      : front
        ? ['front brake pads', 'front brake rotors']
        : [partType]
  return {
    vehicle,
    partType,
    positions,
    searchQueries: axleQueries.map(item => `${vehicleText} ${item}`.trim()).filter(Boolean).slice(0, 6),
    laborHours: null,
  }
}

// Use the model only when the request cannot be decomposed safely from its
// explicit vehicle/part wording. This keeps retailer lookup independent from
// a slow ChatGPT/OAuth response for ordinary shop requests.
async function decomposeRequest(query: string, config: PartsAiConfig): Promise<{
  vehicle: { year: string; make: string; model: string };
  partType: string;
  positions: string[];
  searchQueries: string[];
  laborHours: number | null;
}> {
  const fallback = fallbackDecomposition(query)
  if (fallback.vehicle.year && fallback.vehicle.make && fallback.vehicle.model && fallback.positions.length) return fallback
  let data
  try {
    data = await callPartsAi(config, [
        { role: 'system', content: `You are an auto parts expert. Given a parts request, decompose it into structured data.
Return ONLY valid JSON with this exact structure:
{
  "vehicle": { "year": "2006", "make": "Honda", "model": "Accord" },
  "partType": "brake rotors",
  "positions": ["Front Left", "Front Right", "Rear Left", "Rear Right"],
  "searchQueries": [
    "2006 Honda Accord front brake rotors",
    "2006 Honda Accord rear brake rotors"
  ],
  "laborHours": null
}

Rules:
- Normalize shorthand years like "04 Civic" to "2004 Honda Civic" and "05 Civic" to "2005 Honda Civic"
- Preserve store-specific requests such as AutoZone, O'Reilly, NAPA, Advance Auto, and RockAuto in searchQueries
- Distinguish brake pads, rotors, calipers, pads and rotors, and all 4 brakes
- For "all 4 brakes" = front + rear rotors AND pads, positions: FL, FR, RL, RR
- For "front brakes" = front rotors + pads, positions: FL, FR
- For "lower control arms" both front = positions: Front Left, Front Right
- For "front ones both sides" = Front Left and Front Right
- Always return laborHours:null. A generated estimate is not verified labor-book evidence.
- searchQueries should be specific enough to find exact parts with prices on auto parts stores
- Generate 2-4 search queries covering different stores/angles
- ALWAYS include the vehicle year make model in each search query` },
        { role: 'user', content: query }
      ], 500)
  } catch {
    return fallback
  }
  const raw = data.choices?.[0]?.message?.content || '{}'
  try {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    const parsed = JSON.parse(cleaned) as Partial<{
      vehicle: Partial<VehicleFitment>
      partType: string
      positions: string[]
      searchQueries: string[]
    }>
    return {
      vehicle: {
        year: typeof parsed.vehicle?.year === 'string' ? parsed.vehicle.year.trim().slice(0, 4) : fallback.vehicle.year,
        make: typeof parsed.vehicle?.make === 'string' ? parsed.vehicle.make.trim().slice(0, 48) : fallback.vehicle.make,
        model: typeof parsed.vehicle?.model === 'string' ? parsed.vehicle.model.trim().slice(0, 64) : fallback.vehicle.model,
      },
      partType: typeof parsed.partType === 'string' && parsed.partType.trim() ? parsed.partType.trim().slice(0, 160) : fallback.partType,
      positions: Array.isArray(parsed.positions) && parsed.positions.length ? parsed.positions.filter(position => typeof position === 'string').map(position => position.trim().slice(0, 64)).filter(Boolean).slice(0, 8) : fallback.positions,
      searchQueries: Array.isArray(parsed.searchQueries) && parsed.searchQueries.length ? parsed.searchQueries.filter(search => typeof search === 'string').map(search => search.trim().slice(0, 240)).filter(Boolean).slice(0, 6) : fallback.searchQueries,
      laborHours: null,
    }
  } catch {
    return {
      ...fallback,
    }
  }
}

// Search Tavily for parts across multiple stores
type VehicleFitment = { year: string; make: string; model: string }
type SearchResult = { title: string; url: string; content: string }
const MAX_TAVILY_EXTRACT_URLS = 20
const MAX_TAVILY_EXTRACT_BYTES = 1_000_000
const TAVILY_EXTRACT_TIMEOUT_SECONDS = 12
const MAX_DIRECT_PAGE_BYTES = 2_000_000

function autoZonePathSegment(value: string) {
  const segment = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return segment.length > 0 && segment.length <= 48 ? segment : ''
}

function autoZoneCategoryUrls(vehicle: VehicleFitment, partType: string, queries: string[], stores: string[]) {
  if (!stores.includes('autozone.com') || !/^\d{4}$/.test(vehicle.year)) return []
  const make = autoZonePathSegment(vehicle.make)
  const model = autoZonePathSegment(vehicle.model)
  if (!make || !model) return []

  const requested = `${partType} ${queries.join(' ')}`.toLowerCase()
  const isBrakeRequest = /brake|rotor|pad|disc/.test(requested)
  if (!isBrakeRequest) return []
  const allFour = /\bfront\b[\s\S]*\brear\b|\brear\b[\s\S]*\bfront\b/.test(requested)
  const needsPads = /pad/.test(requested) || (!/rotor|disc/.test(requested) && /brake/.test(requested))
  const needsRotors = /rotor|disc/.test(requested) || (!/pad/.test(requested) && /brake/.test(requested))
  const categories = [
    ...(needsPads ? ['brake-pads'] : []),
    ...(needsRotors ? ['brake-rotor'] : []),
    ...(allFour ? ['performance-brake-pads-rotors-kit'] : []),
  ]
  return categories.map(category => `https://www.autozone.com/brakes-and-traction-control/${category}/${make}/${model}/${vehicle.year}`)
}

function isStrictAutoZoneCategoryUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'www.autozone.com'
      && !url.search
      && !url.hash
      && /^\/brakes-and-traction-control\/(?:brake-pads|brake-rotor|performance-brake-pads-rotors-kit)\/[a-z0-9-]+\/[a-z0-9-]+\/\d{4}\/?$/i.test(url.pathname)
  } catch {
    return false
  }
}

function autoZoneCategoryUrlMatchesVehicle(value: string, vehicle: VehicleFitment) {
  if (!isStrictAutoZoneCategoryUrl(value)) return false
  try {
    const url = new URL(value)
    const segments = url.pathname.split('/').filter(Boolean)
    return segments.at(-1) === vehicle.year.trim().toLowerCase()
      && segments.at(-2) === autoZonePathSegment(vehicle.model)
      && segments.at(-3) === autoZonePathSegment(vehicle.make)
  } catch {
    return false
  }
}

function visibleHtmlEvidence(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    // Keep block boundaries so a product row, its price, and its position
    // remain parseable after HTML is converted to evidence text.
    .replace(/<[^>]+>/g, '\n')
    .replace(/&(nbsp|#160);/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, 18_000)
}

async function readBoundedResponseText(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('Extract response exceeds size limit')
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new Error('Extract response exceeds size limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function fetchAutoZoneCategoryEvidence(urls: string[]): Promise<SearchResult[]> {
  const fetched = await Promise.allSettled(urls.map(async (url) => {
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        // AutoZone serves a client page for non-browser-looking requests.
        'User-Agent': 'Mozilla/5.0 (compatible; AlphaAIDeskPartsLookup/1.0)',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(12_000),
    })
    const expected = canonicalUrl(url)
    const received = canonicalUrl(response.url)
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok || expected !== received || !contentType.toLowerCase().includes('text/html')) return null
    const evidence = visibleHtmlEvidence(await readBoundedResponseText(response, MAX_DIRECT_PAGE_BYTES))
    // A category page is useful only when it contains a directly visible price.
    // Do not turn a fitment landing page without prices into synthetic evidence.
    if (!hasVisiblePrice(evidence)) return null
    return { title: 'AutoZone fitment category', url, content: evidence }
  }))
  return fetched.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : [])
}

async function extractAutoZoneCategoryEvidence(urls: string[]): Promise<SearchResult[]> {
  const requestedUrls = urls.filter(isStrictAutoZoneCategoryUrl).slice(0, MAX_TAVILY_EXTRACT_URLS)
  if (!TAVILY_API_KEY || !requestedUrls.length) return []

  try {
    const response = await fetch('https://api.tavily.com/extract', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TAVILY_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        urls: requestedUrls,
        // AutoZone renders product/price content client-side, so use Tavily's
        // richer extraction mode only for this small deterministic fallback.
        extract_depth: 'advanced',
        format: 'text',
        timeout: TAVILY_EXTRACT_TIMEOUT_SECONDS,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok || !contentType.toLowerCase().includes('application/json')) return []

    const payload = JSON.parse(await readBoundedResponseText(response, MAX_TAVILY_EXTRACT_BYTES)) as {
      results?: { url?: string; raw_content?: string }[]
    }
    const requestedByCanonicalUrl = new Map(requestedUrls.map(url => [canonicalUrl(url), url]))
    return (payload.results || []).flatMap(result => {
      if (typeof result.url !== 'string' || !isStrictAutoZoneCategoryUrl(result.url)) return []
      const expectedUrl = requestedByCanonicalUrl.get(canonicalUrl(result.url))
      if (!expectedUrl) return []
      const rawContent = typeof result.raw_content === 'string' ? result.raw_content : ''
      const evidence = visibleHtmlEvidence(rawContent)
      if (!hasVisiblePrice(evidence)) return []
      return [{ title: 'AutoZone fitment category (Tavily extract)', url: expectedUrl, content: evidence }]
    })
  } catch {
    // Extract is a bounded fallback. Normal search and the direct fetch remain usable.
    return []
  }
}

/**
 * AutoZone category pages often render their product cards after the initial
 * HTML response. The hosted browser is a final, read-only evidence source for
 * those deterministic category URLs. It never signs in, submits a form, or
 * treats a page without a visible price as price evidence.
 */
async function browseAutoZoneCategoryEvidence(urls: string[]): Promise<{ results: SearchResult[]; failed: number }> {
  const candidates = urls.filter(isStrictAutoZoneCategoryUrl).slice(0, 3)
  const attempts = await Promise.allSettled(candidates.map(async url => {
    // Give client-rendered product cards a short settle window. The browser
    // remains bounded and read-only, but an immediate DOM snapshot only sees
    // AutoZone's shell and falsely reports that prices are unavailable.
    const browser = await runHostedBrowser(url, [{ type: 'wait', ms: 1_500 }], { timeoutMs: 10_000 })
    if (!browser.success || canonicalUrl(browser.url || '') !== canonicalUrl(url)) return { result: null, failed: true }
    const evidence = typeof browser.text === 'string' ? browser.text.slice(0, 18_000) : ''
    if (!hasVisiblePrice(evidence)) return { result: null, failed: false }
    return { result: { title: 'AutoZone fitment category (hosted browser)', url, content: evidence }, failed: false }
  }))
  return {
    results: attempts.flatMap(attempt => attempt.status === 'fulfilled' && attempt.value.result ? [attempt.value.result] : []),
    failed: attempts.filter(attempt => attempt.status === 'rejected' || (attempt.status === 'fulfilled' && attempt.value.failed)).length,
  }
}

async function searchParts(queries: string[], stores: string[] = [], vehicle: VehicleFitment = { year: '', make: '', model: '' }, partType = ''): Promise<{
  results: {title: string; url: string; content: string}[]
  diagnostics: { requestedQueries: number; completedQueries: number; providerResults: number; retailerResults: number; shoppingCandidates: number; shoppingResults: number; shoppingCompletedQueries: number; directPageCandidates: number; directPagesFetched: number; tavilyExtractCandidates: number; tavilyExtractFetched: number; browserPageCandidates: number; browserPagesFetched: number; browserFailures: number; providerAttempts: number; providerFailures: number; providers: string[] }
}> {
  const allResults: SearchResult[] = []
  let shoppingCandidates = 0
  let shoppingResults = 0
  let shoppingCompletedQueries = 0
  let providerAttempts = 0
  let providerFailures = 0

  const domains = normalizeStoreFilter(stores)
  const expandedQueries: string[] = []
  for (const q of queries) {
    if (domains.length) expandedQueries.push(`${q} price ${domains.map(domain => `site:${domain}`).join(' OR ')}`)
    else {
      expandedQueries.push(q)
      expandedQueries.push(q + ' site:oreilly.com OR site:advanceautoparts.com OR site:pepboys.com')
      expandedQueries.push(q + ' site:amazon.com OR site:ebay.com OR site:rockauto.com')
    }
  }

  // Keep every requested category when a retailer was specified. The old
  // six-query cap dropped the rear pad/rotor searches for four-wheel jobs.
  const selectedQueries = expandedQueries.slice(0, domains.length ? Math.max(queries.length, 4) : 12)
  const providers = [TAVILY_API_KEY ? 'tavily' : '', SERPER_API_KEY ? 'serper' : ''].filter(Boolean)
  // These deterministic retailer requests do not depend on search-provider
  // results. Start them now so a slow provider cannot add another full round
  // trip before the canonical AutoZone pages are tried.
  const directPageUrls = autoZoneCategoryUrls(vehicle, partType, queries, domains)
  const directEvidencePromise = fetchAutoZoneCategoryEvidence(directPageUrls)
  const tavilyExtractPromise = extractAutoZoneCategoryEvidence(directPageUrls)
  const searchPromises = selectedQueries.map(async (query) => {
    const providerResults: {title: string; url: string; content: string}[] = []
    if (TAVILY_API_KEY) {
      providerAttempts += 1
      try {
        const r = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_key: TAVILY_API_KEY,
            query,
            search_depth: 'advanced',
            include_answer: false,
            include_raw_content: true,
            max_results: 8,
          }),
          signal: AbortSignal.timeout(15000),
        })
        if (r.ok) {
          const d = await r.json() as { results?: { title?: string; url?: string; content?: string; raw_content?: string }[] }
          providerResults.push(...(d.results || []).map(result => ({
            title: result.title || '',
            url: result.url || '',
            content: [result.content || '', result.raw_content || ''].filter(Boolean).join('\n').slice(0, 5000),
          })))
        } else providerFailures += 1
      } catch { providerFailures += 1 }
    }
    if (SERPER_API_KEY) {
      providerAttempts += 1
      try {
        const r = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, num: 8 }),
          signal: AbortSignal.timeout(15000),
        })
        if (r.ok) {
          const d = await r.json() as {
            organic?: { title?: string; link?: string; snippet?: string }[]
            shopping?: { title?: string; link?: string; price?: string; source?: string; delivery?: string }[]
          }
          providerResults.push(...(d.organic || []).map(result => ({
            title: result.title || '',
            url: result.link || '',
            content: (result.snippet || '').slice(0, 800),
          })))
          shoppingCandidates += (d.shopping || []).length
          const shopping = (d.shopping || []).slice(0, 4).map(result => ({
            title: [result.title, result.source].filter(Boolean).join(' — '),
            url: result.link || '',
            content: [result.price ? `Price: ${result.price}` : '', result.delivery || ''].filter(Boolean).join('\n').slice(0, 800),
          }))
          shoppingResults += shopping.length
          providerResults.push(...shopping)
        } else providerFailures += 1
      } catch { providerFailures += 1 }
    }
    return providerResults.filter(result => result.url && urlMatchesStores(result.url, domains))
  })

  // Organic snippets often omit prices even when Google has a merchant offer.
  // Pull the shopping feed for the requested categories so prices remain
  // source-backed instead of forcing the language model to guess them.
  const shoppingSearchesPromise = SERPER_API_KEY
    ? Promise.allSettled(selectedQueries.slice(0, 4).map(async (query) => {
      try {
      const cleanQuery = query
        .replace(/\s+site:[^\s]+/gi, '')
        .replace(/\s+OR\s+/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
      const shoppingQuery = `${cleanQuery} ${domains.map(domain => domain.split('.')[0]).join(' ')}`.trim()
      providerAttempts += 1
      const r = await fetch('https://google.serper.dev/shopping', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: shoppingQuery, num: 8 }),
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) {
        providerFailures += 1
        return []
      }
      const d = await r.json() as { shopping?: { title?: string; link?: string; price?: string; source?: string; delivery?: string }[] }
      shoppingCandidates += (d.shopping || []).length
      return (d.shopping || []).slice(0, 4).map(result => ({
        title: [result.title, result.source].filter(Boolean).join(' — '),
        url: result.link || '',
        content: [result.price ? `Price: ${result.price}` : '', result.delivery || ''].filter(Boolean).join('\n').slice(0, 800),
      }))
      } catch {
        providerFailures += 1
        return []
      }
    }))
    : Promise.resolve([] as PromiseSettledResult<SearchResult[]>[])

  // Provider searches, direct retailer pages, retailer extraction, and the
  // shopping feed are independent reads. Await them together so the request
  // has one bounded provider round instead of four serial ones.
  const [results, directEvidence, tavilyExtractEvidence, shoppingSearches] = await Promise.all([
    Promise.allSettled(searchPromises),
    directEvidencePromise,
    tavilyExtractPromise,
    shoppingSearchesPromise,
  ])
  for (const r of results) {
    if (r.status === 'fulfilled') allResults.push(...r.value)
  }
  for (const result of shoppingSearches) {
    if (result.status === 'fulfilled') {
      shoppingCompletedQueries += 1
      const retailerShopping = result.value.filter(item => item.url && urlMatchesStores(item.url, domains))
      shoppingResults += retailerShopping.length
      allResults.push(...retailerShopping)
    }
  }

  // Search snippets and shopping feeds often omit prices for AutoZone even
  // though AutoZone's canonical vehicle-fitment category pages show them.
  // Fetch only deterministic, generated AutoZone category URLs; never follow
  // a URL supplied by the model or by untrusted request content.
  allResults.push(...directEvidence)
  const directEvidenceUrls = new Set(directEvidence.map(result => canonicalUrl(result.url)))
  const extractFallbackUrls = directPageUrls.filter(url => !directEvidenceUrls.has(canonicalUrl(url)))
  allResults.push(...tavilyExtractEvidence)
  const tavilyEvidenceUrls = new Set(tavilyExtractEvidence.map(result => canonicalUrl(result.url)))
  const browserFallbackUrls = extractFallbackUrls.filter(url => !tavilyEvidenceUrls.has(canonicalUrl(url)))
  // Fall back per deterministic category, not per request. A successful front
  // page must not suppress browser recovery for a missing rear page (or a
  // missing pad/rotor component in the same request).
  const browserFallback = await browseAutoZoneCategoryEvidence(browserFallbackUrls)
  allResults.push(...browserFallback.results)

  // Dedupe by canonical URL while keeping the richest evidence. Direct
  // category extraction is intentionally appended after provider results; a
  // first-result-wins map would let a price-less snippet hide that evidence.
  const evidenceScore = (result: SearchResult) => {
    const priceCount = visiblePriceMatches(`${result.title}\n${result.content}`).length
    return priceCount * 100_000 + Math.min(result.content.length, 20_000)
  }
  const mergedResults = new Map<string, SearchResult>()
  for (const result of allResults) {
    if (!result.url || !urlMatchesStores(result.url, domains)) continue
    const key = canonicalUrl(result.url) || result.url.toLowerCase()
    const current = mergedResults.get(key)
    if (!current) {
      mergedResults.set(key, result)
      continue
    }
    // The same category URL can return a different product slice for each
    // front/rear query. Keep the richest title but union the evidence text so
    // one query cannot hide the other axle's products.
    const richer = evidenceScore(result) > evidenceScore(current) ? result : current
    const content = [current.content, result.content]
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .join('\n')
      .slice(0, 24_000)
    // Search-provider titles are often generic or reflect a nearby result.
    // The exact generated AutoZone category URL is the stronger identity
    // signal, so preserve the category marker for deterministic parsing.
    const title = isStrictAutoZoneCategoryUrl(richer.url) ? 'AutoZone fitment category' : richer.title
    mergedResults.set(key, { ...richer, title, content })
  }
  const filteredResults = [...mergedResults.values()]
  const resultHasVisiblePrice = (result: { title: string; content: string }) => hasVisiblePrice(`${result.title}\n${result.content}`)
  // The parser has a bounded result window. A successful deterministic
  // category extract is richer and vehicle-bound, so it must not be crowded
  // out by a large number of lower-context shopping snippets that also list a
  // price. URL and price validation still happen before any parsed result is
  // returned to the caller.
  const parserPriority = (result: SearchResult) => result.title === 'AutoZone fitment category (Tavily extract)' || result.title === 'AutoZone fitment category (hosted browser)'
    ? 2
    : result.title === 'AutoZone fitment category' ? 1 : 0
  filteredResults.sort((left, right) =>
    parserPriority(right) - parserPriority(left)
    || Number(resultHasVisiblePrice(right)) - Number(resultHasVisiblePrice(left))
    || evidenceScore(right) - evidenceScore(left)
  )
  return {
    results: filteredResults,
    diagnostics: {
      requestedQueries: selectedQueries.length,
      completedQueries: results.filter(result => result.status === 'fulfilled').length,
      providerResults: allResults.length,
      retailerResults: filteredResults.length,
      shoppingCandidates,
      shoppingResults,
      shoppingCompletedQueries,
      directPageCandidates: directPageUrls.length,
      directPagesFetched: directEvidence.length,
      tavilyExtractCandidates: extractFallbackUrls.length,
      tavilyExtractFetched: tavilyExtractEvidence.length,
      browserPageCandidates: browserFallbackUrls.length,
      browserPagesFetched: browserFallback.results.length,
      browserFailures: browserFallback.failed,
      providerAttempts,
      providerFailures,
      providers,
    },
  }
}

// Use DeepSeek to parse raw search results into structured parts data
async function parseResults(
  rawResults: {title: string; url: string; content: string}[],
  vehicle: string,
  partType: string,
  positions: string[],
  config: PartsAiConfig
): Promise<{ options: PartOption[]; kits: KitOption[] }> {
  const deterministic = parseAutoZoneCategoryEvidence(rawResults, isStrictAutoZoneCategoryUrl) as unknown as {
    options: PartOption[]
    kits: KitOption[]
  }
  const resultsText = rawResults.slice(0, 20).map((r, i) => 
    `[${i+1}] ${r.title}\nURL: ${r.url}\n${r.content}`
  ).join('\n\n')
  
  // Deterministic parsing is authoritative for vehicle-specific AutoZone
  // category evidence. Avoid spending another model round trip when it has
  // already produced usable source-backed rows.
  if (deterministic.options.length || deterministic.kits.length || !rawResults.length) return deterministic
  let data
  try {
    data = await callPartsAi(config, [
        { role: 'system', content: `You are an auto parts pricing analyst. Parse search results into structured parts data.

Vehicle: ${vehicle}
Part type: ${partType}
Positions needed: ${positions.join(', ')}

Analyze the search results and extract REAL prices, part numbers, and availability.
Return ONLY valid JSON:
{
  "options": [
    {
      "tier": "budget",
      "brand": "Duralast",
      "parts": [
        {
          "position": "Front Left",
          "name": "Duralast Gold Brake Rotor",
          "partNumber": "DL-12345",
          "price": 54.99,
          "url": "exact-url-from-results",
          "store": "AutoZone",
          "evidenceQuote": "Duralast Gold Brake Rotor 31275DL $54.99",
          "inStock": true,
          "storeLocation": "city and state only if the search results show one, otherwise an empty string",
          "quantity": 1
        }
      ],
      "partsTotal": 219.96
    }
  ],
  "kits": [
    {
      "name": "PowerStop Front+Rear Brake Kit",
      "brand": "PowerStop",
      "price": 256.99,
      "url": "exact-url-from-results",
      "store": "Amazon",
      "evidenceQuote": "PowerStop Front+Rear Brake Kit ... $256.99",
      "includes": "4 rotors + 4 pads + hardware",
      "positions": "Front + Rear"
    }
  ]
}

Rules:
- Show MAX 3 tiers: budget, mid, premium
- ONLY use prices and URLs that ACTUALLY appear in the search results. NEVER invent prices or URLs.
- Every part or kit must include an evidenceQuote copied from one contiguous product/result entry. The quote must contain the selected product identity (name or part number), package/position wording when present, and exactly one currency price—the selected price. If you cannot copy such a quote, omit the item; never quote adjacent product rows or multiple price options.
- A result labelled "AutoZone fitment category" is a vehicle-specific category page. It may contain several products; use its exact category URL only when the product name and price are present in that page's text.
- Do not claim a front/rear position unless that product row or kit description identifies it. For an all-four brake request, include both front and rear pads and rotors, or a kit whose source text explicitly includes both.
- Bind each extracted product name, part number, package quantity and price to the same product row or result entry; never pair a page-wide price with a different product.
- If an individually sold part covers multiple positions (e.g. a rotor), list each required side separately with the same source-backed unit price. If the source explicitly sells an axle set or pair (e.g. brake pads), list one line for that axle, keep the package wording in the name, and do not duplicate it as left and right.
- partsTotal = sum of all parts in that tier (price * quantity for each)
- Include part numbers ONLY if found in results
- For kits, extract bundle deals that cover multiple positions
- Store names: O'Reilly, Advance Auto, PepBoys, Amazon, eBay, RockAuto, AutoZone, NAPA
- If you cannot find real data for a tier, omit it. Do NOT make up prices.` },
        { role: 'user', content: `Search results to parse:\n\n${resultsText}` }
      ], 2000)
  } catch {
    return deterministic
  }
  const raw = data.choices?.[0]?.message?.content || '{}'
  try {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    try {
      const modelParsed = JSON.parse(cleaned) as { options?: PartOption[]; kits?: KitOption[] }
      return {
        options: [...deterministic.options, ...(modelParsed.options || [])],
        kits: [...deterministic.kits, ...(modelParsed.kits || [])],
      }
    } catch {
      // Recover a single object when a model adds a short explanation around
      // otherwise valid JSON. This changes parsing tolerance only; all prices
      // still pass the source/identity sanitizer below.
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start < 0 || end <= start) throw new Error('No JSON object')
      const modelParsed = JSON.parse(cleaned.slice(start, end + 1)) as { options?: PartOption[]; kits?: KitOption[] }
      return {
        options: [...deterministic.options, ...(modelParsed.options || [])],
        kits: [...deterministic.kits, ...(modelParsed.kits || [])],
      }
    }
  } catch {
    return deterministic
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const limited = checkRateLimit(rateLimitKey('parts-lookup', auth.userId, auth.shopId, ip), 30, 60_000)
    if (!limited.ok) return apiFail('Too many parts lookup requests', 429, 'RATE_LIMITED', { resetAt: limited.resetAt })

    const parsedBody = await readJsonObject(req)
    if (!parsedBody.ok) return apiFail(parsedBody.error, 400, 'BAD_REQUEST')
    const queryValue = requireString(parsedBody.body, 'query', 'Query')
    if (!queryValue.ok) return apiFail(queryValue.error, 400, 'BAD_REQUEST')
    const storesValue = optionalStringArray(parsedBody.body, 'stores')
    if (!storesValue.ok) return apiFail(storesValue.error, 400, 'BAD_REQUEST')

    const query = normalizePartsLookupQuery(queryValue.value).slice(0, 240)
    // The workflow may omit its optional `stores` field even when the user
    // said "from AutoZone" in the same message. Infer the retailer from the
    // normalized request so the canonical retailer fallback still runs.
    const stores = normalizeStoreFilter([...(storesValue.value || []), ...inferStoresFromQuery(query)])
    const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'parts-lookup', query])

    // Get AI settings
    const sb = getServiceClient()
    const { data: settings } = await sb.from('settings').select('ai_api_key,ai_model,ai_base_url,labor_rate,tax_rate').eq('shop_id', auth.shopId).limit(1).single()
    const aiKey = typeof settings?.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
    let oauthTransport: OpenAIOAuthTransport | null = null
    try { oauthTransport = await getUserChatGptTransport(auth) } catch {
      // Parts lookup has deterministic decomposition/parsing fallbacks. A
      // stale ChatGPT connection must not turn a retailer search into a
      // timeout or force the user to provide internal part numbers.
      oauthTransport = null
    }
    const aiBase = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const aiModel = oauthTransport ? chatGptModel(settings?.ai_model) : normalizeAiModel(settings?.ai_model, aiBase)
    const aiConfig: PartsAiConfig = { key: aiKey, base: aiBase, model: aiModel, oauthTransport }

    // Step 1: Decompose the request
    const decomposed = await decomposeRequest(query, aiConfig)
    const vehicle = `${decomposed.vehicle.year} ${decomposed.vehicle.make} ${decomposed.vehicle.model}`.trim()

    // Step 2: Build balanced search queries. searchParts applies the retailer
    // domain filter once, so every requested brake category is retained.
    let searchQueries = balancedBrakeQueries(query, vehicle, decomposed.partType, decomposed.positions || [], decomposed.searchQueries || [query])

    // Step 3: Search for parts across stores
    const search = await searchParts(searchQueries, stores, decomposed.vehicle, decomposed.partType)
    const rawResults = search.results
    // Search providers frequently return nearby vehicle years/models for the
    // same category. Keep those leads for diagnostics, but never give them to
    // the parser or evidence sanitizer for the requested vehicle.
    const vehicleBoundResults = rawResults.filter(result =>
      !isStrictAutoZoneCategoryUrl(result.url) || autoZoneCategoryUrlMatchesVehicle(result.url, decomposed.vehicle)
    )

    // Step 4: Parse results with AI
    const parsed = await parseResults(
      vehicleBoundResults,
      vehicle,
      decomposed.partType,
      decomposed.positions,
      aiConfig
    )
    const sanitized = sanitizeParsedParts(parsed, vehicleBoundResults, stores)
    const laborGuidance = standardLaborGuidance(query, decomposed.partType, decomposed.positions || [])
    const warnings = [...sanitized.warnings]
    if (laborGuidance) warnings.push(laborGuidance.note)
    const sourceBackedItems = sanitized.options.reduce((count, option) => count + option.parts.length, 0) + sanitized.kits.length
    const availability = describePriceAvailability({
      vehicle: decomposed.vehicle,
      results: vehicleBoundResults,
      diagnostics: search.diagnostics,
      sourceBackedItems,
    })
    if (availability.state === 'price_unavailable') warnings.unshift(availability.actionable)

    // Build search URLs for reference
    const searchUrls = vehicleBoundResults
      .filter(r => r.url.includes('oreilly') || r.url.includes('advance') || r.url.includes('pepboys') || r.url.includes('amazon') || r.url.includes('ebay') || r.url.includes('rockauto') || r.url.includes('autozone') || r.url.includes('napa'))
      .slice(0, 10)
      .map(r => ({
        store: new URL(r.url).hostname.replace('www.', '').split('.')[0],
        url: r.url
      }))

    const result: PartsLookupResult = {
      vehicle,
      query,
      positions: decomposed.positions,
      options: sanitized.options,
      kits: sanitized.kits,
      taxRate: settings?.tax_rate == null ? null : Number(settings.tax_rate),
      laborHours: laborGuidance?.hours ?? null,
      laborRate: settings?.labor_rate == null ? null : Number(settings.labor_rate),
      ...(laborGuidance ? { laborGuidance } : {}),
      searchUrls,
      sourceConfidence: sanitized.sourceConfidence,
      availability,
      warnings: warnings.slice(0, 8),
    }

    await writeAuditLog({
      shopId: auth.shopId,
      userId: auth.userId,
      action: 'parts.lookup',
      targetType: 'parts',
      permission: 'read',
      approved: true,
      idempotencyKey,
      metadata: {
        query,
        stores,
        search: search.diagnostics,
        parsed: {
          options: parsed.options?.length || 0,
          parts: parsed.options?.reduce((count, option) => count + (option.parts?.length || 0), 0) || 0,
          kits: parsed.kits?.length || 0,
        },
        sanitized: {
          options: sanitized.options.length,
          parts: sanitized.options.reduce((count, option) => count + option.parts.length, 0),
          kits: sanitized.kits.length,
        },
        sourceConfidence: result.sourceConfidence,
        sourceBackedItems,
        availability: result.availability,
      },
    })

    return apiOk(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiFail(message, 500, 'INTERNAL_ERROR')
  }
}
