/**
 * The two public NHTSA lookups: decoding a VIN (vPIC) and listing recalls for a year, make and model. This runs on the
 * server only. It talks to two fixed hosts over https, sends nothing but the VIN or the year, make and model, gives up
 * after a few seconds, refuses redirects, and caps the size of what it reads. Every failure comes back as a plain reason,
 * never a thrown error, so a screen can say "could not reach NHTSA" and carry on. It imports nothing but the VIN helper.
 */
import { cleanVin } from './vin.ts'

export const VPIC_HOST = 'vpic.nhtsa.dot.gov'
export const RECALLS_HOST = 'api.nhtsa.gov'
const ALLOWED_HOSTS = new Set([VPIC_HOST, RECALLS_HOST])
export const LOOKUP_TIMEOUT_MS = 6000
export const MAX_BODY_BYTES = 1_500_000

export type LookupFailure = 'timeout' | 'network' | 'status' | 'too_large' | 'bad_json' | 'blocked'

export function isAllowedUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) && !u.username && !u.password && (u.port === '' || u.port === '443')
  } catch {
    return false
  }
}

export interface FetchLike { (url: string, init?: Record<string, unknown>): Promise<{ ok: boolean; status: number; text(): Promise<string> }> }

/** One GET to an allowed host, read as JSON. Never throws. */
export async function getJson(url: string, doFetch: FetchLike, timeoutMs: number = LOOKUP_TIMEOUT_MS): Promise<{ ok: true; json: unknown } | { ok: false; reason: LookupFailure }> {
  if (!isAllowedUrl(url)) return { ok: false, reason: 'blocked' }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await doFetch(url, { method: 'GET', headers: { Accept: 'application/json' }, redirect: 'error', cache: 'no-store', signal: ctl.signal })
    if (!res.ok) return { ok: false, reason: 'status' }
    const body = await res.text()
    if (body.length > MAX_BODY_BYTES) return { ok: false, reason: 'too_large' }
    try { return { ok: true, json: JSON.parse(body) } } catch { return { ok: false, reason: 'bad_json' } }
  } catch (e) {
    return { ok: false, reason: e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

export const failureText = (r: LookupFailure): string =>
  r === 'timeout' ? 'NHTSA took too long to answer.'
    : r === 'too_large' || r === 'bad_json' ? 'NHTSA sent an answer that could not be read.'
      : r === 'status' ? 'NHTSA is not answering right now.'
        : r === 'blocked' ? 'That lookup is not allowed.'
          : 'NHTSA could not be reached.'

/* ---------- VIN decode ---------- */

export function decodeUrl(vin: string, year?: string | number | null): string {
  const y = year && /^\d{4}$/.test(String(year)) ? `&modelyear=${String(year)}` : ''
  return `https://${VPIC_HOST}/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json${y}`
}

export interface DecodedVehicle {
  vin: string
  year: string
  make: string
  model: string
  trim: string
  engine: string
  body: string
  drive: string
  fuel: string
  transmission: string
  vehicleType: string
  plant: string
}

export interface DecodeOutcome {
  ok: boolean
  vehicle: DecodedVehicle | null
  /** Plain sentences about anything NHTSA flagged (a check digit that does not match, an incomplete VIN). */
  notes: string[]
  /** Why nothing came back, when ok is false. */
  reason: LookupFailure | 'not_found' | 'bad_vin' | null
}

const clean = (v: unknown): string => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return !s || /^not applicable$/i.test(s) ? '' : s
}

const titleCase = (s: string): string => (s === s.toUpperCase() && /[A-Z]{3,}/.test(s) ? s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, a, b) => a + b.toUpperCase()) : s)

/** vPIC writes makes in capitals. Most read better in title case, but a few are initials and stay as they are. */
const KEEP_UPPER = new Set(['BMW', 'GMC', 'RAM', 'FCA', 'MG', 'AMC'])
export const makeName = (s: string): string => (KEEP_UPPER.has(s.toUpperCase()) ? s.toUpperCase() : titleCase(s))

/** Cleans a vPIC DecodeVinValues answer into the fields a repair shop uses. */
export function parseDecode(json: unknown, vin: string): DecodeOutcome {
  const results = json && typeof json === 'object' ? (json as { Results?: unknown }).Results : null
  const row = Array.isArray(results) && results[0] && typeof results[0] === 'object' ? (results[0] as Record<string, unknown>) : null
  if (!row) return { ok: false, vehicle: null, notes: [], reason: 'not_found' }
  const notes: string[] = []
  const code = clean(row.ErrorCode)
  const errText = clean(row.ErrorText)
  if (code && code !== '0' && errText) {
    // "1 - Check Digit (9th position) does not calculate properly; 6 - Incomplete VIN" and so on.
    for (const part of errText.split(';')) {
      const t = clean(part).replace(/^\d+\s*-\s*/, '')
      if (t) notes.push(t.endsWith('.') ? t : `${t}.`)
    }
  }
  const make = makeName(clean(row.Make))
  const model = clean(row.Model)
  const year = clean(row.ModelYear)
  if (!make && !model) return { ok: false, vehicle: null, notes, reason: 'not_found' }
  const disp = Number(clean(row.DisplacementL))
  const cyl = clean(row.EngineCylinders)
  const hp = Number(clean(row.EngineHP))
  const engine = [
    Number.isFinite(disp) && disp > 0 ? `${(Math.round(disp * 10) / 10).toFixed(1)}L` : '',
    cyl ? `${cyl}-cylinder` : '',
    Number.isFinite(hp) && hp > 0 ? `${Math.round(hp)} hp` : '',
  ].filter(Boolean).join(' ')
  const fuel = clean(row.FuelTypePrimary)
  return {
    ok: true,
    notes,
    reason: null,
    vehicle: {
      vin,
      year,
      make,
      model,
      trim: clean(row.Trim) || clean(row.Series),
      engine: [engine, fuel && !/^gasoline$/i.test(fuel) ? fuel : ''].filter(Boolean).join(', '),
      body: clean(row.BodyClass),
      drive: clean(row.DriveType),
      fuel,
      transmission: clean(row.TransmissionStyle),
      vehicleType: clean(row.VehicleType),
      plant: [clean(row.PlantCity), clean(row.PlantCountry).replace(/\s*\(.*?\)/g, '')].filter(Boolean).map(titleCase).join(', '),
    },
  }
}

export async function decodeVin(vin: string, doFetch: FetchLike, year?: string | number | null): Promise<DecodeOutcome> {
  const v = cleanVin(vin)
  if (v.length !== 17) return { ok: false, vehicle: null, notes: [], reason: 'bad_vin' }
  const got = await getJson(decodeUrl(v, year), doFetch)
  if (!got.ok) return { ok: false, vehicle: null, notes: [], reason: got.reason }
  return parseDecode(got.json, v)
}

/* ---------- recalls ---------- */

export interface Recall {
  campaign: string
  component: string
  summary: string
  consequence: string
  remedy: string
  notes: string
  manufacturer: string
  /** yyyy-mm-dd, or '' if NHTSA's date could not be read. */
  reported: string
  /** NHTSA says: do not drive it, or park it outside. */
  parkIt: boolean
  parkOutside: boolean
  overTheAir: boolean
}

/** NHTSA writes dates as dd/mm/yyyy. Anything else is read as a plain ISO date if it is one. */
export function recallDate(raw: unknown): string {
  const s = String(raw ?? '').trim()
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (m) {
    const day = Number(m[1])
    const month = Number(m[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) return ''
    return `${m[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s)
  return iso ? iso[1] : ''
}

export function recallsUrl(v: { year: string | number; make: string; model: string }): string {
  const q = `make=${encodeURIComponent(String(v.make).trim())}&model=${encodeURIComponent(String(v.model).trim())}&modelYear=${encodeURIComponent(String(v.year).trim())}`
  return `https://${RECALLS_HOST}/recalls/recallsByVehicle?${q}`
}

export function parseRecalls(json: unknown): Recall[] {
  const list = json && typeof json === 'object' ? ((json as { results?: unknown; Results?: unknown }).results ?? (json as { Results?: unknown }).Results) : null
  if (!Array.isArray(list)) return []
  const out: Recall[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const campaign = clean(r.NHTSACampaignNumber)
    if (!campaign || seen.has(campaign)) continue
    seen.add(campaign)
    out.push({
      campaign,
      component: clean(r.Component),
      summary: clean(r.Summary),
      consequence: clean(r.Consequence),
      remedy: clean(r.Remedy),
      notes: clean(r.Notes),
      manufacturer: clean(r.Manufacturer),
      reported: recallDate(r.ReportReceivedDate),
      parkIt: r.parkIt === true || r.parkIt === 'true',
      parkOutside: r.parkOutSide === true || r.parkOutSide === 'true',
      overTheAir: r.overTheAirUpdate === true || r.overTheAirUpdate === 'true',
    })
  }
  // Newest first, and anything that says to stop driving at the top.
  out.sort((a, b) => Number(b.parkIt) - Number(a.parkIt) || b.reported.localeCompare(a.reported))
  return out
}

export type RecallOutcome =
  | { ok: true; recalls: Recall[] }
  | { ok: false; reason: LookupFailure | 'bad_input' }

export async function recallsFor(v: { year: string | number; make: string; model: string }, doFetch: FetchLike): Promise<RecallOutcome> {
  const year = String(v.year ?? '').trim()
  if (!/^(19|20)\d{2}$/.test(year) || !String(v.make ?? '').trim() || !String(v.model ?? '').trim()) return { ok: false, reason: 'bad_input' }
  const got = await getJson(recallsUrl({ year, make: v.make, model: v.model }), doFetch)
  if (!got.ok) return got
  return { ok: true, recalls: parseRecalls(got.json) }
}
