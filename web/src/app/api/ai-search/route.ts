import { NextRequest, NextResponse } from 'next/server'

type SearchResult = { title: string; snippet: string; url: string }

// Serper.dev — best results when API key is available
async function searchSerper(query: string): Promise<SearchResult[]> {
  const key = process.env.SERPER_API_KEY
  if (!key) return []
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 8 }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    const data = await res.json()
    const results: SearchResult[] = (data.organic || []).slice(0, 8).map((r: Record<string, string>) => ({
      title: r.title || '',
      snippet: (r.snippet || '').slice(0, 300),
      url: r.link || '',
    }))
    return results
  } catch { return [] }
}

// Try SearXNG public instances (free, no key, real web results)
async function searchSearXNG(query: string): Promise<SearchResult[]> {
  const instances = [
    'https://searxng.site',
    'https://search.inetol.net',
    'https://paulgo.io',
  ]
  for (const base of instances) {
    try {
      const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 AlphaAIDesk/1.0', 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) continue
      const data = await res.json()
      const results: SearchResult[] = (data.results || []).slice(0, 8).map((r: Record<string, string>) => ({
        title: r.title || '',
        snippet: (r.content || r.snippet || '').slice(0, 300),
        url: r.url || '',
      }))
      if (results.length > 0) return results
    } catch { continue }
  }
  return []
}

// Fallback: DuckDuckGo instant answers
async function searchDDG(query: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { headers: { 'User-Agent': 'AlphaAIDeskBot/1.0' }, signal: AbortSignal.timeout(5000) }
    )
    const data = await res.json()
    const results: SearchResult[] = []
    if (data.AbstractText) {
      results.push({ title: data.AbstractSource || 'Summary', snippet: data.AbstractText.slice(0, 300), url: data.AbstractURL || '' })
    }
    for (const r of (data.RelatedTopics || []).slice(0, 5)) {
      if (r.Text) results.push({ title: r.Text.split(' - ')[0] || '', snippet: r.Text.slice(0, 200), url: r.FirstURL || '' })
    }
    return results
  } catch { return [] }
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')
  if (!query) return NextResponse.json({ results: [] })

  // Serper first → SearXNG → DDG fallback
  let results = await searchSerper(query)
  if (results.length === 0) results = await searchSearXNG(query)
  if (results.length === 0) results = await searchDDG(query)

  return NextResponse.json({ results, query })
}
