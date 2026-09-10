export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, hasInternalApiSecret, unauthorized } from '@/lib/api-auth'
import { sendEmail, estimateEmailHtml } from '@/lib/email'
import { getIdempotencyKey } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'

function ok(data: unknown) { return NextResponse.json({ ok: true, data }) }
function fail(error: string, status = 400) { return NextResponse.json({ ok: false, error }, { status }) }

const mutatingActions = new Set([
  'createCustomer', 'createJob', 'createInvoice', 'updateJobStatus', 'updateCustomer',
  'voidDocument', 'deleteRecord', 'scheduleFollowUp', 'sendEstimateEmail',
  'convertEstimateToInvoice', 'addStaff', 'removeStaff', 'updateDocument',
  'createAppointment', 'deleteAppointment', 'updateAppointment', 'updateInventory',
])
const aiActionIdempotency = new Map<string, { createdAt: number; data: unknown }>()

function safeSearchTerm(value: unknown, maxLength = 120): string {
  return String(value ?? '').replace(/[%,().*]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function pickFields(payload: Record<string, unknown>, allowed: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(payload, key)).map((key) => [key, payload[key]]))
}

function rememberAiAction(key: string, data: unknown) {
  const now = Date.now()
  for (const [existingKey, value] of aiActionIdempotency) {
    if (now - value.createdAt > 10 * 60_000) aiActionIdempotency.delete(existingKey)
  }
  aiActionIdempotency.set(key, { createdAt: now, data })
}

export async function POST(req: NextRequest) {
  const sb = getServiceClient()
  const body = await req.json().catch(() => null) as { action?: unknown; payload?: unknown; shopId?: unknown } | null
  const sessionAuth = await getAuthedShop()
  const internal = hasInternalApiSecret(req)
  let caller = sessionAuth

  // Background/mobile callers may use the deployment secret, but they must
  // name a real shop profile. A caller can never select a shop by id alone.
  if (!caller && internal) {
    const requestedShopId = typeof body?.shopId === 'string' ? body.shopId : ''
    if (!requestedShopId) return fail('shopId is required for internal calls', 400)
    const { data: profile } = await sb.from('shop_profiles').select('id,user_id').eq('id', requestedShopId).maybeSingle()
    if (!profile) return fail('Shop not found', 404)
    caller = { userId: String(profile.user_id), shopId: String(profile.id) }
  }
  if (!caller) return unauthorized()

  const shopId = caller.shopId
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const limited = checkRateLimit(rateLimitKey('ai-action', caller.userId, caller.shopId, ip), 120, 60_000)
  if (!limited.ok) return fail('Too many AI action requests', 429)

  const action = typeof body?.action === 'string' ? body.action : ''
  if (!action) return fail('Action is required')
  const payload = body?.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload as Record<string, unknown> : {}
  const safePayload = payload
  if (JSON.stringify(safePayload).length > 20000) return fail('Action payload is too large', 413)
  const idempotencyKey = getIdempotencyKey(req, [shopId, action, JSON.stringify(safePayload).slice(0, 500)])
  const isMutation = mutatingActions.has(action)
  if (isMutation && req.headers.get('x-ai-approval') !== 'confirm') {
    return NextResponse.json({
      ok: false,
      error: 'Explicit confirmation is required before changing shop data or sending anything',
      approvalRequired: true,
      action,
      payload: safePayload,
    }, { status: 409 })
  }
  const existing = isMutation ? aiActionIdempotency.get(idempotencyKey) : undefined
  if (existing) return ok(existing.data)

  const auditedOk = async (data: unknown, targetType?: string, targetId?: string) => {
    if (isMutation) {
      rememberAiAction(idempotencyKey, data)
      await writeAuditLog({
        shopId,
        userId: caller.userId,
        action: `ai.${action}`,
        targetType,
        targetId,
        permission: action.toLowerCase().includes('delete') || action.toLowerCase().includes('void') ? 'destructive' : 'write',
        approved: true,
        idempotencyKey,
        metadata: { payload: safePayload },
      })
    }
    return ok(data)
  }

  try {
    switch (action) {

      // ── Create Customer ──────────────────────────────────────
      case 'createCustomer': {
        const { name, phone, email, address, notes } = payload
        if (!name) return fail('Customer name is required')
        const { data, error } = await sb.from('customers').insert({
          name, phone: phone || null, email: email || null,
          address: address || null, notes: notes || null,
          shop_id: shopId,
          created_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'customer', data?.id)
      }

      // ── Create Job ───────────────────────────────────────────
      case 'createJob': {
        const { customer_id, customer_name, vehicle_year, vehicle_make, vehicle_model, vin, status, notes } = payload
        if (customer_id) {
          const { data: customer, error: customerError } = await sb.from('customers').select('id').eq('id', customer_id).eq('shop_id', shopId).maybeSingle()
          if (customerError) return fail(customerError.message, 500)
          if (!customer) return fail('Customer not found in this shop', 404)
        }
        const { data, error } = await sb.from('jobs').insert({
          customer_id: customer_id || null,
          customer_name: customer_name || 'Walk-in',
          vehicle_year: vehicle_year || '', vehicle_make: vehicle_make || '',
          vehicle_model: vehicle_model || '', vehicle_vin: vin || '',
           status: status || 'Pending', customer_notes: notes || '',
          shop_id: shopId,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'job', data?.id)
      }

      // ── Create Invoice / Estimate ────────────────────────────
      case 'createInvoice': {
        const docType = (payload.type as string) || 'Invoice'
        if (!['Invoice', 'Estimate', 'Receipt'].includes(docType)) return fail('Document type must be Invoice, Estimate, or Receipt')
        if (payload.customer_id) {
          const { data: customer, error: customerError } = await sb.from('customers').select('id').eq('id', payload.customer_id).eq('shop_id', shopId).maybeSingle()
          if (customerError) return fail(customerError.message, 500)
          if (!customer) return fail('Customer not found in this shop', 404)
        }
        const { data: doc_number, error: numberingError } = await sb.rpc('next_document_number', { p_shop_id: shopId, p_type: docType })
        if (numberingError || typeof doc_number !== 'string') return fail('Document numbering failed', 500)

        const { data, error } = await sb.from('documents').insert({
          type: docType, doc_number, shop_id: shopId, status: 'Draft',
          doc_date: new Date().toISOString().split('T')[0],
          customer_name: (payload.customer_name as string) || 'Customer',
          customer_id: payload.customer_id || null,
          customer_phone: payload.customer_phone || null,
          customer_email: payload.customer_email || null,
          vehicle_year: payload.vehicle_year || '', vehicle_make: payload.vehicle_make || '',
          vehicle_model: payload.vehicle_model || '',
          parts: payload.parts || [], labors: payload.labors || [],
          notes: payload.notes || '', tax_rate: payload.tax_rate ?? 8.25,
          apply_tax: payload.apply_tax !== false, shop_supplies: payload.shop_supplies || 0,
          sublet: payload.sublet || 0, deposit: payload.deposit || 0,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'document', data?.id)
      }

      // ── Update Job Status ────────────────────────────────────
      case 'updateJobStatus': {
        const { id, status: newStatus } = payload
        if (!id || !newStatus) return fail('id and status are required')
        const { data, error } = await sb.from('jobs').update({
          status: newStatus, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'job', String(id))
      }

      // ── Update Customer ──────────────────────────────────────
      case 'updateCustomer': {
         const { id } = payload
         if (!id) return fail('Customer id is required')
         const updates = pickFields(payload, ['name','phone','email','address','preferred_contact','vehicle_year','vehicle_make','vehicle_model','vehicle_vin','vehicle_plate','vehicle_mileage','notes','tags','sentiment','last_contact','review_requested','vehicle_color','vehicle_engine','sms_opted_out'])
         const { data, error } = await sb.from('customers').update({
           ...updates, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'customer', String(id))
      }

      // ── Void Document ────────────────────────────────────────
      case 'voidDocument': {
        const { id } = payload
        if (!id) return fail('Document id is required')
        const { data, error } = await sb.from('documents').update({
          status: 'Void', updated_at: new Date().toISOString(),
        }).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'document', String(id))
      }

      // ── Delete Record ────────────────────────────────────────
      case 'deleteRecord': {
        const { table, id } = payload as { table: string; id: string }
        const allowed = ['customers', 'jobs', 'documents', 'messages']
        if (!allowed.includes(table)) return fail(`Cannot delete from table: ${table}`)
        if (!id) return fail('Record id is required')
        // Scope the delete to the caller's shop so one shop can't delete another's row.
         const { data: deleted, error } = await sb.from(table).delete().eq('id', id).eq('shop_id', shopId).select('id').maybeSingle()
         if (error) return fail(error.message, 500)
         if (!deleted) return fail('Record not found in this shop', 404)
         return auditedOk({ deleted: true, table, id }, table, id)
      }

      // ── Schedule Follow-Up ───────────────────────────────────
      case 'scheduleFollowUp': {
        const { customer_id, customer_name, channel, scheduled_for, message_body, subject } = payload
        const selectedChannel = channel || 'sms'
        if (!['sms', 'email'].includes(String(selectedChannel))) return fail('Channel must be sms or email')
        if (typeof message_body !== 'string' || !message_body.trim()) return fail('Message body is required')
        const requestedDate = scheduled_for ? new Date(String(scheduled_for)) : new Date(Date.now() + 86400000)
        if (Number.isNaN(requestedDate.getTime())) return fail('scheduled_for must be a valid date')
        let resolvedCustomerId = typeof customer_id === 'string' ? customer_id : ''
        let customer: { id: string; name?: string; phone?: string; email?: string; sms_opted_out?: boolean } | null = null
        if (resolvedCustomerId) {
          const { data, error: customerError } = await sb.from('customers').select('id,name,phone,email,sms_opted_out').eq('id', resolvedCustomerId).eq('shop_id', shopId).maybeSingle()
          if (customerError) return fail(customerError.message, 500)
          customer = data
        } else if (typeof customer_name === 'string' && customer_name.trim()) {
          const { data, error: customerError } = await sb.from('customers').select('id,name,phone,email,sms_opted_out').eq('shop_id', shopId).ilike('name', customer_name.trim()).limit(1).maybeSingle()
          if (customerError) return fail(customerError.message, 500)
          customer = data
          resolvedCustomerId = data?.id || ''
        }
        if (!customer || !resolvedCustomerId) return fail('Customer must be found before scheduling a follow-up', 404)
        if (selectedChannel === 'sms' && customer.sms_opted_out) return fail('Customer has opted out of SMS', 409)
        const { data, error } = await sb.from('scheduled_messages').insert({
          customer_id: resolvedCustomerId,
          customer_name: customer.name || customer_name || 'Customer',
          channel: selectedChannel,
          scheduled_for: requestedDate.toISOString(),
          message_body: message_body.trim(),
          subject: subject || null,
          status: 'pending',
          shop_id: shopId,
          created_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'scheduled_message', data?.id)
      }

      // ── Get Customer History ─────────────────────────────────
      case 'getCustomerHistory': {
        const { customer_id, customer_name } = payload
        let jobs: unknown[] = []
        let docs: unknown[] = []
        let msgs: unknown[] = []

        if (customer_id) {
          const [jRes, dRes, mRes] = await Promise.all([
            sb.from('jobs').select('*').eq('shop_id', shopId).eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(20),
            sb.from('documents').select('*').eq('shop_id', shopId).eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(20),
            sb.from('messages').select('*').eq('shop_id', shopId).eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(20),
          ])
          if (jRes.error || dRes.error || mRes.error) return fail('Customer history could not be loaded', 500)
          jobs = jRes.data || []
          docs = dRes.data || []
          msgs = mRes.data || []
        } else if (customer_name) {
          const name = safeSearchTerm(customer_name)
          if (!name) return fail('Customer name is required')
          const [jRes, dRes] = await Promise.all([
            sb.from('jobs').select('*').eq('shop_id', shopId).ilike('customer_name', `%${name}%`).order('created_at', { ascending: false }).limit(20),
            sb.from('documents').select('*').eq('shop_id', shopId).ilike('customer_name', `%${name}%`).order('created_at', { ascending: false }).limit(20),
          ])
          if (jRes.error || dRes.error) return fail('Customer history could not be loaded', 500)
          jobs = jRes.data || []
          docs = dRes.data || []
        }
        return ok({ jobs, documents: docs, messages: msgs })
      }




            // -- Search Customers (FULL SYSTEM SEARCH) -------------------------
      case 'searchCustomers': {
        const { query } = payload
        if (!query) return fail('Search query is required')
        const q = safeSearchTerm(query)
        if (!q) return fail('Search query is required')

        // Search customers + jobs in parallel
        const [custRes, jobsRes, docsRes, msgsRes] = await Promise.all([
          sb.from('customers').select('*').eq('shop_id', shopId).or(`name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,address.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
          sb.from('jobs').select('*').eq('shop_id', shopId).or(`customer_name.ilike.%${q}%,customer_notes.ilike.%${q}%,vehicle_vin.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
          sb.from('documents').select('*').eq('shop_id', shopId).or(`customer_name.ilike.%${q}%,doc_number.ilike.%${q}%,notes.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
          sb.from('messages').select('*').eq('shop_id', shopId).or(`body.ilike.%${q}%,from_address.ilike.%${q}%,to_address.ilike.%${q}%`).order('created_at', { ascending: false }).limit(20),
        ])

        if (custRes.error || jobsRes.error || docsRes.error || msgsRes.error) return fail('Customer search failed', 500)

        // Enrich customers with their jobs/vehicle info
        const customers = custRes.data || []
        const allJobs = jobsRes.data || []
        const allDocs = docsRes.data || []
        const enriched = customers.map((c: Record<string, unknown>) => {
          const custJobs = allJobs.filter((j: Record<string, unknown>) => {
            const cName = (c.name as string || '').toLowerCase()
            const jName = (j.customer_name as string || '').toLowerCase()
            return j.customer_id === c.id || jName.includes(cName) || cName.includes(jName)
          })
          const vehicles = custJobs.map((j: Record<string, unknown>) => ({
            year: j.vehicle_year, make: j.vehicle_make, model: j.vehicle_model, vin: j.vehicle_vin
          })).filter((v: Record<string, unknown>) => v.year || v.make || v.model)
          const uniqueVehicles = vehicles.filter((v: Record<string, unknown>, i: number, arr: Record<string, unknown>[]) =>
            arr.findIndex((u: Record<string, unknown>) => u.year === v.year && u.make === v.make && u.model === v.model) === i
          )
          // Backfill email from documents if missing on customer record
          let resolvedEmail = (c.email as string) || null
          if (!resolvedEmail) {
            const cName = (c.name as string || '').toLowerCase()
            const docWithEmail = allDocs.find((d: Record<string, unknown>) => {
              const dName = (d.customer_name as string || '').toLowerCase()
              const emailVal = d.customer_email as string | null
              return emailVal && (d.customer_id === c.id || dName.includes(cName) || cName.includes(dName))
            })
            if (docWithEmail) {
              resolvedEmail = docWithEmail.customer_email as string
              // Save email back to customers table so future searches find it directly
              sb.from('customers').update({ email: resolvedEmail }).eq('id', c.id as string).eq('shop_id', shopId).then(() => {})
            }
          }
          return { ...c, email: resolvedEmail, vehicles: uniqueVehicles, recent_jobs: custJobs.slice(0, 5) }
        })

        // Also find customers referenced in jobs but not in customers table
        const custNames = new Set<string>(customers.map((c: Record<string, unknown>) => (c.name as string || '').toLowerCase()))
        const jobOnlyCustomers = allJobs
          .filter((j: Record<string, unknown>) => {
            const jName = (j.customer_name as string || '').toLowerCase()
            return !custNames.has(jName) && !Array.from(custNames).some(cn => jName.includes(cn) || cn.includes(jName))
          })
          .reduce((acc: Record<string, Record<string, unknown>>, j: Record<string, unknown>) => {
            const name = j.customer_name as string || ''
            if (!acc[name]) acc[name] = { name, source: 'jobs', vehicles: [], recent_jobs: [] }
            const v = { year: j.vehicle_year, make: j.vehicle_make, model: j.vehicle_model, vin: j.vehicle_vin };
            if (v.year || v.make || v.model) (acc[name].vehicles as unknown[]).push(v);
            (acc[name].recent_jobs as unknown[]).push(j)
            return acc
          }, {} as Record<string, Record<string, unknown>>)

        return ok({
          customers: [...enriched, ...Object.values(jobOnlyCustomers)],
          documents: allDocs,
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
          sb.from('jobs').select('*').eq('shop_id', shopId).gte('created_at', weekAgo),
          sb.from('documents').select('*').eq('shop_id', shopId).gte('created_at', weekAgo),
          sb.from('messages').select('*', { count: 'exact', head: true }).eq('shop_id', shopId).eq('read', false).eq('direction', 'inbound'),
          sb.from('customers').select('*', { count: 'exact', head: true }).eq('shop_id', shopId),
        ])

        if (jobsRes.error || docsRes.error || msgsRes.error || custRes.error) return fail('Shop statistics could not be loaded', 500)
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
        const searchUrl = new URL('/api/ai-search', req.nextUrl.origin)
        searchUrl.searchParams.set('q', query)
        searchUrl.searchParams.set('shop_id', shopId)
        const searchHeaders: Record<string, string> = { Accept: 'application/json' }
        const authorization = req.headers.get('authorization')
        const cookie = req.headers.get('cookie')
        if (authorization) searchHeaders.Authorization = authorization
        if (cookie) searchHeaders.Cookie = cookie
        const res = await fetch(searchUrl, { headers: searchHeaders, signal: AbortSignal.timeout(20000) })
        const data = await res.json().catch(() => ({}))
        if (!res.ok || data.ok === false) return fail(data.error || `Search returned ${res.status}`, 502)
        return ok(data)
      }

      // ── Send Estimate/Invoice via Email ────────────────────
      case 'sendEstimateEmail': {
        const { doc_number, customer_name, customer_id, email: overrideEmail } = payload
        let docQuery = sb.from('documents').select('*').eq('shop_id', shopId)
        if (doc_number) docQuery = docQuery.eq('doc_number', doc_number)
        else if (customer_name) docQuery = docQuery.ilike('customer_name', `%${safeSearchTerm(customer_name)}%`).order('created_at', { ascending: false }).limit(1)
        else if (customer_id) docQuery = docQuery.eq('customer_id', customer_id).order('created_at', { ascending: false }).limit(1)
        else return fail('Provide doc_number, customer_name, or customer_id')

        const { data: docs, error: docError } = await docQuery
        if (docError) return fail('Document lookup failed', 500)
        const doc = docs?.[0]
        if (!doc) return fail('Document not found')

        let toEmail = typeof overrideEmail === 'string' ? overrideEmail.trim() : ''
        if (!toEmail && doc.customer_email) toEmail = String(doc.customer_email)
        if (!toEmail && doc.customer_id) {
          const { data: cust, error: customerError } = await sb.from('customers')
            .select('email')
            .eq('id', doc.customer_id)
            .eq('shop_id', shopId)
            .maybeSingle()
          if (customerError) return fail('Customer lookup failed', 500)
          toEmail = cust?.email || ''
        }
        if (!toEmail) return fail('No email on file for this customer. Ask the user to add an email first.')
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) return fail('The customer email address is invalid')

        const { data: settings, error: settingsError } = await sb.from('settings')
          .select('*')
          .eq('shop_id', shopId)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (settingsError) return fail('Shop email settings could not be loaded', 500)
        const html = estimateEmailHtml(doc, settings || {})
        const fromEmail = settings?.from_email || settings?.shop_email || ''
        const shopName = settings?.shop_name || 'your shop'
        if (!fromEmail) return fail('Shop email sender is not configured')

        try {
          await sendEmail({
            to: toEmail,
            subject: `${doc.type} #${doc.doc_number} from ${shopName}`,
            html,
            replyTo: settings?.shop_email,
            apiKey: settings?.resend_api_key,
            from: fromEmail,
            idempotencyKey: getIdempotencyKey(req, [shopId, 'ai-document-email', String(doc.id), toEmail]),
          })
        } catch (error) {
          return fail(error instanceof Error ? error.message : 'Email could not be sent', 502)
        }

        const { error: messageError } = await sb.from('messages').insert({
          direction: 'outbound',
          channel: 'email',
          from_address: fromEmail,
          to_address: toEmail,
          subject: `${doc.type} #${doc.doc_number}`,
          body: `${doc.type} #${doc.doc_number} sent via AI`,
          document_id: doc.id,
          customer_id: doc.customer_id,
          shop_id: shopId,
          status: 'sent',
          read: true,
        })
        if (messageError) return fail('Email sent, but its message record could not be saved', 500)

        const { error: documentError } = await sb.from('documents')
          .update({ sent_at: new Date().toISOString() })
          .eq('id', doc.id)
          .eq('shop_id', shopId)
        if (documentError) return fail('Email sent, but the document could not be marked as sent', 500)

        return auditedOk({ sent: true, to: toEmail, doc_number: doc.doc_number, type: doc.type }, 'document', doc.id)
      }

        case 'convertEstimateToInvoice': {
          const { id: estId } = payload
          if (!estId) return fail('Estimate id is required')
          const { data: est, error: estErr } = await sb.from('documents').select('*').eq('id', estId).eq('shop_id', shopId).single()
          if (estErr || !est) return fail('Estimate not found')
          const { data: invDocNumber, error: numberingError } = await sb.rpc('next_document_number', { p_shop_id: shopId, p_type: 'Invoice' })
          if (numberingError || typeof invDocNumber !== 'string') return fail('Invoice numbering failed', 500)
          const { id: _rmId, doc_number: _rmDn, type: _rmType, created_at: _rmCa, ...estFields } = est
          const { data: invData, error: invErr } = await sb.from('documents').insert({
            ...estFields,
            type: 'Invoice',
            doc_number: invDocNumber,
            status: 'Draft',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).select().single()
          if (invErr) return fail(invErr.message, 500)
          return auditedOk(invData, 'document', invData?.id)
        }
      // ── Add Staff Member ────────────────────────────────────
      case 'addStaff': {
        const { name, role, emoji } = payload
        if (!name) return fail('Staff name is required')
        const { data, error } = await sb.from('staff').insert({
          name: String(name).trim(),
          role: (role as string) || 'technician',
          emoji: (emoji as string) || ((role === 'technician') ? '🔧' : '👤'),
          shop_id: shopId,
          active: true,
          created_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'staff', data?.id)
      }

      // ── Remove Staff Member ──────────────────────────────────
      case 'removeStaff': {
        const { name, id } = payload
        let query: any = sb.from('staff').update({ active: false }).eq('shop_id', shopId)
        if (id) query = query.eq('id', id)
        else if (name) query = query.ilike('name', `%${String(name)}%`)
        else return fail('Provide staff name or id')
        const { data, error } = await query.select().single()
        if (error) return fail(error.message, 500)
        return auditedOk({ removed: true, staff: data }, 'staff', data?.id)
      }

      // ── List Staff ───────────────────────────────────────────
      case 'listStaff': {
        const { data, error } = await sb.from('staff').select('*').eq('shop_id', shopId).eq('active', true).order('name')
        if (error) return fail(error.message, 500)
        return ok({ staff: data || [] })
      }

      // ── Update Document ──────────────────────────────────────
      case 'updateDocument': {
         const { id } = payload
         if (!id) return fail('Document id is required')
         const updates = pickFields(payload, ['type','status','doc_date','due_date','expires_date','customer_id','customer_name','customer_phone','customer_email','job_id','vehicle_year','vehicle_make','vehicle_model','vehicle_vin','vehicle_plate','vehicle_mileage','parts','labors','shop_supplies','sublet','tax_rate','apply_tax','deposit','payment_method','cashier','payment_terms','payment_methods','warranty_type','warranty_months','warranty_mileage','warranty_start','warranty_exclusions','warranty_claim','notes','locked','sent_at','signature_signed_at','signature_signer_name','signature_requested_at','line_items','payment_plan','internal_notes'])
         if (updates.status && ['Paid', 'Partial'].includes(String(updates.status))) return fail('Use the payment action to change an invoice to Paid or Partial; the payment ledger is protected.')
         const { data, error } = await sb.from('documents').update({
           ...updates, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'document', String(id))
      }

      // ── Create Appointment ───────────────────────────────────
      case 'createAppointment': {
         const { customer_name, customer_id, vehicle, service, scheduled_date, scheduled_time, date, time, notes, phone, email } = payload
         const appointmentDate = String(scheduled_date || date || '')
         const appointmentTime = String(scheduled_time || time || '09:00')
         if (!customer_name || !appointmentDate) return fail('customer_name and date are required')
         if (customer_id) {
           const { data: customer, error: customerError } = await sb.from('customers').select('id').eq('id', customer_id).eq('shop_id', shopId).maybeSingle()
           if (customerError) return fail(customerError.message, 500)
           if (!customer) return fail('Customer not found in this shop', 404)
         }
         const { data, error } = await sb.from('appointments').insert({
           customer_name: String(customer_name),
           customer_id: customer_id || null,
           vehicle: vehicle || '',
           service: service || '',
           date: appointmentDate,
           time: appointmentTime,
           scheduled_date: appointmentDate,
           scheduled_time: appointmentTime,
           status: 'Scheduled',
           notes: notes || '',
           phone: phone || null,
           email: email || null,
           shop_id: shopId,
           created_at: new Date().toISOString(),
           updated_at: new Date().toISOString(),
        }).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'appointment', data?.id)
      }

      // ── Time Clock Report ────────────────────────────────────
      case 'getTimeclockReport': {
        const { staff_name, startDate, endDate } = payload
        const start = (startDate as string) || new Date().toISOString().split('T')[0]
        const end   = (endDate as string) || start
        let query = sb.from('timeclock').select('*')
          .eq('shop_id', shopId)
          .gte('clock_in', start + 'T00:00:00')
          .lte('clock_in', end + 'T23:59:59')
          .order('clock_in', { ascending: true })
        if (staff_name) query = query.ilike('staff_name', `%${String(staff_name)}%`)
        const { data, error } = await query
        if (error) return fail(error.message, 500)
        const entries = (data || []) as Record<string, unknown>[]
        const grouped: Record<string, { name: string; entries: Record<string, unknown>[]; totalHours: number }> = {}
        for (const e of entries) {
          const n = e.staff_name as string
          if (!grouped[n]) grouped[n] = { name: n, entries: [], totalHours: 0 }
          grouped[n].entries.push(e)
          grouped[n].totalHours += (e.hours_worked as number) || 0
        }
        return ok({ entries, grouped: Object.values(grouped), startDate: start, endDate: end })
      }

      // ── Delete Appointment ───────────────────────────────────
      case 'deleteAppointment': {
        const { id } = payload
        if (!id) return fail('Appointment id is required')
         const { data: deleted, error } = await sb.from('appointments').delete().eq('id', id).eq('shop_id', shopId).select('id').maybeSingle()
         if (error) return fail(error.message, 500)
         if (!deleted) return fail('Appointment not found in this shop', 404)
         return auditedOk({ deleted: true, id }, 'appointment', String(id))
      }

      // ── Update Appointment ───────────────────────────────────
      case 'updateAppointment': {
         const { id } = payload
         if (!id) return fail('Appointment id is required')
         const updates = pickFields(payload, ['customer_name','customer_id','phone','email','vehicle','service','tech','date','time','scheduled_date','scheduled_time','duration','status','notes','reminder_sent_at'])
         if (updates.scheduled_date && !updates.date) updates.date = updates.scheduled_date
         if (updates.scheduled_time && !updates.time) updates.time = updates.scheduled_time
         if (updates.date && !updates.scheduled_date) updates.scheduled_date = updates.date
         if (updates.time && !updates.scheduled_time) updates.scheduled_time = updates.time
         if (updates.customer_id) {
           const { data: customer, error: customerError } = await sb.from('customers').select('id').eq('id', updates.customer_id).eq('shop_id', shopId).maybeSingle()
           if (customerError) return fail(customerError.message, 500)
           if (!customer) return fail('Customer not found in this shop', 404)
         }
         updates.updated_at = new Date().toISOString()
         const { data, error } = await sb.from('appointments').update(updates).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'appointment', String(id))
      }

      // ── Get Inventory ────────────────────────────────────────
      case 'getInventory': {
        const { query: q } = payload
        let dbQuery = sb.from('inventory').select('*').eq('shop_id', shopId).order('name')
        if (q) dbQuery = dbQuery.ilike('name', `%${String(q)}%`)
        const { data, error } = await dbQuery.limit(50)
        if (error) return fail(error.message, 500)
        return ok({ inventory: data || [] })
      }

      // ── Update Inventory ─────────────────────────────────────
      case 'updateInventory': {
         const { id } = payload
         if (!id) return fail('Inventory item id is required')
         const updates = pickFields(payload, ['part_number','name','category','brand','description','cost','retail_price','qty_on_hand','qty_reorder','qty_on_order','location','supplier','supplier_part_number','notes','last_ordered'])
         const { data, error } = await sb.from('inventory').update({
           ...updates, updated_at: new Date().toISOString(),
        }).eq('id', id).eq('shop_id', shopId).select().single()
        if (error) return fail(error.message, 500)
        return auditedOk(data, 'inventory', String(id))
      }
      default:
        return fail(`Unknown action: ${action}`)
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return fail(message, 500)
  }
}
