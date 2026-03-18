import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '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'

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
}

interface PartsLookupResult {
  vehicle: string
  query: string
  positions: string[]
  options: PartOption[]
  kits: KitOption[]
  taxRate: number
  laborHours: number | null
  laborRate: number
  searchUrls: { store: string; url: string }[]
}

// Use DeepSeek to decompose a parts request into structured search queries
async function decomposeRequest(query: string, aiKey: string, aiBase: string, aiModel: string): Promise<{
  vehicle: { year: string; make: string; model: string };
  partType: string;
  positions: string[];
  searchQueries: string[];
  laborHours: number | null;
}> {
  const res = await fetch(`${aiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: aiModel,
      messages: [
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
  "laborHours": 2.5
}

Rules:
- For "all 4 brakes" = front + rear rotors AND pads, positions: FL, FR, RL, RR
- For "front brakes" = front rotors + pads, positions: FL, FR
- For "lower control arms" both front = positions: Front Left, Front Right
- Include labor hours estimate (brake job per axle=1.5, all 4=2.5-3, control arm=1.5/side, etc)
- searchQueries should be specific enough to find exact parts with prices on auto parts stores
- Generate 2-4 search queries covering different stores/angles
- ALWAYS include the vehicle year make model in each search query` },
        { role: 'user', content: query }
      ],
      max_tokens: 500,
      temperature: 0.1
    })
  })
  const data = await res.json()
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
async function searchParts(queries: string[]): Promise<{title: string; url: string; content: string}[]> {
  const allResults: {title: string; url: string; content: string}[] = []
  
  // Add store-specific queries
  const expandedQueries: string[] = []
  for (const q of queries) {
    expandedQueries.push(q + ' site:oreilly.com OR site:advanceautoparts.com OR site:pepboys.com')
    expandedQueries.push(q + ' site:amazon.com OR site:ebay.com OR site:rockauto.com')
    expandedQueries.push(q + ' price part number')
  }
  
  const searchPromises = expandedQueries.slice(0, 6).map(async (query) => {
    try {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          search_depth: 'advanced',
          include_answer: false,
          max_results: 8,
        }),
        signal: AbortSignal.timeout(15000),
      })
      const d = await r.json()
      return (d.results || []).map((r: {title: string; url: string; content: string}) => ({
        title: r.title || '',
        url: r.url || '',
        content: (r.content || '').slice(0, 800)
      }))
    } catch {
      return []
    }
  })
  
  const results = await Promise.allSettled(searchPromises)
  for (const r of results) {
    if (r.status === 'fulfilled') allResults.push(...r.value)
  }
  
  // Dedupe by URL
  const seen = new Set<string>()
  return allResults.filter(r => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
}

// Use DeepSeek to parse raw search results into structured parts data
async function parseResults(
  rawResults: {title: string; url: string; content: string}[],
  vehicle: string,
  partType: string,
  positions: string[],
  aiKey: string,
  aiBase: string,
  aiModel: string
): Promise<{ options: PartOption[]; kits: KitOption[] }> {
  const resultsText = rawResults.slice(0, 20).map((r, i) => 
    `[${i+1}] ${r.title}\nURL: ${r.url}\n${r.content}`
  ).join('\n\n')
  
  const res = await fetch(`${aiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: aiModel,
      messages: [
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
      ],
      max_tokens: 2000,
      temperature: 0.1
    })
  })
  const data = await res.json()
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
    const { query, stores } = await req.json() as { query: string; stores?: string[] }
    if (!query) return NextResponse.json({ ok: false, error: 'Query is required' }, { status: 400 })

    // Get AI settings
    const sb = getServiceClient()
    const { data: settings } = await sb.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1).single()
    const aiKey = settings?.ai_api_key
    if (!aiKey) return NextResponse.json({ ok: false, error: 'No AI API key configured' }, { status: 400 })
    const aiBase = settings?.ai_base_url || 'https://openrouter.ai/api/v1'
    const aiModel = settings?.ai_model || 'deepseek/deepseek-v3.2'

    // Step 1: Decompose the request
    const decomposed = await decomposeRequest(query, aiKey, aiBase, aiModel)
    const vehicle = `${decomposed.vehicle.year} ${decomposed.vehicle.make} ${decomposed.vehicle.model}`.trim()

    // Step 2: Build search queries (add store filters if specified)
    let searchQueries = decomposed.searchQueries || [query]
    if (stores && stores.length > 0) {
      const storeFilter = stores.map(s => `site:${s}`).join(' OR ')
      searchQueries = searchQueries.map(q => `${q} ${storeFilter}`)
    }

    // Step 3: Search for parts across stores
    const rawResults = await searchParts(searchQueries)

    // Step 4: Parse results with AI
    const parsed = await parseResults(
      rawResults,
      vehicle,
      decomposed.partType,
      decomposed.positions,
      aiKey, aiBase, aiModel
    )

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
      options: parsed.options || [],
      kits: parsed.kits || [],
      taxRate: 8.25,
      laborHours: decomposed.laborHours,
      laborRate: 120,
      searchUrls
    }

    return NextResponse.json({ ok: true, data: result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
