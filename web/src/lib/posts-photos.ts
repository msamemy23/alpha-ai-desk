// Photos for repair posts: which photos belong together, which ones are worth posting, and the privacy clean-up of the
// picture bytes themselves (location and camera data come out before anything leaves the shop).
//
// Pure: no database, no network, relative imports only, so the browser, the server and `node --test` run the same code.

export type PhotoRating = 'green' | 'yellow' | 'red'

/** One picture on one inspection, with what can be known about it without looking at the pixels. */
export interface PhotoCandidate {
  /** `storage:<inspection id>/<file>.jpg`, or `inrow:<inspection id>:<n>` for a picture kept inside the inspection row. */
  ref: string
  dviId: string
  jobId: string | null
  section: string
  itemName: string
  rating: PhotoRating | null
  note: string
  /** File size in bytes. 0 when it could not be read. */
  bytes: number
  width: number | null
  height: number | null
  /** Position in the inspection checklist, so the set can be shown in the order the car was checked. */
  order: number
  inRow: boolean
}

const clamp = (n: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, n))
const round2 = (n: number): number => Math.round(n * 100) / 100

/* ---------- reading and cleaning the picture bytes ---------- */

export type ImageInfo = { type: 'jpeg' | 'png'; width: number; height: number }

const be16 = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1]
const be32 = (b: Uint8Array, i: number): number => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const ascii = (b: Uint8Array, from: number, to: number): string => {
  let s = ''
  for (let i = from; i < to && i < b.length; i++) s += String.fromCharCode(b[i])
  return s
}

/** Width and height of a JPEG or PNG from its header. Only the first few kilobytes are needed. Null for anything else. */
export function imageInfo(b: Uint8Array): ImageInfo | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    if (ascii(b, 12, 16) !== 'IHDR') return null
    const width = be32(b, 16)
    const height = be32(b, 20)
    return width > 0 && height > 0 ? { type: 'png', width, height } : null
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let i = 2
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const m = b[i + 1]
    if (m === 0xff) { i++; continue }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue }
    if (m === 0xd9 || m === 0xda) return null
    const len = be16(b, i + 2)
    if (len < 2) return null
    const sof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc
    if (sof) {
      if (i + 8 >= b.length) return null
      const height = be16(b, i + 5)
      const width = be16(b, i + 7)
      return width > 0 && height > 0 ? { type: 'jpeg', width, height } : null
    }
    i += 2 + len
  }
  return null
}

export type StripResult =
  | { ok: true; bytes: Uint8Array; type: 'jpeg' | 'png'; removed: string[]; changed: boolean }
  | { ok: false; reason: 'type' | 'damaged' }

/** The EXIF orientation (1 to 8) inside an APP1 segment, or 1 when there is none or it cannot be read. */
function exifOrientation(seg: Uint8Array): number {
  const t = 10 // marker (2) + length (2) + "Exif\0\0" (6)
  if (seg.length < t + 14) return 1
  const little = seg[t] === 0x49 && seg[t + 1] === 0x49
  if (!little && !(seg[t] === 0x4d && seg[t + 1] === 0x4d)) return 1
  const u16 = (i: number): number => (little ? seg[i] | (seg[i + 1] << 8) : (seg[i] << 8) | seg[i + 1])
  const u32 = (i: number): number => (little ? (seg[i] | (seg[i + 1] << 8) | (seg[i + 2] << 16) | (seg[i + 3] << 24)) >>> 0 : ((seg[i] << 24) | (seg[i + 1] << 16) | (seg[i + 2] << 8) | seg[i + 3]) >>> 0)
  if (u16(t + 2) !== 42) return 1
  const ifd = t + u32(t + 4)
  if (ifd + 2 > seg.length) return 1
  const n = u16(ifd)
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (e + 12 > seg.length) return 1
    if (u16(e) === 0x0112) {
      const v = u16(e + 8)
      return v >= 1 && v <= 8 ? v : 1
    }
  }
  return 1
}

/** A tiny EXIF block holding only the orientation, so a sideways photo still opens the right way up. */
function orientationOnly(o: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, o, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ])
}

const join = (pieces: Uint8Array[]): Uint8Array => {
  let n = 0
  for (const p of pieces) n += p.length
  const out = new Uint8Array(n)
  let at = 0
  for (const p of pieces) { out.set(p, at); at += p.length }
  return out
}

function stripJpeg(b: Uint8Array): StripResult {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return { ok: false, reason: 'damaged' }
  const kept: Uint8Array[] = []
  const removed: string[] = []
  let orientation = 1
  let i = 2
  let finished = false
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return { ok: false, reason: 'damaged' }
    let m = b[i + 1]
    while (m === 0xff && i + 2 < b.length) { i++; m = b[i + 1] }
    if (m === 0xd9) { kept.push(b.subarray(i, i + 2)); finished = true; i = b.length; break }
    if (m === 0xda) {
      // The picture data. Everything up to the first end-of-image marker is kept; anything after it is not part of the picture.
      let end = -1
      for (let k = i + 2; k + 1 < b.length; k++) if (b[k] === 0xff && b[k + 1] === 0xd9) { end = k + 2; break }
      if (end < 0) return { ok: false, reason: 'damaged' }
      kept.push(b.subarray(i, end))
      if (end < b.length) removed.push('trailer')
      finished = true
      i = b.length
      break
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { kept.push(b.subarray(i, i + 2)); i += 2; continue }
    if (i + 3 >= b.length) return { ok: false, reason: 'damaged' }
    const len = be16(b, i + 2)
    if (len < 2 || i + 2 + len > b.length) return { ok: false, reason: 'damaged' }
    const seg = b.subarray(i, i + 2 + len)
    let drop = false
    if (m === 0xe1) {
      drop = true
      if (ascii(seg, 4, 8) === 'Exif') { removed.push('exif'); orientation = Math.max(orientation, exifOrientation(seg)) } else removed.push('xmp')
    } else if (m === 0xe2 && ascii(seg, 4, 7) === 'MPF') { drop = true; removed.push('multi-picture') }
    else if (m === 0xed) { drop = true; removed.push('iptc') }
    else if (m === 0xfe) { drop = true; removed.push('comment') }
    else if (m >= 0xe3 && m <= 0xef && m !== 0xee) { drop = true; removed.push('app-data') }
    if (!drop) kept.push(seg)
    i += 2 + len
  }
  if (!finished) return { ok: false, reason: 'damaged' }
  const head = b.subarray(0, 2)
  const body = orientation > 1 ? [head, orientationOnly(orientation), ...kept] : [head, ...kept]
  const unique = [...new Set(removed)]
  return { ok: true, bytes: join(body), type: 'jpeg', removed: unique, changed: unique.length > 0 }
}

const PNG_DROP = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME'])

function stripPng(b: Uint8Array): StripResult {
  if (b.length < 20) return { ok: false, reason: 'damaged' }
  const kept: Uint8Array[] = [b.subarray(0, 8)]
  const removed: string[] = []
  let i = 8
  let ended = false
  while (i + 12 <= b.length) {
    const len = be32(b, i)
    const type = ascii(b, i + 4, i + 8)
    const total = 12 + len
    if (i + total > b.length) return { ok: false, reason: 'damaged' }
    if (PNG_DROP.has(type)) removed.push(type === 'eXIf' ? 'exif' : type === 'tIME' ? 'time' : 'text')
    else kept.push(b.subarray(i, i + total))
    i += total
    if (type === 'IEND') { ended = true; break }
  }
  if (!ended) return { ok: false, reason: 'damaged' }
  if (i < b.length) removed.push('trailer')
  const unique = [...new Set(removed)]
  return { ok: true, bytes: join(kept), type: 'png', removed: unique, changed: unique.length > 0 }
}

/**
 * Takes the location, camera and other hidden data out of a picture, without touching the pixels. JPEG and PNG only:
 * any other kind is refused rather than posted with its data still in it. A sideways phone photo keeps just its
 * orientation so it still opens the right way up.
 */
export function stripImageMetadata(b: Uint8Array): StripResult {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8) return stripJpeg(b)
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return stripPng(b)
  return { ok: false, reason: 'type' }
}

/* ---------- scoring ---------- */

/**
 * How much picture detail there is, from file size against pixel count. Every photo in the shop is saved by the same
 * encoder at the same quality, so a soft, dark or featureless photo comes out far smaller than a sharp one.
 * Zero to one.
 */
export function detailScore(c: Pick<PhotoCandidate, 'bytes' | 'width' | 'height'>): number {
  if (c.width && c.height && c.bytes > 0) {
    const bitsPerPixel = (c.bytes * 8) / (c.width * c.height)
    return clamp((bitsPerPixel - 0.35) / (1.8 - 0.35))
  }
  if (c.bytes > 0) return clamp((c.bytes - 50_000) / (450_000 - 50_000))
  return 0.5
}

/** Zero to one: how large the picture is. About 900 pixels on the short side is plenty for a post. */
export function sizeScore(c: Pick<PhotoCandidate, 'width' | 'height'>): number {
  if (!c.width || !c.height) return 0.6
  return clamp(Math.min(c.width, c.height) / 900)
}

export const qualityScore = (c: Pick<PhotoCandidate, 'bytes' | 'width' | 'height'>): number => round2(0.65 * detailScore(c) + 0.35 * sizeScore(c))

const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'was', 'were', 'are', 'not', 'all', 'new', 'old', 'out', 'off', 'one', 'two',
  'replace', 'replaced', 'replacing', 'install', 'installed', 'installing', 'repair', 'repaired', 'service', 'check', 'checked', 'inspect', 'inspection',
  'front', 'rear', 'left', 'right', 'both', 'set', 'kit', 'labor', 'part', 'parts', 'work', 'done', 'customer', 'needs', 'need', 'level', 'condition',
])

/** Short lower-case word stems, without filler. "Front brake pads" gives brake and pad. */
export function stems(text: string): string[] {
  const out: string[] = []
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue
    let w = raw
    if (w.length > 4 && w.endsWith('ing')) w = w.slice(0, -3)
    else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2)
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1)
    if (w.length >= 3 && !out.includes(w)) out.push(w)
  }
  return out
}

/** Zero to one: how much the photo's checklist line has to do with the repair. Neutral when the repair is unknown. */
export function relevance(c: Pick<PhotoCandidate, 'itemName' | 'section' | 'note'>, repair: ReadonlySet<string>): number {
  if (repair.size === 0) return 0.5
  const mine = stems(`${c.itemName} ${c.section} ${c.note}`)
  let hits = 0
  for (const w of mine) if (repair.has(w)) hits += 1
  return clamp(hits / 2)
}

const STATUS_WEIGHT: Record<PhotoRating | 'none', number> = { red: 1, yellow: 0.7, green: 0.25, none: 0.4 }

export function photoScore(c: PhotoCandidate, repair: ReadonlySet<string>): number {
  return round2(0.45 * qualityScore(c) + 0.35 * relevance(c, repair) + 0.2 * STATUS_WEIGHT[c.rating ?? 'none'])
}

const RATING_PHRASE: Record<PhotoRating, string> = { red: 'needs work', yellow: 'worth watching', green: 'looks good' }

/** What the owner sees under a photo: the part and how it was rated. */
export function photoLabel(c: Pick<PhotoCandidate, 'itemName' | 'rating'>): string {
  const name = c.itemName || 'Photo'
  return c.rating ? `${name}, ${RATING_PHRASE[c.rating]}` : name
}

/* ---------- grouping and choosing ---------- */

/** Photos grouped by the job they belong to. Pictures from an inspection that is not linked to a job are left out: there is no one to ask for permission. */
export function groupByJob<T extends { jobId: string | null }>(list: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of list) {
    if (!item.jobId) continue
    const group = out.get(item.jobId)
    if (group) group.push(item)
    else out.set(item.jobId, [item])
  }
  return out
}

export interface Proposal {
  /** The chosen refs, in the order the car was checked. */
  picks: string[]
  /** Why each pick was chosen, in plain words. */
  reasons: Record<string, string>
  /** Why each other photo was left out, in plain words. */
  leftOut: Record<string, string>
  /** Photos that cannot be used at all (too small, or a copy of another). */
  unusable: string[]
  /** One sentence about the set as a whole. Empty when nothing needs saying. */
  note: string
}

export const MIN_PICKS = 3
export const MAX_PICKS = 6
const MIN_SHORT_SIDE = 320
const PER_ITEM = 2

function reasonFor(c: PhotoCandidate, q: number, rel: number): string {
  const bits: string[] = []
  bits.push(q >= 0.6 ? 'Sharp and large enough' : 'Usable')
  if (rel >= 0.5) bits.push('matches the repair')
  else if (c.rating === 'red') bits.push('shows a part that needed work')
  else if (c.rating === 'yellow') bits.push('shows a part worth watching')
  return `${bits.join(', ')}.`
}

/**
 * The best three to six photos of one job for a post. Quality comes from the file (size against pixels, so soft or dark
 * pictures lose), relevance from how the checklist line matches the repair, and no part is shown more than twice.
 * The set comes back in the order the car was checked. If the job has fewer than three usable photos, whatever exists is
 * proposed with a note saying so.
 */
export function proposePhotos(all: readonly PhotoCandidate[], opts: { repairWords?: Iterable<string>; min?: number; max?: number } = {}): Proposal {
  const min = Math.max(1, opts.min ?? MIN_PICKS)
  const max = Math.max(min, opts.max ?? MAX_PICKS)
  const repair = new Set(opts.repairWords ?? [])
  const leftOut: Record<string, string> = {}
  const reasons: Record<string, string> = {}
  if (all.length === 0) return { picks: [], reasons, leftOut, unusable: [], note: 'This job has no photos yet.' }

  type Scored = { c: PhotoCandidate; score: number; q: number; rel: number }
  const usable: Scored[] = []
  const unusable: string[] = []
  const seen = new Set<string>()
  for (const c of all) {
    const short = c.width && c.height ? Math.min(c.width, c.height) : null
    if (short !== null && short < MIN_SHORT_SIDE) { leftOut[c.ref] = 'Too small to look sharp on a phone.'; unusable.push(c.ref); continue }
    const dupKey = c.bytes > 0 ? `${c.itemName}|${c.bytes}` : ''
    if (dupKey && seen.has(dupKey)) { leftOut[c.ref] = 'Looks like a copy of another photo.'; unusable.push(c.ref); continue }
    if (dupKey) seen.add(dupKey)
    const q = qualityScore(c)
    usable.push({ c, score: photoScore(c, repair), q, rel: relevance(c, repair) })
  }
  usable.sort((a, b) => b.score - a.score || a.c.order - b.c.order)

  const top = usable[0]?.score ?? 0
  const bar = Math.max(0.3, top * 0.5)
  const perItem = new Map<string, number>()
  const picked: Scored[] = []
  const take = (s: Scored) => { picked.push(s); perItem.set(s.c.itemName, (perItem.get(s.c.itemName) ?? 0) + 1) }

  for (const s of usable) {
    if (picked.length >= max) break
    if ((perItem.get(s.c.itemName) ?? 0) >= PER_ITEM) continue
    if (picked.length >= min && s.score < bar) continue
    take(s)
  }
  // Not enough yet: relax the bar and the one-part limit, but never use a photo that is nearly empty of detail unless it is all there is.
  if (picked.length < min) {
    for (const s of usable) {
      if (picked.length >= min) break
      if (picked.some(p => p.c.ref === s.c.ref)) continue
      take(s)
    }
  }

  const chosen = new Set(picked.map(p => p.c.ref))
  for (const s of usable) {
    if (chosen.has(s.c.ref)) continue
    leftOut[s.c.ref] = (perItem.get(s.c.itemName) ?? 0) >= PER_ITEM
      ? 'Another photo of the same part is already in the set.'
      : s.q < 0.3 ? 'Looks soft or dark.' : picked.length >= max ? 'The set already has the most photos a post should carry.' : 'Less to do with this repair than the ones chosen.'
  }
  picked.sort((a, b) => a.c.order - b.c.order)
  for (const p of picked) reasons[p.c.ref] = reasonFor(p.c, p.q, p.rel)

  let note = ''
  if (picked.length === 0) note = 'None of this job’s photos are good enough to post.'
  else if (picked.length < min) note = `Only ${picked.length} usable ${picked.length === 1 ? 'photo' : 'photos'}. A post reads best with ${min} or more.`
  return { picks: picked.map(p => p.c.ref), reasons, leftOut, unusable, note }
}

/* ---------- asking the AI to choose (text only: it never sees the pictures) ---------- */

/** The prompt for choosing from photo labels. The model gets part names and ratings only, never a picture, a note, a name or a plate. */
export function aiPickPrompt(cands: readonly PhotoCandidate[], repairLines: readonly string[]): { system: string; user: string } {
  // Technician notes stay on the server: free text could carry a name or a plate, and the model only needs the part and its rating.
  const list = cands.map((c, i) => `${i + 1}. ${photoLabel(c)}`).join('\n')
  return {
    system: `You choose which photos from one auto repair job go together in one social media post. You are given only the name of the part each photo shows and how it was rated. Choose ${MIN_PICKS} to ${MAX_PICKS} photos that tell the story of the repair, favour the parts that were repaired, and do not choose two photos of the same part unless there are no others. Reply with JSON only, like {"picks":[2,5,1]}, using the numbers in the list.`,
    user: `Repair: ${repairLines.length ? repairLines.join('; ') : 'not described'}\nPhotos:\n${list}`,
  }
}

/** Reads the model's answer back into 1-based numbers, or null when it cannot be trusted. */
export function parseAiPick(text: string, count: number): number[] | null {
  const m = /\{[\s\S]*\}/.exec(String(text || ''))
  if (!m) return null
  try {
    const o = JSON.parse(m[0]) as { picks?: unknown }
    if (!Array.isArray(o.picks)) return null
    const out: number[] = []
    for (const v of o.picks) {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isInteger(n) || n < 1 || n > count || out.includes(n)) return null
      out.push(n)
    }
    return out.length >= 1 && out.length <= MAX_PICKS ? out : null
  } catch {
    return null
  }
}

/**
 * Lets the AI's choice replace the heuristic one, without trusting it blindly: photos that cannot be used stay out, a set smaller
 * than three is topped up from the heuristic picks, and the order is still the order the car was checked. `numbers` are the
 * 1-based positions in the list that was sent to the AI (`cands`). Null or unusable answers leave the heuristic proposal alone.
 */
export function applyAiPick(base: Proposal, cands: readonly PhotoCandidate[], numbers: number[] | null): Proposal {
  if (!numbers) return base
  const bad = new Set(base.unusable)
  const refs: string[] = []
  for (const n of numbers) {
    const c = cands[n - 1]
    if (c && !bad.has(c.ref) && !refs.includes(c.ref)) refs.push(c.ref)
  }
  if (refs.length === 0) return base
  for (const ref of base.picks) {
    if (refs.length >= MIN_PICKS) break
    if (!refs.includes(ref)) refs.push(ref)
  }
  const order = new Map(cands.map(c => [c.ref, c.order]))
  refs.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
  const reasons: Record<string, string> = {}
  for (const ref of refs) reasons[ref] = base.reasons[ref] ? `${base.reasons[ref].replace(/\.$/, '')}. Helps tell the story of the repair.` : 'Helps tell the story of the repair.'
  const leftOut: Record<string, string> = { ...base.leftOut }
  for (const ref of refs) delete leftOut[ref]
  for (const c of cands) if (!refs.includes(c.ref) && !leftOut[c.ref]) leftOut[c.ref] = 'Not needed to tell the story.'
  const note = refs.length < MIN_PICKS ? `Only ${refs.length} usable ${refs.length === 1 ? 'photo' : 'photos'}. A post reads best with ${MIN_PICKS} or more.` : ''
  return { picks: refs, reasons, leftOut, unusable: base.unusable, note }
}
