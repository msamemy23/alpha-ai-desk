export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { sendEmail, estimateEmailHtml } from '@/lib/email'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(error: string, status = 400) { return NextResponse.json({ ok: false, error }, { status }) }

export async function POST(req: NextRequest) {
  const sb = getServiceClient()
  const { action, payload } = await req.json() as { action: string; payload: Record<string, unknown> }

  try {
    switch (action) {

      // ── Create Customer ──────────────────────────────────────
      case 'createCustomer': {
        const { name, phone, email, address, notes } = payload
        if (!name) return fail('Customer name is required')
        const { data, error } = await sb.from('customers').insert({
          name, phone: phone || null, email: email || null,
          address: address || null, notes: notes || null,
          created_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return ok(data)
      }

      // ── Create Job ───────────────────────────────────────────
      case 'createJob': {
        const { customer_id, customer_name, vehicle_year, vehicle_make, vehicle_model, vin, status, notes } = payload
        const { data, error } = await sb.from('jobs').insert({
          customer_id: customer_id || null,
          customer_name: customer_name || 'Walk-in',
          vehicle_year: vehicle_year || '', vehicle_make: vehicle_make || '',
          vehicle_model: vehicle_model || '', vin: vin || '',
          status: status || 'Pending', notes: notes || '',
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return ok(data)
      }

      // ── Create Invoice / Estimate ────────────────────────────
      case 'createInvoice': {
        const docType = (payload.type as string) || 'Invoice'
        const prefix = docType === 'Estimate' ? 'EST' : 'INV'
        const year = new Date().getFullYear()
        const { data: existing } = await sb.from('documents').select('doc_number').eq('type', docType).like('doc_number', `${prefix}-${year}-%`)
        const nums = (existing || []).map((d: Record<string, string>) => parseInt(d.doc_number.split('-').pop() || '0'))
        const next = Math.max(0, ...nums) + 1
        const doc_number = `${prefix}-${year}-${String(next).padStart(4, '0')}`

        const { data, error } = await sb.from('documents').insert({
          type: docType, doc_number, status: 'Draft',
          doc_date: new Date().toISOString().split('T')[0],
          customer_name: (payload.customer_name as string) || 'Customer',
          vehicle_year: payload.vehicle_year || '', vehicle_make: payload.vehicle_make || '',
          vehicle_model: payload.vehicle_model || '',
          parts: payload.parts || [], labors: payload.labors || [],
          notes: payload.notes || '', tax_rate: payload.tax_rate ?? 8.25,
          apply_tax: payload.apply_tax !== false, shop_supplies: payload.shop_supplies || 0,
          sublet: payload.sublet || 0, deposit: payload.deposit || 0,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return ok(data)
      }

      // ── Update Job Status ────────────────────────────────────
      case 'updateJobStatus': {
        const { id, status: newStatus } = payload
        if (!id || !newStatus) return fail('id and status are required')
        const { data, error } = await sb.from('jobs').update({
          status: newStatus, updated_at: new Date().toISOString(),
        }).eq('id', id).select().single()
        if (error) return fail(error.message, 500)
        return ok(data)
      }

      // ── Update Customer ──────────────────────────────────────
      case 'updateCustomer': {
        const { id, ...updates } = payload
        if (!id) return fail('Customer id is required')
        const { data, error } = await sb.from('customers').update({
          ...updates, updated_at: new Date().toISOString(),
        }).eq('id', id).select().single()
        if (error) return fail(error.message, 500)
        return ok(data)
      }

      // ── Void Document ────────────────────────────────────────
      case 'voidDocument': {
        const { id } = payload
        if (!id) return fail('Document id is required')
        const { data, error } = await sb.from('documents').update({
          status: 'Void', updated_at: new Date().toISOString(),
        }).eq('id', id).select().single()
        if (error) return fail(error.message, 500)
        return ok(data)
      }

      // ── Delete Record ────────────────────────────────────────
      case 'deleteRecord': {
        const { table, id } = payload as { table: string; id: string }
        const allowed = ['customers', 'jobs', 'documents', 'messages']
        if (!allowed.includes(table)) return fail(`Cannot delete from table: ${table}`)
        if (!id) return fail('Record id is required')
        const { error } = await sb.from(table).delete().eq('id', id)
        if (error) return fail(error.message, 500)
        return ok({ deleted: true, table, id })
      }

      // ── Schedule Follow-Up ───────────────────────────────────
      case 'scheduleFollowUp': {
        const { customer_id, customer_name, channel, scheduled_for, message_body, subject } = payload
        const { data, error } = await sb.from('scheduled_messages').insert({
          customer_id: customer_id || null,
          customer_name: customer_name || 'Customer',
          channel: channel || 'sms',
          scheduled_for: scheduled_for || new Date(Date.now() + 86400000).toISOString(),
          message_body: message_body || '',
          subject: subject || null,
          status: 'pending',
          created_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return ok(data)
      }

      // ── Get Customer History ─────────────────────────────────
      case 'getCustomerHistory': {
        const { customer_id, customer_name } = payload
        let jobs: unknown[] = []
        let docs: unknown[] = []
        let msgs: unknown[] = []

        if (customer_id) {
          const [jRes, dRes, mRes] = await Promise.all([
            sb.from('jobs').select('*').eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(20),
            sb.from('documents').select('*').eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(20),
            sb.from('messages').select('*').eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(20),
          ])
          jobs = jRes.data || []
          docs = dRes.data || []
          msgs = mRes.data || []
        } else if (customer_name) {
          const name = customer_name as string
          const [jRes, dRes] = await Promise.all([
            sb.from('jobs').select('*').ilike('customer_name', `%${name}%`).order('created_at', { ascending: false }).limit(20),
            sb.from('documents').select('*').ilike('customer_name', `%${name}%`).order('created_at', { ascending: false }).limit(20),
          ])
          jobs = jRes.data || []
          docs = dRes.data || []
        }
        return ok({ jobs, documents: docs, messages: msgs })
      }




            // -- Search Customers (FULL SYSTEM SEARCH) -------------------------
      case 'searchCustomers': {
        const { query } = payload
        if (!query) return fail('Search query is required')
        const q = (query as string).trim()

        // Search customers + jobs in parallel
        const [custRes, jobsRes, docsRes, msgsRes] = await Promise.all([
          sb.from('customers').select('*').or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,address.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
          sb.from('jobs').select('*').or(`customer_name.ilike.%${q}%,notes.ilike.%${q}%,vin.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
          sb.from('documents').select('*').or(`customer_name.ilike.%${q}%,doc_number.ilike.%${q}%,notes.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
          sb.from('messages').select('*').or(`body.ilike.%${q}%,from_address.ilike.%${q}%,to_address.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
        ])

        // Enrich customers with their jobs/vehicle info
        const customers = custRes.data || []
        const allJobs = jobsRes.data || []
        const enriched = customers.map((c: Record<string, unknown>) => {
          const custJobs = allJobs.filter((j: Record<string, unknown>) => {
            const cName = (c.name as string || '').toLowerCase()
            const jName = (j.customer_name as string || '').toLowerCase()
            return j.customer_id === c.id || jName.includes(cName) || cName.includes(jName)
          })
          const vehicles = custJobs.map((j: Record<string, unknown>) => ({
            year: j.vehicle_year, make: j.vehicle_make, model: j.vehicle_model, vin: j.vin
          })).filter((v: Record<string, unknown>) => v.year || v.make || v.model)
          const uniqueVehicles = vehicles.filter((v: Record<string, unknown>, i: number, arr: Record<string, unknown>[]) =>
            arr.findIndex((u: Record<string, unknown>) => u.year === v.year && u.make === v.make && u.model === v.model) === i
          )
          return { ...c, vehicles: uniqueVehicles, recent_jobs: custJobs.slice(0, 5) }
        })

        // Also find customers referenced in jobs but not in customers table
        const custNames = new Set(customers.map((c: Record<string, unknown>) => (c.name as string || '').toLowerCase()))
        const jobOnlyCustomers = allJobs
          .filter((j: Record<string, unknown>) => {
            const jName = (j.customer_name as string || '').toLowerCase()
            return !custNames.has(jName) && ![...custNames].some(cn => jName.includes(cn) || cn.includes(jName))
          })
          .reduce((acc: Record<string, Record<string, unknown>>, j: Record<string, unknown>) => {
            const name = j.customer_name as string || ''
            if (!acc[name]) acc[name] = { name, source: 'jobs', vehicles: [], recent_jobs: [] }
            const v = { year: j.vehicle_year, make: j.vehicle_make, model: j.vehicle_model, vin: j.vin };
            if (v.year || v.make || v.model) (acc[name].vehicles as unknown[]).push(v);
            (acc[name].recent_jobs as unknown[]).push(j)
            return acc
          }, {} as Record<string, Record<string, unknown>>)

        return ok({
          customers: [...enriched, ...Object.values(jobOnlyCustomers)],
          documents: docsRes.data || [],
          jobs: allJobs,
          messages: msgsRes.data || [],
          search_query: q,
          total_results: enriched.length + Object.keys(jobOnlyCustomers).length
        })
      }
      // ── Get Shop Stats ───────────────────────────────────────
      case 'getShopStats': {
        const today = new Date().toISOString().split('T')[0]
        const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

        const [jobsRes, docsRes, msgsRes, custRes] = await Promise.all([
          sb.from('jobs').select('*').gte('created_at', weekAgo),
          sb.from('documents').select('*').gte('created_at', weekAgo),
          sb.from('messages').select('*', { count: 'exact', head: true }).eq('read', false).eq('direction', 'inbound'),
          sb.from('customers').select('*', { count: 'exact', head: true }),
        ])

        const jobs = jobsRes.data || []
        const docs = docsRes.data || []

        return ok({
          today,
          totalCustomers: custRes.count || 0,
          unreadMessages: msgsRes.count || 0,
          jobsThisWeek: jobs.length,
          jobsByStatus: jobs.reduce((acc: Record<string, number>, j: Record<string, unknown>) => {
            const s = (j.status as string) || 'Unknown'
            acc[s] = (acc[s] || 0) + 1
            return acc
          }, {}),
          documentsThisWeek: docs.length,
          docsByType: docs.reduce((acc: Record<string, number>, d: Record<string, unknown>) => {
            const t = (d.type as string) || 'Unknown'
            acc[t] = (acc[t] || 0) + 1
            return acc
          }, {}),
        })
      }

      // ── Search Web (proxy to ai-search) ─────────────────────
      case 'searchWeb': {
        const query = payload.query as string
        if (!query) return fail('Search query is required')
        const baseUrl = req.nextUrl.origin
        const res = await fetch(`${baseUrl}/api/ai-search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        return ok(data)
      }

      // ── Send Estimate/Invoice via Email ────────────────────
      case 'sendEstimateEmail': {
        const { doc_number, customer_name, customer_id, email: overrideEmail } = payload
        // Find the document
        let docQuery = sb.from('documents').select('*')
        if (doc_number) docQuery = docQuery.eq('doc_number', doc_number)
        else if (customer_name) docQuery = docQuery.ilike('customer_name', `%${customer_name}%`).order('created_at', { ascending: false }).limit(1)
        else if (customer_id) docQuery = docQuery.eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(1)
        else return fail('Provide doc_number, customer_name, or customer_id')

        const { data: docs } = await docQuery
        const doc = docs?.[0]
        if (!doc) return fail('Document not found')

        // Find customer email
        let toEmail = overrideEmail as string | undefined
        if (!toEmail && doc.customer_id) {
          const { data: cust } = await sb.from('customers').select('email').eq('id', doc.customer_id).single()
          toEmail = cust?.email
        }
        if (!toEmail) return fail('No email on file for this customer. Ask the user to add an email first.')

        // Get settings for email template
        const { data: settings } = await sb.from('settings').select('*').limit(1).single()
        const html = estimateEmailHtml(doc, settings || {})
        const fromEmail = settings?.from_email || 'Alpha Auto <onboarding@resend.dev>'
        const shopName = settings?.shop_name || 'Alpha International Auto Center'

        await sendEmail({
          to: toEmail,
          subject: `${doc.type} #${doc.doc_number} from ${shopName}`,
          html,
          replyTo: settings?.shop_email,
          apiKey: settings?.resend_api_key,
          from: fromEmail,
        })

        // Log the message
        await sb.from('messages').insert({
          direction: 'outbound', channel: 'email',
          from_address: fromEmail,
          to_address: toEmail,
          subject: `${doc.type} #${doc.doc_number}`,
          body: `${doc.type} #${doc.doc_number} sent via AI`,
          document_id: doc.id,
          customer_id: doc.customer_id,
          status: 'sent', read: true,
        })

        // Mark doc as sent
        await sb.from('documents').update({ sent_at: new Date().toISOString() }).eq('id', doc.id)

        return ok({ sent: true, to: toEmail, doc_number: doc.doc_number, type: doc.type })
      }

      default:
        return fail(`Unknown action: ${action}`)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return fail(message, 500)
  }
}
