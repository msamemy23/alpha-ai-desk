// A canned job's vehicle versions, keywords and extra fees as the Canned jobs screen edits them, kept free of React so they can be
// tested on their own.
//
// The base canned job (name, hours, rate, parts) is saved by the Canned jobs screen as it always was. Everything here is the
// optional extra information kept beside it (canned-match.ts, CannedExtras). A version says which cars it fits and may replace the
// job's hours, give a flat labor price, or replace the parts. This file turns what was typed into the stored object, checking every
// row first with the same limits normalizeExtras applies on the server, so nothing is dropped silently. Pricing a job from these
// is still done by buildJobLines in canned-match.ts; nothing here does money maths.

import { normalizeExtras } from '@/lib/canned-match'
import type { CannedExtras, CannedPartRow, JobFee, Variant } from '@/lib/canned-match'

export const MAX_VERSIONS = 30
export const MAX_FEES = 10
export const MAX_KEYWORDS = 20
export const MAX_KEYWORD_LENGTH = 40
export const MAX_LABEL = 60
export const MAX_FEE_NAME = 60
export const MAX_FIT_WORDS = 30
export const MAX_VERSION_PARTS = 30
const MAX_HOURS = 1000
const MAX_MONEY = 1000000

export type FeeKind = JobFee['kind']

export interface PartDraft { key: string; name: string; part_number: string; cost: string; qty: string }
export interface VersionDraft {
  /** The stored id of the version. A new version gets one when it is added. */
  id: string
  label: string
  /** Comma separated, as typed. */
  makes: string
  models: string
  yearFrom: string
  yearTo: string
  /** Empty means the job's own hours. */
  hours: string
  /** Empty means hours times rate. */
  laborPrice: string
  /** False means the job's own parts. True means the rows below replace them, and no rows means no parts. */
  ownParts: boolean
  parts: PartDraft[]
}
export interface FeeDraft { key: string; name: string; amount: string; taxable: boolean; kind: FeeKind }
export interface ExtrasDraft { keywords: string; versions: VersionDraft[]; fees: FeeDraft[] }

export interface PartErrors { name?: string; cost?: string; qty?: string }
export interface VersionErrors {
  label?: string; fit?: string; makes?: string; models?: string; yearFrom?: string; yearTo?: string
  hours?: string; laborPrice?: string; partsLimit?: string
  parts: Record<string, PartErrors>
}
export interface FeeErrors { name?: string; amount?: string }
export interface ExtrasErrors { keywords?: string; versions: Record<string, VersionErrors>; fees: Record<string, FeeErrors> }

export interface ExtrasResult {
  /** The details these rows make, in the form they are stored. Fields with no editor here are carried over from `base`. */
  extras: CannedExtras
  errors: ExtrasErrors
  /** A problem with a list as a whole, or an empty string. */
  problem: string
  /** True when nothing is wrong and the details can be saved. */
  ok: boolean
}

let counter = 0
/** A key for a row on screen that no other row uses. */
export const newDraftKey = (prefix = 'k'): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`

export const blankVersion = (): VersionDraft => ({
  id: newDraftKey('v'), label: '', makes: '', models: '', yearFrom: '', yearTo: '', hours: '', laborPrice: '', ownParts: false, parts: [],
})
export const blankPart = (): PartDraft => ({ key: newDraftKey('p'), name: '', part_number: '', cost: '', qty: '1' })
export const blankFee = (): FeeDraft => ({ key: newDraftKey('f'), name: '', amount: '', taxable: true, kind: 'fee' })

/** A job's own parts as rows, the starting point when a version gets parts of its own. */
export function partsToDrafts(parts: { name?: unknown; part_number?: unknown; cost?: unknown; qty?: unknown }[] | null | undefined): PartDraft[] {
  return (Array.isArray(parts) ? parts : []).map((p) => ({
    key: newDraftKey('p'),
    name: String(p?.name ?? ''),
    part_number: String(p?.part_number ?? ''),
    cost: Number(p?.cost) > 0 ? Number(p.cost).toFixed(2) : '',
    qty: String(Number(p?.qty) >= 1 ? Math.round(Number(p.qty)) : 1),
  }))
}

/** The stored details as rows. */
export function extrasToDraft(ex: CannedExtras): ExtrasDraft {
  const ids = new Set<string>()
  return {
    keywords: ex.keywords.join(', '),
    versions: ex.variants.map((v, i) => {
      let id = v.id || `v${i}`
      while (ids.has(id)) id = `${id}x`
      ids.add(id)
      return {
        id,
        label: v.label,
        makes: v.fit.makes.join(', '),
        models: v.fit.models.join(', '),
        yearFrom: v.fit.yearFrom ? String(v.fit.yearFrom) : '',
        yearTo: v.fit.yearTo ? String(v.fit.yearTo) : '',
        hours: v.hours === null ? '' : String(v.hours),
        laborPrice: v.laborPrice === null ? '' : v.laborPrice.toFixed(2),
        ownParts: v.parts !== null,
        parts: partsToDrafts(v.parts),
      }
    }),
    fees: ex.fees.map((f, i) => ({ key: `f${i}`, name: f.name, amount: f.amount.toFixed(2), taxable: f.taxable, kind: f.kind })),
  }
}

/** The same details, ignoring row keys and the spaces around what was typed. Used to tell whether anything was changed. */
export function sameExtrasDraft(a: ExtrasDraft, b: ExtrasDraft): boolean {
  const flat = (d: ExtrasDraft) => JSON.stringify([
    d.keywords.trim(),
    d.versions.map((v) => [v.id, v.label.trim(), v.makes.trim(), v.models.trim(), v.yearFrom.trim(), v.yearTo.trim(), v.hours.trim(), v.laborPrice.trim(), v.ownParts,
      v.parts.map((p) => [p.name.trim(), p.part_number.trim(), p.cost.trim(), p.qty.trim()])]),
    d.fees.map((f) => [f.name.trim(), f.amount.trim(), f.taxable, f.kind]),
  ])
  return flat(a) === flat(b)
}

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** A comma or new line separated list as typed, without empty entries or repeats (capital letters do not make a repeat). */
export function parseList(s: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const piece of s.split(/[,\n]/)) {
    const word = clean(piece)
    if (word && !seen.has(word.toLowerCase())) { seen.add(word.toLowerCase()); out.push(word) }
  }
  return out
}

const decimal = (s: string): number => {
  const t = s.replace(/[$,\s]/g, '')
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN
}

/** An empty box is fine (null). Anything else must be a 4-digit year, the way the matcher reads it. */
function year(s: string): { value: number | null; bad: boolean } {
  const t = s.trim()
  if (t === '') return { value: null, bad: false }
  const n = /^\d{4}$/.test(t) ? Number(t) : NaN
  return Number.isFinite(n) && n > 1900 && n < 2200 ? { value: n, bad: false } : { value: null, bad: true }
}

const versionIsBlank = (v: VersionDraft): boolean =>
  !v.label.trim() && !v.makes.trim() && !v.models.trim() && !v.yearFrom.trim() && !v.yearTo.trim() && !v.hours.trim() && !v.laborPrice.trim() && !v.ownParts
const partIsBlank = (p: PartDraft): boolean => !p.name.trim() && !p.part_number.trim() && !p.cost.trim() && (p.qty.trim() === '' || p.qty.trim() === '1')
const feeIsBlank = (f: FeeDraft): boolean => !f.name.trim() && !f.amount.trim()

export const versionHasErrors = (e: VersionErrors | undefined): boolean =>
  !!e && (Object.entries(e).some(([k, v]) => k !== 'parts' && !!v) || Object.keys(e.parts).length > 0)

/**
 * Checks what was typed and builds the stored details from it. A row left completely empty is ignored. Details that have no editor
 * here (the job-wide fit, the note for the customer, the inspection words) are kept exactly as they are in `base`.
 */
export function draftToExtras(draft: ExtrasDraft, base: CannedExtras): ExtrasResult {
  const errors: ExtrasErrors = { versions: {}, fees: {} }
  let problem = ''

  const keywords = parseList(draft.keywords)
  if (keywords.length > MAX_KEYWORDS) errors.keywords = `Keep up to ${MAX_KEYWORDS} keywords. Remove ${keywords.length - MAX_KEYWORDS}.`
  else if (keywords.some((k) => k.length > MAX_KEYWORD_LENGTH)) errors.keywords = `Each keyword can be up to ${MAX_KEYWORD_LENGTH} characters. Separate words with commas.`

  const variants: Variant[] = []
  const usedIds = new Set<string>()
  const versionRows = draft.versions.filter((v) => !versionIsBlank(v))
  for (const v of versionRows) {
    const e: VersionErrors = { parts: {} }
    const label = clean(v.label)
    if (!label) e.label = 'Name this version, like “Toyota Camry 2012 to 2018”.'
    else if (label.length > MAX_LABEL) e.label = `Use ${MAX_LABEL} characters or fewer.`

    const makes = parseList(v.makes)
    const models = parseList(v.models)
    if (makes.length > MAX_FIT_WORDS) e.makes = `List up to ${MAX_FIT_WORDS} makes.`
    if (models.length > MAX_FIT_WORDS) e.models = `List up to ${MAX_FIT_WORDS} models.`
    const from = year(v.yearFrom)
    const to = year(v.yearTo)
    if (from.bad) e.yearFrom = 'Enter a 4-digit year, like 2012.'
    if (to.bad) e.yearTo = 'Enter a 4-digit year, like 2018.'
    if (from.value !== null && to.value !== null && from.value > to.value) e.yearTo = 'This year is before the first year.'
    if (!makes.length && !models.length && from.value === null && to.value === null && !from.bad && !to.bad) e.fit = 'Say which cars this fits: a make, a model or a range of years.'

    let hours: number | null = null
    if (v.hours.trim() !== '') {
      const n = decimal(v.hours)
      if (!Number.isFinite(n) || n > MAX_HOURS) e.hours = 'Enter hours, like 1.5, or leave empty to use the job’s hours.'
      else hours = n
    }
    let laborPrice: number | null = null
    if (v.laborPrice.trim() !== '') {
      const n = decimal(v.laborPrice)
      if (!Number.isFinite(n) || n > MAX_MONEY) e.laborPrice = 'Enter a price, like 150.00, or leave empty to charge hours times the rate.'
      else laborPrice = Math.round(n * 100) / 100
    }

    let parts: CannedPartRow[] | null = null
    if (v.ownParts) {
      parts = []
      const rows = v.parts.filter((p) => !partIsBlank(p))
      if (rows.length > MAX_VERSION_PARTS) e.partsLimit = `Keep up to ${MAX_VERSION_PARTS} parts on a version.`
      for (const p of rows) {
        const pe: PartErrors = {}
        const name = clean(p.name)
        if (!name) pe.name = 'Name this part, or remove it.'
        let cost = 0
        if (p.cost.trim() !== '') {
          const n = decimal(p.cost)
          if (!Number.isFinite(n) || n > MAX_MONEY) pe.cost = 'Enter a price, like 12.50.'
          else cost = Math.round(n * 100) / 100
        }
        const q = decimal(p.qty)
        if (!Number.isInteger(q) || q < 1 || q > 999) pe.qty = 'Enter a whole number, 1 or more.'
        if (pe.name || pe.cost || pe.qty) { e.parts[p.key] = pe; continue }
        parts.push({ name, part_number: clean(p.part_number), cost, qty: q })
      }
    }

    let id = v.id.trim()
    if (!id || usedIds.has(id)) id = newDraftKey('v')
    usedIds.add(id)
    if (versionHasErrors(e)) { errors.versions[v.id] = e; continue }
    variants.push({
      id,
      label,
      fit: { makes, models, yearFrom: from.value, yearTo: to.value },
      hours,
      laborPrice,
      parts,
    })
  }
  if (versionRows.length > MAX_VERSIONS) problem = `You can keep up to ${MAX_VERSIONS} versions of one job. Remove ${versionRows.length - MAX_VERSIONS}.`

  const fees: JobFee[] = []
  const feeRows = draft.fees.filter((f) => !feeIsBlank(f))
  for (const f of feeRows) {
    const e: FeeErrors = {}
    const name = clean(f.name)
    if (!name) e.name = 'Say what the fee is for, like Tire disposal.'
    else if (name.length > MAX_FEE_NAME) e.name = `Use ${MAX_FEE_NAME} characters or fewer.`
    const amount = decimal(f.amount)
    if (!Number.isFinite(amount)) e.amount = 'Enter the amount, like 5.00.'
    else if (amount <= 0) e.amount = 'Enter an amount above $0.00.'
    else if (amount > MAX_MONEY) e.amount = 'That amount is too large.'
    if (e.name || e.amount) { errors.fees[f.key] = e; continue }
    fees.push({ name, amount: Math.round(amount * 100) / 100, taxable: f.taxable, kind: f.kind === 'sublet' ? 'sublet' : 'fee' })
  }
  if (!problem && feeRows.length > MAX_FEES) problem = `You can add up to ${MAX_FEES} fees to one job. Remove ${feeRows.length - MAX_FEES}.`

  const extras = normalizeExtras({ ...base, keywords, variants, fees })
  const bad = !!errors.keywords || Object.keys(errors.versions).length > 0 || Object.keys(errors.fees).length > 0
  // Every valid row must survive the server's own clean-up. If one would not, say so now instead of losing it on save.
  if (!problem && !bad && (extras.variants.length !== variants.length || extras.fees.length !== fees.length || extras.keywords.length !== keywords.length)) {
    problem = 'Some of these could not be kept. Check each version, keyword and fee.'
  }
  return { extras, errors, problem, ok: !bad && !problem }
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** One line on what a job has, for the editor and for messages. */
export function describeExtras(ex: CannedExtras): string {
  const parts: string[] = []
  if (ex.variants.length) parts.push(plural(ex.variants.length, 'version', 'versions'))
  if (ex.keywords.length) parts.push(plural(ex.keywords.length, 'keyword', 'keywords'))
  if (ex.fees.length) parts.push(plural(ex.fees.length, 'extra fee', 'extra fees'))
  return parts.length ? parts.join(', ') : 'Nothing added yet'
}

/** Which cars a version fits, in words: "Toyota Camry, 2012 to 2018". Empty when nothing is chosen yet. */
export function fitSummary(v: Pick<VersionDraft, 'makes' | 'models' | 'yearFrom' | 'yearTo'>): string {
  const cars = [parseList(v.makes).join(' or '), parseList(v.models).join(' or ')].filter(Boolean).join(' ')
  const from = v.yearFrom.trim()
  const to = v.yearTo.trim()
  const years = from && to ? (from === to ? from : `${from} to ${to}`) : from ? `${from} and newer` : to ? `${to} and older` : ''
  return [cars, years].filter(Boolean).join(', ')
}

/** What a version changes, in words, for its row when closed. */
export function versionSummary(v: VersionDraft): string {
  const bits: string[] = []
  const fit = fitSummary(v)
  bits.push(fit || 'No cars chosen yet')
  if (v.laborPrice.trim()) bits.push(`$${v.laborPrice.trim().replace(/^\$/, '')} flat labor`)
  else if (v.hours.trim()) bits.push(`${v.hours.trim()} h`)
  if (v.ownParts) bits.push(plural(v.parts.filter((p) => !partIsBlank(p)).length, 'part', 'parts'))
  return bits.join(' · ')
}
