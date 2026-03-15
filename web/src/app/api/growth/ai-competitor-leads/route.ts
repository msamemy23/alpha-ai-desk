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

async function getPlaceReviews(placeId: string) {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,reviews,formatted_phone_number,website,formatted_address&key=${GOOGLE_API_KEY}`
    const res = await fetch(url)
    const data = await res.json()
    return data.result || {}
  } catch { return {} }
}

async function investigatePerson(name: string, city: string) {
  if (!OPENAI_KEY) return { name, phone: null, social: null, email: null, confidence: 'low', notes: 'No AI key configured' }
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'system',
          content: `You are a lead research assistant for an auto repair shop. Given a person's name and city, search your knowledge to find likely contact info. Return JSON only: { "name": "", "likely_phone": "", "likely_email": "", "social_profiles": [], "business_connection": "", "confidence": "high|medium|low", "outreach_angle": "", "notes": "" }. The outreach_angle should be a personalized reason to reach out based on their bad review. If you can't find real info, make reasonable suggestions for how to find them (e.g. search Facebook for name+city, check Whitepages, etc).`
        }, {
          role: 'user',
          content: `Research this person who left a bad review at an auto shop competitor in ${city}: Name: ${name}. Find any public contact info, social media profiles, or business connections. Suggest the best way to reach out and offer better service.`
        }],
        temperature: 0.3,
        max_tokens: 500
      })
    })
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    const cleaned = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    return JSON.parse(cleaned)
  } catch (e) {
    return { name, phone: null, social: null, confidence: 'low', notes: 'Investigation failed' }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { city = 'Houston TX', radius = 15000 } = await req.json()
    const db = getServiceClient()

    // Step 1: Find competitor auto repair shops
    const places = await searchGooglePlaces('auto repair shop', city)
    const competitors = places.slice(0, 8)

    // Step 2: Get reviews for each competitor, find unhappy customers
    const unhappyReviewers: any[] = []
    for (const place of competitors) {
      const details = await getPlaceReviews(place.place_id)
      const reviews = details.reviews || []
      const badReviews = reviews.filter((r: any) => r.rating <= 3)
      for (const review of badReviews.slice(0, 3)) {
        unhappyReviewers.push({
          reviewer_name: review.author_name,
          review_text: review.text,
          review_rating: review.rating,
          review_time: review.relative_time_description,
          competitor_name: details.name || place.name,
          competitor_address: details.formatted_address || place.formatted_address,
          competitor_rating: details.rating || place.rating,
          profile_url: review.author_url || null,
        })
      }
    }

    // Step 3: AI investigates each unhappy reviewer to find contact info
    const leads: any[] = []
    for (const reviewer of unhappyReviewers.slice(0, 10)) {
      const investigation = await investigatePerson(reviewer.reviewer_name, city)
      leads.push({
        ...reviewer,
        investigation,
        suggested_message: `Hi ${reviewer.reviewer_name.split(' ')[0]}! We noticed you had a rough experience at ${reviewer.competitor_name}. At Alpha International Auto Center, we pride ourselves on honest, quality work. We'd love to earn your trust — mention this message for 15% off your first visit! Call us at (713) 663-6979.`
      })
    }

    // Step 4: Save leads to database
    for (const lead of leads) {
      await db.from('leads').insert({
        name: lead.reviewer_name,
        phone: lead.investigation?.likely_phone || null,
        service_needed: 'Competitor unhappy customer',
        source: 'ai-competitor-scan',
        status: 'new',
        notes: JSON.stringify({
          review_text: lead.review_text,
          review_rating: lead.review_rating,
          competitor: lead.competitor_name,
          investigation: lead.investigation,
          suggested_message: lead.suggested_message,
          profile_url: lead.profile_url
        }),
        source_detail: JSON.stringify({ competitor: lead.competitor_name, rating: lead.review_rating }),
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        created_at: new Date().toISOString()
      })
    }

    await db.from('growth_activity').insert({
      action: 'ai_competitor_scan',
      target: city,
      details: `Found ${leads.length} unhappy customers from ${competitors.length} competitors`,
      status: 'complete',
      created_at: new Date().toISOString()
    })

    return NextResponse.json({
      success: true,
      total_competitors: competitors.length,
      total_leads: leads.length,
      leads: leads.map(l => ({
        name: l.reviewer_name,
        review_rating: l.review_rating,
        review_snippet: l.review_text?.slice(0, 120),
        competitor: l.competitor_name,
        competitor_address: l.competitor_address,
        profile_url: l.profile_url,
        investigation: l.investigation,
        suggested_message: l.suggested_message
      }))
    })
  } catch (e) {
    console.error('AI competitor leads error:', e)
    return NextResponse.json({ error: 'Failed to scan competitors' }, { status: 500 })
  }
}
