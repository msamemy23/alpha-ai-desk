import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'
import { forbidden, getRouteShop, unauthorized } from '@/lib/api-auth'
import { AI_BASE_URLS, normalizeAiBaseUrl, normalizeAiModel } from '@/lib/ai-config'
import { NEEDS_CITY, cityName, resolveSearchCity } from '@/lib/growth-city'
import { firstEmailIn, matchSource, nameFoundIn, scoreOf } from '@/lib/lead-grounding'

const SERPER_KEY = process.env.SERPER_API_KEY || ''

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

async function deepResearchBusiness(biz: any, city: string) {
  const name = biz.name
  const [ownerResults, fleetResults, emailResults] = await Promise.all([
    searchSerper(`"${name}" owner OR president OR CEO OR founder ${city}`),
    searchSerper(`"${name}" fleet vehicles trucks vans ${city}`),
    searchSerper(`"${name}" email contact ${city}`)
  ])
  const emailFound = firstEmailIn(JSON.stringify(emailResults))
  return {
    ...biz,
    owner_search: ownerResults.slice(0, 2).map((r: any) => r.snippet).join(' | '),
    fleet_search: fleetResults.slice(0, 2).map((r: any) => r.snippet).join(' | '),
    email: emailFound || biz.email || null,
    raw_snippets: [...ownerResults, ...fleetResults].slice(0, 4).map((r: any) => r.snippet).join(' ')
  }
}

async function aiDeepAnalyze(businesses: any[], city: string, aiKey: string, aiUrl: string, aiModel: string, shopName: string): Promise<any[] | null> {
  if (!businesses.length) return []
  if (!aiKey) return null
  try {
    const res = await fetchT(aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aiKey}` },
      body: JSON.stringify({
        model: aiModel,
        messages: [{
          role: 'system',
          content: `You help ${shopName}, an independent auto repair shop in ${city}, find local businesses that run vehicles and may need a repair shop. Use ONLY facts that appear in the search data you are given. If a fact is not in the data, use null. Never guess a person's name, a phone number, an email address, revenue or head count. Return a JSON array. Each item has exactly these fields:\n{\n  \"name\": \"the business name exactly as given\",\n  \"owner_name\": \"an owner, president or manager named in the search data, else null\",\n  \"owner_title\": \"their title as written in the data, else null\",\n  \"business_type\": \"the kind of business\",\n  \"vehicle_types\": \"vehicles the data says they run, else null\",\n  \"fleet_score\": a whole number 1-10 for how likely a business like this runs several vehicles that need regular service,\n  \"pain_points\": \"one short sentence on why this business may need service, using only the data, else null\",\n  \"best_services\": [\"services such a business usually needs, e.g. oil change, brakes\"],\n  \"outreach_pitch\": \"two plain sentences the shop could say to this business. Mention no price, discount, guarantee or deadline.\",\n  \"confidence\": \"high, medium or low, for how much the data supports this\"\n}`
        }, {
          role: 'user',
          content: `Deep analyze these ${city} businesses for fleet potential. Use the search data provided:\n${JSON.stringify(businesses.slice(0, 12))}`
        }],
        temperature: 0.3,
        max_tokens: 4000
      })
    }, 45000)
    if (!res.ok) return null
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '[]'
    const parsed = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
    return Array.isArray(parsed) ? parsed : null
  } catch { return null }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await getRouteShop(req, body.shopId)
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()
    const { categories } = body
    const db = getServiceClient()
    const city = await resolveSearchCity(db, auth.shopId, body.city)
    if (!city) return NextResponse.json({ error: NEEDS_CITY }, { status: 400 })
    const { data: settings, error: settingsError } = await db.from('settings').select('ai_api_key,ai_base_url,ai_model,shop_name').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) throw settingsError
    const shopName = typeof settings?.shop_name === 'string' && settings.shop_name.trim() ? settings.shop_name.trim().slice(0, 160) : 'this shop'
    const aiKey = typeof settings?.ai_api_key === 'string' ? settings.ai_api_key.trim() : ''
    if (!aiKey) return NextResponse.json({ error: 'AI is not configured for this shop' }, { status: 503 })
    const aiBase = normalizeAiBaseUrl(settings?.ai_base_url || AI_BASE_URLS.OPENROUTER)
    const aiUrl = aiBase + '/chat/completions'
    const aiModel = normalizeAiModel(settings?.ai_model, aiBase)
    const cats = Array.isArray(categories) ? categories.filter((item): item is string => typeof item === 'string').slice(0, 20) : BUSINESS_CATEGORIES
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
    const researched = await Promise.all(topBiz.map(b => deepResearchBusiness(b, city)))

    // Step 3: AI deep analysis with all gathered intel
    const analyzed = await aiDeepAnalyze(researched, city, aiKey, aiUrl, aiModel, shopName)
    if (analyzed === null) return NextResponse.json({ error: 'Alpha’s AI could not analyze the businesses just now. Try again in a few minutes.' }, { status: 502 })
    // Contact details and ratings come from the search results themselves, never from the AI. A name or email the AI
    // added that is not in the search text is dropped.
    const leads = analyzed.flatMap((row: any) => {
      const src: any = matchSource(row, researched)
      if (!src) return []
      const evidence = `${src.owner_search || ''} ${src.raw_snippets || ''}`
      return [{
        name: src.name, phone: src.phone || null, email: src.email || null, address: src.address || null, website: src.website || null,
        google_rating: src.rating ?? null, google_reviews_count: src.reviews ?? null,
        business_type: src.business_type || row.business_type || null,
        owner_name: nameFoundIn(row.owner_name, evidence), owner_title: nameFoundIn(row.owner_name, evidence) ? (row.owner_title || null) : null,
        vehicle_types: row.vehicle_types || null,
        fleet_score: scoreOf(row.fleet_score), pain_points: row.pain_points || null,
        best_services: Array.isArray(row.best_services) ? row.best_services.slice(0, 6) : [],
        outreach_pitch: row.outreach_pitch || null, confidence: ['high', 'medium', 'low'].includes(row.confidence) ? row.confidence : 'low',
      }]
    })
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
        business_type: lead.business_type || null,
        confidence: lead.fleet_score >= 7 ? 'high' : lead.fleet_score >= 4 ? 'medium' : 'low',
        owner_name: lead.owner_name || null,
        owner_title: lead.owner_title || null,
        address: lead.address || null,
        city: cityName(city),
        website: lead.website || null,
        google_rating: lead.google_rating ?? null,
        google_reviews_count: lead.google_reviews_count ?? null,
        vehicle_types: lead.vehicle_types || null,
        industry: lead.business_type || null,
        pain_points: lead.pain_points || null,
        deep_research: {
          fleet_score: lead.fleet_score,
          best_services: lead.best_services,
          outreach_pitch: lead.outreach_pitch,
          confidence: lead.confidence
        },
        research_completed_at: new Date().toISOString(),
        notes: JSON.stringify(lead),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString(),
        shop_id: auth.shopId,
      }))
      const { error } = await db.from('leads').insert(rows)
      if (error) throw error
    }

    const { error: activityError } = await db.from('growth_activity').insert({
      action: 'ai_fleet_scan',
      target: city,
      details: `Deep research: ${sorted.length} fleet leads from ${allBiz.length} businesses (${shuffled.join(', ')})`,
      status: 'complete',
      created_at: new Date().toISOString(),
      shop_id: auth.shopId,
    })
    if (activityError) throw activityError

    return NextResponse.json({ success: true, total_businesses_scanned: allBiz.length,
      total_leads: sorted.length, categories_searched: shuffled,
      all_categories: BUSINESS_CATEGORIES, leads: sorted
    })
  } catch (e) {
    console.error('AI fleet leads error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
