import { NextRequest, NextResponse } from 'next/server'

const TAVILY_API_KEY =
  process.env.TAVILY_API_KEY ||
  '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'

// Free SearXNG public instances for video/image fallback
const SEARXNG_INSTANCES = [
  'https://search.sapti.me',
  'https://searx.tiekoetter.com',
  'https://search.bus-hit.me',
]

type SearchResult = {
  title: string
  snippet: string
  url: string
  published_date?: string
  source?: string
}

type VideoResult = {
  title: string
  url: string
  thumbnail?: string
  duration?: string
  views?: string
  channel?: string
  embed_url?: string
}

type ImageResult = {
  url: string
  thumbnail?: string
  title?: string
  source?: string
  source_url?: string
}

// Fetch YouTube videos via free SearXNG
async function searchVideos(query: string): Promise<VideoResult[]> {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const params = new URLSearchParams({
        q: query,
        categories: 'videos',
        engines: 'youtube',
        format: 'json',
      })
      const res = await fetch(`${instance}/search?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) continue
      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data.results || []).slice(0, 5).map((v: any) => {
        const ytMatch = (v.url || '').match(/(?:watch\?v=|youtu\.be\/)([\w-]{11})/)
        return {
          title: v.title || '',
          url: v.url || '',
          thumbnail: v.thumbnail || (ytMatch ? `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg` : undefined),
          duration: v.length || v.duration || undefined,
          views: v.views || undefined,
          channel: v.author || v.channel || undefined,
          embed_url: ytMatch ? `https://www.youtube.com/embed/${ytMatch[1]}` : undefined,
        }
      })
    } catch { /* try next instance */ }
  }
  return []
}

// Fetch images via SearXNG (free, no API key)
async function searchImages(query: string): Promise<ImageResult[]> {
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const params = new URLSearchParams({
        q: query,
        categories: 'images',
        format: 'json',
      })
      const res = await fetch(`${instance}/search?${params}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) continue
      const data = await res.json()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data.results || []).slice(0, 6).map((img: any) => ({
        url: img.img_src || img.url || '',
        thumbnail: img.thumbnail_src || img.thumbnail || img.img_src || '',
        title: img.title || '',
        source: img.source || '',
        source_url: img.url || '',
      }))
    } catch { /* try next instance */ }
  }
  return []
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')
  if (!query) return NextResponse.json({ results: [] })

  // Run Tavily search + SearXNG videos + SearXNG images in parallel
  const [tavilyResult, videos, searxImages] = await Promise.allSettled([
    // Tavily: main web search with advanced depth
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
        max_results: 8,
      }),
      signal: AbortSignal.timeout(12000),
    }).then(r => r.json()),
    // SearXNG: YouTube videos
    searchVideos(query),
    // SearXNG: images as fallback/supplement
    searchImages(query),
  ])

  const tavilyData = tavilyResult.status === 'fulfilled' ? tavilyResult.value : null
  const videoResults = videos.status === 'fulfilled' ? videos.value : []
  const imageResults = searxImages.status === 'fulfilled' ? searxImages.value : []

  // Build rich search results
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results: SearchResult[] = (tavilyData?.results || []).map((r: any) => ({
    title: r.title || '',
    snippet: (r.content || '').slice(0, 500),
    url: r.url || '',
    published_date: r.published_date || undefined,
    source: r.url ? new URL(r.url).hostname.replace('www.', '') : undefined,
  }))

  // Merge images: Tavily images + SearXNG images (deduplicated)
  const tavilyImages: string[] = (tavilyData?.images || []).slice(0, 5)
  const allImages: ImageResult[] = [
    ...tavilyImages.map((url: string) => ({ url, thumbnail: url, title: '', source: '', source_url: '' })),
    ...imageResults.filter(img => !tavilyImages.includes(img.url)),
  ].slice(0, 8)

  return NextResponse.json({
    results,
    query,
    // Tavily AI-generated answer summary
    ...(tavilyData?.answer ? { answer: tavilyData.answer } : {}),
    // Rich images with metadata
    images: allImages,
    // YouTube videos with embeds
    videos: videoResults,
    // Search metadata
    meta: {
      sources_count: results.length,
      has_videos: videoResults.length > 0,
      has_images: allImages.length > 0,
      has_answer: !!tavilyData?.answer,
    },
  })
}
