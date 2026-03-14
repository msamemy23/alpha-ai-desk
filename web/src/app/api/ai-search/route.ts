import { NextRequest, NextResponse } from 'next/server'

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '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'

const SEARXNG_INSTANCES = [
  'https://search.sapti.me',
  'https://searx.tiekoetter.com',
  'https://search.bus-hit.me',
]

type SearchResult = { title: string; snippet: string; url: string; published_date?: string; source?: string; favicon?: string }
type VideoResult = { title: string; url: string; thumbnail?: string; duration?: string; views?: string; channel?: string; embed_url?: string }
type ImageResult = { url: string; thumbnail?: string; title?: string; source?: string; source_url?: string }
type PriceResult = { store: string; price: number; url: string; in_stock?: boolean; shipping?: string; rating?: string }

function isPriceQuery(q: string) { return /price|cost|how much|buy|order|part|oem|aftermarket|autozone|napa|oreilly|amazon|ebay/i.test(q) }

function extractPrices(results: SearchResult[]): PriceResult[] {
  const prices: PriceResult[] = []
  const re = /\$([\d,]+\.?\d{0,2})/g
  for (const r of results) {
    const text = r.snippet + ' ' + r.title
    const m = [...text.matchAll(re)]
    if (m.length > 0) {
      const price = parseFloat(m[0][1].replace(',', ''))
      if (price > 0 && price < 50000) {
        prices.push({
          store: r.source || new URL(r.url).hostname.replace('www.', ''),
          price, url: r.url,
          in_stock: /in stock|available|ready/i.test(text) ? true : /out of stock|unavailable|backorder/i.test(text) ? false : undefined,
          shipping: /free ship/i.test(text) ? 'Free shipping' : undefined,
          rating: text.match(/(\d\.\d)\s*(?:out of|\/)\s*5/)?.[1] || undefined,
        })
      }
    }
  }
  const seen = new Set<string>()
  return prices.sort((a, b) => a.price - b.price).filter(p => { if (seen.has(p.store)) return false; seen.add(p.store); return true }).slice(0, 6)
}

function generateFollowUps(query: string, hasVids: boolean, hasPrices: boolean): string[] {
  const s: string[] = []
  const q = query.toLowerCase()
  if (hasPrices) s.push('Build an estimate with these prices')
  if (/brake|rotor|pad|caliper|strut|shock|bearing|hub|control arm|tie rod|ball joint|axle/i.test(q)) s.push(`Search labor time for ${query}`)
  if (!hasVids && /replace|install|remove|change|fix|repair|how to/i.test(q)) s.push(`Find a YouTube tutorial for ${query}`)
  if (hasVids) s.push('Show me more video tutorials')
  if (/part|price|cost/i.test(q)) s.push('Compare OEM vs aftermarket options')
  if (/diagnostic|code|dtc|p0|p1|p2|c0|b0|u0/i.test(q)) { s.push('What are common fixes for this code?'); s.push('Search for TSBs related to this') }
  if (/fluid|oil|coolant|transmission|atf|brake fluid/i.test(q)) s.push('What capacity/spec does this vehicle need?')
  if (s.length < 2) s.push('Search for more details on this')
  return s.slice(0, 3)
}

async function searchVideos(query: string): Promise<VideoResult[]> {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const params = new URLSearchParams({ q: query, categories: 'videos', engines: 'youtube', format: 'json' })
      const res = await fetch(`${instance}/search?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
      if (!res.ok) continue
      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data.results || []).slice(0, 5).map((v: any) => {
        const yt = (v.url || '').match(/(?:watch\?v=|youtu\.be\/)([\w-]{11})/)
        return { title: v.title || '', url: v.url || '', thumbnail: v.thumbnail || (yt ? `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg` : undefined), duration: v.length || v.duration || undefined, views: v.views || undefined, channel: v.author || v.channel || undefined, embed_url: yt ? `https://www.youtube.com/embed/${yt[1]}` : undefined }
      })
    } catch { /* next */ }
  }
  return []
}

async function searchImages(query: string): Promise<ImageResult[]> {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const params = new URLSearchParams({ q: query, categories: 'images', format: 'json' })
      const res = await fetch(`${instance}/search?${params}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
      if (!res.ok) continue
      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data.results || []).slice(0, 8).map((img: any) => ({ url: img.img_src || img.url || '', thumbnail: img.thumbnail_src || img.thumbnail || img.img_src || '', title: img.title || '', source: img.source || '', source_url: img.url || '' }))
    } catch { /* next */ }
  }
  return []
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')
  if (!query) return NextResponse.json({ results: [] })

  const isPrice = isPriceQuery(query)

  // Run all searches in parallel
  const [tavilyResult, videos, searxImages] = await Promise.allSettled([
    fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY, query,
        search_depth: isPrice ? 'advanced' : 'advanced',
        include_answer: true, include_images: true,
        include_image_descriptions: true, max_results: 8,
      }),
      signal: AbortSignal.timeout(12000),
    }).then(r => r.json()),
    searchVideos(query),
    searchImages(query),
  ])

  const tavilyData = tavilyResult.status === 'fulfilled' ? tavilyResult.value : null
  const videoResults = videos.status === 'fulfilled' ? videos.value : []
  const imageResults = searxImages.status === 'fulfilled' ? searxImages.value : []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: SearchResult[] = (tavilyData?.results || []).map((r: any) => ({
    title: r.title || '', snippet: (r.content || '').slice(0, 500), url: r.url || '',
    published_date: r.published_date || undefined,
    source: r.url ? new URL(r.url).hostname.replace('www.', '') : undefined,
    favicon: r.url ? `https://www.google.com/s2/favicons?domain=${new URL(r.url).hostname}&sz=32` : undefined,
  }))

  // Merge images
  const tavilyImages: string[] = (tavilyData?.images || []).slice(0, 5)
  const allImages: ImageResult[] = [
    ...tavilyImages.map((url: string) => ({ url, thumbnail: url, title: '', source: '', source_url: '' })),
    ...imageResults.filter(img => !tavilyImages.includes(img.url)),
  ].slice(0, 8)

  // Price Radar: extract and compare prices
  const priceRadar = isPrice ? extractPrices(results) : []

  // Smart Follow-Ups
  const followUps = generateFollowUps(query, videoResults.length > 0, priceRadar.length > 0)

  return NextResponse.json({
    results, query,
    ...(tavilyData?.answer ? { answer: tavilyData.answer } : {}),
    images: allImages,
    videos: videoResults,
    price_radar: priceRadar,
    follow_ups: followUps,
    meta: {
      sources_count: results.length,
      has_videos: videoResults.length > 0,
      has_images: allImages.length > 0,
      has_answer: !!tavilyData?.answer,
      has_prices: priceRadar.length > 0,
      is_price_query: isPrice,
    },
  })
}
