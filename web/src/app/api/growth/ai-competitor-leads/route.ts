import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const SERPER_KEY = process.env.SERPER_API_KEY || ''
const AI_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'
const AI_MODEL = process.env.AI_MODEL || 'google/gemini-2.0-flash-001'

function fetchWithTimeout(url: string, opts: RequestInit, ms = 15000) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id))
}

async function searchSerperPlaces(query: string) {
  if (!SERPER_KEY) return []
  try {
    const res = await fetchWithTimeout('https://google.serper.dev/places', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 6 })
    }, 10000)
    const data = await res.json()
    return (data.places || []).map((p: any) => ({
      name: p.title, address: p.address, phone: p.phoneNumber || null,
      rating: p.rating, reviews: p.reviews, website: p.website || null
    }))
  } catch { return [] }
}

async function searchSerper(query: string) {
  if (!SERPER_KEY) return []
  try {
    const res = await fetchWithTimeout('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 })
    }, 10000)
    const data = await res.json()
    return (data.organic || []).map((r: any) => ({ title: r.title, snippet: r.snippet, url: r.link }))
  } catch { return [] }
}

async function aiAnalyze(competitors: any[], reviewData: any[], city: string) {
  if (!AI_KEY) return []
  try {
    const res = await fetchWithTimeout(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: 'You are a lead gen AI for Alpha International Auto Center in Houston TX. Analyze competitor shops and bad review snippets. Find unhappy customers. Return JSON array: [{ "reviewer_name": "", "competitor_name": "", "review_snippet": "", "service_issue": "", "urgency": "high|medium|low", "suggested_message": "", "how_to_find": "", "confidence": "high|medium|low" }]. Return up to 8 leads. Be concise.'
        }, {
          role: 'user',
          content: `Find unhappy customers from these ${city} competitors:\nShops: ${JSON.stringify(competitors.slice(0, 4))}\nReviews: ${JSON.stringify(reviewData.slice(0, 10))}`
        }],
        temperature: 0.3, max_tokens: 1500
      })
    }, 30000)
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '[]'
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
  } catch { return [] }
}

export async function POST(req: NextRequest) {
  try {
    const { city = 'Houston TX' } = await req.json()
    const db = getServiceClient()

    const competitors = await searchSerperPlaces(`auto repair shop ${city}`)
    const topComps = competitors.slice(0, 3)

    const reviewResults = await Promise.all(
      topComps.map(c => searchSerper(`"${c.name}" ${city} bad review 1 star`))
    )
    const allReviews = reviewResults.flatMap((reviews, i) =>
      reviews.map(r => ({ ...r, competitor: topComps[i].name }))
    )

    const leads = await aiAnalyze(topComps, allReviews, city)

    if (leads.length > 0) {
      const rows = leads.map((lead: any) => ({
        name: lead.reviewer_name || 'Competitor Lead',
        phone: null,
        service_needed: `Competitor unhappy - ${lead.service_issue || 'General'}`,
        source: 'ai-competitor-scan',
        status: 'new',
        notes: JSON.stringify(lead),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      }))
      await db.from('leads').insert(rows)
    }

    await db.from('growth_activity').insert({
      action: 'ai_competitor_scan', target: city,
      details: `Found ${leads.length} unhappy customers from ${topComps.length} competitors`,
      status: 'complete', created_at: new Date().toISOString()
    })

    return NextResponse.json({ success: true, total_competitors: topComps.length, total_leads: leads.length, leads })
  } catch (e) {
    console.error('AI competitor leads error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}