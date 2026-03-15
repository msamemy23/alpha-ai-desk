import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const GOOGLE_API_KEY = process.env.GOOGLE_PLACES_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_API_KEY || ''
const OPENAI_KEY = process.env.OPENAI_API_KEY || ''

async function searchGooglePlaces(query: string, location: string) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query + ' ' + location)}&key=${GOOGLE_API_KEY}`
    const res = await fetch(url)
    const data = await res.json()
    return data.results || []
  } catch { return [] }
}

async function getPlaceDetails(placeId: string) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,website,formatted_address,types,business_status,opening_hours&key=${GOOGLE_API_KEY}`
    const res = await fetch(url)
    const data = await res.json()
    return data.result || {}
  } catch { return {} }
}

async function aiAnalyzeFleetBusinesses(businesses: any[], city: string) {
  if (!OPENAI_KEY) return businesses.map(b => ({ ...b, fleet_score: 5, estimated_vehicles: 'Unknown', outreach_pitch: 'Contact for fleet services' }))
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `You are a fleet sales AI for Alpha International Auto Center in Houston TX. Analyze these local businesses and estimate their fleet size, vehicle types, and create a personalized outreach pitch. Return JSON array: [{ "name": "", "phone": "", "address": "", "website": "", "business_type": "", "estimated_vehicles": "", "vehicle_types": "", "fleet_score": 1-10, "decision_maker_title": "", "outreach_pitch": "", "best_services": [], "annual_value_estimate": "" }]. fleet_score is 1-10 where 10 = most likely to need fleet auto services. outreach_pitch should be personalized to their business type. best_services are what they'd likely need (oil changes, brake service, fleet inspections, etc).`
        }, {
          role: 'user',
          content: `Analyze these ${city} businesses for fleet auto service potential:\n\n${JSON.stringify(businesses.slice(0, 20))}`
        }],
        temperature: 0.3,
        max_tokens: 2000
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

    // Step 1: Search for businesses that likely have vehicle fleets
    const fleetQueries = [
      'plumbing company',
      'electrical contractor',
      'HVAC company',
      'landscaping company',
      'delivery service',
      'pest control',
      'roofing company',
      'cleaning service',
      'construction company',
      'towing company'
    ]

    let allBusinesses: any[] = []
    for (const query of fleetQueries.slice(0, 6)) {
      const places = await searchGooglePlaces(query, city)
      for (const place of places.slice(0, 3)) {
        const details = await getPlaceDetails(place.place_id)
        allBusinesses.push({
          name: details.name || place.name,
          phone: details.formatted_phone_number || null,
          address: details.formatted_address || place.formatted_address,
          website: details.website || null,
          rating: place.rating,
          business_type: query,
          place_id: place.place_id
        })
      }
    }

    // Remove duplicates
    const seen = new Set()
    allBusinesses = allBusinesses.filter(b => {
      const key = b.name + b.address
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Step 2: AI analyzes and scores fleet potential
    const analyzedLeads = await aiAnalyzeFleetBusinesses(allBusinesses, city)

    // Sort by fleet score (highest first)
    const sortedLeads = analyzedLeads.sort((a: any, b: any) => (b.fleet_score || 0) - (a.fleet_score || 0))

    // Step 3: Save top leads to database
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
          website: lead.website,
          address: lead.address
        }),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      })
    }

    await db.from('growth_activity').insert({
      action: 'ai_fleet_scan',
      target: city,
      details: `Found ${sortedLeads.length} fleet leads from ${allBusinesses.length} businesses`,
      status: 'complete',
      created_at: new Date().toISOString()
    })

    return NextResponse.json({
      success: true,
      total_businesses_scanned: allBusinesses.length,
      total_leads: sortedLeads.length,
      leads: sortedLeads.slice(0, 15)
    })
  } catch (e) {
    console.error('AI fleet leads error:', e)
    return NextResponse.json({ error: 'Failed to scan fleet businesses' }, { status: 500 })
  }
}
