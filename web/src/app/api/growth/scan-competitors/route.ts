export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

// Scan competitor auto shops in Houston for low-rated reviews
// Uses Google Places API (Text Search + Place Details)
export async function POST(req: NextRequest) {
  try {
    const { query, radius } = await req.json()
    // Default: search for auto repair shops near Alpha's location
    const searchQuery = query || 'auto repair shop Houston TX'
    const searchRadius = radius || 15000 // 15km default

    const db = getServiceClient()
    const { data: settings } = await db.from('settings').select('*').limit(1).single()

    // Use Google Places API via the GOOGLE_MAPS_API_KEY env var
    // If not set, fall back to SearXNG web search
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY

    interface ReviewItem {
      author: string
      rating: number
      text: string
      time: string
      relative_time: string
    }

    interface CompetitorResult {
      name: string
      address: string
      rating: number
      total_reviews: number
      place_id: string
      low_reviews: ReviewItem[]
    }

    let competitors: CompetitorResult[] = []

    if (mapsKey) {
      // === GOOGLE PLACES API (real) ===
      // Step 1: Text Search for competitor shops
      const searchUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(searchQuery)}&radius=${searchRadius}&key=${mapsKey}`
      const searchRes = await fetch(searchUrl)
      const searchData = await searchRes.json()

      if (!searchData.results?.length) {
        return NextResponse.json({ competitors: [], message: 'No results found' })
      }

      // Step 2: For each competitor, get their reviews
      const places = searchData.results.slice(0, 10) // Top 10 competitors
      for (const place of places) {
        // Skip our own shop
        if ((place.name || '').toLowerCase().includes('alpha international')) continue

        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,rating,user_ratings_total,reviews&key=${mapsKey}`
        const detailRes = await fetch(detailUrl)
        const detailData = await detailRes.json()
        const details = detailData.result

        if (!details) continue

        // Filter for 1-2 star reviews (unhappy customers = potential leads)
        const lowReviews: ReviewItem[] = (details.reviews || [])
          .filter((r: { rating: number }) => r.rating <= 2)
          .map((r: { author_name: string; rating: number; text: string; time: number; relative_time_description: string }) => ({
            author: r.author_name,
            rating: r.rating,
            text: r.text,
            time: new Date(r.time * 1000).toISOString(),
            relative_time: r.relative_time_description,
          }))

        competitors.push({
          name: details.name,
          address: details.formatted_address,
          rating: details.rating || 0,
          total_reviews: details.user_ratings_total || 0,
          place_id: place.place_id,
          low_reviews: lowReviews,
        })
      }
    } else {
      // === FALLBACK: Use AI + web search to find competitors ===
      const aiKey = (settings?.ai_api_key as string) || ''
      const aiModel = (settings?.ai_model as string) || 'deepseek/deepseek-chat-v3-0324:free'
      const aiBase = (settings?.ai_base_url as string) || 'https://openrouter.ai/api/v1'

      if (!aiKey) {
        return NextResponse.json({ error: 'No Google Maps API key or AI API key configured. Add GOOGLE_MAPS_API_KEY to env or configure AI in Settings.' }, { status: 400 })
      }

      // Use AI to search and extract competitor info
      const searchPrompt = `Search for auto repair shops in Houston TX that have bad reviews. For each shop, provide:
1. Shop name
2. Address
3. Overall rating
4. A summary of common complaints from unhappy customers

Format as JSON array: [{"name":"...","address":"...","rating":3.2,"complaints":"..."}]
Focus on shops within 10 miles of 10710 S Main St Houston TX 77025.
Only include shops with ratings below 4.0 or notable bad reviews.`

      const aiRes = await fetch(`${aiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
        body: JSON.stringify({
          model: aiModel,
          messages: [
            { role: 'system', content: 'You are a business intelligence assistant. Return only valid JSON arrays. No markdown.' },
            { role: 'user', content: searchPrompt }
          ],
          max_tokens: 1500,
        })
      })
      const aiData = await aiRes.json()
      const content = aiData.choices?.[0]?.message?.content || '[]'

      try {
        const parsed = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
        competitors = parsed.map((c: { name: string; address: string; rating: number; complaints: string }) => ({
          name: c.name,
          address: c.address,
          rating: c.rating,
          total_reviews: 0,
          place_id: '',
          low_reviews: c.complaints ? [{ author: 'AI Summary', rating: 1, text: c.complaints, time: new Date().toISOString(), relative_time: 'recent' }] : [],
        }))
      } catch {
        competitors = []
      }
    }

    // Save scan results to Supabase for tracking
    await db.from('growth_scans').upsert({
      id: 'latest_competitor_scan',
      type: 'competitor_reviews',
      data: competitors,
      scanned_at: new Date().toISOString(),
    })

    return NextResponse.json({
      competitors: competitors.sort((a, b) => a.rating - b.rating),
      total: competitors.length,
      low_review_leads: competitors.reduce((sum, c) => sum + c.low_reviews.length, 0),
      scanned_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('Scan competitors error:', e)
    return NextResponse.json({ error: 'Failed to scan competitors' }, { status: 500 })
  }
}
