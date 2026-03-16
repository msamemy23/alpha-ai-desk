import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase-service'

const APOLLO_API_KEY = process.env.APOLLO_API_KEY || ''

async function apolloOrgSearch(name: string, domain?: string) {
  if (!APOLLO_API_KEY) return null
  try {
    const body: any = { api_key: APOLLO_API_KEY }
    if (domain) {
      body.organization_domains = [domain]
    } else {
      body.organization_name = name
      body.organization_locations = ['Houston, Texas, United States']
    }
    const res = await fetch('https://api.apollo.io/api/v1/mixed_people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        page: 1,
        per_page: 5,
        person_titles: ['owner', 'manager', 'general manager', 'president', 'ceo', 'founder', 'director of operations', 'fleet manager', 'operations manager'],
      })
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function apolloEnrichPerson(email?: string, firstName?: string, lastName?: string, domain?: string) {
  if (!APOLLO_API_KEY) return null
  try {
    const body: any = { api_key: APOLLO_API_KEY, reveal_personal_emails: true, reveal_phone_number: true }
    if (email) body.email = email
    if (firstName) body.first_name = firstName
    if (lastName) body.last_name = lastName
    if (domain) body.organization_name = domain
    const res = await fetch('https://api.apollo.io/api/v1/people/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) return null
    return await res.json()
  } catch { return null }
}

async function apolloOrgEnrich(domain: string) {
  if (!APOLLO_API_KEY || !domain) return null
  try {
    const res = await fetch('https://api.apollo.io/api/v1/organizations/enrich', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    // Use the search endpoint instead for better results
    const searchRes = await fetch('https://api.apollo.io/api/v1/mixed_companies/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: APOLLO_API_KEY,
        organization_domains: [domain],
        page: 1,
        per_page: 1
      })
    })
    if (!searchRes.ok) return null
    return await searchRes.json()
  } catch { return null }
}

function extractDomain(website: string | null): string | null {
  if (!website) return null
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`)
    return url.hostname.replace('www.', '')
  } catch { return null }
}

export async function POST(req: NextRequest) {
  try {
    const { lead_id, lead_name, lead_website, lead_domain, bulk_lead_ids } = await req.json()
    const db = getServiceClient()

    // Bulk enrichment mode
    if (bulk_lead_ids?.length) {
      const { data: leadsData } = await db.from('leads').select('*').in('id', bulk_lead_ids)
      if (!leadsData?.length) return NextResponse.json({ error: 'No leads found' }, { status: 404 })

      const results = []
      for (const lead of leadsData) {
        const domain = extractDomain(lead.website) || lead_domain
        const searchResult = await apolloOrgSearch(lead.name, domain || undefined)
        const people = searchResult?.people || []

        let apollo_data: any = {
          enriched_at: new Date().toISOString(),
          people_found: people.length,
          contacts: people.slice(0, 5).map((p: any) => ({
            name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
            title: p.title || null,
            email: p.email || null,
            phone: p.phone_numbers?.[0]?.sanitized_number || p.phone_number?.sanitized_number || null,
            linkedin: p.linkedin_url || null,
            city: p.city || null,
            state: p.state || null,
            seniority: p.seniority || null,
            departments: p.departments || [],
          })),
          organization: searchResult?.organizations?.[0] ? {
            name: searchResult.organizations[0].name,
            website: searchResult.organizations[0].website_url,
            phone: searchResult.organizations[0].phone,
            industry: searchResult.organizations[0].industry,
            employee_count: searchResult.organizations[0].estimated_num_employees,
            revenue: searchResult.organizations[0].annual_revenue_printed,
            founded_year: searchResult.organizations[0].founded_year,
            linkedin: searchResult.organizations[0].linkedin_url,
            logo: searchResult.organizations[0].logo_url,
            city: searchResult.organizations[0].city,
            state: searchResult.organizations[0].state,
            keywords: searchResult.organizations[0].keywords || [],
          } : null
        }

        // Get best contact info
        const bestContact = people[0]
        const updateData: any = {
          apollo_data: JSON.stringify(apollo_data),
          apollo_enriched_at: new Date().toISOString(),
        }

        if (bestContact) {
          if (!lead.email && bestContact.email) updateData.email = bestContact.email
          if (!lead.phone && (bestContact.phone_numbers?.[0]?.sanitized_number || bestContact.phone_number?.sanitized_number)) {
            updateData.phone = bestContact.phone_numbers?.[0]?.sanitized_number || bestContact.phone_number?.sanitized_number
          }
          if (!lead.owner_name && bestContact.first_name) {
            updateData.owner_name = `${bestContact.first_name} ${bestContact.last_name || ''}`.trim()
            updateData.owner_title = bestContact.title || 'Decision Maker'
          }
          if (!lead.linkedin_url && bestContact.linkedin_url) {
            updateData.linkedin_url = bestContact.linkedin_url
          }
        }

        if (apollo_data.organization) {
          if (!lead.employee_count && apollo_data.organization.employee_count) {
            updateData.employee_count = String(apollo_data.organization.employee_count)
          }
          if (!lead.revenue_estimate && apollo_data.organization.revenue) {
            updateData.revenue_estimate = apollo_data.organization.revenue
          }
        }

        await db.from('leads').update(updateData).eq('id', lead.id)
        results.push({ id: lead.id, name: lead.name, contacts_found: people.length })

        // Rate limit: small delay between requests
        await new Promise(r => setTimeout(r, 300))
      }

      return NextResponse.json({ success: true, enriched: results.length, results })
    }

    // Single lead enrichment
    if (lead_id) {
      const { data: lead } = await db.from('leads').select('*').eq('id', lead_id).single()
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

      const domain = extractDomain(lead.website) || lead_domain
      const searchResult = await apolloOrgSearch(lead.name || lead_name, domain || undefined)
      const people = searchResult?.people || []

      let apollo_data: any = {
        enriched_at: new Date().toISOString(),
        people_found: people.length,
        contacts: people.slice(0, 5).map((p: any) => ({
          name: `${p.first_name || ''} ${p.last_name || ''}`.trim(),
          title: p.title || null,
          email: p.email || null,
          phone: p.phone_numbers?.[0]?.sanitized_number || p.phone_number?.sanitized_number || null,
          linkedin: p.linkedin_url || null,
          city: p.city || null,
          state: p.state || null,
          seniority: p.seniority || null,
          departments: p.departments || [],
        })),
        organization: searchResult?.organizations?.[0] ? {
          name: searchResult.organizations[0].name,
          website: searchResult.organizations[0].website_url,
          phone: searchResult.organizations[0].phone,
          industry: searchResult.organizations[0].industry,
          employee_count: searchResult.organizations[0].estimated_num_employees,
          revenue: searchResult.organizations[0].annual_revenue_printed,
          founded_year: searchResult.organizations[0].founded_year,
          linkedin: searchResult.organizations[0].linkedin_url,
          logo: searchResult.organizations[0].logo_url,
          keywords: searchResult.organizations[0].keywords || [],
        } : null
      }

      const bestContact = people[0]
      const updateData: any = {
        apollo_data: JSON.stringify(apollo_data),
        apollo_enriched_at: new Date().toISOString(),
      }

      if (bestContact) {
        if (!lead.email && bestContact.email) updateData.email = bestContact.email
        if (!lead.phone && (bestContact.phone_numbers?.[0]?.sanitized_number || bestContact.phone_number?.sanitized_number)) {
          updateData.phone = bestContact.phone_numbers?.[0]?.sanitized_number || bestContact.phone_number?.sanitized_number
        }
        if (!lead.owner_name && bestContact.first_name) {
          updateData.owner_name = `${bestContact.first_name} ${bestContact.last_name || ''}`.trim()
          updateData.owner_title = bestContact.title || 'Decision Maker'
        }
        if (!lead.linkedin_url && bestContact.linkedin_url) {
          updateData.linkedin_url = bestContact.linkedin_url
        }
      }

      if (apollo_data.organization) {
        if (!lead.employee_count && apollo_data.organization.employee_count) {
          updateData.employee_count = String(apollo_data.organization.employee_count)
        }
        if (!lead.revenue_estimate && apollo_data.organization.revenue) {
          updateData.revenue_estimate = apollo_data.organization.revenue
        }
      }

      await db.from('leads').update(updateData).eq('id', lead_id)

      await db.from('growth_activity').insert({
        action: 'apollo_enrich',
        target: lead.name,
        details: `Found ${people.length} contacts via Apollo.io`,
        status: 'complete',
        created_at: new Date().toISOString()
      })

      return NextResponse.json({
        success: true,
        contacts_found: people.length,
        apollo_data,
        updated_fields: Object.keys(updateData).filter(k => k !== 'apollo_data' && k !== 'apollo_enriched_at')
      })
    }

    return NextResponse.json({ error: 'Provide lead_id or bulk_lead_ids' }, { status: 400 })
  } catch (e) {
    console.error('Apollo enrich error:', e)
    return NextResponse.json({ error: 'Enrichment failed' }, { status: 500 })
  }
}