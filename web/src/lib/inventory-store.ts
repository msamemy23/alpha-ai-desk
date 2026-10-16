/**
 * Everything that saves or reads parts, vendors, purchase orders, returns and price rules, and every change to a count.
 *
 * Counts are only changed through the database functions from migration 057 (one transaction per change, with the history line
 * written in the same step). On a database that does not have them yet, a count change falls back to a guarded update that only
 * lands if nobody changed the count in the meantime. Orders, receiving and price rules need the update and say so.
 *
 * Nothing is deleted from here: vendors are archived, returns are cancelled, orders are cancelled. Plain TypeScript with
 * relative imports so the tests can run every path against an in-memory database.
 */
import { createHash } from 'node:crypto'
import type { Db, DbError, Row } from './db-types.ts'
import { isMissingSchemaError } from './report-docs.ts'
import { isEmail } from './saved-reports.ts'
import { isDayKey } from './report-ranges.ts'
import { addExpense } from './books-store.ts'
import {
  billReference, checkPo, checkReceipt, normalizeCode, normalizeRules, poHtml, poMessage, RETURN_KINDS, RETURN_STATUS, validBarcode,
} from './inventory-logic.ts'
import type {
  BillOutcome, CostMethod, PartExtra, PartHistory, PartReturn, PoLine, PoStatus, PriceRules, PurchaseOrder, ReturnKind, ReturnStatus, ShopFacts, SoldLine, StockPart, Vendor, VendorPrice,
} from './inventory-logic.ts'

export interface Actor { userId: string; name: string }
export type Failure = { ok: false; status: number; message: string; needsUpdate?: boolean; fields?: Record<string, string>; conflict?: boolean }
const fail = (status: number, message: string, extra: Partial<Failure> = {}): Failure => ({ ok: false, status, message, ...extra })

/** Who may change what. Everyone signed in can read; a viewer changes nothing. */
const MANAGE = new Set(['owner', 'admin', 'manager', 'service'])
export const canBuy = (role: string): boolean => MANAGE.has(role)
export const canAdjust = (role: string): boolean => role !== 'viewer' && role !== ''

export const NEEDS_UPDATE = 'This needs a one-time update to your Alpha Desk database. It does not change your parts counts or invoices.'

function failed(error: DbError | null | undefined, what: string): Failure {
  if (isMissingSchemaError(error) || error?.code === 'PGRST202' || error?.code === '42883') return fail(503, NEEDS_UPDATE, { needsUpdate: true })
  console.error(`[inventory] ${what}:`, error?.message || 'unknown error')
  return fail(500, `${what} did not work. Nothing was changed. Try again in a moment.`)
}

const tidy = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const money = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN
}
const whole = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) ? n : NaN
}

/* ---------- row mappers ---------- */

export const partFrom = (r: Row): StockPart => ({
  id: String(r.id ?? ''), part_number: tidy(r.part_number, 80), name: tidy(r.name, 200), category: tidy(r.category, 60), brand: tidy(r.brand, 80),
  cost: r.cost == null || r.cost === '' ? null : Number(r.cost), retail_price: r.retail_price == null || r.retail_price === '' ? null : Number(r.retail_price),
  qty_on_hand: r.qty_on_hand == null ? null : Number(r.qty_on_hand), qty_reorder: r.qty_reorder == null ? null : Number(r.qty_reorder), qty_on_order: r.qty_on_order == null ? null : Number(r.qty_on_order),
  location: tidy(r.location, 80), supplier: tidy(r.supplier, 120), supplier_part_number: tidy(r.supplier_part_number, 80),
})

export const vendorFrom = (r: Row): Vendor => ({
  id: String(r.id ?? ''), name: tidy(r.name, 120), email: tidy(r.email, 254), phone: tidy(r.phone, 40), contact: tidy(r.contact, 120), account_number: tidy(r.account_number, 60),
  address: tidy(r.address, 300), terms: tidy(r.terms, 120), lead_days: r.lead_days == null ? null : Number(r.lead_days), notes: tidy(r.notes, 1000), active: r.active !== false,
})

export const priceFrom = (r: Row): VendorPrice => ({
  id: String(r.id ?? ''), vendor_id: String(r.vendor_id ?? ''), part_id: String(r.part_id ?? ''), vendor_sku: tidy(r.vendor_sku, 60),
  price: Math.max(0, Number(r.price) || 0), core_charge: Math.max(0, Number(r.core_charge) || 0), checked_on: r.checked_on ? String(r.checked_on).slice(0, 10) : null,
})

export const extraFrom = (r: Row): PartExtra => ({
  part_id: String(r.part_id ?? ''), barcode: tidy(r.barcode, 64), max_qty: r.max_qty == null ? null : Number(r.max_qty), order_multiple: r.order_multiple == null ? null : Number(r.order_multiple),
  core_charge: Math.max(0, Number(r.core_charge) || 0), preferred_vendor_id: r.preferred_vendor_id ? String(r.preferred_vendor_id) : null,
})

export const lineFrom = (r: Row): PoLine => ({
  id: String(r.id ?? ''), part_id: r.part_id ? String(r.part_id) : null, description: tidy(r.description, 200), sku: tidy(r.sku, 60),
  qty: Math.max(0, Math.trunc(Number(r.qty) || 0)), unit_cost: Math.max(0, Number(r.unit_cost) || 0), core_charge: Math.max(0, Number(r.core_charge) || 0), qty_received: Math.max(0, Math.trunc(Number(r.qty_received) || 0)),
})

const STATUSES: PoStatus[] = ['draft', 'sent', 'partial', 'received', 'cancelled']
export const poFrom = (r: Row, lines: Row[]): PurchaseOrder => ({
  id: String(r.id ?? ''), po_number: tidy(r.po_number, 20), vendor_id: r.vendor_id ? String(r.vendor_id) : null, vendor_name: tidy(r.vendor_name, 120),
  status: STATUSES.includes(r.status as PoStatus) ? (r.status as PoStatus) : 'draft', notes: tidy(r.notes, 1000), expected_on: r.expected_on ? String(r.expected_on).slice(0, 10) : null,
  created_at: String(r.created_at ?? ''), sent_at: r.sent_at ? String(r.sent_at) : null, sent_to: tidy(r.sent_to, 300),
  lines: lines.filter(l => String(l.po_id) === String(r.id)).sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0)).map(lineFrom),
})

export const returnFrom = (r: Row): PartReturn => ({
  id: String(r.id ?? ''), part_id: r.part_id ? String(r.part_id) : null, vendor_id: r.vendor_id ? String(r.vendor_id) : null, description: tidy(r.description, 200),
  kind: RETURN_KINDS.some(k => k.key === r.kind) ? (r.kind as ReturnKind) : 'core', qty: Math.max(1, Math.trunc(Number(r.qty) || 1)), amount: Math.max(0, Number(r.amount) || 0),
  status: RETURN_STATUS.some(s => s.key === r.status) ? (r.status as ReturnStatus) : 'open', opened_on: String(r.opened_on ?? '').slice(0, 10), credited_on: r.credited_on ? String(r.credited_on).slice(0, 10) : null,
  reference: tidy(r.reference, 80), note: tidy(r.note, 500),
})

export const historyFrom = (r: Row): PartHistory => ({
  id: String(r.id ?? ''), part_id: String(r.part_id ?? ''), at: String(r.at ?? ''), actor: tidy(r.actor_name, 120), field: String(r.field ?? ''),
  before: r.old_value == null ? null : Number(r.old_value), after: r.new_value == null ? null : Number(r.new_value), reason: tidy(r.reason, 40), reference: tidy(r.reference, 80), note: tidy(r.note, 300),
})

/* ---------- reading ---------- */

export type ResourceState = 'ok' | 'needs-update' | 'error'
export interface Resource<T> { state: ResourceState; value: T; error: string }

async function read<T>(work: PromiseLike<{ data: Row[] | null; error: DbError | null }>, map: (rows: Row[]) => T, empty: T, what: string): Promise<Resource<T>> {
  const { data, error } = await work
  if (error) {
    if (isMissingSchemaError(error)) return { state: 'needs-update', value: empty, error: '' }
    console.error(`[inventory] ${what}:`, error.message)
    return { state: 'error', value: empty, error: `${what} did not load. Try again.` }
  }
  return { state: 'ok', value: map(data || []), error: '' }
}

export interface InventoryData {
  extras: Resource<PartExtra[]>
  vendors: Resource<Vendor[]>
  prices: Resource<VendorPrice[]>
  orders: Resource<PurchaseOrder[]>
  returns: Resource<PartReturn[]>
  rules: Resource<PriceRules>
}

export async function loadInventoryData(db: Db, shopId: string): Promise<InventoryData> {
  const orderRows = await db.from('purchase_orders').select('id,po_number,vendor_id,vendor_name,status,notes,expected_on,created_at,sent_at,sent_to,send_started_at').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(300)
  const orderIds = (orderRows.data || []).map(r => String(r.id))
  const lineRows = orderIds.length ? await db.from('purchase_order_lines').select('id,po_id,position,part_id,description,sku,qty,unit_cost,core_charge,qty_received').eq('shop_id', shopId).in('po_id', orderIds).limit(20000) : { data: [] as Row[], error: null }
  const [extras, vendors, prices, returns, rules] = await Promise.all([
    read(db.from('inventory_extras').select('part_id,barcode,max_qty,order_multiple,core_charge,preferred_vendor_id').eq('shop_id', shopId).limit(20000), r => r.map(extraFrom), [] as PartExtra[], 'Barcodes and order levels'),
    read(db.from('vendors').select('id,name,email,phone,contact,account_number,address,terms,lead_days,notes,active').eq('shop_id', shopId).order('name').limit(1000), r => r.map(vendorFrom), [] as Vendor[], 'Your vendors'),
    read(db.from('vendor_prices').select('id,vendor_id,part_id,vendor_sku,price,core_charge,checked_on').eq('shop_id', shopId).limit(50000), r => r.map(priceFrom), [] as VendorPrice[], 'Vendor prices'),
    read(db.from('part_returns').select('id,part_id,vendor_id,description,kind,qty,amount,status,opened_on,credited_on,reference,note').eq('shop_id', shopId).order('opened_on', { ascending: false }).limit(1000), r => r.map(returnFrom), [] as PartReturn[], 'Returns and cores'),
    read(db.from('pricing_rules').select('rules').eq('shop_id', shopId).limit(1), r => normalizeRules(r[0]?.rules), normalizeRules(null), 'Your price rules'),
  ])
  const orders: Resource<PurchaseOrder[]> = orderRows.error
    ? (isMissingSchemaError(orderRows.error) ? { state: 'needs-update', value: [], error: '' } : { state: 'error', value: [], error: 'Your purchase orders did not load. Try again.' })
    : lineRows.error
      ? { state: 'error', value: [], error: 'The parts on your purchase orders did not load. Try again.' }
      : { state: 'ok', value: (orderRows.data || []).map(r => poFrom(r, lineRows.data || [])), error: '' }
  return { extras, vendors, prices, orders, returns, rules }
}

/** The recent changes to one part, newest first. */
export async function loadHistory(db: Db, shopId: string, partId: string, limit = 100): Promise<Resource<PartHistory[]>> {
  return read(db.from('part_history').select('id,part_id,at,actor_name,field,old_value,new_value,reason,reference,note').eq('shop_id', shopId).eq('part_id', partId).order('at', { ascending: false }).limit(limit),
    r => r.map(historyFrom), [] as PartHistory[], 'The history of this part')
}

/** What sold in the last `days` days, line by line, for the reorder suggestions and the slow-stock report. */
export async function loadSoldLines(db: Db, shopId: string, sinceDay: string): Promise<SoldLine[]> {
  const out: SoldLine[] = []
  let from = 0
  for (;;) {
    const { data, error } = await db.from('documents').select('id,type,status,doc_date,created_at,parts').eq('shop_id', shopId).in('type', ['Invoice', 'Receipt']).gte('created_at', `${sinceDay}T00:00:00`).order('created_at', { ascending: false }).range(from, from + 999)
    if (error) throw new Error(error.message || 'Sales could not be read.')
    for (const d of data || []) {
      const status = String(d.status || '').trim().toLowerCase()
      if (['draft', 'void', 'voided', 'cancelled', 'canceled'].includes(status)) continue
      const day = String(d.doc_date || d.created_at || '').slice(0, 10)
      for (const p of (Array.isArray(d.parts) ? d.parts : []) as Row[]) {
        const qty = Number(p?.qty ?? 1)
        const name = tidy(p?.name, 200)
        if (name && Number.isFinite(qty) && qty > 0) out.push({ date: day, name, qty })
      }
    }
    if ((data || []).length < 1000) return out
    from += 1000
  }
}

/* ---------- changing a count ---------- */

export type AdjustField = 'qty_on_hand' | 'qty_on_order' | 'qty_reorder'
const ADJUSTABLE: AdjustField[] = ['qty_on_hand', 'qty_on_order', 'qty_reorder']

export interface AdjustInput { part_id?: unknown; field?: unknown; delta?: unknown; set?: unknown; reason?: unknown; reference?: unknown; note?: unknown }

/** Changes a count by an amount, or sets it to a number, and writes who and why. One step; two people cannot overwrite each other. */
export async function adjustPart(db: Db, shopId: string, actor: Actor, input: AdjustInput): Promise<{ ok: true; old: number | null; new: number; viaFallback: boolean } | Failure> {
  const partId = tidy(input.part_id, 64)
  const field = (input.field === undefined ? 'qty_on_hand' : input.field) as AdjustField
  if (!partId) return fail(400, 'Choose a part.')
  if (!ADJUSTABLE.includes(field)) return fail(400, 'That number cannot be changed here.')
  const delta = whole(input.delta), set = whole(input.set)
  if ((delta === null) === (set === null) || Number.isNaN(delta) || Number.isNaN(set)) return fail(400, 'Enter a whole number to add or take away, or the new count.')
  if (set !== null && (set < 0 || set > 1_000_000)) return fail(400, 'A count has to be between 0 and 1,000,000.')
  if (delta !== null && Math.abs(delta) > 1_000_000) return fail(400, 'That change is too large.')
  const reason = tidy(input.reason, 40), reference = tidy(input.reference, 80), note = tidy(input.note, 300)

  const r = await db.rpc('inventory_apply_delta', {
    p_shop_id: shopId, p_part_id: partId, p_field: field, p_delta: delta, p_set: set, p_actor_id: actor.userId, p_actor_name: actor.name,
    p_reason: reason, p_reference: reference, p_note: note, p_clamp: false,
  })
  if (!r.error) {
    const d = (r.data || {}) as Row
    return { ok: true, old: d.old == null ? null : Number(d.old), new: Number(d.new), viaFallback: false }
  }
  const code = r.error.code
  if (code === '23514') return fail(400, 'That would take the count below zero. Check how many are really there.')
  if (code === 'P0002') return fail(404, 'That part was not found. It may have been deleted.')
  if (code === '22023') return fail(400, r.error.message || 'Enter a whole number.')
  if (code !== 'PGRST202' && code !== '42883' && !isMissingSchemaError(r.error)) return failed(r.error, 'Changing the count')

  // The database update is not applied yet: change the count only if nobody else has in the meantime.
  const cur = await db.from('inventory').select(`id,${field}`).eq('id', partId).eq('shop_id', shopId).maybeSingle()
  if (cur.error) return failed(cur.error, 'Changing the count')
  if (!cur.data) return fail(404, 'That part was not found. It may have been deleted.')
  const old = cur.data[field] == null ? null : Number(cur.data[field])
  const next = set !== null ? set : (old ?? 0) + (delta as number)
  if (next < 0 && next < (old ?? 0)) return fail(400, 'That would take the count below zero. Check how many are really there.')
  let q = db.from('inventory').update({ [field]: next, updated_at: new Date().toISOString() }).eq('id', partId).eq('shop_id', shopId)
  q = old === null ? q.is(field, null) : q.eq(field, old)
  const upd = await q.select('id').maybeSingle()
  if (upd.error) return failed(upd.error, 'Changing the count')
  if (!upd.data) return fail(409, 'Someone else changed this count a moment ago. Reload and check it again.', { conflict: true })
  // The history is a record, not a requirement: if its table is not there yet the count change still stands.
  if (old !== next) {
    await db.from('part_history').insert({ shop_id: shopId, part_id: partId, actor_id: actor.userId, actor_name: actor.name.slice(0, 120), field, old_value: old, new_value: next, reason, reference, note })
  }
  return { ok: true, old, new: next, viaFallback: true }
}

/* ---------- price rules ---------- */

export async function saveRules(db: Db, shopId: string, actor: Actor, raw: unknown): Promise<{ ok: true; rules: PriceRules } | Failure> {
  const rules = normalizeRules(raw)
  const asked = raw && typeof raw === 'object' && Array.isArray((raw as Row).tiers) ? ((raw as Row).tiers as unknown[]).length : 0
  if (asked > 20) return fail(400, 'Use up to 20 price ranges.')
  if (asked !== rules.tiers.length) return fail(400, 'One of the price ranges does not make sense. Each needs a cost range that ends above where it starts, and a percent (margins must be under 95).')
  const { error } = await db.from('pricing_rules').upsert({ shop_id: shopId, rules, updated_by: actor.userId, updated_at: new Date().toISOString() }, { onConflict: 'shop_id' })
  if (error) return failed(error, 'Saving the price rules')
  return { ok: true, rules }
}

export interface PriceChange { part_id: string; from: number | null; to: number }

/** Applies a list of new prices the owner has looked at and approved. A part whose price changed since the list was made is skipped. */
export async function applyPrices(db: Db, shopId: string, actor: Actor, changes: unknown): Promise<{ ok: true; changed: number; skipped: number } | Failure> {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 2000) return fail(400, 'Choose between 1 and 2,000 prices to change.')
  const list: PriceChange[] = []
  for (const c of changes) {
    const o = (c && typeof c === 'object' ? c : {}) as Row
    const to = money(o.to), from = money(o.from)
    if (!tidy(o.part_id, 64) || to === null || Number.isNaN(to) || to < 0 || to > 1_000_000 || Number.isNaN(from)) return fail(400, 'One of the prices is not valid. Refresh the list and try again.')
    list.push({ part_id: tidy(o.part_id, 64), from, to })
  }
  const r = await db.rpc('inventory_set_prices', { p_shop_id: shopId, p_changes: list.map(c => ({ part_id: c.part_id, from_price: c.from, to_price: c.to })), p_actor_id: actor.userId, p_actor_name: actor.name, p_reason: 'price rules' })
  if (!r.error) { const d = (r.data || {}) as Row; return { ok: true, changed: Number(d.changed) || 0, skipped: Number(d.skipped) || 0 } }
  if (r.error.code !== 'PGRST202' && r.error.code !== '42883' && !isMissingSchemaError(r.error)) return failed(r.error, 'Changing the prices')
  // Without the database update: one guarded change per part. A part that changed meanwhile is skipped, never overwritten.
  let changed = 0, skipped = 0
  for (const c of list) {
    let q = db.from('inventory').update({ retail_price: c.to, updated_at: new Date().toISOString() }).eq('id', c.part_id).eq('shop_id', shopId)
    q = c.from === null ? q.is('retail_price', null) : q.eq('retail_price', c.from)
    const u = await q.select('id').maybeSingle()
    if (u.error) return failed(u.error, 'Changing the prices')
    if (u.data) {
      changed += 1
      await db.from('part_history').insert({ shop_id: shopId, part_id: c.part_id, actor_id: actor.userId, actor_name: actor.name.slice(0, 120), field: 'retail_price', old_value: c.from, new_value: c.to, reason: 'price rules', reference: '', note: '' })
    } else skipped += 1
  }
  return { ok: true, changed, skipped }
}

/* ---------- vendors and their prices ---------- */

export type VendorField = 'name' | 'email' | 'phone' | 'lead_days'

export function checkVendor(input: Row): { ok: true; value: Omit<Vendor, 'id' | 'active'> } | { ok: false; errors: Partial<Record<VendorField, string>> } {
  const errors: Partial<Record<VendorField, string>> = {}
  const name = tidy(input.name, 120)
  if (!name) errors.name = 'Type the vendor\'s name.'
  const email = tidy(input.email, 254)
  if (email && !isEmail(email)) errors.email = 'That does not look like an email address.'
  const phone = tidy(input.phone, 40)
  if (phone && !/^[0-9+()\-.\s xext#]{5,40}$/i.test(phone)) errors.phone = 'That does not look like a phone number.'
  const lead = whole(input.lead_days)
  if (lead !== null && (Number.isNaN(lead) || lead < 0 || lead > 365)) errors.lead_days = 'Lead time is a number of days, 0 to 365.'
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { name, email, phone, contact: tidy(input.contact, 120), account_number: tidy(input.account_number, 60), address: tidy(input.address, 300), terms: tidy(input.terms, 120), lead_days: lead, notes: tidy(input.notes, 1000) } }
}

const VENDOR_COLUMNS = 'id,name,email,phone,contact,account_number,address,terms,lead_days,notes,active'
const nz = (s: string) => s || null

export async function saveVendor(db: Db, shopId: string, actor: Actor, id: unknown, input: Row): Promise<{ ok: true; vendor: Vendor } | Failure> {
  const c = checkVendor(input)
  if (!c.ok) return fail(400, Object.values(c.errors)[0] || 'Check the vendor.', { fields: c.errors as Record<string, string> })
  const v = c.value
  const row = { name: v.name, email: nz(v.email), phone: nz(v.phone), contact: nz(v.contact), account_number: nz(v.account_number), address: nz(v.address), terms: nz(v.terms), lead_days: v.lead_days, notes: nz(v.notes), updated_at: new Date().toISOString() }
  const key = tidy(id, 64)
  const res = key
    ? await db.from('vendors').update(row).eq('id', key).eq('shop_id', shopId).select(VENDOR_COLUMNS).maybeSingle()
    : await db.from('vendors').insert({ ...row, shop_id: shopId, created_by: actor.userId }).select(VENDOR_COLUMNS).maybeSingle()
  if (res.error) {
    if (res.error.code === '23505') return fail(409, `You already have a vendor named ${v.name}.`, { fields: { name: 'You already have a vendor with this name.' } })
    return failed(res.error, 'Saving the vendor')
  }
  if (!res.data) return fail(404, 'That vendor was not found.')
  return { ok: true, vendor: vendorFrom(res.data) }
}

/** Vendors are archived, never deleted: orders and prices still point at them. */
export async function setVendorActive(db: Db, shopId: string, id: unknown, active: boolean): Promise<{ ok: true; vendor: Vendor } | Failure> {
  const key = tidy(id, 64)
  if (!key) return fail(400, 'Choose a vendor.')
  const { data, error } = await db.from('vendors').update({ active, updated_at: new Date().toISOString() }).eq('id', key).eq('shop_id', shopId).select(VENDOR_COLUMNS).maybeSingle()
  if (error) return failed(error, 'Changing the vendor')
  if (!data) return fail(404, 'That vendor was not found.')
  return { ok: true, vendor: vendorFrom(data) }
}

export async function saveVendorPrice(db: Db, shopId: string, actor: Actor, input: Row, todayKey: string): Promise<{ ok: true; price: VendorPrice } | Failure> {
  const vendorId = tidy(input.vendor_id, 64), partId = tidy(input.part_id, 64)
  if (!vendorId || !partId) return fail(400, 'Choose a vendor and a part.')
  const price = money(input.price), core = money(input.core_charge) ?? 0
  if (price === null || Number.isNaN(price) || price < 0 || price > 1_000_000) return fail(400, 'Enter the price as a number, like 12.50.', { fields: { price: 'Enter the price as a number, like 12.50.' } })
  if (Number.isNaN(core) || core < 0 || core > 100_000) return fail(400, 'The core charge cannot be below zero.', { fields: { core_charge: 'The core charge cannot be below zero.' } })
  const checked = tidy(input.checked_on, 10) || todayKey
  if (!isDayKey(checked)) return fail(400, 'Pick the day the price was checked.')
  const ven = await db.from('vendors').select('id').eq('id', vendorId).eq('shop_id', shopId).maybeSingle()
  if (ven.error) return failed(ven.error, 'Saving the price')
  if (!ven.data) return fail(404, 'That vendor was not found.')
  const part = await db.from('inventory').select('id').eq('id', partId).eq('shop_id', shopId).maybeSingle()
  if (part.error) return failed(part.error, 'Saving the price')
  if (!part.data) return fail(404, 'That part was not found.')
  const { data, error } = await db.from('vendor_prices').upsert(
    { shop_id: shopId, vendor_id: vendorId, part_id: partId, vendor_sku: nz(tidy(input.vendor_sku, 60)), price, core_charge: core, checked_on: checked, updated_by: actor.userId, updated_at: new Date().toISOString() },
    { onConflict: 'vendor_id,part_id' },
  ).select('id,vendor_id,part_id,vendor_sku,price,core_charge,checked_on').maybeSingle()
  if (error) return failed(error, 'Saving the price')
  return { ok: true, price: priceFrom(data || {}) }
}

export async function removeVendorPrice(db: Db, shopId: string, id: unknown): Promise<{ ok: true } | Failure> {
  const key = tidy(id, 64)
  if (!key) return fail(400, 'Choose a price.')
  const { data, error } = await db.from('vendor_prices').delete().eq('id', key).eq('shop_id', shopId).select('id')
  if (error) return failed(error, 'Removing the price')
  if (!data || data.length === 0) return fail(404, 'That price was not found.')
  return { ok: true }
}

/* ---------- barcodes and order levels ---------- */

export async function saveExtras(db: Db, shopId: string, actor: Actor, input: Row): Promise<{ ok: true; extra: PartExtra } | Failure> {
  const partId = tidy(input.part_id, 64)
  if (!partId) return fail(400, 'Choose a part.')
  const errors: Record<string, string> = {}
  const raw = tidy(input.barcode, 64)
  const barcode = raw ? normalizeCode(raw) : ''
  // A barcode may be any code the shelf label carries. When it looks like a UPC or EAN (8, 12 or 13 digits) the check digit must add
  // up, so a mistyped or half-scanned code is caught instead of being saved.
  if (/^\d{8}$|^\d{12}$|^\d{13}$/.test(barcode) && !validBarcode(barcode)) errors.barcode = 'That barcode does not add up (the last digit is wrong). Scan it again or type it carefully.'
  const max = whole(input.max_qty), mult = whole(input.order_multiple), core = money(input.core_charge) ?? 0
  if (max !== null && (Number.isNaN(max) || max < 0 || max > 1_000_000)) errors.max_qty = 'Order up to a whole number, 0 or more.'
  if (mult !== null && (Number.isNaN(mult) || mult < 1 || mult > 10_000)) errors.order_multiple = 'The case size is a whole number, 1 or more.'
  if (Number.isNaN(core) || core < 0 || core > 100_000) errors.core_charge = 'The core charge cannot be below zero.'
  const vendorId = tidy(input.preferred_vendor_id, 64)
  if (vendorId) {
    const v = await db.from('vendors').select('id').eq('id', vendorId).eq('shop_id', shopId).maybeSingle()
    if (v.error) return failed(v.error, 'Saving the part details')
    if (!v.data) errors.preferred_vendor_id = 'That vendor was not found.'
  }
  if (Object.keys(errors).length) return fail(400, Object.values(errors)[0], { fields: errors })
  const part = await db.from('inventory').select('id').eq('id', partId).eq('shop_id', shopId).maybeSingle()
  if (part.error) return failed(part.error, 'Saving the part details')
  if (!part.data) return fail(404, 'That part was not found.')
  const { data, error } = await db.from('inventory_extras').upsert(
    { shop_id: shopId, part_id: partId, barcode: barcode || null, max_qty: max, order_multiple: mult, core_charge: core, preferred_vendor_id: vendorId || null, updated_by: actor.userId, updated_at: new Date().toISOString() },
    { onConflict: 'shop_id,part_id' },
  ).select('part_id,barcode,max_qty,order_multiple,core_charge,preferred_vendor_id').maybeSingle()
  if (error) {
    if (error.code === '23505') {
      const other = await db.from('inventory_extras').select('part_id').eq('shop_id', shopId).eq('barcode', barcode).limit(1)
      const who = other.data?.[0]?.part_id ? await db.from('inventory').select('name').eq('id', String(other.data[0].part_id)).eq('shop_id', shopId).maybeSingle() : null
      return fail(409, `That barcode is already on ${who?.data?.name ? String(who.data.name) : 'another part'}.`, { fields: { barcode: 'That barcode is already on another part.' } })
    }
    return failed(error, 'Saving the part details')
  }
  return { ok: true, extra: extraFrom(data || {}) }
}

/* ---------- returns and cores ---------- */

export async function saveReturn(db: Db, shopId: string, actor: Actor, id: unknown, input: Row, todayKey: string): Promise<{ ok: true; ret: PartReturn } | Failure> {
  const errors: Record<string, string> = {}
  const description = tidy(input.description, 200)
  if (!description) errors.description = 'Describe what is going back.'
  const kind = RETURN_KINDS.find(k => k.key === input.kind)?.key
  if (!kind) errors.kind = 'Choose why it is going back.'
  const status = input.status === undefined ? 'open' : RETURN_STATUS.find(s => s.key === input.status)?.key
  if (!status) errors.status = 'Choose where the return stands.'
  const qty = whole(input.qty ?? 1)
  if (qty === null || Number.isNaN(qty) || qty < 1 || qty > 100_000) errors.qty = 'How many: a whole number, 1 or more.'
  const amount = money(input.amount) ?? 0
  if (Number.isNaN(amount) || amount < 0 || amount > 1_000_000) errors.amount = 'The credit cannot be below zero.'
  const opened = tidy(input.opened_on, 10) || todayKey
  if (!isDayKey(opened)) errors.opened_on = 'Pick the day it was opened.'
  let credited = tidy(input.credited_on, 10) || null
  if (status === 'credited' && !credited) credited = todayKey
  if (credited && !isDayKey(credited)) errors.credited_on = 'Pick the day the credit came.'
  else if (credited && isDayKey(opened) && credited < opened) errors.credited_on = 'The credit cannot come before the return was opened.'
  const vendorId = tidy(input.vendor_id, 64)
  if (vendorId && !errors.description) {
    const v = await db.from('vendors').select('id').eq('id', vendorId).eq('shop_id', shopId).maybeSingle()
    if (v.error) return failed(v.error, 'Saving the return')
    if (!v.data) errors.vendor_id = 'That vendor was not found.'
  }
  if (Object.keys(errors).length) return fail(400, Object.values(errors)[0], { fields: errors })
  const row = {
    part_id: nz(tidy(input.part_id, 64)), vendor_id: vendorId || null, description, kind, qty, amount, status, opened_on: opened, credited_on: status === 'credited' ? credited : null,
    reference: nz(tidy(input.reference, 80)), note: nz(tidy(input.note, 500)), updated_by: actor.userId, updated_at: new Date().toISOString(),
  }
  const cols = 'id,part_id,vendor_id,description,kind,qty,amount,status,opened_on,credited_on,reference,note'
  const key = tidy(id, 64)
  const res = key
    ? await db.from('part_returns').update(row).eq('id', key).eq('shop_id', shopId).select(cols).maybeSingle()
    : await db.from('part_returns').insert({ ...row, shop_id: shopId, created_by: actor.userId }).select(cols).maybeSingle()
  if (res.error) return failed(res.error, 'Saving the return')
  if (!res.data) return fail(404, 'That return was not found.')
  return { ok: true, ret: returnFrom(res.data) }
}

/* ---------- purchase orders ---------- */

const PO_COLUMNS = 'id,po_number,vendor_id,vendor_name,status,notes,expected_on,created_at,sent_at,sent_to,send_started_at'
const LINE_COLUMNS = 'id,po_id,position,part_id,description,sku,qty,unit_cost,core_charge,qty_received'

export async function loadPo(db: Db, shopId: string, id: string): Promise<{ ok: true; po: PurchaseOrder; startedSend: boolean } | Failure> {
  const o = await db.from('purchase_orders').select(PO_COLUMNS).eq('id', id).eq('shop_id', shopId).maybeSingle()
  if (o.error) return failed(o.error, 'Reading the order')
  if (!o.data) return fail(404, 'That order was not found.')
  const l = await db.from('purchase_order_lines').select(LINE_COLUMNS).eq('po_id', id).eq('shop_id', shopId).limit(500)
  if (l.error) return failed(l.error, 'Reading the order')
  return { ok: true, po: poFrom(o.data, l.data || []), startedSend: !!o.data.send_started_at }
}

export async function savePoDraft(db: Db, shopId: string, actor: Actor, id: unknown, input: Row): Promise<{ ok: true; id: string; po_number: string } | Failure> {
  const c = checkPo(input)
  if (!c.ok) return fail(400, c.errors[0], { fields: { lines: c.errors.join(' ') } })
  const v = c.value
  let vendorName = v.vendor_name
  if (v.vendor_id) {
    const ven = await db.from('vendors').select('name').eq('id', v.vendor_id).eq('shop_id', shopId).maybeSingle()
    if (ven.error) return failed(ven.error, 'Saving the order')
    if (!ven.data) return fail(404, 'That vendor was not found.')
    vendorName = String(ven.data.name)
  }
  const r = await db.rpc('po_save_draft', {
    p_shop_id: shopId, p_po_id: tidy(id, 64) || null, p_vendor_id: v.vendor_id, p_vendor_name: vendorName, p_notes: v.notes, p_expected_on: v.expected_on,
    p_lines: v.lines.map(l => ({ part_id: l.part_id, description: l.description, sku: l.sku, qty: l.qty, unit_cost: l.unit_cost, core_charge: l.core_charge })), p_actor_id: actor.userId,
  })
  if (r.error) {
    if (r.error.code === 'P0001') return fail(409, 'Only a draft order can be changed.', { conflict: true })
    if (r.error.code === 'P0002') return fail(404, r.error.message || 'Something on this order was not found.')
    if (r.error.code === '22023') return fail(400, r.error.message || 'Check the order.')
    return failed(r.error, 'Saving the order')
  }
  const d = (r.data || {}) as Row
  return { ok: true, id: String(d.id), po_number: String(d.po_number) }
}

export interface PoPreview { to: string; subject: string; text: string; token: string; po: PurchaseOrder; vendor: Vendor | null }

const tokenOf = (to: string, subject: string, text: string) => createHash('sha256').update(JSON.stringify([to, subject, text])).digest('hex').slice(0, 24)

/** Exactly what would be emailed, and a token for it. Sending needs the same token back, so only what was looked at can go out. */
export async function previewPo(db: Db, shopId: string, id: string, shop: ShopFacts): Promise<{ ok: true; preview: PoPreview } | Failure> {
  const loaded = await loadPo(db, shopId, id)
  if (!loaded.ok) return loaded
  const po = loaded.po
  let vendor: Vendor | null = null
  if (po.vendor_id) {
    const v = await db.from('vendors').select(VENDOR_COLUMNS).eq('id', po.vendor_id).eq('shop_id', shopId).maybeSingle()
    if (v.error) return failed(v.error, 'Reading the vendor')
    if (v.data) vendor = vendorFrom(v.data)
  }
  const msg = poMessage(po, { name: vendor?.name || po.vendor_name, contact: vendor?.contact }, shop)
  const to = vendor?.email || ''
  return { ok: true, preview: { to, subject: msg.subject, text: msg.text, token: tokenOf(to, msg.subject, msg.text), po, vendor } }
}

export type Mailer = (mail: { to: string; subject: string; html: string; text: string; replyTo?: string; idempotencyKey?: string }) => Promise<void>

/**
 * Emails an order to the vendor after the owner approved the exact message. The order is claimed before anything is sent, so a
 * second tap cannot send it twice; if sending fails the claim is released; if the send worked but recording it did not, the order
 * stays claimed and the answer says so.
 */
export async function sendPo(db: Db, shopId: string, actor: Actor, id: string, token: string, shop: ShopFacts, send: Mailer): Promise<{ ok: true; sentTo: string; recorded: boolean } | Failure> {
  const p = await previewPo(db, shopId, id, shop)
  if (!p.ok) return p
  const { preview } = p
  if (preview.po.status !== 'draft') return fail(409, 'This order has already been sent.', { conflict: true })
  if (!preview.po.lines.length) return fail(400, 'Add at least one part to the order.')
  if (!preview.to || !isEmail(preview.to)) return fail(400, `${preview.vendor?.name || 'This vendor'} has no email address on file. Add one to the vendor, or place the order another way and mark it as sent.`)
  if (!token || token !== preview.token) return fail(409, 'The order or the vendor changed since you looked at it. Review it again before sending.', { conflict: true })

  const claim = await db.from('purchase_orders').update({ send_started_at: new Date().toISOString(), updated_by: actor.userId }).eq('id', id).eq('shop_id', shopId).eq('status', 'draft').is('send_started_at', null).select('id').maybeSingle()
  if (claim.error) return failed(claim.error, 'Sending the order')
  if (!claim.data) return fail(409, 'A send for this order was already started. If you are not sure it went out, check your sent mail, then use "I already sent it".', { conflict: true })

  try {
    await send({ to: preview.to, subject: preview.subject, html: poHtml(preview.po, { name: preview.vendor?.name || preview.po.vendor_name, contact: preview.vendor?.contact, account_number: preview.vendor?.account_number }, shop), text: preview.text, replyTo: shop.email || undefined, idempotencyKey: `po:${id}` })
  } catch (e) {
    console.error('[inventory] order email:', e instanceof Error ? e.message : e)
    await db.from('purchase_orders').update({ send_started_at: null }).eq('id', id).eq('shop_id', shopId).eq('status', 'draft')
    return fail(502, 'The email could not be sent, so nothing was recorded. Try again, or place the order another way.')
  }
  const done = await db.rpc('po_mark_sent', { p_shop_id: shopId, p_po_id: id, p_sent_to: preview.to, p_via: 'email', p_actor_id: actor.userId, p_actor_name: actor.name })
  return { ok: true, sentTo: preview.to, recorded: !done.error }
}

/** For an order placed by phone or on a vendor's website: record it as sent without emailing. */
export async function markPoSent(db: Db, shopId: string, actor: Actor, id: string, via: string): Promise<{ ok: true; already: boolean } | Failure> {
  const r = await db.rpc('po_mark_sent', { p_shop_id: shopId, p_po_id: id, p_sent_to: tidy(via, 300) || 'placed outside Alpha Desk', p_via: 'manual', p_actor_id: actor.userId, p_actor_name: actor.name })
  if (r.error) {
    if (r.error.code === 'P0002') return fail(404, 'That order was not found.')
    if (r.error.code === 'P0001') return fail(409, r.error.message || 'This order cannot be marked sent.', { conflict: true })
    return failed(r.error, 'Marking the order sent')
  }
  return { ok: true, already: (r.data as Row | null)?.already === true }
}

export async function cancelPo(db: Db, shopId: string, actor: Actor, id: string): Promise<{ ok: true; already: boolean } | Failure> {
  const r = await db.rpc('po_cancel', { p_shop_id: shopId, p_po_id: id, p_actor_id: actor.userId, p_actor_name: actor.name })
  if (r.error) {
    if (r.error.code === 'P0002') return fail(404, 'That order was not found.')
    if (r.error.code === 'P0001') return fail(409, r.error.message || 'This order cannot be cancelled.', { conflict: true })
    return failed(r.error, 'Cancelling the order')
  }
  return { ok: true, already: (r.data as Row | null)?.already === true }
}

export interface ReceiveInput { receipt_key?: unknown; items?: unknown; allow_over?: unknown; cost_method?: unknown; bill?: unknown }

/** What the caller knows about the signed-in person and the day, so a bill is only added by someone who may and on the shop's date. */
export interface ReceiveOptions { mayBill: boolean; todayKey: string }

/**
 * The bill that goes with a delivery: one bill in Accounting for the parts that came in, under "Parts bought", with the order number
 * on it so the bill can be matched to the paper one. It is added only when the person asked, only for someone who may enter bills, and
 * only when the delivery itself was counted for the first time (a repeat of the same delivery adds nothing). A bill that cannot be added
 * never undoes the delivery; the screen is told why and the bill can be entered by hand.
 */
async function billForDelivery(db: Db, shopId: string, actor: Actor, po: PurchaseOrder, ask: Row, opts: ReceiveOptions): Promise<BillOutcome> {
  if (!opts.mayBill) return { state: 'skipped', message: 'The delivery was checked in. Only an owner, admin or manager can add the bill to Accounting, so ask one of them to enter it.' }
  try {
    let vendor = tidy(po.vendor_name, 120)
    if (!vendor && po.vendor_id) {
      const v = await db.from('vendors').select('name').eq('id', po.vendor_id).eq('shop_id', shopId).maybeSingle()
      vendor = tidy(v.data?.name, 120)
    }
    if (!vendor) return { state: 'failed', message: 'The delivery was checked in, but the order has no vendor name, so the bill was not added. Enter it in Accounting.' }
    const receipts = await db.from('po_receipts').select('id').eq('po_id', po.id).limit(500)
    const reference = billReference(po.po_number, Math.max(1, (receipts.data || []).length))
    const paid = ask.paid === true
    const made = await addExpense(db, shopId, actor, {
      date: opts.todayKey, vendor, category: 'parts', amount: ask.amount, reference, memo: `Parts received on ${po.po_number}`,
      paid: paid, paid_on: paid ? opts.todayKey : '',
    }, opts.todayKey)
    if (made.ok) return { state: 'added', amount: made.expense.amount, paid: !!made.expense.paid_on, vendor, reference }
    if (made.duplicate) return { state: 'duplicate', message: `The delivery was checked in. A bill from ${vendor} for the same amount on the same day is already in Accounting, so a second one was not added.` }
    if (made.fields?.amount) return { state: 'failed', message: `The delivery was checked in, but the bill was not added. ${made.fields.amount} Enter it in Accounting.` }
    return { state: 'failed', message: `The delivery was checked in, but the bill was not added. ${made.message}` }
  } catch (e) {
    console.error('[inventory] delivery bill:', e instanceof Error ? e.message : e)
    return { state: 'failed', message: 'The delivery was checked in, but the bill was not added. Enter it in Accounting.' }
  }
}

/** Checks a delivery in. Counts go up, "on order" goes down, and cost updates the way the person chose. Repeating the same key counts once. */
export async function receivePo(db: Db, shopId: string, actor: Actor, id: string, input: ReceiveInput, opts: ReceiveOptions = { mayBill: false, todayKey: '' }): Promise<{ ok: true; status: PoStatus; duplicate: boolean; missing: string[]; bill: BillOutcome | null } | Failure> {
  const key = tidy(input.receipt_key, 80)
  if (key.length < 8) return fail(400, 'The delivery could not be checked for repeats. Refresh and try again.')
  const method = (['keep', 'latest', 'average'] as CostMethod[]).find(m => m === input.cost_method)
  if (!method) return fail(400, 'Choose how to update the cost.')
  const items = (Array.isArray(input.items) ? input.items : []).map(i => { const o = (i && typeof i === 'object' ? i : {}) as Row; return { lineId: tidy(o.line_id, 64), qty: Number(o.qty) || 0 } })
  const loaded = await loadPo(db, shopId, id)
  if (!loaded.ok) return loaded
  // A delivery that was already counted (a retry after a dropped connection) is answered as "already counted" by the database function.
  // Checking it again against the order as it is now would call it "more than was ordered", which is wrong: it was fine when it was counted.
  const seen = await db.from('po_receipts').select('receipt_key').eq('po_id', id).eq('receipt_key', key).limit(1)
  const repeat = !seen.error && (seen.data || []).length > 0
  const check = checkReceipt(loaded.po, items, input.allow_over === true)
  if (!repeat && !check.ok) return fail(400, check.problems[0], { fields: { items: check.problems.join(' ') } })
  const ask = input.bill && typeof input.bill === 'object' && !Array.isArray(input.bill) && (input.bill as Row).add === true ? (input.bill as Row) : null
  // A bill that cannot be right is refused before anything is counted, so nobody has to undo a delivery to fix a typo in the amount.
  if (ask) {
    const amount = money(ask.amount)
    if (amount === null || Number.isNaN(amount) || amount <= 0) return fail(400, 'Enter the amount on the vendor\'s bill as a number, like 245.50, or turn off adding the bill.', { fields: { bill: 'Enter the amount on the vendor\'s bill as a number, like 245.50.' } })
    if (amount > 10_000_000) return fail(400, 'That bill amount is more than ten million dollars. Check it.', { fields: { bill: 'That bill amount is more than ten million dollars.' } })
  }
  const r = await db.rpc('receive_po_lines', {
    p_shop_id: shopId, p_po_id: id, p_receipt_key: key, p_items: items.filter(i => i.qty > 0).map(i => ({ line_id: i.lineId, qty: i.qty })), p_allow_over: input.allow_over === true,
    p_cost_method: method, p_actor_id: actor.userId, p_actor_name: actor.name,
  })
  if (r.error) {
    if (r.error.code === '23514') return fail(409, (r.error.message || 'More arrived than was ordered.').replace(/^.*?:\s*/, ''), { conflict: true })
    if (r.error.code === 'P0001') return fail(409, r.error.message || 'This order cannot be received.', { conflict: true })
    if (r.error.code === 'P0002') return fail(404, r.error.message || 'That order was not found.')
    if (r.error.code === '22023') return fail(400, r.error.message || 'Check the delivery.')
    return failed(r.error, 'Checking in the delivery')
  }
  const d = (r.data || {}) as Row
  const duplicate = d.duplicate === true
  // The same delivery sent twice (a retry) counted once, so it also gets one bill: nothing is added the second time.
  const bill = ask && !duplicate ? await billForDelivery(db, shopId, actor, loaded.po, ask, opts) : null
  return { ok: true, status: STATUSES.includes(d.status as PoStatus) ? (d.status as PoStatus) : 'partial', duplicate, missing: Array.isArray(d.missing) ? d.missing.map(String) : [], bill }
}
