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
      rating: p.rating, website: p.website || null
    }))
  } catch { return [] }
}

async function findEmail(website: string, businessName: string) {
  if (!SERPER_KEY || !website) return null
  try {
    const res = await fetchT('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `"${businessName}" email contact`, num: 3 })
    }, 8000)
    const data = await res.json()
    const all = JSON.stringify(data.organic || [])
    const emailMatch = all.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
    return emailMatch ? emailMatch[0] : null
  } catch { return null }
}

async function aiAnalyze(businesses: any[], city: string) {
  if (!AI_KEY || !businesses.length) return businesses.map(b => ({ ...b, fleet_score: 5, outreach_pitch: 'Contact for fleet services', estimated_vehicles: '2-5', best_services: ['oil change', 'tire rotation'] }))
  try {
    const res = await fetchT(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: 'You are a fleet sales AI for Alpha International Auto Center in Houston TX. Analyze businesses and score fleet potential. Return JSON array: [{ "name": "", "phone": "", "email": "", "address": "", "business_type": "", "estimated_vehicles": "", "fleet_score": 1-10, "outreach_pitch": "", "best_services": [], "contact_person": "", "annual_value_estimate": "" }]. fleet_score 10 = most likely to need fleet services. Keep it concise.'
        }, {
          role: 'user',
          content: `Score these ${city} businesses for fleet potential:\n${JSON.stringify(businesses.slice(0, 20))}`
        }],
        temperature: 0.3, max_tokens: 2000
      })
    }, 30000)
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
    // Search 5 random categories per scan to stay within timeout
    const shuffled = [...cats].sort(() => Math.random() - 0.5).slice(0, 5)

    const results = await Promise.all(
      shuffled.map(q => searchSerperPlaces(`${q} ${city}`))
    )

    let allBiz = results.flat().map((b, i) => ({
      ...b, business_type: shuffled[Math.floor(i / 3)]
    }))
    const seen = new Set()
    allBiz = allBiz.filter(b => { const k = b.name; if (seen.has(k)) return false; seen.add(k); return true })

    // Try to find emails for top businesses
    const emailPromises = allBiz.slice(0, 5).map(b => findEmail(b.website, b.name))
    const emails = await Promise.all(emailPromises)
    allBiz.slice(0, 5).forEach((b, i) => { if (emails[i]) b.email = emails[i] })

    const leads = await aiAnalyze(allBiz, city)
    const sorted = leads.sort((a: any, b: any) => (b.fleet_score || 0) - (a.fleet_score || 0)).slice(0, 15)

    if (sorted.length > 0) {
      const rows = sorted.map((lead: any) => ({
        name: lead.name, phone: lead.phone || null,
        email: lead.email || null,
        service_needed: `Fleet - ${lead.business_type || 'General'}`,
        source: 'ai-fleet-scan', status: 'new',
        business_type: lead.business_type,
        confidence: lead.fleet_score >= 7 ? 'high' : lead.fleet_score >= 4 ? 'medium' : 'low',
        notes: JSON.stringify(lead),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      }))
      await db.from('leads').insert(rows)
    }

    await db.from('growth_activity').insert({
      action: 'ai_fleet_scan', target: city,
      details: `Found ${sorted.length} fleet leads from ${allBiz.length} businesses (${shuffled.join(', ')})`,
      status: 'complete', created_at: new Date().toISOString()
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