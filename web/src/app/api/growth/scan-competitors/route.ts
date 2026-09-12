export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { getRouteShop, unauthorized } from '@/lib/api-auth'

// Scan competitor auto shops in Houston for low-rated reviews
// Uses Google Places API (Text Search + Place Details)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    const query = typeof body?.query === 'string' ? body.query.trim().slice(0, 200) : ''
    const rawRadius = Number(body?.radius ?? 15000)
    const searchRadius = Number.isFinite(rawRadius) && rawRadius >= 100 && rawRadius <= 50000 ? Math.floor(rawRadius) : 15000

    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) throw settingsError
    const shopName = String(settings?.shop_name || settings?.company_name || settings?.business_name || 'our shop')
    const shopAddress = String(settings?.shop_address || settings?.address || 'your service area')
    const searchQuery = query || `auto repair shops near ${shopAddress}`

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
      if (!searchRes.ok) throw new Error(`Google Places search failed: ${searchRes.status}`)
      const searchData = await searchRes.json()

      if (!searchData.results?.length) {
        return NextResponse.json({ competitors: [], message: 'No results found' })
      }

      // Step 2: For each competitor, get their reviews
      const places = searchData.results.slice(0, 10) // Top 10 competitors
      for (const place of places) {
        // Skip our own shop
        if ((place.name || '').toLowerCase().includes(shopName.toLowerCase())) continue

        const detailUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_address,rating,user_ratings_total,reviews&key=${mapsKey}`
        const detailRes = await fetch(detailUrl)
        if (!detailRes.ok) continue
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
      const aiBase = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
      const aiModel = normalizeAiModel(settings?.ai_model, aiBase)

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
Focus on shops near ${shopAddress}.
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
      if (!aiRes.ok) throw new Error(`AI provider returned ${aiRes.status}`)
      const aiData = await aiRes.json()
      const content = aiData.choices?.[0]?.message?.content || '[]'

      try {
        const parsed = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
        competitors = Array.isArray(parsed) ? parsed.filter(c => c && typeof c === 'object').map((c: { name: string; address: string; rating: number; complaints: string }) => ({
          name: c.name,
          address: c.address,
          rating: c.rating,
          total_reviews: 0,
          place_id: '',
          low_reviews: c.complaints ? [{ author: 'AI Summary', rating: 1, text: c.complaints, time: new Date().toISOString(), relative_time: 'recent' }] : [],
        })) : []
      } catch {
        competitors = []
      }
    }

    // Save scan results to Supabase for tracking
    const { error: scanError } = await db.from('growth_scans').upsert({
      id: `${auth.shopId}:latest_competitor_scan`,
      shop_id: auth.shopId,
      type: 'competitor_reviews',
      data: competitors,
      scanned_at: new Date().toISOString(),
    })
    if (scanError) throw scanError

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
