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
    searchSerper(`"${name}" owner OR manager Houston`),
    searchSerper(`"${name}" bad review complaint Houston auto repair`),
    searchSerper(`"${name}" email contact Houston`)
  ])
  const emailMatch = JSON.stringify(emailResults).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return {
    ...comp,
    owner_search: ownerResults.slice(0, 2).map((r: any) => r.snippet).join(' | '),
    bad_reviews: reviewResults.slice(0, 3).map((r: any) => r.snippet).join(' | '),
    email: emailMatch ? emailMatch[0] : null
  }
}

async function aiDeepAnalyze(competitors: any[], city: string) {
  if (!AI_KEY) return []
  try {
    const res = await fetchT(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: `You are a competitive intelligence analyst for Alpha International Auto Center in Houston TX. Analyze competitor auto shops and find their unhappy customers. Return JSON array with DEEP profiles:\n[{\n  "name": "customer/reviewer name",\n  "competitor_name": "which competitor they complained about",\n  "phone": "if findable",\n  "email": "if findable",\n  "address": "competitor address",\n  "city": "Houston",\n  "website": "competitor website",\n  "owner_name": "competitor owner/manager name",\n  "owner_title": "title",\n  "google_rating": competitor rating,\n  "google_reviews_count": number,\n  "employee_count": "estimated",\n  "revenue_estimate": "estimated",\n  "years_in_business": number or null,\n  "industry": "auto repair",\n  "service_area": "areas served",\n  "pain_points": "specific complaints from reviews",\n  "service_needed": "what service the customer needed",\n  "review_snippet": "the actual bad review text",\n  "confidence": "high/medium/low",\n  "fleet_score": 1-10,\n  "outreach_pitch": "personalized pitch to steal this customer",\n  "suggested_message": "ready-to-send SMS",\n  "annual_value_estimate": "$X,XXX"\n}]`
        }, {
          role: 'user',
          content: `Find unhappy customers from these ${city} competitors. Use review data:\n${JSON.stringify(competitors.slice(0, 10))}`
        }],
        temperature: 0.3,
        max_tokens: 4000
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
    const queries = ['auto repair shop', 'mechanic shop', 'car service center', 'oil change shop']
    const shuffled = queries.sort(() => Math.random() - 0.5).slice(0, 3)

    const results = await Promise.all(shuffled.map(q => searchSerperPlaces(`${q} ${city}`)))
    let topComps = results.flat()
    const seen = new Set()
    topComps = topComps.filter(c => { if (seen.has(c.name)) return false; seen.add(c.name); return true })
      .filter(c => c.rating && c.rating < 4.5).slice(0, 6)

    const researched = await Promise.all(topComps.map(c => deepResearchCompetitor(c)))
    const leads = await aiDeepAnalyze(researched, city)

    if (leads.length > 0) {
      const rows = leads.map((l: any) => ({
        name: l.name || l.competitor_name || 'Unknown',
        phone: l.phone || null, email: l.email || null,
        service_needed: l.service_needed || 'Auto repair',
        source: 'ai-competitor-scan', status: 'new',
        business_type: 'auto repair competitor',
        confidence: l.confidence || 'medium',
        owner_name: l.owner_name || null, owner_title: l.owner_title || null,
        address: l.address || null, city: l.city || 'Houston',
        website: l.website || null,
        google_rating: l.google_rating || null,
        google_reviews_count: l.google_reviews_count || null,
        years_in_business: l.years_in_business || null,
        employee_count: l.employee_count || null,
        revenue_estimate: l.revenue_estimate || null,
        industry: l.industry || 'auto repair',
        service_area: l.service_area || null,
        pain_points: l.pain_points || null,
        deep_research: { review_snippet: l.review_snippet, competitor_name: l.competitor_name,
          fleet_score: l.fleet_score, outreach_pitch: l.outreach_pitch,
          suggested_message: l.suggested_message, annual_value_estimate: l.annual_value_estimate },
        research_completed_at: new Date().toISOString(),
        notes: JSON.stringify(l),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      }))
      await db.from('leads').insert(rows)
    }

    await db.from('growth_activity').insert({
      action: 'ai_competitor_scan', target: city,
      details: `Deep research: ${leads.length} unhappy customers from ${topComps.length} competitors`,
      status: 'complete', created_at: new Date().toISOString()
    })

    return NextResponse.json({ success: true, total_competitors: topComps.length,
      total_leads: leads.length, leads })
  } catch (e) {
    console.error('AI competitor leads error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}