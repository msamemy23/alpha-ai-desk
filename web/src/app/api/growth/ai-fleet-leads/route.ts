import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const SERPER_KEY = process.env.SERPER_API_KEY || ''
const AI_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'
const AI_MODEL = process.env.AI_MODEL || 'google/gemini-2.0-flash-001'

const BUSINESS_CATEGORIES = [
  'plumbing company', 'HVAC company', 'electrician company', 'landscaping company',
  'pest control company', 'roofing company', 'cleaning service company',
  'property management company', 'delivery service', 'food truck',
  'towing company', 'construction company', 'car dealership',
  'auto rental company', 'church with van', 'school district transportation',
  'courier service', 'mobile mechanic', 'painting company', 'moving company',
  'security patrol company', 'carpet cleaning company', 'locksmith',
  'catering company', 'home inspection company'
]

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
      body: JSON.stringify({ q: query, num: 5 })
    }, 10000)
    const data = await res.json()
    return (data.places || []).slice(0, 3).map((p: any) => ({
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

async function deepResearchBusiness(biz: any) {
  const name = biz.name
  const [ownerResults, fleetResults, emailResults] = await Promise.all([
    searchSerper(`"${name}" owner OR president OR CEO OR founder Houston`),
    searchSerper(`"${name}" fleet vehicles trucks vans Houston`),
    searchSerper(`"${name}" email contact Houston`)
  ])
  const emailMatch = JSON.stringify(emailResults).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return {
    ...biz,
    owner_search: ownerResults.slice(0, 2).map((r: any) => r.snippet).join(' | '),
    fleet_search: fleetResults.slice(0, 2).map((r: any) => r.snippet).join(' | '),
    email: emailMatch ? emailMatch[0] : biz.email || null,
    raw_snippets: [...ownerResults, ...fleetResults].slice(0, 4).map((r: any) => r.snippet).join(' ')
  }
}

async function aiDeepAnalyze(businesses: any[], city: string) {
  if (!AI_KEY || !businesses.length) return businesses.map(b => ({
    ...b, fleet_score: 5, owner_name: 'Unknown', owner_title: 'Owner',
    estimated_vehicles: '2-5', revenue_estimate: 'Unknown', years_in_business: null,
    has_maintenance_contract: false, vehicle_types: 'Mixed', service_area: city,
    pain_points: '', outreach_pitch: 'Contact for fleet services'
  }))
  try {
    const res = await fetchT(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: `You are an expert business intelligence analyst for Alpha International Auto Center in Houston TX. Do DEEP research analysis on each business. Extract every detail possible. Return a JSON array where each object has ALL these fields:\n{\n  "name": "exact business name",\n  "owner_name": "owner/president/CEO name from search data or best guess",\n  "owner_title": "their title (Owner, President, CEO, GM, Fleet Manager)",\n  "phone": "business phone",\n  "email": "business email",\n  "address": "full street address",\n  "city": "city",\n  "zip": "zip code",\n  "website": "website url",\n  "business_type": "industry category",\n  "industry": "specific industry",\n  "employee_count": "estimated employees (e.g. 10-25)",\n  "revenue_estimate": "estimated annual revenue (e.g. $500K-$1M)",\n  "years_in_business": estimated number or null,\n  "fleet_size": "estimated vehicles (e.g. 5-10)",\n  "vehicle_types": "types of vehicles (vans, trucks, cars, etc)",\n  "has_maintenance_contract": true/false guess,\n  "current_shop": "who they likely use for maintenance or Unknown",\n  "service_area": "areas they serve in Houston",\n  "google_rating": number or null,\n  "google_reviews_count": number or null,\n  "facebook_url": "facebook page url or null",\n  "linkedin_url": "linkedin page url or null",\n  "pain_points": "likely vehicle/fleet pain points",\n  "fleet_score": 1-10 (10 = highest fleet service need),\n  "confidence": "high/medium/low",\n  "outreach_pitch": "personalized 2-sentence pitch mentioning their business by name",\n  "best_services": ["oil change", "brakes", etc],\n  "annual_value_estimate": "$X,XXX estimated annual spend on fleet maintenance"\n}\nUse the search snippets provided to fill in real data. If info is not available, make intelligent estimates based on business type and size. Be thorough.`
        }, {
          role: 'user',
          content: `Deep analyze these ${city} businesses for fleet potential. Use the search data provided:\n${JSON.stringify(businesses.slice(0, 12))}`
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
    const { city = 'Houston TX', categories } = await req.json()
    const db = getServiceClient()
    const cats = categories || BUSINESS_CATEGORIES
    const shuffled = [...cats].sort(() => Math.random() - 0.5).slice(0, 5)

    // Step 1: Search Google Places for businesses
    const results = await Promise.all(
      shuffled.map(q => searchSerperPlaces(`${q} ${city}`))
    )
    let allBiz = results.flat().map((b, i) => ({
      ...b, business_type: shuffled[Math.floor(i / 3)]
    }))
    const seen = new Set()
    allBiz = allBiz.filter(b => { const k = b.name; if (seen.has(k)) return false; seen.add(k); return true })

    // Step 2: Deep research top 8 businesses (3 parallel searches each)
    const topBiz = allBiz.slice(0, 8)
    const researched = await Promise.all(topBiz.map(b => deepResearchBusiness(b)))

    // Step 3: AI deep analysis with all gathered intel
    const leads = await aiDeepAnalyze(researched, city)
    const sorted = leads.sort((a: any, b: any) => (b.fleet_score || 0) - (a.fleet_score || 0)).slice(0, 15)

    // Step 4: Save to DB with all deep research fields
    if (sorted.length > 0) {
      const rows = sorted.map((lead: any) => ({
        name: lead.name,
        phone: lead.phone || null,
        email: lead.email || null,
        service_needed: `Fleet - ${lead.business_type || 'General'}`,
        source: 'ai-fleet-scan',
        status: 'new',
        business_type: lead.business_type || lead.industry,
        confidence: lead.fleet_score >= 7 ? 'high' : lead.fleet_score >= 4 ? 'medium' : 'low',
        owner_name: lead.owner_name || null,
        owner_title: lead.owner_title || null,
        address: lead.address || null,
        city: lead.city || city.split(' ')[0],
        zip: lead.zip || null,
        website: lead.website || null,
        google_rating: lead.google_rating || lead.rating || null,
        google_reviews_count: lead.google_reviews_count || lead.reviews || null,
        years_in_business: lead.years_in_business || null,
        employee_count: lead.employee_count || null,
        revenue_estimate: lead.revenue_estimate || null,
        fleet_size: lead.fleet_size || lead.estimated_vehicles || null,
        vehicle_types: lead.vehicle_types || null,
        has_maintenance_contract: lead.has_maintenance_contract || false,
        current_shop: lead.current_shop || null,
        industry: lead.industry || lead.business_type || null,
        service_area: lead.service_area || null,
        facebook_url: lead.facebook_url || null,
        linkedin_url: lead.linkedin_url || null,
        pain_points: lead.pain_points || null,
        deep_research: {
          fleet_score: lead.fleet_score,
          best_services: lead.best_services,
          outreach_pitch: lead.outreach_pitch,
          annual_value_estimate: lead.annual_value_estimate,
          confidence: lead.confidence
        },
        research_completed_at: new Date().toISOString(),
        notes: JSON.stringify(lead),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      }))
      await db.from('leads').insert(rows)
    }

    await db.from('growth_activity').insert({
      action: 'ai_fleet_scan',
      target: city,
      details: `Deep research: ${sorted.length} fleet leads from ${allBiz.length} businesses (${shuffled.join(', ')})`,
      status: 'complete',
      created_at: new Date().toISOString()
    })

    return NextResponse.json({
      success: true, total_businesses_scanned: allBiz.length,
      total_leads: sorted.length, categories_searched: shuffled,
      all_categories: BUSINESS_CATEGORIES, leads: sorted
    })
  } catch (e) {
    console.error('AI fleet leads error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}