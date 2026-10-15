import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { missingSchema } from '@/lib/schema-missing'
import { cleanTemplate, customKeyFor } from '@/lib/dvi'

export const dynamic = 'force-dynamic'

/**
 * The shop's own inspection checklists. Only the server reaches the table.
 * Nothing is ever deleted here: "remove" archives a checklist (hidden from the start screen, still readable by inspections
 * already made from it) and "restore" brings it back. Until migration 049 is applied the list is empty and says so.
 */
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const MAX_TEMPLATES = 30
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLUMNS = 'id,label,blurb,sections,archived,created_at,updated_at'

function shape(r: Record<string, unknown>) {
  return { id: String(r.id), key: customKeyFor(String(r.id)), label: String(r.label || ''), blurb: String(r.blurb || ''), sections: Array.isArray(r.sections) ? r.sections : [], archived: r.archived === true, updated_at: String(r.updated_at || '') }
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const { data, error } = await getServiceClient().from('dvi_templates').select(COLUMNS).eq('shop_id', auth.shopId).order('created_at', { ascending: true }).limit(100)
  if (error) {
    if (missingSchema(error)) return reply({ ok: true, available: false, templates: [] })
    return reply({ ok: false, error: 'Your checklists could not be loaded' }, 500)
  }
  return reply({ ok: true, available: true, templates: (data || []).map(r => shape(r as Record<string, unknown>)) })
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const t = cleanTemplate(body)
  if (!t) return reply({ ok: false, error: 'Give the checklist a name and at least one check.' }, 400)

  const sb = getServiceClient()
  const count = await sb.from('dvi_templates').select('id', { count: 'exact', head: true }).eq('shop_id', auth.shopId).eq('archived', false)
  if (count.error) {
    if (missingSchema(count.error)) return reply({ ok: false, available: false, error: 'Your own checklists need a database update first.' }, 409)
    return reply({ ok: false, error: 'Your checklists could not be checked' }, 500)
  }
  if ((count.count ?? 0) >= MAX_TEMPLATES) return reply({ ok: false, error: `You can keep ${MAX_TEMPLATES} checklists. Remove one first.` }, 409)

  const { data, error } = await sb.from('dvi_templates').insert({ shop_id: auth.shopId, label: t.label, blurb: t.blurb, sections: t.sections }).select(COLUMNS).single()
  if (error || !data) { console.error('[inspection/templates] create failed:', error?.message); return reply({ ok: false, error: 'The checklist could not be saved' }, 500) }
  return reply({ ok: true, template: shape(data as Record<string, unknown>) })
}

export async function PUT(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!ID.test(id)) return reply({ ok: false, error: 'Missing checklist' }, 400)

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof body?.archived === 'boolean') patch.archived = body.archived
  if (body && ('label' in body || 'sections' in body)) {
    const t = cleanTemplate(body)
    if (!t) return reply({ ok: false, error: 'Give the checklist a name and at least one check.' }, 400)
    Object.assign(patch, { label: t.label, blurb: t.blurb, sections: t.sections })
  }
  if (Object.keys(patch).length === 1) return reply({ ok: false, error: 'Nothing to change' }, 400)

  const { data, error } = await getServiceClient().from('dvi_templates').update(patch).eq('id', id).eq('shop_id', auth.shopId).select(COLUMNS).maybeSingle()
  if (error) { if (missingSchema(error)) return reply({ ok: false, available: false, error: 'Your own checklists need a database update first.' }, 409); return reply({ ok: false, error: 'The checklist could not be saved' }, 500) }
  if (!data) return reply({ ok: false, error: 'Checklist not found' }, 404)
  return reply({ ok: true, template: shape(data as Record<string, unknown>) })
}
