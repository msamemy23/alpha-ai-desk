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
import type { OpenAIOAuthTransport } from '@openai-oauth/core'

export const dynamic = 'force-dynamic'

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ''
const SERPER_API_KEY = process.env.SERPER_API_KEY || ''

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

function priceAppearsInEvidence(price: unknown, evidence: string) {
  const value = typeof price === 'number' ? price : Number(price)
  if (!Number.isFinite(value) || value <= 0) return false
  const normalized = evidence.replace(/,/g, '')
  // A model number, SKU, year, or substring of a larger price is not a quote.
  // Some retailer pages render cents as "$52 99", so normalize both that
  // presentation and the usual "$52.99" / "USD 52.99" forms.
  return [...normalized.matchAll(/(?:\$\s*|USD\s+)(\d+)(?:[.\s](\d{2}))?(?![\d.])/gi)]
    .some(match => Number(`${match[1]}${match[2] ? `.${match[2]}` : ''}`) === value)
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

type PartsAiMessage = { role: 'system' | 'user'; content: string }

type PartsAiConfig = {
  key: string
  base: string
  model: string
  oauthTransport: OpenAIOAuthTransport | null
}

async function callPartsAi(config: PartsAiConfig, messages: PartsAiMessage[], maxTokens: number) {
  if (config.oauthTransport) {
    const completion = await fetchOpenAIChatCompletion(config.oauthTransport, {
      model: chatGptModel(config.model),
      messages,
      max_tokens: maxTokens,
    }, AbortSignal.timeout(120000))
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
    signal: AbortSignal.timeout(120000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof data?.error?.message === 'string' ? data.error.message : `AI provider returned ${res.status}`)
  return data
}

// Use DeepSeek to decompose a parts request into structured search queries
async function decomposeRequest(query: string, config: PartsAiConfig): Promise<{
  vehicle: { year: string; make: string; model: string };
  partType: string;
  positions: string[];
  searchQueries: string[];
  laborHours: number | null;
}> {
  const data = await callPartsAi(config, [
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
  const raw = data.choices?.[0]?.message?.content || '{}'
  try {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return {
      vehicle: { year: '', make: '', model: '' },
      partType: query,
      positions: [],
      searchQueries: [query],
      laborHours: null
    }
  }
}

// Search Tavily for parts across multiple stores
async function searchParts(queries: string[], stores: string[] = []): Promise<{
  results: {title: string; url: string; content: string}[]
  diagnostics: { requestedQueries: number; completedQueries: number; providerResults: number; retailerResults: number; shoppingCandidates: number; shoppingResults: number; shoppingCompletedQueries: number; providers: string[] }
}> {
  const allResults: {title: string; url: string; content: string}[] = []
  let shoppingCandidates = 0
  let shoppingResults = 0
  let shoppingCompletedQueries = 0

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
  const searchPromises = selectedQueries.map(async (query) => {
    const providerResults: {title: string; url: string; content: string}[] = []
    if (TAVILY_API_KEY) {
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
        }
      } catch { /* use the second provider when available */ }
    }
    if (SERPER_API_KEY) {
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
        }
      } catch { /* both providers are best-effort; sanitize what was returned */ }
    }
    return providerResults.filter(result => result.url && urlMatchesStores(result.url, domains))
  })
  
  const results = await Promise.allSettled(searchPromises)
  for (const r of results) {
    if (r.status === 'fulfilled') allResults.push(...r.value)
  }

  // Organic snippets often omit prices even when Google has a merchant offer.
  // Pull the shopping feed for the requested categories so prices remain
  // source-backed instead of forcing the language model to guess them.
  if (SERPER_API_KEY) {
    const shoppingSearches = await Promise.allSettled(selectedQueries.slice(0, 4).map(async (query) => {
      const cleanQuery = query
        .replace(/\s+site:[^\s]+/gi, '')
        .replace(/\s+OR\s+/gi, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
      const shoppingQuery = `${cleanQuery} ${domains.map(domain => domain.split('.')[0]).join(' ')}`.trim()
      const r = await fetch('https://google.serper.dev/shopping', {
        method: 'POST',
        headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: shoppingQuery, num: 8 }),
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) return []
      const d = await r.json() as { shopping?: { title?: string; link?: string; price?: string; source?: string; delivery?: string }[] }
      shoppingCandidates += (d.shopping || []).length
      return (d.shopping || []).slice(0, 4).map(result => ({
        title: [result.title, result.source].filter(Boolean).join(' — '),
        url: result.link || '',
        content: [result.price ? `Price: ${result.price}` : '', result.delivery || ''].filter(Boolean).join('\n').slice(0, 800),
      }))
    }))
    for (const result of shoppingSearches) {
      if (result.status === 'fulfilled') {
        shoppingCompletedQueries += 1
        const retailerShopping = result.value.filter(item => item.url && urlMatchesStores(item.url, domains))
        shoppingResults += retailerShopping.length
        allResults.push(...retailerShopping)
      }
    }
  }

  // Dedupe by URL
  const seen = new Set<string>()
  const filteredResults = allResults.filter(r => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return !!r.url && urlMatchesStores(r.url, domains)
  })
  const hasVisiblePrice = (result: { title: string; content: string }) => /(?:\$\s*|USD\s+)\d/i.test(`${result.title}\n${result.content}`)
  filteredResults.sort((left, right) => Number(hasVisiblePrice(right)) - Number(hasVisiblePrice(left)))
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
  const resultsText = rawResults.slice(0, 20).map((r, i) => 
    `[${i+1}] ${r.title}\nURL: ${r.url}\n${r.content}`
  ).join('\n\n')
  
  const data = await callPartsAi(config, [
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
          "inStock": true,
          "storeLocation": "Houston TX",
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
      "includes": "4 rotors + 4 pads + hardware",
      "positions": "Front + Rear"
    }
  ]
}

Rules:
- Show MAX 3 tiers: budget, mid, premium
- ONLY use prices and URLs that ACTUALLY appear in the search results. NEVER invent prices or URLs.
- If a part appears for multiple positions (e.g. front left/right use same part), list each position separately with same price
- partsTotal = sum of all parts in that tier (price * quantity for each)
- Include part numbers ONLY if found in results
- For kits, extract bundle deals that cover multiple positions
- Store names: O'Reilly, Advance Auto, PepBoys, Amazon, eBay, RockAuto, AutoZone, NAPA
- If you cannot find real data for a tier, omit it. Do NOT make up prices.` },
        { role: 'user', content: `Search results to parse:\n\n${resultsText}` }
      ], 2000)
  const raw = data.choices?.[0]?.message?.content || '{}'
  try {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return { options: [], kits: [] }
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
    const stores = normalizeStoreFilter(storesValue.value)
    const idempotencyKey = getIdempotencyKey(req, [auth.shopId, 'parts-lookup', query])

    // Get AI settings
    const sb = getServiceClient()
    const { data: settings } = await sb.from('settings').select('ai_api_key,ai_model,ai_base_url,labor_rate,tax_rate').eq('shop_id', auth.shopId).limit(1).single()
    const oauthTransport = await getUserChatGptTransport(auth)
    const aiKey = typeof settings?.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
    if (!oauthTransport && !aiKey) return apiFail('No AI provider is connected. Connect ChatGPT in Settings or add the shop AI key.', 400, 'BAD_REQUEST')
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
    const search = await searchParts(searchQueries, stores)
    const rawResults = search.results

    // Step 4: Parse results with AI
    const parsed = await parseResults(
      rawResults,
      vehicle,
      decomposed.partType,
      decomposed.positions,
      aiConfig
    )
    const sanitized = sanitizeParsedParts(parsed, rawResults, stores)
    const laborGuidance = standardLaborGuidance(query, decomposed.partType, decomposed.positions || [])
    const warnings = [...sanitized.warnings]
    if (laborGuidance) warnings.push(laborGuidance.note)

    // Build search URLs for reference
    const searchUrls = rawResults
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
        verifiedItems: result.options.reduce((count, option) => count + option.parts.length, 0) + result.kits.length,
      },
    })

    return apiOk(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiFail(message, 500, 'INTERNAL_ERROR')
  }
}

