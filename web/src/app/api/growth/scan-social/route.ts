export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { getRouteShop, unauthorized } from '@/lib/api-auth'

// Scan social media / web for people in Houston posting about car trouble
// Uses SearXNG (if configured) or direct web search via AI
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    const rawKeywords = Array.isArray(body?.keywords) ? body.keywords : []
    const keywords = rawKeywords
      .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
      .map(value => value.trim().slice(0, 120))
      .slice(0, 10)
    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('*').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) throw settingsError

    const aiKey = (settings?.ai_api_key as string) || ''
    const aiBase = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const aiModel = normalizeAiModel(settings?.ai_model, aiBase)

    if (!aiKey) {
      return NextResponse.json({ error: 'AI API key not configured in Settings' }, { status: 400 })
    }

    const searchTerms = keywords.length ? keywords : [
      'car broke down Houston',
      'need mechanic Houston TX',
      'car won\'t start Houston',
      'auto repair recommendation Houston',
      'check engine light Houston',
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
    const searxUrl = settings?.searxng_url as string

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

    // AI may suggest candidates, but it cannot verify a live post on its own.
    const aiRes = await fetch(`${aiBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: 'system', content: 'You are a lead generation AI for an auto repair shop. Return only valid JSON arrays. No markdown.' },
          { role: 'user', content: `Suggest candidate social posts that might indicate auto-repair demand in the target area. Do not claim you searched or verified live posts. Return JSON array: [{"platform":"Facebook","title":"...","snippet":"...","url":"","potential_service":"brake repair","urgency":"high"}].` }
        ],
        max_tokens: 2000,
      })
    })

    if (!aiRes.ok) throw new Error(`AI provider returned ${aiRes.status}`)
    const aiData = await aiRes.json()
    const content = aiData.choices?.[0]?.message?.content || '[]'

    try {
      const parsed = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
      if (Array.isArray(parsed)) {
        for (const post of parsed) {
          if (!allPosts.some(p => p.title === post.title)) {
            allPosts.push({
              platform: post.platform || 'Social',
              title: post.title || 'Untitled',
              snippet: post.snippet || '',
              url: post.url || '',
              date: post.date || new Date().toISOString(),
              potential_service: post.potential_service || 'General',
              urgency: post.urgency || 'medium',
              verified: false,
            })
          }
        }
      }
    } catch { /* keep what we have */ }

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
