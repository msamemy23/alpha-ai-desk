/**
 * Parts and inventory rules: what to reorder, purchase orders and receiving, vendor price comparison, core charges and returns,
 * shelf value, barcodes, and price rules. Plain TypeScript with no framework imports, shared by the screens, the API routes and
 * the tests. It only works things out from the data it is given; saving and sending happen elsewhere, behind approval.
 */
import { normPart, roundCents, stockState } from './list-logic.ts'
import { csvCell } from './reports.ts'

/* ---------- shapes ---------- */

export interface StockPart {
  id: string
  part_number: string
  name: string
  category: string
  brand: string
  cost: number | null
  retail_price: number | null
  qty_on_hand: number | null
  qty_reorder: number | null
  qty_on_order: number | null
  location: string
  supplier: string
  supplier_part_number: string
  last_ordered?: string
  updated_at?: string
  created_at?: string
}

/** Extra facts kept beside a part in a table of their own (so older databases keep working). */
export interface PartExtra {
  part_id: string
  barcode: string
  /** Order up to this many. */
  max_qty: number | null
  /** Vendors sell in cases: order in multiples of this. */
  order_multiple: number | null
  core_charge: number
  preferred_vendor_id: string | null
}

export interface Vendor {
  id: string
  name: string
  email: string
  phone: string
  contact: string
  account_number: string
  address: string
  terms: string
  lead_days: number | null
  notes: string
  active: boolean
}

export interface VendorPrice { id: string; vendor_id: string; part_id: string; vendor_sku: string; price: number; core_charge: number; checked_on: string | null }

const num = (v: unknown, fallback = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : fallback }
const whole = (v: unknown): number => Math.max(0, Math.trunc(num(v)))
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/* ---------- how much has been sold ---------- */

export interface SoldLine { date: string; name: string; qty: number }
export interface Usage { sold: number; perWeek: number; lastSold: string }

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * How many of each stocked part were sold on invoices in the last `days` days. A line counts for a part when its name is the
 * same as the part's name, or contains the part's number (4 characters or more, so short numbers do not match by accident).
 */
export function usageFromSales(lines: SoldLine[], parts: StockPart[], todayKey: string, days = 90): Map<string, Usage> {
  const out = new Map<string, Usage>()
  const from = shiftDay(todayKey, -(days - 1))
  const byName = new Map<string, StockPart[]>()
  for (const p of parts) { const k = nameKey(p.name); if (k) byName.set(k, [...(byName.get(k) || []), p]) }
  const numbers = parts.map(p => ({ p, n: normPart(p.part_number) })).filter(x => x.n.length >= 4)
  for (const l of lines) {
    if (!l.date || l.date < from || l.date > todayKey || !(l.qty > 0)) continue
    const k = nameKey(l.name)
    let hit: StockPart | undefined
    const named = byName.get(k)
    if (named && named.length === 1) hit = named[0]
    if (!hit) {
      const squashed = normPart(l.name)
      const found = numbers.filter(x => squashed.includes(x.n))
      if (found.length === 1) hit = found[0].p
    }
    if (!hit) continue
    const u = out.get(hit.id) || { sold: 0, perWeek: 0, lastSold: '' }
    u.sold += l.qty; if (l.date > u.lastSold) u.lastSold = l.date
    out.set(hit.id, u)
  }
  for (const u of out.values()) u.perWeek = Math.round((u.sold / (days / 7)) * 100) / 100
  return out
}

function shiftDay(k: string, n: number): string {
  const d = new Date(`${k}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ---------- what to reorder ---------- */

export interface Suggestion {
  part: StockPart
  qty: number
  vendorId: string | null
  vendorName: string
  unitCost: number
  /** Why it is on the list, in words. */
  reason: string
  state: 'out' | 'low'
  /** Days of stock left at the recent pace, or null when nothing sold lately. */
  daysLeft: number | null
  /** Where the unit cost came from. */
  costFrom: 'vendor price' | 'last cost' | 'none'
}

export interface ReorderInput {
  parts: StockPart[]
  extras: Map<string, PartExtra>
  vendors: Vendor[]
  prices: VendorPrice[]
  usage: Map<string, Usage>
}

/** A part's cheapest vendor price, then the preferred vendor, then the vendor named on the part, then none. */
function pickVendor(p: StockPart, x: PartExtra | undefined, vendors: Vendor[], prices: VendorPrice[]): { vendor: Vendor | null; price: VendorPrice | null } {
  const active = vendors.filter(v => v.active)
  const mine = prices.filter(r => r.part_id === p.id && active.some(v => v.id === r.vendor_id) && r.price > 0)
  const preferred = x?.preferred_vendor_id ? active.find(v => v.id === x.preferred_vendor_id) : undefined
  if (preferred) return { vendor: preferred, price: mine.find(r => r.vendor_id === preferred.id) || null }
  const named = p.supplier.trim().toLowerCase()
  const byName = named ? active.find(v => v.name.trim().toLowerCase() === named) : undefined
  if (byName) return { vendor: byName, price: mine.find(r => r.vendor_id === byName.id) || null }
  const cheapest = [...mine].sort((a, b) => a.price - b.price)[0]
  if (cheapest) return { vendor: active.find(v => v.id === cheapest.vendor_id) || null, price: cheapest }
  return { vendor: null, price: null }
}

/**
 * Parts at or below their reorder point that are not already covered by what is on order, with a suggested quantity.
 * Parts with no reorder point are only listed when they are out of stock and have sold lately.
 */
export function reorderSuggestions(inp: ReorderInput): Suggestion[] {
  const out: Suggestion[] = []
  for (const p of inp.parts) {
    const have = num(p.qty_on_hand), reorder = whole(p.qty_reorder), onOrder = whole(p.qty_on_order)
    const state = stockState(have, reorder)
    const use = inp.usage.get(p.id)
    if (state === 'ok') continue
    if (state === 'out' && reorder === 0 && !(use && use.sold > 0)) continue
    const position = Math.max(0, have) + onOrder
    if (reorder > 0 && position > reorder) continue
    if (reorder === 0 && position > 0) continue
    const x = inp.extras.get(p.id)
    const target = x?.max_qty && x.max_qty > 0 ? x.max_qty : reorder > 0 ? Math.max(reorder * 2, reorder + 1) : Math.max(1, Math.ceil((use?.perWeek || 0) * 4))
    let qty = Math.max(1, Math.ceil(target - position))
    const multiple = x?.order_multiple && x.order_multiple > 1 ? x.order_multiple : 0
    if (multiple) qty = Math.ceil(qty / multiple) * multiple
    const { vendor, price } = pickVendor(p, x, inp.vendors, inp.prices)
    const unitCost = price ? price.price : num(p.cost)
    out.push({
      part: p, qty, vendorId: vendor?.id ?? null, vendorName: vendor?.name ?? (p.supplier.trim() || ''), unitCost: roundCents(unitCost),
      reason: state === 'out' ? (onOrder > 0 ? `Out of stock, ${onOrder} on order` : 'Out of stock') : `${Math.max(0, have)} left, reorder point is ${reorder}${onOrder > 0 ? `, ${onOrder} on order` : ''}`,
      state: state === 'out' ? 'out' : 'low',
      daysLeft: use && use.perWeek > 0 ? Math.round((Math.max(0, have) / (use.perWeek / 7)) * 10) / 10 : null,
      costFrom: price ? 'vendor price' : unitCost > 0 ? 'last cost' : 'none',
    })
  }
  return out.sort((a, b) => (a.state === b.state ? 0 : a.state === 'out' ? -1 : 1) || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9) || a.part.name.localeCompare(b.part.name))
}

/** Suggestions grouped by vendor, one draft order each. Parts with no vendor go in a group of their own. */
export function groupByVendor(list: Suggestion[]): { vendorId: string | null; vendorName: string; items: Suggestion[]; total: number }[] {
  const m = new Map<string, { vendorId: string | null; vendorName: string; items: Suggestion[]; total: number }>()
  for (const s of list) {
    const k = s.vendorId || `name:${s.vendorName.toLowerCase()}`
    const g = m.get(k) || { vendorId: s.vendorId, vendorName: s.vendorName, items: [], total: 0 }
    g.items.push(s); g.total = roundCents(g.total + s.qty * s.unitCost); m.set(k, g)
  }
  return [...m.values()].sort((a, b) => (a.vendorName ? 0 : 1) - (b.vendorName ? 0 : 1) || b.total - a.total)
}

/* ---------- purchase orders ---------- */

export type PoStatus = 'draft' | 'sent' | 'partial' | 'received' | 'cancelled'
export const PO_STATUS_LABEL: Record<PoStatus, string> = { draft: 'Draft', sent: 'Sent', partial: 'Partly received', received: 'Received', cancelled: 'Cancelled' }

export interface PoLine { id: string; part_id: string | null; description: string; sku: string; qty: number; unit_cost: number; core_charge: number; qty_received: number }
export interface PurchaseOrder {
  id: string
  po_number: string
  vendor_id: string | null
  vendor_name: string
  status: PoStatus
  notes: string
  expected_on: string | null
  created_at: string
  sent_at: string | null
  sent_to: string
  lines: PoLine[]
}

export interface PoTotals { subtotal: number; cores: number; total: number; units: number; received: number; outstanding: number }

export function poTotals(lines: Pick<PoLine, 'qty' | 'unit_cost' | 'core_charge' | 'qty_received'>[]): PoTotals {
  let subtotal = 0, cores = 0, units = 0, received = 0
  for (const l of lines) {
    subtotal += num(l.qty) * num(l.unit_cost); cores += num(l.qty) * num(l.core_charge)
    units += num(l.qty); received += Math.min(num(l.qty), num(l.qty_received))
  }
  return { subtotal: roundCents(subtotal), cores: roundCents(cores), total: roundCents(subtotal + cores), units, received, outstanding: Math.max(0, units - received) }
}

/** The status after receiving: nothing in yet keeps it as sent, some lines short is partial, all in is received. */
export function statusAfterReceiving(po: Pick<PurchaseOrder, 'status' | 'lines'>): PoStatus {
  if (po.status === 'draft' || po.status === 'cancelled') return po.status
  const t = poTotals(po.lines)
  if (t.units > 0 && t.received >= t.units) return 'received'
  return t.received > 0 ? 'partial' : 'sent'
}

export interface PoLineInput { part_id?: unknown; description?: unknown; sku?: unknown; qty?: unknown; unit_cost?: unknown; core_charge?: unknown }
export interface PoInput { vendor_id?: unknown; vendor_name?: unknown; notes?: unknown; expected_on?: unknown; lines?: unknown }
export interface PoWrite { vendor_id: string | null; vendor_name: string; notes: string; expected_on: string | null; lines: Omit<PoLine, 'id' | 'qty_received'>[] }

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00`))

export function checkPo(input: PoInput): { ok: true; value: PoWrite } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const vendorId = clean(input.vendor_id, 64) || null
  const vendorName = clean(input.vendor_name, 120)
  if (!vendorId && !vendorName) errors.push('Choose the vendor this order goes to.')
  const expected = clean(input.expected_on, 10)
  if (expected && !isDay(expected)) errors.push('The expected date is not a real date.')
  const rawLines = Array.isArray(input.lines) ? (input.lines as PoLineInput[]) : []
  if (!rawLines.length) errors.push('Add at least one part to the order.')
  if (rawLines.length > 200) errors.push('An order can have up to 200 lines. Split this into two orders.')
  const lines: PoWrite['lines'] = []
  rawLines.slice(0, 200).forEach((l, i) => {
    const at = `Line ${i + 1}`
    const description = clean(l.description, 200)
    const qty = Math.trunc(num(l.qty))
    const cost = num(l.unit_cost, NaN)
    const core = num(l.core_charge)
    if (!description) errors.push(`${at}: describe the part.`)
    else if (!(qty >= 1) || qty > 100000) errors.push(`${at} (${description}): the quantity must be a whole number, 1 or more.`)
    else if (!Number.isFinite(cost) || cost < 0 || cost > 1_000_000) errors.push(`${at} (${description}): enter what one costs, like 12.50.`)
    else if (core < 0 || core > 1_000_000) errors.push(`${at} (${description}): the core charge cannot be below zero.`)
    else lines.push({ part_id: clean(l.part_id, 64) || null, description, sku: clean(l.sku, 60), qty, unit_cost: roundCents(cost), core_charge: roundCents(core) })
  })
  if (errors.length) return { ok: false, errors }
  return { ok: true, value: { vendor_id: vendorId, vendor_name: vendorName, notes: clean(input.notes, 1000), expected_on: expected || null, lines } }
}

/** "PO-0007". The number comes from a counter kept by the database so two people never get the same one. */
export const poNumberFor = (n: number): string => `PO-${String(Math.max(1, Math.trunc(n))).padStart(4, '0')}`

export interface ReceiveItem { lineId: string; qty: number }
export interface ReceiveCheck {
  ok: boolean
  problems: string[]
  /** Lines whose received total would go above the quantity ordered. Allowed only when the person confirms it. */
  over: { lineId: string; description: string; ordered: number; wouldBe: number }[]
  lines: { lineId: string; partId: string | null; qty: number; unitCost: number; description: string }[]
  units: number
}

/** Checks a receipt against the order before anything is saved. */
export function checkReceipt(po: Pick<PurchaseOrder, 'status' | 'lines'>, items: ReceiveItem[], allowOver = false): ReceiveCheck {
  const problems: string[] = []
  const over: ReceiveCheck['over'] = []
  const lines: ReceiveCheck['lines'] = []
  if (po.status === 'draft') problems.push('This order has not been sent yet. Send it, or mark it sent, before receiving.')
  if (po.status === 'cancelled') problems.push('This order was cancelled.')
  if (po.status === 'received') problems.push('This order is already fully received.')
  const seen = new Set<string>()
  for (const it of items) {
    const line = po.lines.find(l => l.id === it.lineId)
    const qty = Math.trunc(num(it.qty))
    if (!line) { problems.push('A line on this receipt is not on the order.'); continue }
    if (seen.has(line.id)) { problems.push(`${line.description} is listed twice.`); continue }
    seen.add(line.id)
    if (qty === 0) continue
    if (qty < 0 || qty > 100000) { problems.push(`${line.description}: enter how many arrived, 0 or more.`); continue }
    const would = line.qty_received + qty
    if (would > line.qty) over.push({ lineId: line.id, description: line.description, ordered: line.qty, wouldBe: would })
    lines.push({ lineId: line.id, partId: line.part_id, qty, unitCost: line.unit_cost, description: line.description })
  }
  if (!lines.length && !problems.length) problems.push('Enter how many of at least one part arrived.')
  if (over.length && !allowOver) problems.push(`${over.map(o => `${o.description} would be ${o.wouldBe} of ${o.ordered} ordered`).join('; ')}. Confirm if the vendor really sent extra.`)
  return { ok: problems.length === 0, problems, over, lines, units: lines.reduce((s, l) => s + l.qty, 0) }
}

/**
 * What a delivery came to, from the parts that arrived: what each one costs plus any core charge the vendor adds. This is the number
 * offered when the person records the vendor's bill; they can change it to match the paper bill (freight, tax).
 */
export function receiptAmount(po: Pick<PurchaseOrder, 'lines'>, items: ReceiveItem[]): number {
  let total = 0
  for (const it of items) {
    const line = po.lines.find(l => l.id === it.lineId)
    const qty = Math.max(0, Math.trunc(num(it.qty)))
    if (line && qty > 0) total += qty * (num(line.unit_cost) + num(line.core_charge))
  }
  return roundCents(total)
}

/** The reference on the bill: the order number, and "delivery 2" when that order has come in more than once. */
export const billReference = (poNumber: string, deliveryNo: number): string => (deliveryNo > 1 ? `${poNumber} delivery ${Math.trunc(deliveryNo)}` : poNumber)

/** What happened to the bill that goes with a delivery. A bill that was not added never stops the delivery from being checked in. */
export type BillOutcome =
  | { state: 'added'; amount: number; paid: boolean; vendor: string; reference: string }
  | { state: 'duplicate' | 'failed' | 'skipped'; message: string }

/** One sentence for the screen. */
export function billOutcomeWords(b: BillOutcome | null | undefined): string {
  if (!b) return ''
  if (b.state === 'added') return `The bill from ${b.vendor} (${b.reference}) for $${b.amount.toFixed(2)} was added to Accounting${b.paid ? ' as paid' : ' as unpaid'}.`
  return b.message
}

export type CostMethod = 'keep' | 'latest' | 'average'
export const COST_METHODS: { key: CostMethod; label: string; help: string }[] = [
  { key: 'latest', label: 'Use the newest cost', help: 'The part\'s cost becomes what you just paid.' },
  { key: 'average', label: 'Average the cost', help: 'Blend what you just paid with what is on the shelf already.' },
  { key: 'keep', label: 'Leave the cost alone', help: 'Only the count changes.' },
]

/** What a part looks like after some arrive. On order goes down by the same amount, but never below zero. */
export function applyReceipt(part: Pick<StockPart, 'qty_on_hand' | 'qty_on_order' | 'cost'>, qty: number, unitCost: number, method: CostMethod): { qty_on_hand: number; qty_on_order: number; cost: number | null } {
  const had = Math.max(0, num(part.qty_on_hand)), n = Math.max(0, Math.trunc(qty))
  let cost: number | null = part.cost
  if (unitCost > 0 && n > 0) {
    if (method === 'latest') cost = roundCents(unitCost)
    else if (method === 'average') cost = had + n > 0 ? roundCents(((had * num(part.cost)) + (n * unitCost)) / (had + n)) : roundCents(unitCost)
  }
  return { qty_on_hand: had + n, qty_on_order: Math.max(0, num(part.qty_on_order) - n), cost }
}

export interface ShopFacts { name: string; address: string; phone: string; email: string }

/** The order as an email and as plain text. Shown to the person before it is sent, and sent exactly as shown. */
export function poMessage(po: Pick<PurchaseOrder, 'po_number' | 'expected_on' | 'notes' | 'lines'>, vendor: { name: string; contact?: string }, shop: ShopFacts): { subject: string; text: string } {
  const t = poTotals(po.lines)
  const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const hello = vendor.contact?.trim() ? `Hello ${vendor.contact.trim().split(/\s+/)[0]},` : 'Hello,'
  const rows = po.lines.map(l => `  ${l.qty} x ${l.description}${l.sku ? ` (${l.sku})` : ''}  ${usd(l.unit_cost)} each${l.core_charge > 0 ? `, plus ${usd(l.core_charge)} core` : ''}  =  ${usd(l.qty * (l.unit_cost + l.core_charge))}`)
  const lines = [
    hello, '',
    `Please fill this order for ${shop.name.trim() || 'our shop'}.`, '',
    `Purchase order ${po.po_number}`,
    ...rows, '',
    `Subtotal ${usd(t.subtotal)}${t.cores > 0 ? `, core charges ${usd(t.cores)}` : ''}, total ${usd(t.total)}`,
    po.expected_on ? `Needed by ${new Date(`${po.expected_on}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.` : '',
    po.notes ? `Notes: ${po.notes}` : '', '',
    'Please reply to confirm the order, the price and when it will ship. If anything is out of stock, tell us what you can send.', '',
    'Thank you,', shop.name.trim() || '',
    [shop.address, shop.phone, shop.email].map(s => s.trim()).filter(Boolean).join('  |  '),
  ].filter((l, i, a) => !(l === '' && a[i - 1] === ''))
  return { subject: `Purchase order ${po.po_number} from ${shop.name.trim() || 'our shop'}`, text: lines.join('\n').trim() + '\n' }
}

const escHtml = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** The same order as an email page and a print page (the browser saves it as a PDF). */
export function poHtml(po: Pick<PurchaseOrder, 'po_number' | 'expected_on' | 'notes' | 'lines'>, vendor: { name: string; contact?: string; account_number?: string }, shop: ShopFacts, forPrint = false): string {
  const t = poTotals(po.lines)
  const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const cell = 'padding:6px 8px;border-bottom:1px solid #d4d4d4;font-size:13px;'
  const head = `<tr>${['Qty', 'Part', 'Part number', 'Each', 'Core', 'Line total'].map((h, i) => `<th style="${cell}text-align:${i >= 3 ? 'right' : 'left'};color:#555;font-weight:600;">${h}</th>`).join('')}</tr>`
  const body = po.lines.map(l => `<tr><td style="${cell}">${l.qty}</td><td style="${cell}">${escHtml(l.description)}</td><td style="${cell}">${escHtml(l.sku)}</td><td style="${cell}text-align:right;">${usd(l.unit_cost)}</td><td style="${cell}text-align:right;">${l.core_charge > 0 ? usd(l.core_charge) : ''}</td><td style="${cell}text-align:right;">${usd(l.qty * (l.unit_cost + l.core_charge))}</td></tr>`).join('')
  const inner = `<h1 style="font-size:20px;margin:0;color:#1a1a1a;">Purchase order ${escHtml(po.po_number)}</h1>
<p style="margin:2px 0 14px;color:#555;font-size:13px;">${escHtml(shop.name)}${shop.address ? ` &middot; ${escHtml(shop.address)}` : ''}${shop.phone ? ` &middot; ${escHtml(shop.phone)}` : ''}${shop.email ? ` &middot; ${escHtml(shop.email)}` : ''}</p>
<p style="margin:0 0 10px;font-size:14px;color:#1a1a1a;"><strong>To:</strong> ${escHtml(vendor.name)}${vendor.account_number ? ` &middot; Account ${escHtml(vendor.account_number)}` : ''}${po.expected_on ? `<br><strong>Needed by:</strong> ${escHtml(new Date(`${po.expected_on}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}` : ''}</p>
<table style="border-collapse:collapse;width:100%;"><thead>${head}</thead><tbody>${body}</tbody></table>
<p style="margin:12px 0 0;text-align:right;font-size:14px;color:#1a1a1a;">Subtotal ${usd(t.subtotal)}${t.cores > 0 ? ` &middot; Core charges ${usd(t.cores)}` : ''} &middot; <strong>Total ${usd(t.total)}</strong></p>
${po.notes ? `<p style="margin:12px 0 0;font-size:13px;color:#555;">Notes: ${escHtml(po.notes)}</p>` : ''}
<p style="margin:14px 0 0;font-size:13px;color:#555;">Please reply to confirm the order, the price and when it will ship. If anything is out of stock, tell us what you can send.</p>`
  if (forPrint) return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Purchase order ${escHtml(po.po_number)}</title><style>@page{margin:16mm 14mm}body{margin:0 auto;max-width:820px;padding:20px 16px;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;background:#fff}tr{page-break-inside:avoid}</style></head><body>${inner}</body></html>`
  return `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:680px;margin:0 auto;padding:16px;">${inner}</div>`
}

/* ---------- vendor prices ---------- */

export interface Offer { vendor: Vendor; price: number; core: number; vendorSku: string; checkedOn: string | null; saving: number | null; cheapest: boolean }

/** Every vendor's price for a part, cheapest first, with how much it saves against the part's current cost. */
export function compareOffers(partId: string, vendors: Vendor[], prices: VendorPrice[], currentCost: number | null): Offer[] {
  const list = prices.filter(p => p.part_id === partId && p.price > 0).map(p => ({ p, v: vendors.find(v => v.id === p.vendor_id) })).filter((x): x is { p: VendorPrice; v: Vendor } => !!x.v)
  const sorted = list.sort((a, b) => a.p.price - b.p.price || a.v.name.localeCompare(b.v.name))
  const best = sorted[0]?.p.price
  return sorted.map(({ p, v }) => ({
    vendor: v, price: roundCents(p.price), core: roundCents(p.core_charge), vendorSku: p.vendor_sku, checkedOn: p.checked_on,
    saving: currentCost && currentCost > 0 ? roundCents(currentCost - p.price) : null, cheapest: p.price === best,
  }))
}

/** How old a price is, so the screen can warn about one nobody has checked in months. */
export function priceAge(checkedOn: string | null, todayKey: string): { days: number | null; stale: boolean } {
  if (!checkedOn || !isDay(checkedOn)) return { days: null, stale: true }
  const days = Math.round((Date.parse(`${todayKey}T12:00:00`) - Date.parse(`${checkedOn}T12:00:00`)) / 86_400_000)
  return { days, stale: days > 120 }
}

/* ---------- returns and cores ---------- */

export type ReturnKind = 'core' | 'warranty' | 'wrong-part' | 'overstock' | 'damaged'
export type ReturnStatus = 'open' | 'shipped' | 'credited' | 'cancelled'
export const RETURN_KINDS: { key: ReturnKind; label: string }[] = [
  { key: 'core', label: 'Core to send back' }, { key: 'warranty', label: 'Warranty return' }, { key: 'wrong-part', label: 'Wrong part' },
  { key: 'overstock', label: 'Overstock' }, { key: 'damaged', label: 'Damaged on arrival' },
]
export const RETURN_STATUS: { key: ReturnStatus; label: string }[] = [
  { key: 'open', label: 'To send back' }, { key: 'shipped', label: 'Sent, waiting for credit' }, { key: 'credited', label: 'Credit received' }, { key: 'cancelled', label: 'Cancelled' },
]

export interface PartReturn {
  id: string
  part_id: string | null
  vendor_id: string | null
  description: string
  kind: ReturnKind
  qty: number
  /** The credit the vendor owes for it. */
  amount: number
  status: ReturnStatus
  opened_on: string
  credited_on: string | null
  reference: string
  note: string
}

export interface ReturnsSummary { open: number; shipped: number; waitingCredit: number; overdue: number; overdueCredit: number; byVendor: { vendorId: string | null; credit: number; count: number }[] }

/** Returns still to send, and credit still to come. A return is overdue when it has been open more than 30 days. */
export function returnsSummary(list: PartReturn[], todayKey: string): ReturnsSummary {
  const live = list.filter(r => r.status === 'open' || r.status === 'shipped')
  const age = (r: PartReturn) => Math.round((Date.parse(`${todayKey}T12:00:00`) - Date.parse(`${r.opened_on}T12:00:00`)) / 86_400_000)
  const by = new Map<string, { vendorId: string | null; credit: number; count: number }>()
  for (const r of live) { const k = r.vendor_id || ''; const g = by.get(k) || { vendorId: r.vendor_id, credit: 0, count: 0 }; g.credit = roundCents(g.credit + r.amount); g.count += 1; by.set(k, g) }
  const overdue = live.filter(r => age(r) > 30)
  return {
    open: live.filter(r => r.status === 'open').length, shipped: live.filter(r => r.status === 'shipped').length,
    waitingCredit: roundCents(live.reduce((s, r) => s + r.amount, 0)), overdue: overdue.length, overdueCredit: roundCents(overdue.reduce((s, r) => s + r.amount, 0)),
    byVendor: [...by.values()].sort((a, b) => b.credit - a.credit),
  }
}

/* ---------- shelf value ---------- */

export interface ValueRow { category: string; parts: number; units: number; atCost: number; atRetail: number }
export interface Valuation {
  parts: number
  units: number
  atCost: number
  atRetail: number
  potentialProfit: number
  byCategory: ValueRow[]
  /** Parts with no cost written down. Their value counts as zero, so the total is a floor. */
  noCost: StockPart[]
  /** Counts below zero. They count as zero in the value. */
  negative: StockPart[]
  /** On the shelf with no sale in the period the sales cover (only judged when sales are known). */
  slow: { part: StockPart; value: number }[]
  slowValue: number
}

/** `usage` is what sold over the period to judge slow stock by (the screen uses 180 days), or null when sales could not be read. */
export function valuation(parts: StockPart[], usage: Map<string, Usage> | null): Valuation {
  const byCat = new Map<string, ValueRow>()
  let units = 0, atCost = 0, atRetail = 0
  const noCost: StockPart[] = [], negative: StockPart[] = []
  const slow: Valuation['slow'] = []
  for (const p of parts) {
    const have = num(p.qty_on_hand)
    if (have < 0) negative.push(p)
    const n = Math.max(0, have)
    if (n > 0 && !(num(p.cost) > 0)) noCost.push(p)
    const cost = n * num(p.cost), retail = n * num(p.retail_price)
    units += n; atCost += cost; atRetail += retail
    const k = p.category.trim() || 'No category'
    const row = byCat.get(k) || { category: k, parts: 0, units: 0, atCost: 0, atRetail: 0 }
    row.parts += 1; row.units += n; row.atCost = roundCents(row.atCost + cost); row.atRetail = roundCents(row.atRetail + retail); byCat.set(k, row)
    if (usage && n > 0 && cost > 0) {
      const u = usage.get(p.id)
      if (!u || u.sold === 0) slow.push({ part: p, value: roundCents(cost) })
    }
  }
  slow.sort((a, b) => b.value - a.value)
  return {
    parts: parts.length, units, atCost: roundCents(atCost), atRetail: roundCents(atRetail), potentialProfit: roundCents(atRetail - atCost),
    byCategory: [...byCat.values()].sort((a, b) => b.atCost - a.atCost || a.category.localeCompare(b.category)), noCost, negative, slow, slowValue: roundCents(slow.reduce((s, r) => s + r.value, 0)),
  }
}

/* ---------- barcodes and part numbers ---------- */

/** What a scanner or a person typed, tidied: spaces and dashes removed, capitals, and the leading zeros of a scan kept. */
export const normalizeCode = (v: unknown): string => String(v ?? '').replace(/[\s\u0000-\u001f]/g, '').replace(/[-]/g, '').toUpperCase().slice(0, 64)

/** True for a valid UPC-A, EAN-13 or EAN-8 (the check digit adds up). */
export function validBarcode(v: unknown): boolean {
  const s = String(v ?? '').replace(/\D/g, '')
  if (![8, 12, 13].includes(s.length)) return false
  const d = s.split('').map(Number)
  const check = d.pop() as number
  let sum = 0
  d.reverse().forEach((n, i) => { sum += i % 2 === 0 ? n * 3 : n })
  return (10 - (sum % 10)) % 10 === check
}

export type CodeMatch = { part: StockPart; why: 'barcode' | 'part number' | 'vendor part number' | 'starts with' }

/**
 * Parts that go with a code. Exact matches on the barcode, the part number or the vendor's part number come first; if there are none,
 * parts whose number starts with what was typed (4 characters or more) are offered as possibilities.
 */
export function findByCode(parts: StockPart[], extras: Map<string, PartExtra>, code: unknown): CodeMatch[] {
  const c = normalizeCode(code)
  if (!c) return []
  const digits = c.replace(/\D/g, '')
  const exact: CodeMatch[] = []
  for (const p of parts) {
    const x = extras.get(p.id)
    if (x?.barcode && (normalizeCode(x.barcode) === c || (digits.length >= 8 && x.barcode.replace(/\D/g, '') === digits))) { exact.push({ part: p, why: 'barcode' }); continue }
    if (c.length >= 2 && normPart(p.part_number) === c) { exact.push({ part: p, why: 'part number' }); continue }
    if (c.length >= 2 && normPart(p.supplier_part_number) === c) exact.push({ part: p, why: 'vendor part number' })
  }
  if (exact.length) return exact
  if (c.length < 4) return []
  return parts.filter(p => normPart(p.part_number).startsWith(c) || normPart(p.supplier_part_number).startsWith(c)).slice(0, 8).map(part => ({ part, why: 'starts with' as const }))
}

/* ---------- price rules ---------- */

export type RoundTo = 'none' | '0.99' | '0.05' | '1'
export interface PriceTier { min_cost: number; max_cost: number | null; method: 'markup' | 'margin'; pct: number; category: string }
export interface PriceRules { tiers: PriceTier[]; round_to: RoundTo; minimum_price: number }
export const DEFAULT_RULES: PriceRules = { tiers: [], round_to: 'none', minimum_price: 0 }

export function normalizeRules(raw: unknown): PriceRules {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tiers: PriceTier[] = []
  for (const t of (Array.isArray(o.tiers) ? o.tiers : []).slice(0, 20)) {
    const r = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
    const min = num(r.min_cost, 0), max = r.max_cost === null || r.max_cost === '' || r.max_cost === undefined ? null : num(r.max_cost, NaN)
    const pct = num(r.pct, NaN), method = r.method === 'margin' ? 'margin' : 'markup'
    if (!(min >= 0) || (max !== null && !(max > min)) || !Number.isFinite(pct) || pct < 0 || (method === 'margin' && pct >= 95) || pct > 1000) continue
    tiers.push({ min_cost: roundCents(min), max_cost: max === null ? null : roundCents(max), method, pct: Math.round(pct * 100) / 100, category: clean(r.category, 40) })
  }
  const round = ['none', '0.99', '0.05', '1'].includes(String(o.round_to)) ? (o.round_to as RoundTo) : 'none'
  return { tiers, round_to: round, minimum_price: Math.max(0, roundCents(num(o.minimum_price))) }
}

/** Rounds up to the next price that ends the way the shop likes. */
export function roundPrice(price: number, to: RoundTo): number {
  if (!(price > 0)) return 0
  switch (to) {
    case '0.99': return roundCents(Math.ceil(price - 0.99 - 1e-9) + 0.99)
    case '0.05': return roundCents(Math.ceil(price * 20 - 1e-9) / 20)
    case '1': return Math.ceil(price - 1e-9)
    default: return roundCents(price)
  }
}

/** The price for a cost under the rules, or null when no tier covers the cost (the part is left as it is). */
export function priceFor(cost: number, category: string, rules: PriceRules): number | null {
  if (!(cost > 0)) return null
  const cat = category.trim().toLowerCase()
  const fits = (t: PriceTier) => cost >= t.min_cost && (t.max_cost === null || cost < t.max_cost)
  const tier = rules.tiers.find(t => t.category && t.category.toLowerCase() === cat && fits(t)) || rules.tiers.find(t => !t.category && fits(t))
  if (!tier) return null
  const raw = tier.method === 'markup' ? cost * (1 + tier.pct / 100) : cost / (1 - tier.pct / 100)
  return Math.max(roundPrice(raw, rules.round_to), rules.minimum_price, roundCents(cost))
}

export interface Reprice { part: StockPart; from: number | null; to: number; change: number; marginFrom: number | null; marginTo: number }

/** What changing prices by the rules would do, part by part. Nothing is changed here; the screen shows this and asks first. */
export function previewReprice(parts: StockPart[], rules: PriceRules, opts: { onlyRaise?: boolean } = {}): Reprice[] {
  const out: Reprice[] = []
  for (const p of parts) {
    const cost = num(p.cost)
    const to = priceFor(cost, p.category, rules)
    if (to === null) continue
    const from = p.retail_price === null || p.retail_price === undefined ? null : num(p.retail_price)
    if (from !== null && Math.abs(from - to) < 0.005) continue
    if (opts.onlyRaise && from !== null && to < from) continue
    out.push({ part: p, from, to, change: roundCents(to - (from ?? 0)), marginFrom: from && from > 0 ? Math.round(((from - cost) / from) * 1000) / 10 : null, marginTo: Math.round(((to - cost) / to) * 1000) / 10 })
  }
  return out.sort((a, b) => a.part.name.localeCompare(b.part.name))
}

/* ---------- history ---------- */

export const ADJUST_REASONS: { key: string; label: string }[] = [
  { key: 'count', label: 'Counted the shelf' }, { key: 'used', label: 'Used on a job' }, { key: 'received', label: 'Received' },
  { key: 'returned', label: 'Returned to the vendor' }, { key: 'damaged', label: 'Damaged or lost' }, { key: 'correction', label: 'Fixing a mistake' }, { key: 'other', label: 'Something else' },
]
export const reasonLabel = (k: string): string => ADJUST_REASONS.find(r => r.key === k)?.label.toLowerCase() || (k ? k.replace(/[_-]+/g, ' ') : '')

export interface PartHistory { id: string; part_id: string; at: string; actor: string; field: string; before: number | null; after: number | null; reason: string; reference: string; note: string }

const FIELD_WORDS: Record<string, string> = { qty_on_hand: 'on hand', qty_on_order: 'on order', cost: 'cost', retail_price: 'price', qty_reorder: 'reorder point' }

/** "Sam changed on hand from 6 to 4 (used on a job, INV-1001)". */
export function describeHistory(h: PartHistory): string {
  const who = h.actor.trim() || 'Someone'
  const field = FIELD_WORDS[h.field] || h.field.replace(/_/g, ' ')
  const money = h.field === 'cost' || h.field === 'retail_price'
  const fmt = (n: number | null) => (n === null ? 'nothing' : money ? `$${n.toFixed(2)}` : String(n))
  const why = [reasonLabel(h.reason), h.reference.trim(), h.note.trim()].filter(Boolean).join(', ')
  return `${who} changed ${field} from ${fmt(h.before)} to ${fmt(h.after)}${why ? ` (${why})` : ''}.`
}

/* ---------- files ---------- */

const line = (cells: unknown[]) => cells.map(c => (typeof c === 'string' && /^-?\d+(\.\d+)?$/.test(c) ? c : csvCell(c))).join(',')

export function valuationCsv(parts: StockPart[]): string {
  const out = [line(['Part number', 'Name', 'Brand', 'Category', 'Location', 'On hand', 'Cost', 'Price', 'Value at cost', 'Value at price', 'Vendor'])]
  for (const p of [...parts].sort((a, b) => a.name.localeCompare(b.name))) {
    const n = Math.max(0, num(p.qty_on_hand))
    out.push(line([p.part_number, p.name, p.brand, p.category, p.location, num(p.qty_on_hand), (p.cost ?? 0).toFixed(2), (p.retail_price ?? 0).toFixed(2), (n * num(p.cost)).toFixed(2), (n * num(p.retail_price)).toFixed(2), p.supplier]))
  }
  return out.join('\r\n') + '\r\n'
}

export function reorderCsv(list: Suggestion[]): string {
  const out = [line(['Part number', 'Name', 'Vendor', 'On hand', 'On order', 'Reorder point', 'Suggested quantity', 'Unit cost', 'Line total', 'Why'])]
  for (const s of list) out.push(line([s.part.part_number, s.part.name, s.vendorName, num(s.part.qty_on_hand), num(s.part.qty_on_order), num(s.part.qty_reorder), s.qty, s.unitCost.toFixed(2), (s.qty * s.unitCost).toFixed(2), s.reason]))
  return out.join('\r\n') + '\r\n'
}

export function poCsv(po: Pick<PurchaseOrder, 'po_number' | 'lines'>): string {
  const out = [line(['PO number', 'Part number', 'Description', 'Quantity', 'Unit cost', 'Core charge', 'Line total', 'Received'])]
  for (const l of po.lines) out.push(line([po.po_number, l.sku, l.description, l.qty, l.unit_cost.toFixed(2), l.core_charge.toFixed(2), (l.qty * (l.unit_cost + l.core_charge)).toFixed(2), l.qty_received]))
  return out.join('\r\n') + '\r\n'
}
