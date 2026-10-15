import { NextRequest } from 'next/server'
import { canManageBooks } from '@/lib/books-store'
import { deleteReport, draftFrom, listSaved, loadSavedOne, previewSaved, saveReport, sendSaved, setEnabled } from '@/lib/report-delivery'
import { mailerFor } from '@/lib/report-mail'
import { jsonFail, jsonOk, readBody, respond, routeCtx, shopToday } from '@/lib/route-ctx'

export const dynamic = 'force-dynamic'

/** Saved and emailed reports, and the history of what was sent. Owners, admins and managers only. */
export async function GET() {
  const c = await routeCtx(canManageBooks)
  if (!c.ok) return c.response
  const list = await listSaved(c.ctx.db, c.ctx.shopId)
  return jsonOk({ ...list })
}

export async function POST(req: NextRequest) {
  const c = await routeCtx(canManageBooks)
  if (!c.ok) return c.response
  const body = await readBody(req)
  if (!body) return jsonFail(400, 'Send the request as JSON.')
  const { db, shopId, userId, name, email } = c.ctx
  const actor = { userId, name, email }
  const id = typeof body.id === 'string' ? body.id : ''
  const draft = body.report && typeof body.report === 'object' && !Array.isArray(body.report) ? (body.report as Record<string, unknown>) : {}

  switch (String(body.action || '')) {
    case 'save': return respond(await saveReport(db, shopId, actor, id || null, draft, await shopToday(db, shopId)))
    case 'enable': return respond(await setEnabled(db, shopId, actor, id, body.enabled === true, await shopToday(db, shopId)))
    case 'delete': return respond(await deleteReport(db, shopId, id))
    case 'preview':
    case 'send': {
      const saved = id ? await loadSavedOne(db, shopId, id) : draftFrom(draft)
      if (!saved.ok) return respond(saved)
      if (body.action === 'preview') {
        try { return jsonOk({ preview: await previewSaved(db, shopId, saved.report, new Date(), body.which === 'send-now' ? 'send-now' : body.which === 'next-scheduled' ? 'next-scheduled' : undefined) }) }
        catch (e) { console.error('[reports] preview:', e instanceof Error ? e.message : e); return jsonFail(500, 'The preview could not be built. Nothing was sent. Try again.') }
      }
      const mode = body.mode === 'test' ? 'test' : 'manual'
      if (mode === 'manual' && !id) return jsonFail(400, 'Save the report before sending it to its addresses.')
      try {
        const out = await sendSaved({ db, shopId, send: await mailerFor(db, shopId), now: new Date(), actor }, saved.report, mode, String(body.send_key || ''))
        if (!out.ok) return jsonFail(out.status, out.message, { needsUpdate: out.needsUpdate, partial: out.partial })
        return jsonOk({ ...out })
      } catch (e) {
        console.error('[reports] send:', e instanceof Error ? e.message : e)
        return jsonFail(500, 'The report could not be built, so nothing was sent. Try again.')
      }
    }
    default: return jsonFail(400, 'That action is not one this screen can do.')
  }
}
