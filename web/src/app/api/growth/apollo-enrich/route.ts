/**
 * Multi-Source Lead Enrichment  —  replaces Apollo.io
 *
 * Priority waterfall:
 *  1. Google Maps Places API  — phone, address, hours, rating, types  (best for local SMBs)
 *  2. Hunter.io              — professional email finding  (80%+ accuracy)
 *  3. Serper / web search    — additional contact intel when the above miss
 *
 * Keys needed (set in Vercel env or settings table):
 *   GOOGLE_MAPS_API_KEY   — Google Cloud Console → Places API
 *   HUNTER_IO_API_KEY     — hunter.io → API settings
 *   SERPER_API_KEY        — already used elsewhere in the app
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY || ''
const HUNTER_KEY = process.env.HUNTER_IO_API_KEY || ''
const SERPER_KEY = process.env.SERPER_API_KEY || ''

// ─── helpers ────────────────────────────────────────────────────────────────

function extractDomain(website: string | null): string | null {
  if (!website) return null
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`)
    return url.hostname.replace('www.', '')
  } catch { return null }
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ─── Google Maps Places enrichment ──────────────────────────────────────────
// Searches by business name + optionally location, returns phone/address/rating/types
async function googleMapsEnrich(businessName: string, city = 'Houston TX') {
  if (!GOOGLE_MAPS_KEY) return null
  try {
    // Text Search (finds local business by name + location)
    const query = encodeURIComponent(`${businessName} ${city}`)
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${GOOGLE_MAPS_KEY}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    const place = data.results?.[0]
    if (!place) return null

    // Place Details (gets phone number and website)
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,formatted_phone_number,website,formatted_address,rating,user_ratings_total,business_status,types,opening_hours&key=${GOOGLE_MAPS_KEY}`
    const detailRes = await fetch(detailsUrl)
    const detailData = await detailRes.json()
    const details = detailData.result || {}

    return {
      source: 'google_maps',
      name: details.name || place.name,
      phone: details.formatted_phone_number || null,
      website: details.website || null,
      address: details.formatted_address || place.formatted_address || null,
      rating: details.rating || place.rating || null,
      review_count: details.user_ratings_total || place.user_ratings_total || null,
      business_status: details.business_status || null,
      types: details.types || place.types || [],
      place_id: place.place_id,
    }
  } catch (e) {
    console.error('Google Maps enrich error:', e)
    return null
  }
}

// ─── Hunter.io email finder ──────────────────────────────────────────────────
// Finds professional emails for a domain — returns best email + confidence score
async function hunterFindEmail(domain: string, firstName?: string, lastName?: string) {
  if (!HUNTER_KEY || !domain) return null
  try {
    // Domain search first (gets all emails for the domain)
    const domainUrl = `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${HUNTER_KEY}&limit=5`
    const res = await fetch(domainUrl)
    if (!res.ok) return null
    const data = await res.json()
    const emails = data.data?.emails || []

    // If we have a name, also try email finder for a specific person
    if (firstName && lastName) {
      const finderUrl = `https://api.hunter.io/v2/email-finder?domain=${domain}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${HUNTER_KEY}`
      const finderRes = await fetch(finderUrl)
      if (finderRes.ok) {
        const finderData = await finderRes.json()
        const found = finderData.data
        if (found?.email && found.confidence > 50) {
          return {
            source: 'hunter_finder',
            email: found.email,
            confidence: found.confidence,
            first_name: found.first_name,
            last_name: found.last_name,
            position: found.position,
            all_emails: emails.slice(0, 3),
          }
        }
      }
    }

    // Fall back to best email from domain search
    const best = emails
      .filter((e: any) => e.confidence > 50)
      .sort((a: any, b: any) => b.confidence - a.confidence)[0]

    if (!best) return null
    return {
      source: 'hunter_domain',
      email: best.value,
      confidence: best.confidence,
      first_name: best.first_name,
      last_name: best.last_name,
      position: best.position,
      all_emails: emails.slice(0, 3),
    }
  } catch (e) {
    console.error('Hunter.io enrich error:', e)
    return null
  }
}

// ─── Serper web search enrichment ───────────────────────────────────────────
// Falls back to web search to find contact info when other sources miss
async function serperEnrich(businessName: string, city = 'Houston TX') {
  if (!SERPER_KEY) return null
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_KEY },
      body: JSON.stringify({ q: `"${businessName}" ${city} contact phone email`, num: 3 })
    })
    if (!res.ok) return null
    const data = await res.json()
    const snippet = data.organic?.[0]?.snippet || ''
    const link = data.organic?.[0]?.link || null

    // Extract phone from snippet using regex
    const phoneMatch = snippet.match(/\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/)
    // Extract email from snippet using regex
    const emailMatch = snippet.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)

    return {
      source: 'serper',
      phone: phoneMatch?.[0] || null,
      email: emailMatch?.[0] || null,
      website: link,
      snippet: snippet.slice(0, 300),
    }
  } catch (e) {
    console.error('Serper enrich error:', e)
    return null
  }
}

// ─── Main enrichment logic ───────────────────────────────────────────────────

async function enrichOneLead(lead: any) {
  const domain = extractDomain(lead.website)
  const city = lead.city ? `${lead.city} ${lead.state || ''}` : 'Houston TX'

  // Run Google Maps + Serper in parallel; Hunter needs domain so runs after
  const [mapsResult, serperResult] = await Promise.all([
    googleMapsEnrich(lead.name, city),
    serperEnrich(lead.name, city),
  ])

  // Hunter needs a domain — try website domain or extract from Serper result
  const bestDomain = domain || extractDomain(serperResult?.website || '') || extractDomain(mapsResult?.website || '')
  const hunterResult = bestDomain ? await hunterFindEmail(bestDomain, lead.owner_name?.split(' ')[0], lead.owner_name?.split(' ').slice(1).join(' ')) : null

  // Compile enrichment data
  const enriched: any = {
    enriched_at: new Date().toISOString(),
    sources: [] as string[],
    contacts: [],
    organization: null,
  }

  if (mapsResult) {
    enriched.sources.push('google_maps')
    enriched.organization = {
      name: mapsResult.name,
      phone: mapsResult.phone,
      website: mapsResult.website,
      address: mapsResult.address,
      rating: mapsResult.rating,
      review_count: mapsResult.review_count,
      business_status: mapsResult.business_status,
      types: mapsResult.types,
      place_id: mapsResult.place_id,
    }
  }

  if (hunterResult) {
    enriched.sources.push(hunterResult.source)
    enriched.contacts.push({
      name: [hunterResult.first_name, hunterResult.last_name].filter(Boolean).join(' ') || null,
      email: hunterResult.email,
      title: hunterResult.position || null,
      confidence: hunterResult.confidence,
      source: hunterResult.source,
    })
  }

  if (serperResult) {
    enriched.sources.push('serper')
    if (!enriched.organization) {
      enriched.organization = {
        website: serperResult.website,
        phone: serperResult.phone,
      }
    }
  }

  // Build DB update — only fill in fields that are currently blank
  const updateData: any = {
    enrichment_data: JSON.stringify(enriched),
    enriched_at: new Date().toISOString(),
    enrichment_source: enriched.sources.join(',') || 'none',
  }

  // Phone: prefer Google Maps (most accurate for local businesses)
  if (!lead.phone) {
    updateData.phone = mapsResult?.phone || serperResult?.phone || null
  }

  // Email: prefer Hunter (verified professional email)
  if (!lead.email) {
    updateData.email = hunterResult?.email || serperResult?.email || null
  }

  // Website
  if (!lead.website) {
    updateData.website = mapsResult?.website || serperResult?.website || null
  }

  // Address
  if (!lead.address && mapsResult?.address) {
    updateData.address = mapsResult.address
  }

  // Rating info (useful for competitive analysis)
  if (mapsResult?.rating) {
    updateData.google_rating = mapsResult.rating
    updateData.google_review_count = mapsResult.review_count
  }

  // Owner name from Hunter
  const bestContact = enriched.contacts[0]
  if (!lead.owner_name && bestContact?.name) {
    updateData.owner_name = bestContact.name
    updateData.owner_title = bestContact.title || 'Decision Maker'
  }

  return { updateData, enriched }
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { lead_id, bulk_lead_ids } = await req.json()
    const db = getServiceClient()

    // ── Bulk enrichment ──────────────────────────────────────────────────
    if (bulk_lead_ids?.length) {
      if (bulk_lead_ids.length > 50) {
        return NextResponse.json({ error: 'Bulk limit is 50 leads per request to avoid rate limits' }, { status: 400 })
      }

      const { data: leadsData } = await db.from('leads').select('*').in('id', bulk_lead_ids)
      if (!leadsData?.length) return NextResponse.json({ error: 'No leads found' }, { status: 404 })

      const results = []
      for (const lead of leadsData) {
        try {
          const { updateData, enriched } = await enrichOneLead(lead)
          await db.from('leads').update(updateData).eq('id', lead.id)
          results.push({
            id: lead.id,
            name: lead.name,
            contacts_found: enriched.contacts.length,
            sources: enriched.sources,
            phone_found: !!updateData.phone,
            email_found: !!updateData.email,
          })
        } catch (e) {
          results.push({ id: lead.id, name: lead.name, error: (e as Error).message })
        }

        // Rate limiting: 1.2 s between requests to stay within API limits
        await delay(1200)
      }

      await db.from('growth_activity').insert({
        action: 'bulk_enrich',
        target: `${results.length} leads`,
        details: `Enriched via Google Maps + Hunter.io + Serper`,
        status: 'complete',
        created_at: new Date().toISOString()
      })

      return NextResponse.json({
        success: true,
        enriched: results.filter(r => !r.error).length,
        failed: results.filter(r => r.error).length,
        results,
      })
    }

    // ── Single lead enrichment ────────────────────────────────────────────
    if (lead_id) {
      const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single()
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

      const { updateData, enriched } = await enrichOneLead(lead)
      await db.from('leads').update(updateData).eq('id', lead_id)

      await db.from('growth_activity').insert({
        action: 'lead_enrich',
        target: lead.name,
        details: `Enriched via ${enriched.sources.join(', ') || 'no data found'}`,
        status: 'complete',
        created_at: new Date().toISOString()
      })

      return NextResponse.json({
        success: true,
        contacts_found: enriched.contacts.length,
        sources_used: enriched.sources,
        enrichment_data: enriched,
        updated_fields: Object.keys(updateData).filter(k => k !== 'enrichment_data' && k !== 'enriched_at'),
      })
    }

    return NextResponse.json({ error: 'Provide lead_id or bulk_lead_ids' }, { status: 400 })
  } catch (e) {
    console.error('Enrichment error:', e)
    return NextResponse.json({ error: (e as Error).message || 'Enrichment failed' }, { status: 500 })
  }
}
