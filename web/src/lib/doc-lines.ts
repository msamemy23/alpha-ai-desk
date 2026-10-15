// Reading the lines of a document: groups ("jobs"), a flat list for display, and fee lines.
//
// Nothing here changes how a document is priced. Every number comes from document-money.ts. New
// information (which job a line belongs to, a note, a fee flag, a list price before a discount) lives
// in optional fields on the line objects. Old documents do not have those fields and read exactly as
// before: one group, the same lines, the same totals.

import {
  calculateDocumentTotals,
  getLaborFlatAmount,
  laborLineTotal,
  nonNegativeDecimal,
  nonNegativeMoney,
  partLineTotal,
  quantityFromUnknown,
  roundMoney,
} from '@/lib/document-money'

export type Line = Record<string, unknown>

/** Lines with no job name belong to this group. */
export const GENERAL_JOB_KEY = '_general'
export const MAX_JOB_NAME = 80

const text = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

/** A job name as typed, with stray spaces removed. */
export function cleanJobName(value: unknown): string {
  return text(value).replace(/\s+/g, ' ').trim().slice(0, MAX_JOB_NAME)
}

export const jobNameOf = (line: Line): string => cleanJobName(line.job)

/** Same job typed with different capital letters or spacing is one job. */
export function jobKeyOf(name: unknown): string {
  const clean = cleanJobName(name)
  return clean ? clean.toLowerCase() : GENERAL_JOB_KEY
}

const asLines = (v: unknown): Line[] =>
  Array.isArray(v) ? v.filter((line): line is Line => Boolean(line && typeof line === 'object')) : []

export type LineKind = 'part' | 'labor' | 'fee' | 'sublet' | 'core'

/** A part line can be marked as a fee or outside work. It is still priced as a part. */
export function partKind(line: Line): 'part' | 'fee' | 'sublet' {
  return line.kind === 'fee' ? 'fee' : line.kind === 'sublet' ? 'sublet' : 'part'
}

export function partLabel(line: Line): string {
  const name = cleanJobName(line.name) || cleanJobName(line.description)
  if (name) return text(line.name || line.description).trim()
  const brand = text(line.brand).trim()
  return brand ? `${brand} part` : 'Part'
}

export function laborLabel(line: Line): string {
  return text(line.operation || line.description).trim() || 'Labor'
}

export interface JobGroup {
  key: string
  name: string
  /** Index into doc.parts / doc.labors, in document order. */
  partIdx: number[]
  laborIdx: number[]
  labor: number
  parts: number
  core: number
  /** Labor + parts + core for this job, before tax. */
  subtotal: number
  /** Tax this job adds on its own taxable parts (supplies and sublet are not split across jobs). */
  tax: number
  total: number
  lineCount: number
  /** Every line in the job carries the approved marker. */
  approved: boolean
}

type DocLike = Record<string, unknown>

export const isLineApproved = (line: Line): boolean => line.approved === true

/**
 * Splits a document into jobs. Order is first appearance, labor first (customers think of the work,
 * then the parts). Lines without a job go in the general group, shown last when other jobs exist.
 */
export function groupJobs(doc: DocLike): JobGroup[] {
  const parts = asLines(doc.parts)
  const labors = asLines(doc.labors)
  const order: string[] = []
  const map = new Map<string, { name: string; partIdx: number[]; laborIdx: number[] }>()
  const touch = (line: Line) => {
    const name = jobNameOf(line)
    const key = jobKeyOf(name)
    if (!map.has(key)) {
      map.set(key, { name: name || '', partIdx: [], laborIdx: [] })
      order.push(key)
    }
    return map.get(key)!
  }
  labors.forEach((line, i) => touch(line).laborIdx.push(i))
  parts.forEach((line, i) => touch(line).partIdx.push(i))

  const taxRate = calculateDocumentTotals({ tax_rate: doc.tax_rate, apply_tax: doc.apply_tax }).taxRate
  const applyTax = doc.apply_tax !== false
  const keys = order.filter((k) => k !== GENERAL_JOB_KEY).concat(order.includes(GENERAL_JOB_KEY) ? [GENERAL_JOB_KEY] : [])
  const onlyGeneral = keys.length === 1 && keys[0] === GENERAL_JOB_KEY

  return keys.map((key) => {
    const g = map.get(key)!
    const jobParts = g.partIdx.map((i) => parts[i])
    const jobLabors = g.laborIdx.map((i) => labors[i])
    const sub = calculateDocumentTotals({
      parts: jobParts, labors: jobLabors, tax_rate: taxRate, apply_tax: applyTax, shop_supplies: 0, sublet: 0,
    })
    const everything = [...jobParts, ...jobLabors]
    return {
      key,
      name: g.name || (onlyGeneral ? 'Estimate' : 'Other items'),
      partIdx: g.partIdx,
      laborIdx: g.laborIdx,
      labor: sub.laborTotal,
      parts: sub.partsTotal,
      core: sub.coreTotal,
      subtotal: roundMoney(sub.laborTotal + sub.partsTotal + sub.coreTotal),
      tax: sub.taxAmount,
      total: sub.total,
      lineCount: everything.length,
      approved: everything.length > 0 && everything.every(isLineApproved),
    }
  })
}

/** The document with only the chosen jobs left in it. Everything else on the document is kept. */
export function keepJobs(doc: DocLike, keepKeys: Iterable<string>): { parts: Line[]; labors: Line[] } {
  const keep = new Set(keepKeys)
  return {
    parts: asLines(doc.parts).filter((l) => keep.has(jobKeyOf(l.job))),
    labors: asLines(doc.labors).filter((l) => keep.has(jobKeyOf(l.job))),
  }
}

/** One row of the customer-facing list. The same rows feed the signing page, print, and email. */
export interface DisplayLine {
  kind: LineKind
  description: string
  detail: string
  qty: number
  unit: number
  total: number
  /** Price before a discount, for the line total (not each). 0 when there is no discount. */
  listTotal: number
  job: string
  jobKey: string
  note: string
  approved: boolean
  warranty: string
}

const hoursText = (n: number) => String(Math.round(n * 100) / 100)

function laborDetail(line: Line): { detail: string; qty: number; unit: number; flat: boolean } {
  const flat = getLaborFlatAmount(line)
  if (flat !== null) return { detail: 'Flat price', qty: 1, unit: flat, flat: true }
  const hours = nonNegativeDecimal(line.hours)
  const rate = nonNegativeDecimal(line.rate)
  return { detail: `${hoursText(hours)} hr at $${rate.toFixed(2)} per hour`, qty: hours, unit: rate, flat: false }
}

/** Savings on a line (list price minus charged price) as a positive number. */
export function lineSavings(line: Line, kind: 'part' | 'labor'): number {
  if (kind === 'part') {
    const list = nonNegativeDecimal(line.listPrice, 0)
    const price = nonNegativeDecimal(line.unitPrice, 0)
    if (list <= price) return 0
    return roundMoney((list - price) * quantityFromUnknown(line.qty))
  }
  const flat = getLaborFlatAmount(line)
  if (flat !== null) {
    const list = nonNegativeDecimal(line.listAmount, 0)
    return list > flat ? roundMoney(list - flat) : 0
  }
  const list = nonNegativeDecimal(line.listRate, 0)
  const rate = nonNegativeDecimal(line.rate, 0)
  if (list <= rate) return 0
  return roundMoney((list - rate) * nonNegativeDecimal(line.hours))
}

export function displayLines(doc: DocLike): DisplayLine[] {
  const out: DisplayLine[] = []
  const labors = asLines(doc.labors)
  const parts = asLines(doc.parts)
  for (const l of labors) {
    const d = laborDetail(l)
    const total = laborLineTotal(l)
    const savings = lineSavings(l, 'labor')
    out.push({
      kind: 'labor', description: laborLabel(l), detail: d.detail, qty: d.qty, unit: d.unit, total,
      listTotal: savings > 0 ? roundMoney(total + savings) : 0,
      job: jobNameOf(l), jobKey: jobKeyOf(l.job), note: text(l.note).trim(), approved: isLineApproved(l), warranty: '',
    })
  }
  for (const p of parts) {
    const kind = partKind(p)
    const qty = quantityFromUnknown(p.qty)
    const total = partLineTotal(p)
    const savings = lineSavings(p, 'part')
    const brand = text(p.brand).trim()
    const pn = text(p.part_number || p.partNumber).trim()
    const detail = [brand, pn ? `Part ${pn}` : ''].filter(Boolean).join(', ')
    out.push({
      kind, description: partLabel(p), detail, qty, unit: nonNegativeMoney(p.unitPrice), total,
      listTotal: savings > 0 ? roundMoney(total + savings) : 0,
      job: jobNameOf(p), jobKey: jobKeyOf(p.job), note: text(p.note).trim(), approved: isLineApproved(p), warranty: text(p.warranty).trim(),
    })
    const coreAmount = nonNegativeDecimal(p.core)
    const coreTotal = roundMoney(coreAmount * qty)
    if (coreTotal > 0) {
      out.push({
        kind: 'core', description: 'Core charge, refundable', detail: partLabel(p), qty, unit: coreAmount, total: coreTotal, listTotal: 0,
        job: jobNameOf(p), jobKey: jobKeyOf(p.job), note: '', approved: isLineApproved(p), warranty: '',
      })
    }
  }
  return out
}

/** A new fee or outside-work line. Priced as a part, so tax and totals follow the normal rules. */
export function makeFeeLine(input: { name: string; amount: number; taxable: boolean; kind?: 'fee' | 'sublet'; job?: string }): Line {
  const line: Line = {
    name: input.name.trim() || (input.kind === 'sublet' ? 'Outside work' : 'Fee'),
    qty: 1,
    unitPrice: Math.max(0, roundMoney(input.amount)),
    taxable: input.taxable,
    kind: input.kind === 'sublet' ? 'sublet' : 'fee',
  }
  const job = cleanJobName(input.job)
  if (job) line.job = job
  return line
}

/** Job names already used in a document, for the pick list in the editor. */
export function jobNames(doc: DocLike): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const line of [...asLines(doc.labors), ...asLines(doc.parts)]) {
    const name = jobNameOf(line)
    if (name && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase())
      names.push(name)
    }
  }
  return names
}

/** Renames a job across all lines. Returns new arrays; the inputs are not touched. */
export function renameJob(doc: DocLike, from: string, to: string): { parts: Line[]; labors: Line[] } {
  const fromKey = jobKeyOf(from)
  const name = cleanJobName(to)
  const map = (line: Line): Line => {
    if (jobKeyOf(line.job) !== fromKey) return line
    const next = { ...line }
    if (name) next.job = name
    else delete next.job
    return next
  }
  return { parts: asLines(doc.parts).map(map), labors: asLines(doc.labors).map(map) }
}

/** True when at least one line has not been approved by the customer yet. */
export function hasUnapprovedLines(doc: DocLike): boolean {
  const all = [...asLines(doc.parts), ...asLines(doc.labors)]
  return all.some((l) => !isLineApproved(l))
}

/** Marks every current line as approved. Used as the starting point for a supplement. */
export function stampApproved(doc: DocLike): { parts: Line[]; labors: Line[] } {
  const stamp = (l: Line): Line => (l.approved === true ? l : { ...l, approved: true })
  return { parts: asLines(doc.parts).map(stamp), labors: asLines(doc.labors).map(stamp) }
}

/** Lines the customer has not approved yet, as a document body (for the supplement link). */
export function unapprovedOnly(doc: DocLike): { parts: Line[]; labors: Line[] } {
  return {
    parts: asLines(doc.parts).filter((l) => !isLineApproved(l)),
    labors: asLines(doc.labors).filter((l) => !isLineApproved(l)),
  }
}
