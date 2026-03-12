import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

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

      default:
        return fail(`Unknown action: ${action}`)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return fail(message, 500)
  }
}
