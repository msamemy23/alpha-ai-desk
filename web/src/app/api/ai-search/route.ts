import { NextRequest, NextResponse } from 'next/server'

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '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'

const SEARXNG_INSTANCES = [
  'https://search.sapti.me',
  'https://searx.tiekoetter.com',
  'https://search.bus-hit.me',
]

// ── Types ──────────────────────────────────────────────
type SearchResult = {
  title: string; snippet: string; url: string;
  published_date?: string; source?: string; favicon?: string;
  category?: string
}
type VideoResult = {
  title: string; url: string; thumbnail?: string;
  duration?: string; views?: string; channel?: string; embed_url?: string
}
type ImageResult = { url: string; thumbnail?: string; title?: string; source?: string; source_url?: string }
type PriceResult = { store: string; price: number; url: string; in_stock?: boolean; shipping?: string; rating?: string; part_number?: string }
type KnowledgePanel = { type: string; title: string; facts: Record<string, string>; source?: string }

// ── Query Classification ───────────────────────────────────
function classifyQuery(q: string): { isPrice: boolean; isDiagnostic: boolean; isLabor: boolean; isHow: boolean; isTSB: boolean; isFluid: boolean; isRecall: boolean } {
  const lq = q.toLowerCase()
  return {
    isPrice: /price|cost|how much|buy|order|part|oem|aftermarket|autozone|napa|oreilly|amazon|ebay/i.test(q),
    isDiagnostic: /diagnostic|code|dtc|check engine|cel|p0|p1|p2|c0|b0|u0|obd|freeze frame/i.test(q),
    isLabor: /labor time|labor hour|flat rate|book time|how long|repair time/i.test(q),
    isHow: /how to|replace|install|remove|change|fix|repair|diy|tutorial|step.?by.?step/i.test(q),
    isTSB: /tsb|technical service bulletin|recall|campaign/i.test(q),
    isFluid: /fluid|oil|coolant|transmission|atf|brake fluid|capacity|torque spec/i.test(q),
    isRecall: /recall|safety recall|nhtsa/i.test(q),
  }
}

// ── Extract Prices (enhanced) ──────────────────────────────
function extractPrices(results: SearchResult[]): PriceResult[] {
  const prices: PriceResult[] = []
  const re = /\$([\d,]+\.?\d{0,2})/g
  const partRe = /(?:part|item|sku|#|number)[:\s#]*(\w[\w-]{3,})/i
  for (const r of results) {
    const text = r.snippet + ' ' + r.title
    const m = [...text.matchAll(re)]
    if (m.length > 0) {
      const price = parseFloat(m[0][1].replace(',', ''))
      if (price > 0 && price < 50000) {
        const partMatch = text.match(partRe)
        prices.push({
          store: r.source || new URL(r.url).hostname.replace('www.', ''),
          price, url: r.url,
          in_stock: /in stock|available|ready/i.test(text) ? true : /out of stock|unavailable|backorder/i.test(text) ? false : undefined,
          shipping: /free ship/i.test(text) ? 'Free shipping' : undefined,
          rating: text.match(/(\d\.\d)\s*(?:out of|\/)\s*5/)?.​[1] || undefined,
          part_number: partMatch?.[1] || undefined,
        })
      }
    }
  }
  const seen = new Set<string>()
  return prices.sort((a, b) => a.price - b.price).filter(p => { if (seen.has(p.store)) return false; seen.add(p.store); return true }).slice(0, 8)
}

// ── Knowledge Panel Extraction ────────────────────────────
function extractKnowledgePanel(query: string, results: SearchResult[]): KnowledgePanel | null {
  const q = query.toLowerCase()
  // DTC code detection
  const dtcMatch = q.match(/\b([pbcu][0-9]{4})\b/i)
  if (dtcMatch) {
    const code = dtcMatch[1].toUpperCase()
    const relevant = results.find(r => r.snippet.toLowerCase().includes(code.toLowerCase()))
    if (relevant) {
      return {
        type: 'dtc_code',
        title: `Diagnostic Code: ${code}`,
        facts: {
          'Code': code,
          'Description': relevant.snippet.slice(0, 200),
          'Source': relevant.source || '',
        },
        source: relevant.url
      }
    }
  }
  // Fluid capacity detection
  const capacityMatch = results.find(r => /\d+(\.\d+)?\s*(quart|liter|oz|gallon|pt)/i.test(r.snippet))
  if (capacityMatch && /fluid|oil|coolant|capacity|spec/i.test(q)) {
    const capMatch = capacityMatch.snippet.match(/(\d+(\.\d+)?\s*(quart|liter|oz|gallon|pt)s?)/i)
    return {
      type: 'fluid_spec',
      title: 'Fluid Specification',
      facts: {
        'Capacity': capMatch?.[1] || 'See source',
        'Details': capacityMatch.snippet.slice(0, 200),
      },
      source: capacityMatch.url
    }
  }
  return null
}

// ── Smart Follow-Ups (enhanced) ─────────────────────────────
function generateFollowUps(query: string, cls: ReturnType<typeof classifyQuery>, hasVids: boolean, hasPrices: boolean): string[] {
  const s: string[] = []
  const q = query.toLowerCase()
  if (hasPrices) s.push('Build an estimate with these prices')
  if (/brake|rotor|pad|caliper|strut|shock|bearing|hub|control arm|tie rod|ball joint|axle/i.test(q)) s.push(`Search labor time for ${query}`)
  if (!hasVids && cls.isHow) s.push(`Find a YouTube tutorial for ${query}`)
  if (hasVids) s.push('Show me more video tutorials')
  if (cls.isPrice) s.push('Compare OEM vs aftermarket options')
  if (cls.isDiagnostic) { s.push('What are common fixes for this code?'); s.push('Search for TSBs related to this') }
  if (cls.isFluid) s.push('What capacity/spec does this vehicle need?')
  if (cls.isRecall || cls.isTSB) s.push('Check NHTSA for open recalls')
  if (cls.isLabor) s.push('Build an estimate with this labor time')
  if (/tire|alignment|wheel/i.test(q)) s.push('Compare tire prices nearby')
  if (/battery/i.test(q)) s.push('What battery size fits this vehicle?')
  if (/ac|air condition|refrigerant|freon/i.test(q)) s.push('What refrigerant type and capacity?')
  if (s.length < 2) s.push('Search for more details on this')
  return s.slice(0, 4)
}

// ── SearXNG Video Search ───────────────────────────────────
async function searchVideos(query: string): Promise<VideoResult[]> {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const params = new URLSearchParams({ q: query, categories: 'videos', engines: 'youtube', format: 'json' })
      const res = await fetch(`${instance}/search?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
      if (!res.ok) continue
      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data.results || []).slice(0, 6).map((v: any) => {
        const yt = (v.url || '').match(/(?:watch\?v=|youtu\.be\/)([\w-]{11})/)
        return {
          title: v.title || '', url: v.url || '',
          thumbnail: v.thumbnail || (yt ? `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg` : undefined),
          duration: v.length || v.duration || undefined,
          views: v.views || undefined,
          channel: v.author || v.channel || undefined,
          embed_url: yt ? `https://www.youtube.com/embed/${yt[1]}` : undefined
        }
      })
    } catch { /* next */ }
  }
  return []
}

// ── SearXNG Image Search ───────────────────────────────────
async function searchImages(query: string): Promise<ImageResult[]> {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const params = new URLSearchParams({ q: query, categories: 'images', format: 'json' })
      const res = await fetch(`${instance}/search?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
      if (!res.ok) continue
      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data.results || []).slice(0, 10).map((img: any) => ({
        url: img.img_src || img.url || '',
        thumbnail: img.thumbnail_src || img.thumbnail || img.img_src || '',
        title: img.title || '',
        source: img.source || '',
        source_url: img.url || ''
      }))
    } catch { /* next */ }
  }
  return []
}

// ── Related Searches ──────────────────────────────────────
function generateRelatedSearches(query: string, cls: ReturnType<typeof classifyQuery>): string[] {
  const related: string[] = []
  const q = query.toLowerCase()
  // Extract vehicle info for related searches
  const vehicleMatch = q.match(/(\d{4})\s+(\w+)\s+(\w+)/)
  if (vehicleMatch) {
    const [, year, make, model] = vehicleMatch
    if (cls.isPrice) related.push(`${year} ${make} ${model} OEM parts`, `${year} ${make} ${model} aftermarket parts`)
    if (cls.isDiagnostic) related.push(`${year} ${make} ${model} common problems`, `${year} ${make} ${model} TSB list`)
    if (cls.isHow) related.push(`${year} ${make} ${model} repair manual`, `${year} ${make} ${model} torque specs`)
  }
  if (/brake/i.test(q)) related.push('ceramic vs semi-metallic brake pads', 'how to check brake pad thickness')
  if (/oil/i.test(q) && !/oil leak/i.test(q)) related.push('synthetic vs conventional oil', 'best oil filter brands')
  return related.slice(0, 3)
}

// ── Main GET Handler ──────────────────────────────────────
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')
  if (!query) return NextResponse.json({ results: [] })

  const cls = classifyQuery(query)

  // Run ALL searches in parallel for speed
  const [tavilyResult, videos, searxImages] = await Promise.allSettled([
    fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'advanced',
        include_answer: true,
        include_images: true,
        include_image_descriptions: true,
        max_results: 10,
      }),
      signal: AbortSignal.timeout(12000),
    }).then(r => r.json()),
    searchVideos(query),
    searchImages(query),
  ])

  const tavilyData = tavilyResult.status === 'fulfilled' ? tavilyResult.value : null
  let videoResults = videos.status === 'fulfilled' ? videos.value : []
  const imageResults = searxImages.status === 'fulfilled' ? searxImages.value : []

  // Fallback: extract YouTube videos from Tavily results
  if (videoResults.length === 0) {
    const seen = new Set<string>()
    for (const r of (tavilyData?.results || [])) {
      const yt = (r.url || '').match(/(?:watch\?v=|youtu\.be\/|shorts\/)([\w-]{11})/)
      if (yt && !seen.has(yt[1])) {
        seen.add(yt[1])
        videoResults.push({
          title: r.title || '', url: r.url || '',
          thumbnail: `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`,
          channel: (r.content || '').match(/(?:channel|by)\s+([^\n.]+)/i)?.[1] || undefined,
          embed_url: `https://www.youtube.com/embed/${yt[1]}`,
        })
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: SearchResult[] = (tavilyData?.results || []).map((r: any) => {
    // Auto-categorize results
    let category = 'web'
    const host = r.url ? new URL(r.url).hostname : ''
    if (/autozone|napa|oreilly|rockauto|amazon|ebay|partsgeek|carid/i.test(host)) category = 'parts'
    else if (/youtube|youtu\.be/i.test(host)) category = 'video'
    else if (/reddit|forum|bobisthe|justanswer/i.test(host)) category = 'forum'
    else if (/nhtsa|recall/i.test(host)) category = 'recall'
    else if (/alldata|mitchell|identifix/i.test(host)) category = 'repair_data'
    return {
      title: r.title || '',
      snippet: (r.content || '').slice(0, 500),
      url: r.url || '',
      published_date: r.published_date || undefined,
      source: r.url ? new URL(r.url).hostname.replace('www.', '') : undefined,
      favicon: r.url ? `https://www.google.com/s2/favicons?domain=${new URL(r.url).hostname}&sz=32` : undefined,
      category,
    }
  })

  // Merge images from Tavily and SearXNG
  const tavilyImages: string[] = (tavilyData?.images || []).slice(0, 5)
  const allImages: ImageResult[] = [
    ...tavilyImages.map((url: string) => ({ url, thumbnail: url, title: '', source: '', source_url: '' })),
    ...imageResults.filter(img => !tavilyImages.includes(img.url)),
  ].slice(0, 10)

  // Price Radar
  const priceRadar = cls.isPrice ? extractPrices(results) : []

  // Knowledge Panel
  const knowledgePanel = extractKnowledgePanel(query, results)

  // Follow-Ups
  const followUps = generateFollowUps(query, cls, videoResults.length > 0, priceRadar.length > 0)

  // Related Searches
  const relatedSearches = generateRelatedSearches(query, cls)

  return NextResponse.json({
    results,
    query,
    ...(tavilyData?.answer ? { answer: tavilyData.answer } : {}),
    images: allImages,
    videos: videoResults,
    price_radar: priceRadar,
    knowledge_panel: knowledgePanel,
    follow_ups: followUps,
    related_searches: relatedSearches,
    meta: {
      sources_count: results.length,
      has_videos: videoResults.length > 0,
      has_images: allImages.length > 0,
      has_answer: !!tavilyData?.answer,
      has_prices: priceRadar.length > 0,
      has_knowledge_panel: !!knowledgePanel,
      query_type: cls,
      is_price_query: cls.isPrice,
    },
  })
}
