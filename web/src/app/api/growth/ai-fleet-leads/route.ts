import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const SERPER_KEY = process.env.SERPER_API_KEY || ''
const AI_KEY = process.env.OPENROUTER_API_KEY || ''
const AI_URL = 'https://openrouter.ai/api/v1/chat/completions'
const AI_MODEL = process.env.AI_MODEL || 'google/gemini-2.0-flash-001'

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
      category: p.category || ''
    }))
  } catch { return [] }
}

async function aiAnalyzeFleetBusinesses(businesses: any[], city: string) {
  if (!AI_KEY) return businesses.map(b => ({ ...b, fleet_score: 5, estimated_vehicles: 'Unknown', outreach_pitch: 'Contact for fleet services' }))
  try {
    const res = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: `You are a fleet sales AI for Alpha International Auto Center in Houston TX. Analyze these local businesses and estimate their fleet size, vehicle types, and create a personalized outreach pitch. Return JSON array: [{ "name": "", "phone": "", "address": "", "website": "", "business_type": "", "estimated_vehicles": "", "vehicle_types": "", "fleet_score": 1-10, "decision_maker_title": "", "outreach_pitch": "", "best_services": [], "annual_value_estimate": "" }]. fleet_score is 1-10 where 10 = most likely to need fleet auto services. outreach_pitch should be personalized to their business type. best_services are what they'd likely need (oil changes, brake service, fleet inspections, etc).`
        }, {
          role: 'user',
          content: `Analyze these ${city} businesses for fleet auto service potential:\n\n${JSON.stringify(businesses.slice(0, 20))}`
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

    const fleetQueries = [
      'plumbing company', 'electrical contractor', 'HVAC company',
      'landscaping company', 'delivery service', 'pest control',
      'roofing company', 'cleaning service', 'construction company', 'towing company'
    ]

    let allBusinesses: any[] = []
    for (const query of fleetQueries.slice(0, 6)) {
      const places = await searchSerperPlaces(`${query} ${city}`)
      allBusinesses.push(...places.slice(0, 5).map(p => ({ ...p, business_type: query })))
    }

    const seen = new Set()
    allBusinesses = allBusinesses.filter(b => {
      const key = b.name + b.address
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const analyzedLeads = await aiAnalyzeFleetBusinesses(allBusinesses, city)
    const sortedLeads = analyzedLeads.sort((a: any, b: any) => (b.fleet_score || 0) - (a.fleet_score || 0))

    for (const lead of sortedLeads.slice(0, 15)) {
      await db.from('leads').insert({
        name: lead.name,
        phone: lead.phone || null,
        service_needed: `Fleet services - ${lead.business_type || 'General'}`,
        source: 'ai-fleet-scan',
        status: 'new',
        notes: JSON.stringify({
          business_type: lead.business_type,
          estimated_vehicles: lead.estimated_vehicles,
          vehicle_types: lead.vehicle_types,
          fleet_score: lead.fleet_score,
          decision_maker_title: lead.decision_maker_title,
          outreach_pitch: lead.outreach_pitch,
          best_services: lead.best_services,
          annual_value_estimate: lead.annual_value_estimate,
          website: lead.website, address: lead.address
        }),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      })
    }

    await db.from('growth_activity').insert({
      action: 'ai_fleet_scan', target: city,
      details: `Found ${sortedLeads.length} fleet leads from ${allBusinesses.length} businesses`,
      status: 'complete', created_at: new Date().toISOString()
    })

    return NextResponse.json({
      success: true, total_businesses_scanned: allBusinesses.length,
      total_leads: sortedLeads.length,
      leads: sortedLeads.slice(0, 15)
    })
  } catch (e) {
    console.error('AI fleet leads error:', e)
    return NextResponse.json({ error: 'Failed to scan fleet businesses' }, { status: 500 })
  }
}