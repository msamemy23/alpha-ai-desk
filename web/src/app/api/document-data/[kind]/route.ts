export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import type { AuthenticatedShop } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { normalizePrefs } from '@/lib/doc-prefs'
import { normalizeOptionGroup } from '@/lib/doc-approval'
import { normalizeExtras } from '@/lib/canned-match'
import { summarizeLinks } from '@/lib/doc-history'
import { isMissingSchema, jsonError, jsonOk, loadPrefs, NEEDS_UPDATE } from '@/lib/doc-server'
import type { Db } from '@/lib/doc-server'

// The small data the paperwork screens keep beside the documents themselves. One route, one kind per call:
//
//   settings       the shop's paperwork settings (expiry days, terms, colour, markup matrix, rates, fees, wording)
//   options        good / better / best choices on an estimate
//   templates      whole estimates and invoices saved to start the next one from
//   canned-extras  per canned job: keywords, vehicle fits, variants, fees, note
//   declined-work  jobs customers said no to, kept for later
//   links          what customers did with their links, for the document list (polled)
//
// Every kind checks the caller's shop. A kind whose table is not there yet (database update not applied) answers
// with available: false so the page can say so for that feature only.

type Ctx = { params: Promise<{ kind: string }> }

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))
const WRITE_MANAGERS = new Set(['owner', 'admin', 'manager'])

const unavailable = () => jsonError(NEEDS_UPDATE, 503, { available: false })
const failed = (what: string) => jsonError(`${what} Try again.`, 500)

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

/** Lines saved into a template or option start fresh: no approval marks, no ids from another document. */
function cleanLines(v: unknown, max = 60): Record<string, unknown>[] {
  if (!Array.isArray(v)) return []
  return v.filter((l): l is Record<string, unknown> => Boolean(l && typeof l === 'object' && !Array.isArray(l))).slice(0, max).map((l) => {
    const { approved: _approved, ...rest } = l
    void _approved
    return rest
  })
}

async function documentOf(db: Db, shopId: string, documentId: string) {
  const { data, error } = await db.from('documents').select('id,type,status').eq('id', documentId).eq('shop_id', shopId).maybeSingle()
  return { doc: data as { id: string; type: string; status: string } | null, error }
}

/* ───────── settings ───────── */

async function settings(req: NextRequest, auth: AuthenticatedShop, db: Db) {
  if (req.method === 'GET') {
    const { prefs, available } = await loadPrefs(db, auth.shopId)
    return jsonOk({ prefs, available, canEdit: WRITE_MANAGERS.has(auth.role) })
  }
  if (req.method === 'PUT') {
    if (!WRITE_MANAGERS.has(auth.role)) return forbidden()
    const body = await readBody(req)
    if (!body) return jsonError('Invalid request', 400)
    const prefs = normalizePrefs(body.prefs)
    const { error } = await db.from('document_settings').upsert({ shop_id: auth.shopId, data: prefs, updated_by: auth.userId, updated_at: new Date().toISOString() }, { onConflict: 'shop_id' })
    if (error) return isMissingSchema(error) ? unavailable() : failed('The settings could not be saved.')
    return jsonOk({ ok: true, prefs })
  }
  return jsonError('Method not allowed', 405)
}

/* ───────── options ───────── */

async function options(req: NextRequest, auth: AuthenticatedShop, db: Db) {
  if (req.method === 'GET') {
    const documentId = req.nextUrl.searchParams.get('documentId')
    if (!documentId) return jsonError('documentId required', 400)
    const { data, error } = await db.from('document_options').select('id,name,position,choices,status,chosen_choice_id,decided_at').eq('shop_id', auth.shopId).eq('document_id', documentId).order('position', { ascending: true })
    if (error) return isMissingSchema(error) ? jsonOk({ options: [], available: false }) : failed('The options could not be loaded.')
    const groups = (data || []).map(normalizeOptionGroup).filter((g) => g !== null)
    return jsonOk({ options: groups, available: true })
  }

  if (auth.role === 'viewer') return forbidden()
  const body = await readBody(req)

  if (req.method === 'POST' || req.method === 'PUT') {
    if (!body) return jsonError('Invalid request', 400)
    const documentId = str(body.documentId)
    if (!documentId) return jsonError('documentId required', 400)
    const { doc, error: docError } = await documentOf(db, auth.shopId, documentId)
    if (docError) return failed('The estimate could not be loaded.')
    if (!doc) return jsonError('Document not found', 404)
    if (doc.type !== 'Estimate') return jsonError('Choices can only be added to an estimate.', 400)
    if (doc.status === 'Void' || doc.status === 'Declined') return jsonError('This estimate is closed. Restore or change it first.', 409)

    const choices = (Array.isArray(body.choices) ? body.choices : []).slice(0, 5).map((c) => {
      const o = c && typeof c === 'object' ? (c as Record<string, unknown>) : {}
      return { id: str(o.id) || crypto.randomUUID(), label: str(o.label), description: str(o.description), recommended: o.recommended === true, parts: cleanLines(o.parts, 30), labors: cleanLines(o.labors, 30) }
    })
    const check = normalizeOptionGroup({ id: 'check', name: body.name, choices, status: 'open' })
    if (!check) return jsonError('Give the group a name, for example "Brake pads".', 400)
    if (check.choices.length < 2) return jsonError('Add at least two choices so the customer has something to pick between.', 400)
    if (check.choices.some((c) => c.parts.length + c.labors.length === 0)) return jsonError('Every choice needs at least one line.', 400)
    const stored = check.choices.map((c) => ({ id: c.id, label: c.label, description: c.description, recommended: c.recommended, parts: c.parts, labors: c.labors }))
    const recommended = stored.filter((c) => c.recommended)
    if (recommended.length > 1) stored.forEach((c) => { c.recommended = c.id === recommended[0].id })

    if (req.method === 'POST') {
      const count = await db.from('document_options').select('id').eq('shop_id', auth.shopId).eq('document_id', documentId).limit(20)
      if (count.error) return isMissingSchema(count.error) ? unavailable() : failed('The choices could not be saved.')
      if ((count.data || []).length >= 10) return jsonError('That is a lot of choice groups for one estimate. Remove one first.', 400)
      const { data, error } = await db.from('document_options').insert({
        shop_id: auth.shopId, document_id: documentId, name: check.name, position: (count.data || []).length, choices: stored, status: 'open', created_by: auth.userId,
      }).select('id').single()
      if (error) return isMissingSchema(error) ? unavailable() : failed('The choices could not be saved.')
      return jsonOk({ ok: true, id: (data as { id: string }).id })
    }

    const id = str(body.id)
    if (!id) return jsonError('id required', 400)
    const existing = await db.from('document_options').select('id,status').eq('id', id).eq('shop_id', auth.shopId).eq('document_id', documentId).maybeSingle()
    if (existing.error) return isMissingSchema(existing.error) ? unavailable() : failed('The choices could not be loaded.')
    if (!existing.data) return jsonError('Choices not found', 404)
    if ((existing.data as { status: string }).status !== 'open') return jsonError('The customer already answered this one, so it can no longer be changed.', 409)
    const { error } = await db.from('document_options').update({ name: check.name, choices: stored, updated_at: new Date().toISOString() }).eq('id', id).eq('shop_id', auth.shopId)
    if (error) return failed('The choices could not be saved.')
    return jsonOk({ ok: true, id })
  }

  if (req.method === 'DELETE') {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return jsonError('id required', 400)
    const existing = await db.from('document_options').select('id,status').eq('id', id).eq('shop_id', auth.shopId).maybeSingle()
    if (existing.error) return isMissingSchema(existing.error) ? unavailable() : failed('The choices could not be loaded.')
    if (!existing.data) return jsonError('Choices not found', 404)
    if ((existing.data as { status: string }).status === 'open') {
      const { error } = await db.from('document_options').delete().eq('id', id).eq('shop_id', auth.shopId)
      if (error) return failed('The choices could not be removed.')
    } else {
      // An answered group stays as part of the record; it is just hidden from now on.
      const { error } = await db.from('document_options').update({ status: 'void', updated_at: new Date().toISOString() }).eq('id', id).eq('shop_id', auth.shopId)
      if (error) return failed('The choices could not be removed.')
    }
    return jsonOk({ ok: true })
  }
  return jsonError('Method not allowed', 405)
}

/* ───────── templates ───────── */

const TEMPLATE_COLUMNS = 'id,name,description,kind,parts,labors,shop_supplies,notes,warranty_type,created_at,updated_at'

async function templates(req: NextRequest, auth: AuthenticatedShop, db: Db) {
  if (req.method === 'GET') {
    const { data, error } = await db.from('document_templates').select(TEMPLATE_COLUMNS).eq('shop_id', auth.shopId).order('name', { ascending: true }).limit(200)
    if (error) return isMissingSchema(error) ? jsonOk({ templates: [], available: false }) : failed('The templates could not be loaded.')
    return jsonOk({ templates: data || [], available: true })
  }
  if (auth.role === 'viewer') return forbidden()

  if (req.method === 'POST') {
    const body = await readBody(req)
    if (!body) return jsonError('Invalid request', 400)
    const name = str(body.name).replace(/\s+/g, ' ').trim()
    if (name.length < 1 || name.length > 80) return jsonError('Give the template a name up to 80 characters.', 400)
    const parts = cleanLines(body.parts)
    const labors = cleanLines(body.labors)
    if (parts.length + labors.length === 0) return jsonError('Add at least one line before saving it as a template.', 400)
    if (JSON.stringify(parts).length + JSON.stringify(labors).length > 190000) return jsonError('That is too big to save as a template.', 400)
    const kind = body.kind === 'estimate' || body.kind === 'invoice' ? body.kind : 'any'
    const supplies = Number(body.shop_supplies)
    const row = {
      shop_id: auth.shopId, name, description: str(body.description).slice(0, 400), kind, parts, labors,
      shop_supplies: Number.isFinite(supplies) && supplies >= 0 ? Math.round(supplies * 100) / 100 : 0,
      notes: str(body.notes).slice(0, 4000), warranty_type: str(body.warranty_type).slice(0, 120), created_by: auth.userId,
    }
    const count = await db.from('document_templates').select('id').eq('shop_id', auth.shopId).limit(201)
    if (count.error) return isMissingSchema(count.error) ? unavailable() : failed('The template could not be saved.')
    if ((count.data || []).length >= 200) return jsonError('You have 200 templates. Delete one you no longer use first.', 400)
    const { data, error } = await db.from('document_templates').insert(row).select(TEMPLATE_COLUMNS).single()
    if (error) return failed('The template could not be saved.')
    return jsonOk({ ok: true, template: data })
  }

  if (req.method === 'DELETE') {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return jsonError('id required', 400)
    const { error } = await db.from('document_templates').delete().eq('id', id).eq('shop_id', auth.shopId)
    if (error) return isMissingSchema(error) ? unavailable() : failed('The template could not be deleted.')
    return jsonOk({ ok: true })
  }
  return jsonError('Method not allowed', 405)
}

/* ───────── canned job extras ───────── */

async function cannedExtras(req: NextRequest, auth: AuthenticatedShop, db: Db) {
  if (req.method === 'GET') {
    const { data, error } = await db.from('canned_job_extras').select('canned_job_id,data').eq('shop_id', auth.shopId).limit(1000)
    if (error) return isMissingSchema(error) ? jsonOk({ extras: {}, available: false }) : failed('The job details could not be loaded.')
    const extras: Record<string, unknown> = {}
    for (const row of (data || []) as { canned_job_id: string; data: unknown }[]) extras[row.canned_job_id] = normalizeExtras(row.data)
    return jsonOk({ extras, available: true })
  }
  if (auth.role === 'viewer') return forbidden()

  if (req.method === 'PUT') {
    const body = await readBody(req)
    if (!body) return jsonError('Invalid request', 400)
    const jobId = str(body.cannedJobId)
    if (!jobId || jobId.length > 64) return jsonError('cannedJobId required', 400)
    const data = normalizeExtras(body.extras)
    const { error } = await db.from('canned_job_extras').upsert({ shop_id: auth.shopId, canned_job_id: jobId, data, updated_by: auth.userId, updated_at: new Date().toISOString() }, { onConflict: 'shop_id,canned_job_id' })
    if (error) return isMissingSchema(error) ? unavailable() : failed('The job details could not be saved.')
    return jsonOk({ ok: true, extras: data })
  }

  if (req.method === 'DELETE') {
    const jobId = req.nextUrl.searchParams.get('cannedJobId')
    if (!jobId) return jsonError('cannedJobId required', 400)
    const { error } = await db.from('canned_job_extras').delete().eq('shop_id', auth.shopId).eq('canned_job_id', jobId)
    if (error) return isMissingSchema(error) ? unavailable() : failed('The job details could not be removed.')
    return jsonOk({ ok: true })
  }
  return jsonError('Method not allowed', 405)
}

/* ───────── declined work ───────── */

const DECLINED_STATUSES = new Set(['open', 'reminded', 'booked', 'dismissed'])
const DECLINED_COLUMNS = 'id,document_id,customer_id,customer_name,vehicle,job,amount,lines,source,status,declined_at,remind_after,note'

async function declinedWork(req: NextRequest, auth: AuthenticatedShop, db: Db) {
  if (req.method === 'GET') {
    const all = req.nextUrl.searchParams.get('status') === 'all'
    const customerId = req.nextUrl.searchParams.get('customerId')
    let q = db.from('declined_work').select(DECLINED_COLUMNS).eq('shop_id', auth.shopId)
    if (customerId) q = q.eq('customer_id', customerId)
    const { data, error } = await q.order('declined_at', { ascending: false }).limit(500)
    if (error) return isMissingSchema(error) ? jsonOk({ work: [], available: false }) : failed('Declined work could not be loaded.')
    const rows = ((data || []) as { status: string }[]).filter((r) => all || r.status === 'open' || r.status === 'reminded')
    return jsonOk({ work: rows, available: true })
  }
  if (auth.role === 'viewer') return forbidden()
  const body = await readBody(req)
  if (!body) return jsonError('Invalid request', 400)

  if (req.method === 'PATCH') {
    const id = str(body.id)
    const status = str(body.status)
    if (!id) return jsonError('id required', 400)
    if (!DECLINED_STATUSES.has(status)) return jsonError('Unknown status', 400)
    const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
    if (typeof body.remindAfter === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.remindAfter)) patch.remind_after = body.remindAfter
    if (typeof body.note === 'string') patch.note = body.note.trim().slice(0, 1000) || null
    const { data, error } = await db.from('declined_work').update(patch).eq('id', id).eq('shop_id', auth.shopId).select('id')
    if (error) return isMissingSchema(error) ? unavailable() : failed('That could not be saved.')
    if (!data || data.length === 0) return jsonError('Not found', 404)
    return jsonOk({ ok: true })
  }

  if (req.method === 'POST') {
    const job = str(body.job).replace(/\s+/g, ' ').trim()
    if (job.length < 1 || job.length > 120) return jsonError('Say what the job is, up to 120 characters.', 400)
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return jsonError('Enter the price the customer turned down.', 400)
    const customerId = str(body.customerId)
    if (customerId) {
      const { data: c, error } = await db.from('customers').select('id').eq('id', customerId).eq('shop_id', auth.shopId).maybeSingle()
      if (error) return failed('The customer could not be checked.')
      if (!c) return jsonError('Customer not found', 404)
    }
    const remind = typeof body.remindAfter === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.remindAfter) ? body.remindAfter : null
    const { data, error } = await db.from('declined_work').insert({
      shop_id: auth.shopId, customer_id: customerId || null, customer_name: str(body.customerName).slice(0, 160) || null, vehicle: str(body.vehicle).slice(0, 160) || null,
      job, amount: Math.round(amount * 100) / 100, lines: [], source: 'manual', status: 'open', remind_after: remind, note: str(body.note).trim().slice(0, 1000) || null,
    }).select(DECLINED_COLUMNS).single()
    if (error) return isMissingSchema(error) ? unavailable() : failed('That could not be saved.')
    return jsonOk({ ok: true, work: data })
  }
  return jsonError('Method not allowed', 405)
}

/* ───────── links summary ───────── */

async function links(req: NextRequest, auth: AuthenticatedShop, db: Db) {
  if (req.method !== 'GET') return jsonError('Method not allowed', 405)
  const since = new Date(Date.now() - 120 * 86400000).toISOString()
  const [rows, notes] = await Promise.all([
    db.from('document_links').select('document_id,created_at,channel,first_viewed_at,last_viewed_at,view_count,completed_at,response,revoked_at').eq('shop_id', auth.shopId).gte('created_at', since).order('created_at', { ascending: false }).limit(2000),
    db.from('document_approvals').select('document_id,note,status').eq('shop_id', auth.shopId).gte('signed_at', since).limit(1000),
  ])
  if (rows.error) return isMissingSchema(rows.error) ? jsonOk({ summaries: {}, available: false }) : failed('Customer activity could not be loaded.')
  const noted = new Set<string>()
  if (!notes.error) for (const r of (notes.data || []) as { document_id: string; note: string | null; status: string }[]) if (r.note && r.status !== 'failed') noted.add(r.document_id)
  return jsonOk({ summaries: summarizeLinks((rows.data || []) as never[], noted), available: true, at: new Date().toISOString() })
}

const HANDLERS: Record<string, (req: NextRequest, auth: AuthenticatedShop, db: Db) => Promise<Response>> = {
  settings, options, templates, 'canned-extras': cannedExtras, 'declined-work': declinedWork, links,
}

async function run(req: NextRequest, ctx: Ctx): Promise<Response> {
  const { kind } = await ctx.params
  const handler = HANDLERS[kind]
  if (!handler) return jsonError('Not found', 404)
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (req.method !== 'GET' && !checkRateLimit(`document-data:${auth.shopId}`, 240, 60_000).ok) return jsonError('Too many requests. Wait a minute.', 429)
  try {
    return await handler(req, auth, getServiceClient())
  } catch (e) {
    console.error('[document-data] failed:', kind, e instanceof Error ? e.message : e)
    return jsonError('Something went wrong. Try again.', 500)
  }
}

export const GET = run
export const POST = run
export const PUT = run
export const PATCH = run
export const DELETE = run
