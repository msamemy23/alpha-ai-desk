import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const SERPER_KEY = process.env.SERPER_API_KEY || ''
const AI_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'
const AI_MODEL = process.env.AI_MODEL || 'google/gemini-2.0-flash-001'

function fetchT(url: string, opts: RequestInit, ms = 15000) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), ms)
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id))
}

async function searchSerperPlaces(query: string) {
  if (!SERPER_KEY) return []
  try {
    const res = await fetchT('https://google.serper.dev/places', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 8 })
    }, 10000)
    const data = await res.json()
    return (data.places || []).map((p: any) => ({
      name: p.title, address: p.address, phone: p.phoneNumber || null,
      rating: p.rating, reviews: p.reviews, website: p.website || null, cid: p.cid || null
    }))
  } catch { return [] }
}

async function searchSerper(query: string) {
  if (!SERPER_KEY) return []
  try {
    const res = await fetchT('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 5 })
    }, 8000)
    const data = await res.json()
    return (data.organic || []).map((r: any) => ({ title: r.title, snippet: r.snippet, url: r.link }))
  } catch { return [] }
}

async function deepResearchCompetitor(comp: any) {
  const name = comp.name
  const [ownerResults, reviewResults, emailResults] = await Promise.all([
    searchSerper(`"${name}" owner OR manager OR president Houston`),
    searchSerper(`"${name}" reviews complaints Houston auto repair`),
    searchSerper(`"${name}" email contact Houston`)
  ])
  const emailMatch = JSON.stringify(emailResults).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return {
    ...comp,
    owner_search: ownerResults.slice(0, 2).map((r: any) => r.snippet).join(' | '),
    review_snippets: reviewResults.slice(0, 3).map((r: any) => r.snippet).join(' | '),
    email: emailMatch ? emailMatch[0] : null
  }
}

async function aiAnalyzeCompetitors(competitors: any[], city: string) {
  if (!AI_KEY || !competitors.length) return []
  try {
    const res = await fetchT(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: `You are a competitive intelligence analyst for Alpha International Auto Center in Houston TX. Analyze competitor auto shops and create DEEP profiles on each one. Return a JSON array where each object represents a COMPETITOR SHOP with ALL these fields:
{
  "name": "competitor shop name",
  "phone": "their phone",
  "email": "their email if found",
  "address": "full address",
  "city": "Houston",
  "website": "website",
  "owner_name": "owner/manager name from search data",
  "owner_title": "Owner/Manager/President",
  "google_rating": rating number,
  "google_reviews_count": review count,
  "employee_count": "estimated (e.g. 5-15)",
  "revenue_estimate": "estimated (e.g. $500K-$1M)",
  "years_in_business": number or null,
  "industry": "auto repair",
  "service_area": "areas they serve",
  "pain_points": "their weaknesses from reviews (wait times, pricing, quality issues)",
  "fleet_score": 1-10 (how easy to steal their customers),
  "confidence": "high/medium/low",
  "outreach_pitch": "pitch to their unhappy customers mentioning specific complaints",
  "annual_value_estimate": "potential revenue if we capture their customers",
  "review_snippet": "notable bad review quote",
  "best_services": ["services we can offer better"]
}
Use the search snippets and review data provided to fill real info. Be thorough.`
        }, {
          role: 'user',
          content: `Deep analyze these ${city} auto repair competitors:\n${JSON.stringify(competitors.slice(0, 10))}`
        }],
        temperature: 0.3, max_tokens: 4000
      })
    }, 45000)
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '[]'
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
  } catch { return [] }
}

export async function POST(req: NextRequest) {
  try {
    const { city = 'Houston TX' } = await req.json()
    const db = getServiceClient()

    const queries = ['auto repair shop', 'mechanic shop', 'car service center', 'oil change shop', 'brake shop', 'transmission repair']
    const shuffled = queries.sort(() => Math.random() - 0.5).slice(0, 3)

    const results = await Promise.all(shuffled.map(q => searchSerperPlaces(`${q} ${city}`)))
    let allComps = results.flat()
    const seen = new Set<string>()
    allComps = allComps.filter(c => {
      const k = c.name?.toLowerCase()
      if (!k || seen.has(k) || k.includes('alpha international')) return false
      seen.add(k); return true
    }).slice(0, 8)

    const researched = await Promise.all(allComps.slice(0, 6).map(c => deepResearchCompetitor(c)))
    const leads = await aiAnalyzeCompetitors(researched, city)
    const sorted = (leads || []).sort((a: any, b: any) => (b.fleet_score || 0) - (a.fleet_score || 0)).slice(0, 15)

    if (sorted.length > 0) {
      const rows = sorted.map((l: any) => ({
        name: l.name || 'Unknown Competitor',
        phone: l.phone || null,
        email: l.email || null,
        service_needed: 'Competitor - ' + (l.pain_points?.split(',')[0] || 'Auto repair'),
        source: 'ai-competitor-scan',
        status: 'new',
        business_type: 'auto repair competitor',
        confidence: l.confidence || 'medium',
        owner_name: l.owner_name || null,
        owner_title: l.owner_title || null,
        address: l.address || null,
        city: l.city || 'Houston',
        website: l.website || null,
        google_rating: l.google_rating || null,
        google_reviews_count: l.google_reviews_count || null,
        years_in_business: l.years_in_business || null,
        employee_count: l.employee_count || null,
        revenue_estimate: l.revenue_estimate || null,
        industry: l.industry || 'auto repair',
        service_area: l.service_area || null,
        pain_points: l.pain_points || null,
        deep_research: {
          review_snippet: l.review_snippet,
          fleet_score: l.fleet_score,
          outreach_pitch: l.outreach_pitch,
          best_services: l.best_services,
          annual_value_estimate: l.annual_value_estimate
        },
        research_completed_at: new Date().toISOString(),
        notes: JSON.stringify(l),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      }))
      await db.from('leads').insert(rows)
    }

    await db.from('growth_activity').insert({
      action: 'ai_competitor_scan', target: city,
      details: `Deep research: ${sorted.length} competitors from ${allComps.length} shops`,
      status: 'complete', created_at: new Date().toISOString()
    })

    return NextResponse.json({ success: true, total_competitors: allComps.length, total_leads: sorted.length, leads: sorted })
  } catch (e) {
    console.error('AI competitor leads error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}