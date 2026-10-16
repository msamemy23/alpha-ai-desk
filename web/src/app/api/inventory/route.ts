import { NextRequest } from 'next/server'
import {
  adjustPart, applyPrices, canAdjust, canBuy, cancelPo, loadHistory, loadInventoryData, loadSoldLines, markPoSent, previewPo, receivePo, removeVendorPrice,
  saveExtras, savePoDraft, saveReturn, saveRules, saveVendor, saveVendorPrice, sendPo, setVendorActive,
} from '@/lib/inventory-store'
import { loadShopFacts, todayKeyIn } from '@/lib/report-delivery'
import { mailerFor } from '@/lib/report-mail'
import { jsonFail, jsonOk, readBody, respond, routeCtx } from '@/lib/route-ctx'

export const dynamic = 'force-dynamic'

/**
 * Vendors, purchase orders, returns, price rules and the history of every count. Anyone on the team can read. Counting,
 * receiving and returns are open to everyone but viewers; buying and pricing are for owners, admins and managers.
 */
export async function GET(req: NextRequest) {
  const c = await routeCtx()
  if (!c.ok) return c.response
  const { db, shopId } = c.ctx
  const q = new URL(req.url).searchParams
  const history = q.get('history')
  if (history) return respond({ ok: true }, { history: await loadHistory(db, shopId, history.slice(0, 64)) })
  const facts = await loadShopFacts(db, shopId)
  const data = await loadInventoryData(db, shopId)
  const days = Math.min(365, Math.max(30, Number(q.get('sold')) || 0))
  let sold: { state: 'ok' | 'error'; lines: unknown[]; error: string } | null = null
  if (q.get('sold')) {
    const since = new Date(); since.setDate(since.getDate() - days)
    try { sold = { state: 'ok', lines: await loadSoldLines(db, shopId, todayKeyIn(facts.timezone, since)), error: '' } }
    catch (e) { console.error('[inventory] sold:', e instanceof Error ? e.message : e); sold = { state: 'error', lines: [], error: 'What you sold did not load, so usage and slow stock are not shown.' } }
  }
  return jsonOk({ ...data, sold, shop: { name: facts.name, address: facts.address, phone: facts.phone, email: facts.email }, today: todayKeyIn(facts.timezone, new Date()), canBuy: canBuy(c.ctx.role), canAdjust: canAdjust(c.ctx.role) })
}

export async function POST(req: NextRequest) {
  const body = await readBody(req)
  if (!body) return jsonFail(400, 'Send the request as JSON.')
  const action = String(body.action || '')
  const adjusting = ['adjust', 'extras-save', 'return-save', 'po-receive'].includes(action)
  const c = await routeCtx(adjusting ? canAdjust : canBuy)
  if (!c.ok) return c.response
  const { db, shopId, userId, name } = c.ctx
  const actor = { userId, name }
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
  const id = typeof body.id === 'string' ? body.id : ''
  const today = async () => todayKeyIn((await loadShopFacts(db, shopId)).timezone, new Date())

  switch (action) {
    case 'adjust': return respond(await adjustPart(db, shopId, actor, obj(body.adjust)))
    case 'rules-save': return respond(await saveRules(db, shopId, actor, body.rules))
    case 'prices-apply': return respond(await applyPrices(db, shopId, actor, body.changes))
    case 'vendor-save': return respond(await saveVendor(db, shopId, actor, id || null, obj(body.vendor)))
    case 'vendor-active': return respond(await setVendorActive(db, shopId, id, body.active !== false))
    case 'price-save': return respond(await saveVendorPrice(db, shopId, actor, obj(body.price), await today()))
    case 'price-remove': return respond(await removeVendorPrice(db, shopId, id))
    case 'extras-save': return respond(await saveExtras(db, shopId, actor, obj(body.extras)))
    case 'return-save': return respond(await saveReturn(db, shopId, actor, id || null, obj(body.ret), await today()))
    case 'po-save': return respond(await savePoDraft(db, shopId, actor, id || null, obj(body.po)))
    case 'po-preview': {
      const facts = await loadShopFacts(db, shopId)
      return respond(await previewPo(db, shopId, id, { name: facts.name, address: facts.address, phone: facts.phone, email: facts.email }))
    }
    case 'po-send': {
      const facts = await loadShopFacts(db, shopId)
      const shop = { name: facts.name, address: facts.address, phone: facts.phone, email: facts.email }
      return respond(await sendPo(db, shopId, actor, id, String(body.token || ''), shop, await mailerFor(db, shopId)))
    }
    case 'po-mark-sent': return respond(await markPoSent(db, shopId, actor, id, String(body.via || '')))
    case 'po-cancel': return respond(await cancelPo(db, shopId, actor, id))
    case 'po-receive': return respond(await receivePo(db, shopId, actor, id, obj(body.receipt)))
    default: return jsonFail(400, 'That action is not one this screen can do.')
  }
}
