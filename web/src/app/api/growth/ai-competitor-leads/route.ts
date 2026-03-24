/**
 * AI Competitor Leads + Alpha AI Prospect Discovery
 *
 * scan_type options:
 *   "competitors"      — auto repair shops (steal their unhappy customers)
 *   "alpha_ai"         — ANY business with high call volume / vehicle fleets
 *                        (potential Alpha AI phone-answering subscribers)
 *   "both" (default)   — runs both scans
 *
 * Alpha AI target categories:
 *   Medical, Moving, Delivery, Fleet, Construction, HVAC, Plumbing, Electrical,
 *   Pest Control, Landscaping, Property Mgmt, Security, Logistics/Trucking,
 *   Towing, Car Dealerships, Roofing, Cleaning Services, Staffing, Legal, Dental,
 *   Funeral Homes, Waste Management, Food Delivery, Courier, and many more.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const SERPER_KEY = process.env.SERPER_API_KEY || ''
const AI_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'
const AI_MODEL = process.env.AI_MODEL || 'deepseek/deepseek-v3.2'

// ─── Business categories for Alpha AI prospect discovery ────────────────────
// These are business types with high call volume, vehicle fleets, or field teams
// — all great candidates for AI phone answering
const ALPHA_AI_CATEGORIES = [
  // ── Medical & Healthcare ──
  { query: 'doctor office medical clinic', industry: 'medical', label: 'Medical Clinic' },
  { query: 'dental office dentist', industry: 'dental', label: 'Dental Office' },
  { query: 'urgent care walk-in clinic', industry: 'medical', label: 'Urgent Care' },
  { query: 'chiropractor physical therapy', industry: 'medical', label: 'Chiropractic/PT' },
  { query: 'home health care agency', industry: 'healthcare', label: 'Home Healthcare' },

  // ── Trades & Field Services ──
  { query: 'HVAC heating cooling contractor', industry: 'hvac', label: 'HVAC Company' },
  { query: 'plumbing company plumber', industry: 'plumbing', label: 'Plumber' },
  { query: 'electrical contractor electrician', industry: 'electrical', label: 'Electrician' },
  { query: 'roofing company roofer contractor', industry: 'roofing', label: 'Roofing Company' },
  { query: 'pest control exterminator', industry: 'pest_control', label: 'Pest Control' },
  { query: 'landscaping lawn care company', industry: 'landscaping', label: 'Landscaping' },
  { query: 'cleaning service maid janitorial', industry: 'cleaning', label: 'Cleaning Service' },
  { query: 'general contractor construction company', industry: 'construction', label: 'Construction' },

  // ── Transportation & Fleet ──
  { query: 'moving company movers', industry: 'moving', label: 'Moving Company' },
  { query: 'towing company roadside assistance', industry: 'towing', label: 'Towing Service' },
  { query: 'trucking logistics freight company', industry: 'logistics', label: 'Trucking/Logistics' },
  { query: 'courier delivery service last mile', industry: 'delivery', label: 'Courier/Delivery' },
  { query: 'limo charter transportation service', industry: 'transport', label: 'Limo/Charter' },
  { query: 'car dealership auto dealer', industry: 'dealership', label: 'Car Dealership' },

  // ── Property & Facilities ──
  { query: 'property management company apartments', industry: 'property_mgmt', label: 'Property Management' },
  { query: 'commercial real estate company', industry: 'real_estate', label: 'Commercial Real Estate' },
  { query: 'security company guard service', industry: 'security', label: 'Security Company' },
  { query: 'waste management junk removal', industry: 'waste', label: 'Waste/Junk Removal' },

  // ── Professional Services ──
  { query: 'law firm attorney office', industry: 'legal', label: 'Law Firm' },
  { query: 'insurance agency broker', industry: 'insurance', label: 'Insurance Agency' },
  { query: 'staffing employment agency', industry: 'staffing', label: 'Staffing Agency' },
  { query: 'funeral home mortuary', industry: 'funeral', label: 'Funeral Home' },

  // ── Food & Hospitality ──
  { query: 'catering company food service', industry: 'catering', label: 'Catering' },
  { query: 'food truck mobile food vendor', industry: 'food_truck', label: 'Food Truck' },
  { query: 'restaurant high volume diner', industry: 'restaurant', label: 'Restaurant' },

  // ── Auto & Vehicle ──
  { query: 'auto body shop collision repair', industry: 'auto_body', label: 'Auto Body Shop' },
  { query: 'tire shop tire center', industry: 'auto', label: 'Tire Shop' },
  { query: 'auto glass windshield replacement', industry: 'auto', label: 'Auto Glass' },
  { query: 'detailing car wash mobile', industry: 'auto', label: 'Auto Detailing' },
  { query: 'fleet management company vehicles', industry: 'fleet', label: 'Fleet Operator' },
]

// Auto repair competitor categories (for shop-side use)
const COMPETITOR_CATEGORIES = [
  'auto repair shop',
  'mechanic shop',
  'car service center',
  'oil change shop',
  'brake shop',
  'transmission repair',
  'auto tune up',
  'engine repair shop',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function deepResearchBusiness(biz: any, industry: string) {
  const name = biz.name
  const [ownerResults, emailResults] = await Promise.all([
    searchSerper(`"${name}" owner OR manager OR contact`),
    searchSerper(`"${name}" email contact phone`),
  ])
  const emailMatch = JSON.stringify(emailResults).match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return {
    ...biz,
    industry,
    owner_search: ownerResults.slice(0, 2).map((r: any) => r.snippet).join(' | '),
    email: emailMatch ? emailMatch[0] : null,
  }
}

async function aiAnalyzeLeads(businesses: any[], city: string, isAlphaAiProspects: boolean) {
  if (!AI_KEY || !businesses.length) return []
  const systemPrompt = isAlphaAiProspects
    ? `You are a sales intelligence analyst for Alpha AI — an AI phone answering service that helps businesses never miss a call. 
Analyze these local businesses and score them as potential Alpha AI customers.
Return a JSON array where each object has ALL these fields:
{
  "name": "business name",
  "phone": "their phone",
  "email": "their email if found",
  "address": "full address",
  "city": "${city.split(' ')[0]}",
  "website": "website or null",
  "owner_name": "owner/manager name if found",
  "owner_title": "Owner/Manager/Director",
  "google_rating": rating number or null,
  "google_reviews_count": review count or null,
  "employee_count": "estimated (e.g. 5-20)",
  "industry": "their industry",
  "pain_points": "call-related pain points (missed calls, after-hours, overwhelmed staff)",
  "alpha_ai_fit_score": 1-10 (how much they need AI answering — 10=perfect fit),
  "monthly_call_volume_estimate": "estimated monthly inbound calls",
  "alpha_ai_pitch": "personalized pitch: why they need Alpha AI phone answering",
  "annual_contract_value": "estimated ARR if they sign (e.g. $1,200-$3,600/yr)",
  "confidence": "high/medium/low",
  "best_contact_time": "morning/afternoon/business_hours",
  "outreach_channel": "phone/email/both"
}
Focus on businesses with high inbound call volume, seasonal surges, or after-hours issues.`
    : `You are a competitive intelligence analyst for Alpha International Auto Center in Houston TX.
Analyze these competitor auto shops and create DEEP profiles.
Return a JSON array where each object has ALL these fields:
{
  "name": "competitor shop name",
  "phone": "their phone",
  "email": "their email if found",
  "address": "full address",
  "city": "Houston",
  "website": "website or null",
  "owner_name": "owner/manager name from search data",
  "owner_title": "Owner/Manager/President",
  "google_rating": rating number,
  "google_reviews_count": review count,
  "employee_count": "estimated (e.g. 5-15)",
  "revenue_estimate": "estimated (e.g. $500K-$1M)",
  "industry": "auto repair",
  "pain_points": "their weaknesses from reviews (wait times, pricing, quality issues)",
  "fleet_score": 1-10 (how easy to steal their customers),
  "confidence": "high/medium/low",
  "outreach_pitch": "pitch to their unhappy customers mentioning specific complaints",
  "annual_value_estimate": "potential revenue if we capture their customers",
  "review_snippet": "notable bad review quote"
}`

  try {
    const res = await fetchT(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system', content: systemPrompt
        }, {
          role: 'user',
          content: `Analyze these ${city} businesses:\\n${JSON.stringify(businesses.slice(0, 10))}`
        }],
        temperature: 0.3, max_tokens: 4000
      })
    }, 45000)
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '[]'
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
  } catch { return [] }
}

function deduplicateByName(items: any[], existingNames: Set<string>) {
  const seen = new Set<string>(existingNames)
  return items.filter(c => {
    const k = (c.name || '').toLowerCase().trim()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { city = 'Houston TX', scan_type = 'both', categories } = await req.json()
    const db = getServiceClient()

    const allLeads: any[] = []

    // ── SCAN 1: Auto repair competitors ──────────────────────────────────────
    if (scan_type === 'competitors' || scan_type === 'both') {
      const compQueries = COMPETITOR_CATEGORIES.sort(() => Math.random() - 0.5).slice(0, 4)
      const compResults = await Promise.all(compQueries.map(q => searchSerperPlaces(`${q} ${city}`)))
      let comps = compResults.flat()
      const seen = new Set<string>()
      comps = comps.filter(c => {
        const k = c.name?.toLowerCase()
        if (!k || seen.has(k) || k.includes('alpha international')) return false
        seen.add(k); return true
      }).slice(0, 8)

      if (comps.length > 0) {
        const researched = await Promise.all(comps.slice(0, 6).map(c => deepResearchBusiness(c, 'auto repair')))
        const analyzed = await aiAnalyzeLeads(researched, city, false)
        const sorted = (analyzed || []).sort((a: any, b: any) => (b.fleet_score || 0) - (a.fleet_score || 0)).slice(0, 12)

        for (const l of sorted) {
          allLeads.push({
            name: l.name || 'Unknown',
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
            city: l.city || city.split(' ')[0],
            website: l.website || null,
            google_rating: l.google_rating || null,
            google_reviews_count: l.google_reviews_count || null,
            employee_count: l.employee_count || null,
            revenue_estimate: l.revenue_estimate || null,
            industry: 'auto repair',
            pain_points: l.pain_points || null,
            deep_research: {
              review_snippet: l.review_snippet,
              fleet_score: l.fleet_score,
              outreach_pitch: l.outreach_pitch,
              annual_value_estimate: l.annual_value_estimate,
            },
            research_completed_at: new Date().toISOString(),
            notes: JSON.stringify(l),
            follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            created_at: new Date().toISOString(),
          })
        }
      }
    }

    // ── SCAN 2: Alpha AI prospects (all high-call-volume business types) ──────
    if (scan_type === 'alpha_ai' || scan_type === 'both') {
      // Pick a random mix of categories — weighted toward highest value
      const selectedCategories = categories
        ? ALPHA_AI_CATEGORIES.filter(c => categories.includes(c.industry))
        : ALPHA_AI_CATEGORIES.sort(() => Math.random() - 0.5).slice(0, 6)

      const prospectResults = await Promise.all(
        selectedCategories.map(cat => searchSerperPlaces(`${cat.query} ${city}`))
      )

      // Flatten + attach category metadata
      let allProspects: any[] = []
      selectedCategories.forEach((cat, i) => {
        const places = (prospectResults[i] || []).map((p: any) => ({ ...p, industry: cat.industry, category_label: cat.label }))
        allProspects = allProspects.concat(places)
      })

      // Deduplicate
      const existingCompNames = new Set(allLeads.map(l => (l.name || '').toLowerCase()))
      allProspects = deduplicateByName(allProspects, existingCompNames).slice(0, 20)

      if (allProspects.length > 0) {
        // Deep research top prospects
        const researched = await Promise.all(allProspects.slice(0, 8).map(c => deepResearchBusiness(c, c.industry)))
        const analyzed = await aiAnalyzeLeads(researched, city, true)
        const sorted = (analyzed || []).sort((a: any, b: any) => (b.alpha_ai_fit_score || 0) - (a.alpha_ai_fit_score || 0)).slice(0, 20)

        for (const l of sorted) {
          allLeads.push({
            name: l.name || 'Unknown',
            phone: l.phone || null,
            email: l.email || null,
            service_needed: `Alpha AI Prospect - ${l.industry || l.category_label || 'Business'}`,
            source: 'alpha-ai-prospect-scan',
            status: 'new',
            business_type: l.industry || 'business',
            confidence: l.confidence || 'medium',
            owner_name: l.owner_name || null,
            owner_title: l.owner_title || null,
            address: l.address || null,
            city: l.city || city.split(' ')[0],
            website: l.website || null,
            google_rating: l.google_rating || null,
            google_reviews_count: l.google_reviews_count || null,
            employee_count: l.employee_count || null,
            industry: l.industry || null,
            pain_points: l.pain_points || null,
            deep_research: {
              alpha_ai_fit_score: l.alpha_ai_fit_score,
              monthly_call_volume: l.monthly_call_volume_estimate,
              alpha_ai_pitch: l.alpha_ai_pitch,
              annual_contract_value: l.annual_contract_value,
              best_contact_time: l.best_contact_time,
              outreach_channel: l.outreach_channel,
            },
            research_completed_at: new Date().toISOString(),
            notes: JSON.stringify(l),
            follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
            created_at: new Date().toISOString(),
          })
        }
      }
    }

    // ── Save all leads to DB ──────────────────────────────────────────────────
    if (allLeads.length > 0) {
      await db.from('leads').insert(allLeads)
    }

    await db.from('growth_activity').insert({
      action: 'ai_lead_scan',
      target: `${city} — ${scan_type}`,
      details: `Discovered ${allLeads.length} leads (scan_type: ${scan_type})`,
      status: 'complete',
      created_at: new Date().toISOString()
    })

    return NextResponse.json({
      success: true,
      scan_type,
      total_leads: allLeads.length,
      competitor_leads: allLeads.filter(l => l.source === 'ai-competitor-scan').length,
      alpha_ai_prospects: allLeads.filter(l => l.source === 'alpha-ai-prospect-scan').length,
      available_categories: ALPHA_AI_CATEGORIES.map(c => ({ industry: c.industry, label: c.label })),
      leads: allLeads,
    })
  } catch (e) {
    console.error('AI lead scan error:', e)
    return NextResponse.json({ error: 'Failed to run lead scan' }, { status: 500 })
  }
}
