export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

// Scan social media / web for people in Houston posting about car trouble
// Uses SearXNG (if configured) or direct web search via AI
export async function POST(req: NextRequest) {
  try {
    const { keywords } = await req.json()
    const db = getServiceClient()
    const { data: settings } = await db.from('settings').select('*').limit(1).single()

    const aiKey = (settings?.ai_api_key as string) || ''
    const aiModel = (settings?.ai_model as string) || 'deepseek/deepseek-chat-v3-0324:free'
    const aiBase = (settings?.ai_base_url as string) || 'https://openrouter.ai/api/v1'

    if (!aiKey) {
      return NextResponse.json({ error: 'AI API key not configured in Settings' }, { status: 400 })
    }

    const searchTerms = keywords || [
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
    }

    let allPosts: SocialPost[] = []

    // Try SearXNG first (self-hosted search)
    const searxUrl = process.env.SEARXNG_URL || (settings?.searxng_url as string)

    if (searxUrl) {
      for (const term of searchTerms.slice(0, 5)) {
        try {
          const searchUrl = `${searxUrl}/search?q=${encodeURIComponent(term + ' site:facebook.com OR site:nextdoor.com OR site:reddit.com')}&format=json&categories=general&time_range=month`
          const res = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) })
          if (res.ok) {
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
              })
            }
          }
        } catch { /* skip */ }
      }
    }

    // AI analysis to find and categorize leads
    const aiRes = await fetch(`${aiBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: 'system', content: 'You are a lead generation AI for an auto repair shop. Return only valid JSON arrays. No markdown.' },
          { role: 'user', content: `Find recent social media posts from people in Houston TX who need auto repair. Search Facebook groups, Nextdoor, Reddit r/houston. Return JSON array: [{"platform":"Facebook","title":"...","snippet":"...","url":"","potential_service":"brake repair","urgency":"high"}]. Find 5-10 leads.` }
        ],
        max_tokens: 2000,
      })
    })

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
            })
          }
        }
      }
    } catch { /* keep what we have */ }

    const urgencyOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
    allPosts.sort((a, b) => (urgencyOrder[a.urgency] || 1) - (urgencyOrder[b.urgency] || 1))

    await db.from('growth_scans').upsert({
      id: 'latest_social_scan',
      type: 'social_monitoring',
      data: allPosts,
      scanned_at: new Date().toISOString(),
    })

    // Auto-create leads from high-urgency posts
    const highUrgency = allPosts.filter(p => p.urgency === 'high')
    for (const post of highUrgency) {
      if (post.url) {
        const { data: existing } = await db.from('leads').select('id').eq('source_url', post.url).limit(1)
        if (existing?.length) continue
      }
      await db.from('leads').insert({
        name: `Social Lead: ${post.platform}`,
        service_needed: post.potential_service,
        source: post.platform.toLowerCase(),
        source_url: post.url || null,
        notes: `${post.title}\n${post.snippet}`,
        status: 'new',
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString(),
      })
    }

    return NextResponse.json({
      posts: allPosts,
      total: allPosts.length,
      high_urgency: highUrgency.length,
      leads_created: highUrgency.length,
      scanned_at: new Date().toISOString(),
    })
  } catch (e) {
    console.error('Scan social error:', e)
    return NextResponse.json({ error: 'Failed to scan social media' }, { status: 500 })
  }
}
