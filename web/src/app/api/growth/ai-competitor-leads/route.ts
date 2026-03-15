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
      title: r.title, snippet: r.snippet, url: r.link
    }))
  } catch { return [] }
}

async function searchSerperPlaces(query: string) {
  if (!SERPER_KEY) return []
  try {
    const res = await fetch('https://google.serper.dev/places', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 10 })
    })
    const data = await res.json()
    return (data.places || []).map((p: any) => ({
      name: p.title, address: p.address, phone: p.phoneNumber || null,
      rating: p.rating, reviews: p.reviews, website: p.website || null,
      cid: p.cid || null
    }))
  } catch { return [] }
}

async function getCompetitorReviews(shopName: string, city: string) {
  const results = await searchSerper(`"${shopName}" ${city} reviews bad experience 1 star`)
  return results.slice(0, 5)
}

async function aiAnalyzeReviews(competitors: any[], reviewData: any[], city: string) {
  if (!AI_KEY) return []
  try {
    const res = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: `You are a lead generation AI for Alpha International Auto Center in Houston TX. Analyze these competitor auto shops and their bad review snippets. Extract names of unhappy customers and create outreach strategies. Return JSON array: [{ "reviewer_name": "", "competitor_name": "", "review_snippet": "", "service_issue": "", "urgency": "high|medium|low", "outreach_angle": "", "suggested_message": "", "how_to_find": "", "confidence": "high|medium|low" }]. suggested_message should be friendly and mention Alpha International. how_to_find should suggest ways to locate their contact info. Return up to 10 leads.`
        }, {
          role: 'user',
          content: `Analyze these ${city} competitor shops and their bad reviews. Find unhappy customers we can reach out to:\n\nCompetitors: ${JSON.stringify(competitors.slice(0, 8))}\n\nReview snippets: ${JSON.stringify(reviewData.slice(0, 20))}`
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

    const competitors = await searchSerperPlaces(`auto repair shop ${city}`)

    let allReviewData: any[] = []
    for (const comp of competitors.slice(0, 6)) {
      const reviews = await getCompetitorReviews(comp.name, city)
      allReviewData.push(...reviews.map((r: any) => ({ ...r, competitor: comp.name })))
    }

    const leads = await aiAnalyzeReviews(competitors, allReviewData, city)

    for (const lead of leads) {
      await db.from('leads').insert({
        name: lead.reviewer_name || 'Competitor Lead',
        phone: null,
        service_needed: `Competitor unhappy - ${lead.service_issue || 'General'}`,
        source: 'ai-competitor-scan',
        status: 'new',
        notes: JSON.stringify({
          competitor: lead.competitor_name,
          review_snippet: lead.review_snippet,
          outreach_angle: lead.outreach_angle,
          suggested_message: lead.suggested_message,
          how_to_find: lead.how_to_find,
          confidence: lead.confidence
        }),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      })
    }

    await db.from('growth_activity').insert({
      action: 'ai_competitor_scan', target: city,
      details: `Found ${leads.length} unhappy customers from ${competitors.length} competitors`,
      status: 'complete', created_at: new Date().toISOString()
    })

    return NextResponse.json({
      success: true, total_competitors: competitors.length,
      total_leads: leads.length, leads
    })
  } catch (e) {
    console.error('AI competitor leads error:', e)
    return NextResponse.json({ error: 'Failed to scan competitors' }, { status: 500 })
  }
}