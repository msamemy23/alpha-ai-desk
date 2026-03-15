import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const SERPER_KEY = process.env.SERPER_API_KEY || ''
const AI_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'
const AI_MODEL = process.env.AI_MODEL || 'google/gemini-2.0-flash-001'

async function searchSerper(query: string) {
  if (!SERPER_KEY) return []
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 10 })
    })
    const data = await res.json()
    return (data.organic || []).map((r: any) => ({
      title: r.title, snippet: r.snippet, url: r.link,
      source: r.link ? new URL(r.link).hostname : 'unknown'
    }))
  } catch { return [] }
}

async function aiAnalyzeSocialPosts(posts: any[], city: string) {
  if (!AI_KEY) return []
  try {
    const res = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: `You are a lead generation AI for Alpha International Auto Center in Houston TX. Analyze social media search results and extract potential leads - people who need auto repair services. For each lead found, return JSON array: [{ "name": "", "platform": "", "post_snippet": "", "service_needed": "", "urgency": "high|medium|low", "likely_phone": "", "social_profile": "", "suggested_message": "", "confidence": "high|medium|low", "how_to_find": "" }]. The suggested_message should be friendly and offer help. how_to_find should explain steps to locate their contact info. Return up to 10 leads.`
        }, {
          role: 'user',
          content: `Analyze these social media search results from ${city} area and find people who need auto repair. Extract their info and suggest outreach:\n\n${JSON.stringify(posts.slice(0, 15))}`
        }],
        temperature: 0.3, max_tokens: 2000
      })
    })
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '[]'
    const cleaned = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    return JSON.parse(cleaned)
  } catch { return [] }
}

export async function POST(req: NextRequest) {
  try {
    const { city = 'Houston TX' } = await req.json()
    const db = getServiceClient()

    const queries = [
      `"need a mechanic" ${city} site:facebook.com OR site:reddit.com OR site:nextdoor.com`,
      `"looking for auto repair" ${city} site:facebook.com OR site:reddit.com`,
      `"car broke down" OR "check engine light" ${city} site:facebook.com OR site:nextdoor.com`,
      `"recommend a mechanic" OR "good auto shop" ${city} site:facebook.com OR site:reddit.com`,
      `"bad experience" "auto repair" ${city} site:facebook.com OR site:yelp.com`
    ]

    let allResults: any[] = []
    for (const query of queries) {
      const results = await searchSerper(query)
      allResults = [...allResults, ...results]
    }

    const seen = new Set()
    allResults = allResults.filter(r => {
      if (seen.has(r.url)) return false
      seen.add(r.url)
      return true
    })

    const leads = await aiAnalyzeSocialPosts(allResults, city)

    for (const lead of leads) {
      await db.from('leads').insert({
        name: lead.name || 'Social Lead',
        phone: lead.likely_phone || null,
        service_needed: lead.service_needed || 'General auto repair',
        source: 'ai-social-scan',
        status: 'new',
        notes: JSON.stringify({
          platform: lead.platform,
          post_snippet: lead.post_snippet,
          urgency: lead.urgency,
          social_profile: lead.social_profile,
          suggested_message: lead.suggested_message,
          how_to_find: lead.how_to_find,
          confidence: lead.confidence
        }),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      })
    }

    await db.from('growth_activity').insert({
      action: 'ai_social_scan', target: city,
      details: `Found ${leads.length} social media leads from ${allResults.length} posts`,
      status: 'complete', created_at: new Date().toISOString()
    })

    return NextResponse.json({
      success: true, total_posts_scanned: allResults.length,
      total_leads: leads.length, leads
    })
  } catch (e) {
    console.error('AI social leads error:', e)
    return NextResponse.json({ error: 'Failed to scan social media' }, { status: 500 })
  }
}