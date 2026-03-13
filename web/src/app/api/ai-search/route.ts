import { NextRequest, NextResponse } from 'next/server'

const TAVILY_API_KEY =
  process.env.TAVILY_API_KEY ||
  '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'

type SearchResult = { title: string; snippet: string; url: string }

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')
  if (!query) return NextResponse.json({ results: [] })

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        search_depth: 'basic',
        include_answer: true,
        include_images: true,
        max_results: 5,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      return NextResponse.json({ results: [], query })
    }

    const data = await res.json()

    const results: SearchResult[] = (data.results || []).map(
      (r: { title?: string; content?: string; url?: string }) => ({
        title: r.title || '',
        snippet: (r.content || '').slice(0, 300),
        url: r.url || '',
      })
    )

    // Include image URLs from Tavily if available
    const images: string[] = (data.images || []).slice(0, 5)

    return NextResponse.json({
      results,
      query,
      ...(data.answer ? { answer: data.answer } : {}),
      ...(images.length ? { images } : {}),
    })
  } catch {
    return NextResponse.json({ results: [], query })
  }
}
