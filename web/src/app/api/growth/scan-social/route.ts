export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getRouteShop, unauthorized } from '@/lib/api-auth'
import { assertPublicUrl } from '@/lib/public-url'
import { NEEDS_CITY, resolveSearchCity } from '@/lib/growth-city'

// Scan social media / web for people near this shop posting about car trouble.
// Only posts the search engine actually returned are shown. Nothing is suggested or made up by an AI.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    const rawKeywords = Array.isArray(body?.keywords) ? body.keywords : []
    const keywords = rawKeywords
      .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value: string) => value.trim().slice(0, 120))
      .slice(0, 10)
    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) throw settingsError

    const city = keywords.length ? '' : await resolveSearchCity(db, auth.shopId, body?.city)
    if (!keywords.length && !city) return NextResponse.json({ error: NEEDS_CITY }, { status: 400 })

    const searchTerms = keywords.length ? keywords : [
      `car broke down ${city}`,
      `need mechanic ${city}`,
      `car won't start ${city}`,
      `auto repair recommendation ${city}`,
      `check engine light ${city}`,
    ]

    interface SocialPost {
      platform: string
      title: string
      snippet: string
      url: string
      date: string
      potential_service: string
      urgency: 'high' | 'medium' | 'low'
      verified: boolean
    }

    let allPosts: SocialPost[] = []
    let searchSucceeded = false

    // Try SearXNG first (self-hosted search)
    const rawSearxUrl = typeof settings?.searxng_url === 'string' ? settings.searxng_url.trim() : ''
    let searxUrl = ''
    if (rawSearxUrl) {
      try {
        searxUrl = (await assertPublicUrl(rawSearxUrl)).toString().replace(/\/$/, '')
      } catch {
        return NextResponse.json({ error: 'Configured search endpoint is not a public HTTPS URL' }, { status: 400 })
      }
    }

    if (searxUrl) {
      for (const term of searchTerms.slice(0, 5)) {
        try {
          const searchUrl = `${searxUrl}/search?q=${encodeURIComponent(term + ' site:facebook.com OR site:nextdoor.com OR site:reddit.com')}&format=json&categories=general&time_range=month`
          const res = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) })
          if (res.ok) {
            searchSucceeded = true
            const data = await res.json()
            for (const result of (data.results || []).slice(0, 5)) {
              let platform = 'Web'
              if (result.url?.includes('facebook.com')) platform = 'Facebook'
              else if (result.url?.includes('nextdoor.com')) platform = 'Nextdoor'
              else if (result.url?.includes('reddit.com')) platform = 'Reddit'
              allPosts.push({
                platform,
                title: result.title || '',
                snippet: result.content || '',
                url: result.url || '',
                date: result.publishedDate || new Date().toISOString(),
                potential_service: term,
                urgency: term.includes('broke down') || term.includes('won\'t start') ? 'high' : 'medium',
                verified: true,
              })
            }
          }
        } catch { /* skip */ }
      }
    }

    if (!searxUrl) return NextResponse.json({ error: 'Reading social posts needs a search endpoint, which is not set up in Settings. Nothing was made up in its place.' }, { status: 503 })

    const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
    allPosts.sort((a, b) => (urgencyOrder[a.urgency] || 1) - (urgencyOrder[b.urgency] || 1))

    const { error: scanError } = await db.from('growth_scans').upsert({
      id: `${auth.shopId}:latest_social_scan`,
      shop_id: auth.shopId,
      type: 'social_monitoring',
      data: allPosts,
      scanned_at: new Date().toISOString(),
    })
    if (scanError) throw scanError

    // Auto-create leads from high-urgency posts
    const highUrgency = allPosts.filter(p => p.urgency === 'high' && p.verified)
    for (const post of highUrgency) {
      if (post.url) {
        const { data: existing } = await db.from('leads').select('id').eq('shop_id', auth.shopId).eq('source_url', post.url).limit(1)
        if (existing?.length) continue
      }
      const { error: leadError } = await db.from('leads').insert({
        shop_id: auth.shopId,
        name: `Social Lead: ${post.platform}`,
        service_needed: post.potential_service,
        source: post.platform.toLowerCase(),
        source_url: post.url || null,
        notes: `${post.title}\n${post.snippet}`,
        status: 'new',
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString(),
      })
      if (leadError) throw leadError
    }

    return NextResponse.json({
      posts: allPosts,
      total: allPosts.length,
      high_urgency: allPosts.filter(p => p.urgency === 'high').length,
      verified_high_urgency: highUrgency.length,
      leads_created: highUrgency.length,
      search_succeeded: searchSucceeded,
      scanned_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('Scan social error:', e)
    return NextResponse.json({ error: 'Failed to scan social media' }, { status: 500 })
  }
}
