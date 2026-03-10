import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q')
  if (!query) return NextResponse.json({ results: [] })

  try {
    // DuckDuckGo Instant Answer API (no key needed)
    const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
      headers: { 'User-Agent': 'AlphaAIDeskBot/1.0' }
    })
    const data = await res.json()

    const results: { title: string; snippet: string; url: string }[] = []

    if (data.AbstractText) {
      results.push({ title: data.AbstractSource || 'Info', snippet: data.AbstractText.slice(0, 200), url: data.AbstractURL || '' })
    }

    const related = data.RelatedTopics || []
    for (const r of related.slice(0, 6)) {
      if (r.Text) results.push({ title: r.Text.split(' - ')[0] || '', snippet: r.Text.slice(0, 200), url: r.FirstURL || '' })
    }

    return NextResponse.json({ results })
  } catch {
    return NextResponse.json({ results: [], error: 'Search failed' })
  }
}
