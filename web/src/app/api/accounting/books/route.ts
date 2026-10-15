import { NextRequest } from 'next/server'
import { addExpense, canManageBooks, loadBooks, payExpense, restoreExpense, saveClose, saveMappings, saveSettings, updateExpense, voidExpense } from '@/lib/books-store'
import { jsonFail, jsonOk, readBody, respond, routeCtx, shopToday } from '@/lib/route-ctx'

export const dynamic = 'force-dynamic'

/** The shop's books: settings, account names, bills and the month-end checklists. Owners, admins and managers only. */
export async function GET() {
  const c = await routeCtx(canManageBooks)
  if (!c.ok) return c.response
  const { db, shopId } = c.ctx
  const books = await loadBooks(db, shopId)
  return jsonOk({ ...books })
}

export async function POST(req: NextRequest) {
  const c = await routeCtx(canManageBooks)
  if (!c.ok) return c.response
  const body = await readBody(req)
  if (!body) return jsonFail(400, 'Send the request as JSON.')
  const { db, shopId, userId, name } = c.ctx
  const actor = { userId, name }
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

  switch (String(body.action || '')) {
    case 'settings': return respond(await saveSettings(db, shopId, actor, obj(body.settings)))
    case 'mappings': return respond(await saveMappings(db, shopId, actor, body.mappings))
    case 'expense-add': return respond(await addExpense(db, shopId, actor, obj(body.expense), await shopToday(db, shopId)))
    case 'expense-update': return respond(await updateExpense(db, shopId, actor, body.id, obj(body.expense), await shopToday(db, shopId)))
    case 'expense-pay': return respond(await payExpense(db, shopId, actor, body.id, body.paid_on, body.method, await shopToday(db, shopId)))
    case 'expense-void': return respond(await voidExpense(db, shopId, actor, body.id, body.reason))
    case 'expense-restore': return respond(await restoreExpense(db, shopId, actor, body.id))
    case 'close': return respond(await saveClose(db, shopId, actor, obj(body.close)))
    default: return jsonFail(400, 'That action is not one this screen can do.')
  }
}
