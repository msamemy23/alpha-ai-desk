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
      body: JSON.stringify({ q: query, num: 5 })
    })
    const data = await res.json()
    return (data.places || []).slice(0, 3).map((p: any) => ({
      name: p.title, address: p.address, phone: p.phoneNumber || null,
      rating: p.rating, website: p.website || null
    }))
  } catch { return [] }
}

async function aiAnalyze(businesses: any[], city: string) {
  if (!AI_KEY || !businesses.length) return businesses.map(b => ({ ...b, fleet_score: 5, outreach_pitch: 'Contact for fleet services' }))
  try {
    const res = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{
          role: 'system',
          content: 'You are a fleet sales AI for Alpha International Auto Center in Houston TX. Analyze businesses and score fleet potential. Return JSON array: [{ "name": "", "phone": "", "address": "", "business_type": "", "estimated_vehicles": "", "fleet_score": 1-10, "outreach_pitch": "", "best_services": [] }]. fleet_score 10 = most likely to need fleet services. Keep it concise.'
        }, {
          role: 'user',
          content: `Score these ${city} businesses for fleet potential:\n${JSON.stringify(businesses)}`
        }],
        temperature: 0.3, max_tokens: 1500
      })
    })
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '[]'
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim())
  } catch { return [] }
}

export async function POST(req: NextRequest) {
  try {
    const { city = 'Houston TX' } = await req.json()
    const db = getServiceClient()
    const queries = ['plumbing company', 'HVAC company', 'landscaping company', 'pest control']
    const results = await Promise.all(queries.map(q => searchSerperPlaces(`${q} ${city}`)))
    let allBiz = results.flat().map((b, i) => ({ ...b, business_type: queries[Math.floor(i / 3)] }))
    const seen = new Set()
    allBiz = allBiz.filter(b => { const k = b.name; if (seen.has(k)) return false; seen.add(k); return true })
    const leads = await aiAnalyze(allBiz, city)
    const sorted = leads.sort((a: any, b: any) => (b.fleet_score || 0) - (a.fleet_score || 0)).slice(0, 10)
    for (const lead of sorted) {
      await db.from('leads').insert({
        name: lead.name, phone: lead.phone || null,
        service_needed: `Fleet - ${lead.business_type || 'General'}`,
        source: 'ai-fleet-scan', status: 'new',
        notes: JSON.stringify(lead),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      })
    }
    await db.from('growth_activity').insert({
      action: 'ai_fleet_scan', target: city,
      details: `Found ${sorted.length} fleet leads from ${allBiz.length} businesses`,
      status: 'complete', created_at: new Date().toISOString()
    })
    return NextResponse.json({ success: true, total_businesses_scanned: allBiz.length, total_leads: sorted.length, leads: sorted })
  } catch (e) {
    console.error('AI fleet leads error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}