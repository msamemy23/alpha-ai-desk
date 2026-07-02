export type RepairProvider = 'LEMON' | 'CHARM' | 'NHTSA' | 'OEM1Stop' | 'AutoZone' | 'Web'
export type RepairCategory = 'manual' | 'procedure' | 'diagram' | 'spec' | 'labor' | 'tsb' | 'recall' | 'complaint' | 'oem_link' | 'shop_draft'
export type RepairConfidence = 'public_manual' | 'official_government' | 'official_oem_index' | 'source_directory' | 'search_result' | 'shop_draft'

export interface RepairVehicle {
  vin?: string
  year?: string
  make?: string
  model?: string
  engine?: string
  trim?: string
  drivetrain?: string
  transmission?: string
  fuel?: string
  bodyClass?: string
  brakeSystem?: string
  adas?: string
  emissions?: string
}

export interface RepairSource {
  id: string
  provider: RepairProvider
  category: RepairCategory
  title: string
  description: string
  url: string
  vehicle: string
  confidence: RepairConfidence
  access: 'free_public' | 'free_account' | 'source_link'
  canStoreContent: boolean
  action: 'open_source' | 'review_before_use'
}

export interface RepairDraft {
  title: string
  status: 'draft_needs_technician_review'
  operation: string
  sourceRequired: boolean
  warnings: string[]
  checklist: string[]
  estimateNotes: string[]
}

export interface RepairSearchResult {
  query: string
  normalizedVehicle: RepairVehicle
  sources: RepairSource[]
  shopProcedures?: RepairShopProcedureSummary[]
  manualMatches: RepairManualMatch[]
  operationLines: RepairOperationLine[]
  estimateDraft: RepairEstimateDraft
  safetyProfile: RepairSafetyProfile
  coverageDashboard: RepairCoverageDashboard
  draft: RepairDraft
  counts: Record<RepairCategory, number>
  workflow: RepairWorkflow
  warnings: string[]
}

export interface RepairWorkflowStep {
  id: string
  label: string
  status: 'ready' | 'needs_source' | 'needs_review'
  detail: string
}

export interface RepairWorkflow {
  vehicleMatch: {
    level: 'exact_vin' | 'year_make_model' | 'partial' | 'unknown'
    label: string
    missing: string[]
    confidence: number
  }
  coverage: {
    hasManual: boolean
    hasOfficialData: boolean
    hasProcedureCandidate: boolean
    hasEstimateReadyDraft: boolean
    hasExactProcedureMatch: boolean
    hasShopProcedure: boolean
  }
  steps: RepairWorkflowStep[]
  safetyGates: string[]
}

export interface RepairManualMatch {
  id: string
  title: string
  url: string
  provider: 'LEMON' | 'CHARM'
  path: string[]
  category: RepairCategory
  matchType: 'exact_procedure' | 'likely_section' | 'diagram_or_spec' | 'general_manual'
  score: number
  hasImages: boolean
  sourceStatus: 'indexed' | 'source_link_only'
  note: string
}

export interface RepairOperationLine {
  id: string
  label: string
  system: string
  kind: 'labor' | 'inspection' | 'parts' | 'fluid'
  side?: 'front' | 'rear' | 'left' | 'right' | 'both' | 'all'
  quantity: number
  sourceStatus: 'needs_source' | 'source_candidate' | 'source_verified'
  risk: 'standard' | 'elevated' | 'critical'
  estimateAmount: number | null
}

export interface RepairEstimateDraft {
  targetTotal: number | null
  totalLocked: boolean
  parts: Array<Record<string, unknown>>
  labors: Array<Record<string, unknown>>
  notes: string
  warnings: string[]
}

export interface RepairSafetyProfile {
  level: 'standard' | 'elevated' | 'critical'
  systems: string[]
  technicianSignoffRequired: boolean
  gates: Array<{
    id: string
    label: string
    reason: string
    required: boolean
  }>
}

export interface RepairCoverageDashboard {
  lemonCharmManual: 'found' | 'missing'
  nhtsaRecalls: 'found' | 'not_found' | 'unknown'
  tsbCommunications: 'link_ready'
  oemOneStop: 'link_ready'
  autoZoneGuide: 'link_ready'
  shopProcedure: 'found' | 'not_found' | 'needs_database'
  indexedPages: number
  indexedLinks: number
  exactMatches: number
  likelyMatches: number
  diagrams: number
  specs: number
}

export interface RepairShopProcedureSummary {
  id: string
  title: string
  operation: string
  status: string
  confidence: string
  updatedAt?: string
}

export interface RepairManualLink {
  title: string
  url: string
  provider: 'LEMON' | 'CHARM'
  category: RepairCategory
  isDirectory: boolean
}

export interface RepairManualSection {
  heading: string
  text: string
}

export interface RepairManualImage {
  alt: string
  url: string
}

export interface RepairManualPage {
  provider: 'LEMON' | 'CHARM'
  url: string
  title: string
  breadcrumbs: RepairManualLink[]
  links: RepairManualLink[]
  sections: RepairManualSection[]
  images: RepairManualImage[]
  procedureText?: string
  canStoreContent: false
  warning: string
}

const MAKES = [
  'Acura', 'Audi', 'BMW', 'Buick', 'Cadillac', 'Chevrolet', 'Chrysler', 'Dodge', 'Ram', 'Ford', 'GMC', 'Honda',
  'Hyundai', 'Infiniti', 'Jaguar', 'Jeep', 'Kia', 'Land Rover', 'Lexus', 'Lincoln', 'Mazda', 'Mercedes Benz',
  'Mercury', 'Mini', 'Mitsubishi', 'Nissan', 'Oldsmobile', 'Pontiac', 'Porsche', 'Saab', 'Saturn', 'Scion',
  'Subaru', 'Suzuki', 'Toyota', 'Volkswagen', 'Volvo', 'Tesla', 'Rivian',
]

const MODEL_HINTS = [
  'accord', 'civic', 'cr-v', 'crv', 'pilot', 'odyssey', 'fit', 'ridgeline', 'camry', 'corolla', 'rav4', 'tacoma',
  'tundra', '4runner', 'prius', 'altima', 'sentra', 'maxima', 'rogue', 'pathfinder', 'frontier', 'silverado',
  'sierra', 'suburban', 'tahoe', 'yukon', 'escalade', 'malibu', 'impala', 'equinox', 'f-150', 'f150', 'escape',
  'explorer', 'focus', 'fusion', 'mustang', 'wrangler', 'cherokee', 'grand cherokee', 'ram', 'charger', 'challenger',
  'outback', 'forester', 'impreza', 'legacy', 'elantra', 'sonata', 'santa fe', 'sorento', 'soul', 'optima',
]

const MAKE_ALIASES: Record<string, string> = {
  chevy: 'Chevrolet',
  benz: 'Mercedes Benz',
  mercedes: 'Mercedes Benz',
  vw: 'Volkswagen',
  nissan: 'Nissan-Datsun',
  datsun: 'Nissan-Datsun',
  dodge: 'Dodge and Ram',
  ram: 'Dodge and Ram',
}

const DTC_PROFILES: Record<string, {
  system: string
  searchTerms: string
  removalTerms: string
  requiredTerms: string[]
}> = {
  P0420: {
    system: 'emissions exhaust catalyst',
    searchTerms: 'catalyst system catalytic converter exhaust oxygen sensor emissions diagnosis',
    removalTerms: 'catalytic converter exhaust oxygen sensor removal procedure',
    requiredTerms: ['catalyst', 'catalytic', 'converter', 'exhaust', 'oxygen', 'o2', 'emission', 'sensor', 'diagnostic trouble code'],
  },
  P0300: {
    system: 'engine misfire',
    searchTerms: 'random multiple cylinder misfire ignition fuel compression firing order cylinder order diagnosis',
    removalTerms: 'spark plug ignition coil injector misfire firing order cylinder order removal testing procedure',
    requiredTerms: ['misfire', 'ignition', 'spark', 'coil', 'injector', 'compression', 'fuel', 'firing', 'order', 'cylinder'],
  },
  P0171: {
    system: 'fuel trim lean condition',
    searchTerms: 'system too lean fuel trim vacuum leak maf oxygen sensor diagnosis',
    removalTerms: 'maf sensor oxygen sensor intake vacuum leak removal testing procedure',
    requiredTerms: ['lean', 'fuel trim', 'vacuum', 'intake', 'maf', 'oxygen', 'sensor'],
  },
}

const GENERIC_COMPONENT_TERMS = new Set([
  'follow', 'up', 'show', 'me', 'removal', 'remove', 'install', 'installation', 'replacement', 'replace',
  'procedure', 'manual', 'repair', 'diagnosis', 'diagnostic', 'steps', 'step', 'source', 'sources',
])

const MANUAL_TOKEN_STOP_WORDS = new Set([
  'front', 'rear', 'left', 'right', 'both', 'all', 'replace', 'replacement', 'repair', 'service',
  'procedure', 'manual', 'find', 'look', 'search', 'show', 'follow', 'removal', 'remove', 'install',
  'installation', 'steps', 'step', 'source', 'sources', 'system', 'sensor', 'component', 'general',
  'honda', 'toyota', 'ford', 'chevrolet', 'dodge', 'ram', 'jeep', 'nissan', 'gmc',
])

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function expandTwoDigitYear(year: string) {
  const value = Number(year)
  return value >= 80 ? `19${year.padStart(2, '0')}` : `20${year.padStart(2, '0')}`
}

function canonicalMakeForManuals(make?: string) {
  const raw = (make || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  return MAKE_ALIASES[lower] || MAKES.find(item => item.toLowerCase() === lower) || raw.replace(/\b\w/g, c => c.toUpperCase())
}

function canonicalMakeForNhtsa(make?: string) {
  const raw = (make || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (lower === 'dodge and ram') return 'Dodge'
  if (lower === 'nissan-datsun') return 'Nissan'
  return raw.replace(/\b\w/g, c => c.toUpperCase())
}

function normalizeModel(value?: string) {
  if (!value) return ''
  return value
    .replace(/\bcrv\b/gi, 'CR-V')
    .replace(/\bf150\b/gi, 'F-150')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wordsFrom(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function isGenericComponent(value: string) {
  const words = wordsFrom(value)
  return !words.length || words.every(word => GENERIC_COMPONENT_TERMS.has(word))
}

function expandDtcComponent(component: string, dtc?: string) {
  const profile = dtc ? DTC_PROFILES[dtc] : undefined
  if (!profile) return component || dtc || ''

  const wantsRemoval = /\b(removal|remove|replace|replacement|install|installation)\b/i.test(component)
  const cleanComponent = component
    .replace(new RegExp(`\\b${escapeRegExp(dtc || '')}\\b`, 'gi'), ' ')
    .replace(/\bfollow\s*up\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const focus = wantsRemoval ? profile.removalTerms : profile.searchTerms
  if (!cleanComponent || isGenericComponent(cleanComponent)) return focus
  return `${focus} ${cleanComponent}`.replace(/\s+/g, ' ').trim()
}

export function parseRepairQuery(input: string, fallback: Partial<RepairVehicle> = {}): RepairVehicle & { component: string; dtc?: string } {
  let text = input.replace(/\s+/g, ' ').trim()
  const vin = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0]?.toUpperCase() || fallback.vin
  const dtcShort = text.match(/\b([PCBU])\s?-?\s?(\d{3})\b/i)
  const dtc = text.match(/\b[PCBU][0-9A-F]{4}\b/i)?.[0]?.toUpperCase()
    || (dtcShort ? `${dtcShort[1].toUpperCase()}0${dtcShort[2]}` : undefined)
  const explicitYear = text.match(/\b(19|20)\d{2}\b/)?.[0]
  const shortYearMatch = text.match(/\b(\d{2})\s+([a-z][a-z0-9-]+)/i)
  const year = fallback.year || explicitYear || (shortYearMatch ? expandTwoDigitYear(shortYearMatch[1]) : '')

  const lower = text.toLowerCase()
  let make = fallback.make || ''
  for (const item of MAKES) {
    const re = new RegExp(`\\b${item.replace(/\s+/g, '\\s+')}\\b`, 'i')
    if (re.test(text)) {
      make = item
      break
    }
  }
  if (!make) {
    for (const [alias, target] of Object.entries(MAKE_ALIASES)) {
      if (new RegExp(`\\b${alias}\\b`, 'i').test(text)) {
        make = target
        break
      }
    }
  }
  if (!make && shortYearMatch) {
    const possibleModel = shortYearMatch[2].toLowerCase()
    if (['civic', 'accord', 'crv', 'cr-v', 'pilot', 'odyssey', 'fit'].includes(possibleModel)) make = 'Honda'
    if (['camry', 'corolla', 'rav4', 'tacoma', 'tundra', 'prius'].includes(possibleModel)) make = 'Toyota'
  }

  let model = fallback.model || ''
  for (const hint of MODEL_HINTS.sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${hint.replace('-', '-?').replace(/\s+/g, '\\s+')}\\b`, 'i').test(lower)) {
      model = hint
      break
    }
  }
  const engineMatch = text.match(/\b(\d\.\d)\s*(?:l|liter)\b/i)
  const engine = fallback.engine || (engineMatch ? `${engineMatch[1]}L` : '')
  const transmission = fallback.transmission
    || (/\bautomatic(?:\s+(?:trans|transmission))?\b/i.test(text) ? 'Automatic'
      : /\b(?:standard|manual)(?:\s+(?:trans|transmission))?\b/i.test(text) ? 'Manual'
        : '')

  const rawComponent = text
    .replace(/\bfollow\s*up\b/gi, ' ')
    .replace(/\b(open|find|look\s+up|search|repair|manual|procedure|steps?|for|on|a|an|the|please|me|show|get)\b/gi, ' ')
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, ' ')
    .replace(/\b[PCBU][0-9A-F]{4}\b/gi, ' ')
    .replace(/\b(19|20)?\d{2}\b/g, ' ')
    .replace(new RegExp(`\\b(${MAKES.join('|').replace(/\s+/g, '\\s+')})\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b(${MODEL_HINTS.map(escapeRegExp).join('|').replace(/\s+/g, '\\s+')})\\b`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const component = expandDtcComponent(rawComponent, dtc)

  return {
    vin,
    year,
    make: canonicalMakeForManuals(make),
    model: normalizeModel(model),
    engine,
    trim: fallback.trim,
    drivetrain: fallback.drivetrain,
    transmission,
    fuel: fallback.fuel,
    bodyClass: fallback.bodyClass,
    brakeSystem: fallback.brakeSystem,
    adas: fallback.adas,
    emissions: fallback.emissions,
    component: component || dtc || input,
    dtc,
  }
}

export function vehicleLabel(vehicle: RepairVehicle) {
  return [vehicle.year, canonicalMakeForNhtsa(vehicle.make), vehicle.model, vehicle.trim, vehicle.engine].filter(Boolean).join(' ').trim()
}

function sourceId(provider: string, url: string) {
  return `${provider}:${url}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120)
}

function source(
  provider: RepairProvider,
  category: RepairCategory,
  title: string,
  description: string,
  url: string,
  vehicle: string,
  confidence: RepairConfidence,
  access: RepairSource['access'] = 'source_link',
): RepairSource {
  return {
    id: sourceId(provider, url),
    provider,
    category,
    title,
    description,
    url,
    vehicle,
    confidence,
    access,
    canStoreContent: confidence === 'shop_draft',
    action: confidence === 'shop_draft' ? 'review_before_use' : 'open_source',
  }
}

async function fetchText(url: string, timeoutMs = 12000) {
  try {
    const res = await fetch(url, {
      // Standard browser UA — nothing identifying, and less likely to be blocked.
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

// Manual pages are static — cache them in the DB so repeat lookups are instant
// and survive the manual sites being slow or down. Fails open in every way: no
// table, no service client, or running in the browser → plain live fetch.
const MANUAL_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// Warm-lambda memory cache: even without the DB cache table, repeat fetches
// inside the same server instance are instant. Small cap — pages can be 1.5MB.
const memoryCache = new Map<string, { html: string; at: number }>()
const MEMORY_CACHE_MAX = 24

async function fetchManualHtmlCached(url: string, timeoutMs = 12000): Promise<string> {
  if (typeof window !== 'undefined') return fetchText(url, timeoutMs)
  const mem = memoryCache.get(url)
  if (mem && Date.now() - mem.at < MANUAL_CACHE_TTL_MS) return mem.html
  try {
    const { getServiceClient } = await import('../supabase')
    const db = getServiceClient()
    try {
      const { data } = await db
        .from('repair_manual_cache')
        .select('html, fetched_at')
        .eq('url', url)
        .maybeSingle()
      if (data?.html && Date.now() - new Date(data.fetched_at).getTime() < MANUAL_CACHE_TTL_MS) {
        return data.html
      }
    } catch { /* cache table may not exist yet — fetch live */ }
    const html = await fetchText(url, timeoutMs)
    if (html) {
      if (memoryCache.size >= MEMORY_CACHE_MAX) {
        const oldest = memoryCache.keys().next().value
        if (oldest) memoryCache.delete(oldest)
      }
      memoryCache.set(url, { html, at: Date.now() })
      // Fire and forget — the caller never waits on the cache write.
      void db
        .from('repair_manual_cache')
        .upsert({ url, html, fetched_at: new Date().toISOString() })
        .then(() => {}, () => {})
    }
    return html
  } catch {
    return fetchText(url, timeoutMs)
  }
}

function extractManualLinks(html: string, baseUrl: string, model?: string) {
  const all: Array<{ title: string; url: string }> = []
  const matched: Array<{ title: string; url: string }> = []
  const seen = new Set<string>()
  const modelLower = (model || '').toLowerCase().replace(/-/g, '')
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const href = decodeHtml(match[1])
    const label = decodeHtml(match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    if (!href || href.startsWith('#') || href === '/' || /about|nfo|style/i.test(href)) continue
    let url: string
    try { url = new URL(href, baseUrl).toString() } catch { continue }
    if (seen.has(url)) continue
    seen.add(url)
    const entry = { title: label || decodeURIComponent(url.split('/').filter(Boolean).pop() || url), url }
    all.push(entry)
    const comparable = `${label} ${decodeURIComponent(url)}`.toLowerCase().replace(/-/g, '')
    if (modelLower && comparable.includes(modelLower)) matched.push(entry)
  }
  // Prefer links that match the model, but fall back to ALL links so a naming
  // mismatch on the directory page never returns an empty result.
  return (matched.length ? matched : all).slice(0, 16)
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function titleFromUrl(url: string) {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean)
    return decodeURIComponent(path[path.length - 1] || url).replace(/\s+/g, ' ')
  } catch {
    return url
  }
}

function extractTitle(html: string, url: string) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return stripTags(h1 || title || titleFromUrl(url)).replace(/\s+[~|-]\s+(LEMON Manuals|Operation CHARM).*$/i, '') || titleFromUrl(url)
}

function providerFromUrl(url: string): 'LEMON' | 'CHARM' | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'charm.li') return 'CHARM'
    if (['lemon-manuals.la', 'lemon-manuals.org.ua', 'lemon-manuals.gy'].includes(host)) return 'LEMON'
    return null
  } catch {
    return null
  }
}

export function normalizeManualUrl(input: string) {
  try {
    const parsed = new URL(input)
    if (!['https:', 'http:'].includes(parsed.protocol)) return null
    const provider = providerFromUrl(parsed.toString())
    if (!provider) return null
    parsed.protocol = 'https:'
    parsed.username = ''
    parsed.password = ''
    parsed.hash = ''
    return { provider, url: parsed.toString() }
  } catch {
    return null
  }
}

function manualLinkFromAnchor(href: string, label: string, baseUrl: string): RepairManualLink | null {
  try {
    // Fragment links are section jumps INSIDE one document, not pages to fetch.
    if (href.startsWith('#')) return null
    const url = new URL(decodeHtml(href), baseUrl)
    let basePath = ''
    try { basePath = new URL(baseUrl).pathname } catch { /* relative base */ }
    if (url.hash && url.pathname === basePath) return null
    url.hash = ''
    if (url.pathname === basePath) return null // self-link
    const provider = providerFromUrl(url.toString())
    if (!provider) return null
    const cleanLabel = stripTags(label) || titleFromUrl(url.toString())
    if (!cleanLabel || /^(home|temporarily|permanently|read the announcement|about lemon manuals|so it begins)$/i.test(cleanLabel)) return null
    if (/\/(style\.css|about\.html|nfo\.html|script\.js)$/i.test(url.pathname)) return null
    return {
      title: cleanLabel,
      url: url.toString(),
      provider,
      category: inferCategory(`${cleanLabel} ${decodeURIComponent(url.pathname)}`),
      isDirectory: url.pathname.endsWith('/'),
    }
  } catch {
    return null
  }
}

function extractManualLinksDetailed(html: string, baseUrl: string, limit = 80): RepairManualLink[] {
  const links: RepairManualLink[] = []
  const seen = new Set<string>()
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const link = manualLinkFromAnchor(match[1], match[2], baseUrl)
    if (!link || seen.has(link.url)) continue
    seen.add(link.url)
    links.push(link)
    if (links.length >= limit) break
  }
  return links
}

function extractBreadcrumbs(html: string, baseUrl: string): RepairManualLink[] {
  const header = html.match(/<div[^>]*class=["'][^"']*header[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || ''
  return extractManualLinksDetailed(header, baseUrl, 12)
}

function mainFragment(html: string) {
  const main = html.match(/<div[^>]*class=["'][^"']*main[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?:<div|<\/body>|$)/i)?.[1]
  return main || html
}

function extractManualImages(html: string, baseUrl: string): RepairManualImage[] {
  const images: RepairManualImage[] = []
  const seen = new Set<string>()
  const re = /<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    try {
      const tag = match[0]
      const src = new URL(decodeHtml(match[1]), baseUrl).toString()
      const provider = providerFromUrl(src)
      if (!provider || seen.has(src)) continue
      // Skip UI chrome. On these manual sites the folder/section icons live under
      // /icons/ and are SVGs (e.g. the generic vehicle outline) — never a real
      // diagram. Actual figures are raster images under /images/. Filtering these
      // out stops the drill from stopping on an icon-only directory page.
      const path = new URL(src).pathname.toLowerCase()
      if (/\/icons?\//.test(path) || path.endsWith('.svg') || /\bclass=["'][^"']*\bfolder-icon\b/i.test(tag)) continue
      // Diagram <img> tags have no alt; the caption is the nearest preceding h3/b.
      const altAttr = stripTags(tag.match(/\salt=["']([^"']*)["']/i)?.[1] || '')
      const caption = altAttr || captionBeforeIndex(html, match.index) || 'Manual diagram'
      images.push({ alt: caption, url: src })
      seen.add(src)
      if (images.length >= 12) break
    } catch {}
  }
  return images
}

// Pull a diagram's caption: a nearby figure-caption span, or the closest
// heading/<b> just before the <img>. Works across both manual databases.
function captionBeforeIndex(html: string, index: number) {
  const before = html.slice(Math.max(0, index - 1600), index)
  const capSpan = [...before.matchAll(/<span[^>]*class=["'][^"']*imageCaption[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)].pop()?.[1]
  const heading = capSpan
    || [...before.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)].pop()?.[1]
    || [...before.matchAll(/<b[^>]*>([\s\S]*?)<\/b>/gi)].pop()?.[1]
    || ''
  const text = stripTags(decodeHtml(heading)).replace(/\s+/g, ' ').trim()
  return text.length >= 3 && text.length <= 160 ? text : ''
}

function extractReaderSections(html: string, url: string): RepairManualSection[] {
  const main = mainFragment(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, _level, heading) => `\n@@HEADING:${stripTags(heading)}@@\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|tr|div|section)>/gi, '\n')

  const lines = decodeHtml(main.replace(/<[^>]*>/g, ' '))
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const sections: RepairManualSection[] = []
  let heading = extractTitle(html, url)
  let body: string[] = []
  for (const line of lines) {
    const marker = line.match(/^@@HEADING:(.*?)@@$/)
    if (marker) {
      if (body.length) sections.push({ heading, text: body.join('\n').slice(0, 1600) })
      heading = marker[1] || 'Section'
      body = []
      continue
    }
    if (!/^LEMON Manuals|^Operation CHARM|^Home >>/i.test(line)) body.push(line)
    if (sections.length >= 8) break
  }
  if (body.length) sections.push({ heading, text: body.join('\n').slice(0, 1600) })
  return sections
    .filter(section => section.text.length > 30)
    .slice(0, 8)
}

// Clean, readable procedure text for the chat. CHARM/LEMON mark section headings
// with <b> and number their steps as plain text split by <br> (indented with tab
// spans), so turn that into plain lines with **bold** headings.
function extractProcedureText(html: string): string {
  let main = mainFragment(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<img[^>]*>/gi, ' ')
  // Number <ol> items — the newer manual database writes its steps as real
  // ordered lists; the older one writes "1. ..." text split by <br>. After this,
  // both come out as plain numbered lines.
  main = main.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, body: string) => {
    let i = 0
    return '\n' + body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_x, item: string) => `\n${++i}. ${stripTags(decodeHtml(item))}`) + '\n'
  })
  main = main
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_m, t) => `\n**${stripTags(t)}**\n`)
    .replace(/<(?:b|strong)[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, (_m, t) => {
      const txt = stripTags(t)
      return txt.length > 2 && txt.length < 120 ? `\n**${txt}**\n` : ` ${txt} `
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|tr|div|section|ul)>/gi, '\n')
  const decoded = decodeHtml(main.replace(/<[^>]*>/g, ' ')).replace(/\t+/g, ' ')
  const out: string[] = []
  for (const raw of decoded.split(/\r?\n/)) {
    const line = raw.replace(/[  ]+/g, ' ').trim()
    if (!line) continue
    if (/^(LEMON Manuals|Operation CHARM|Home >>|Database:|Free .*Manual|Expand All|Collapse All|About LEMON|So it begins|Courtesy of)/i.test(line)) continue
    if (out.length && out[out.length - 1] === line) continue
    out.push(line)
  }
  return out.join('\n').slice(0, 8000)
}

// Split the extracted text into **heading**-delimited sections so a specific ask
// ("removal", "bleeding", "testing") can pull just that part of a mega-document.
function splitProcedureSections(docText: string): Array<{ heading: string; text: string }> {
  const sections: Array<{ heading: string; lines: string[] }> = []
  let current = { heading: '', lines: [] as string[] }
  for (const line of docText.split('\n')) {
    const h = line.match(/^\*\*(.+)\*\*$/)
    if (h) {
      if (current.lines.length) sections.push(current)
      current = { heading: h[1], lines: [] }
    } else {
      current.lines.push(line)
    }
  }
  if (current.lines.length) sections.push(current)
  return sections.map(s => ({ heading: s.heading, text: s.lines.join('\n') }))
}

// The part of the job the user asked about — generic across all jobs.
function requestedSectionTerms(query: string): string[] {
  const t = query.toLowerCase()
  if (/\b(remove|removal|take off|take out)\b/.test(t)) return ['removal', 'remove']
  if (/\b(install|installation|put back|reassemble)\b/.test(t)) return ['installation', 'install']
  if (/\b(test|testing|diagnos|check)\b/.test(t)) return ['diagnosis', 'testing', 'test', 'diagnostic']
  if (/\b(bleed|bleeding)\b/.test(t)) return ['bleeding', 'bleed']
  if (/\b(adjust|adjustment)\b/.test(t)) return ['adjustment', 'adjust']
  if (/\b(torque|spec|specs|capacity)\b/.test(t)) return ['specification', 'torque', 'capacities']
  if (/\b(inspect|inspection|thickness|wear)\b/.test(t)) return ['inspection', 'inspect']
  return []
}

function positionTerms(query: string): string[] {
  const t = query.toLowerCase()
  const out: string[] = []
  if (/\bfront\b/.test(t)) out.push('front')
  if (/\brear\b|\bback\b/.test(t)) out.push('rear')
  return out
}

export async function readRepairManualPage(url: string, timeoutMs = 12000, linkLimit = 80): Promise<RepairManualPage> {
  const normalized = normalizeManualUrl(url)
  if (!normalized) throw new Error('Only CHARM and LEMON manual URLs are supported')
  const html = await fetchManualHtmlCached(normalized.url, timeoutMs)
  if (!html) throw new Error('Manual source did not return readable content')
  // Mega index pages (the old-db Repair-and-Diagnosis tree is ~1.5MB) are link
  // hubs, never content — skip the expensive text parsing so a serverless CPU
  // doesn't burn the whole time budget on one page.
  if (html.length > 350_000) {
    return {
      provider: normalized.provider,
      url: normalized.url,
      title: extractTitle(html, normalized.url),
      breadcrumbs: extractBreadcrumbs(html, normalized.url),
      links: extractManualLinksDetailed(mainFragment(html), normalized.url, linkLimit),
      sections: [],
      images: [],
      procedureText: '',
      canStoreContent: false,
      warning: 'Source preview only. Do not copy protected manual text into customer documents. Verify exact trim, engine, warnings, torque specs, and safety procedures from the source before work.',
    }
  }
  return {
    provider: normalized.provider,
    url: normalized.url,
    title: extractTitle(html, normalized.url),
    breadcrumbs: extractBreadcrumbs(html, normalized.url),
    links: extractManualLinksDetailed(mainFragment(html), normalized.url, linkLimit),
    sections: extractReaderSections(html, normalized.url),
    images: extractManualImages(mainFragment(html), normalized.url),
    procedureText: extractProcedureText(html),
    canStoreContent: false,
    warning: 'Source preview only. Do not copy protected manual text into customer documents. Verify exact trim, engine, warnings, torque specs, and safety procedures from the source before work.',
  }
}

// Folder names that lead to an actual figure vs. text-only leaves to avoid.
const DIAGRAM_LEAF_HINTS = /(component\s*location|locations?|connector\s*view|schematic|wiring\s*diagram|diagram|pinout|illustration|exploded|description\s*and\s*operation)/i
// Folders that hold the actual step-by-step procedure.
const PROCEDURE_LEAF_HINTS = /(service\s*and\s*repair|testing\s*and\s*inspection|service\s*information|removal|installation|replacement|overhaul|adjustment|\bprocedure\b|inspection)/i
const TEXT_LEAF_PENALTY = /(p\s*code\s*chart|code\s*chart|dtc\s*(?:list|index)|dtcs\b|trouble\s*code\s*(?:list|description)|diagnostic\s*code\s*index|technical\s*service\s*bulletin|\btsb\b|maintenance\s*(?:schedule|interval)|wiring\s*repairs?|verification\s*test|troubleshooting|pinpoint\s*test|routine\s*inspection|reference\s*guide|checksheet)/i
// The part itself, not its relay/fuse/module/wiring — unless that's what we want.
const DISTRACTOR_PENALTY = /\b(relay|module|fuse|junction|harness|circuit breaker)\b/i
// Subsystems that hijack generic asks — penalized unless the user names them.
const SUBSYSTEM_QUALIFIERS: Array<{ asked: RegExp; penalty: RegExp }> = [
  { asked: /\b(abs|antilock|anti-lock)\b/i, penalty: /(antilock|anti-lock|\babs\b)/i },
  { asked: /\btraction\b/i, penalty: /\btraction\b/i },
  { asked: /\bparking\b/i, penalty: /\bparking\s*brake\b/i },
  { asked: /\bhybrid\b/i, penalty: /\bhybrid\b/i },
  { asked: /\b(lamp|light|bulb)\b/i, penalty: /\b(lamp|light|bulb)\b/i },
  { asked: /\b(pedal|switch)\b/i, penalty: /\b(pedal|switch)\b/i },
  { asked: /\bseat\b/i, penalty: /\bseat\b/i },
  { asked: /\b(wiring|circuit|electrical|indicator|connector)\b/i, penalty: /\b(circuit|electrical\s*diagrams?|warning\s*indicator|wiring|connector\s*view)\b/i },
]

function detectDtcCode(value: string) {
  const full = value.match(/\b([PCBU])([0-9A-F]{4})\b/i)
  if (full) return `${full[1]}${full[2]}`.toUpperCase()
  const short = value.match(/\b([PCBU])\s?-?\s?(\d{3})\b/i)
  if (short) return `${short[1].toUpperCase()}0${short[2]}`
  return ''
}

// Specific part words that pin the right page. Generic words like "sensor" or
// "diagnostic trouble code" are left out on purpose — they drag the drill onto ABS
// code lists and unrelated sensors instead of the part the request is about.
const DIAGRAM_TARGET_TERMS: Record<string, string[]> = {
  P0420: ['catalytic converter', 'catalytic', 'catalyst', 'oxygen', 'a/f sensor', 'air fuel', 'air/fuel', 'ho2s'],
  P0300: ['ignition', 'ignition coil', 'spark plug', 'firing order', 'distributor', 'coil', 'injector'],
  P0171: ['mass air flow', 'maf', 'oxygen', 'intake air', 'air fuel', 'air/fuel', 'throttle body'],
}

// Words that don't name a part — strip them from a free-text query so they don't
// make the drill match the year/make sitting in the URL path.
const REPAIR_TERM_STOP = new Set([
  'show', 'give', 'tell', 'pull', 'open', 'find', 'need', 'want', 'please', 'procedure', 'procedures',
  'steps', 'step', 'diagram', 'picture', 'manual', 'repair', 'replace', 'replacement', 'remove', 'removal',
  'install', 'installation', 'fix', 'help', 'this', 'that', 'with', 'have', 'about', 'four', 'corner', 'corners',
  'honda', 'toyota', 'ford', 'chevrolet', 'chevy', 'nissan', 'dodge', 'jeep', 'gmc', 'subaru', 'mazda', 'kia', 'hyundai',
  'accord', 'civic', 'camry', 'corolla', 'silverado', 'altima', 'tacoma', 'tundra', 'wrangler',
])

function repairTargetTerms(query: string): string[] {
  const pos = positionTerms(query)
  const withPos = (arr: string[]) => [...arr, ...pos]
  const dtc = detectDtcCode(query)
  if (dtc && DIAGRAM_TARGET_TERMS[dtc]) return withPos(DIAGRAM_TARGET_TERMS[dtc])
  const text = query.toLowerCase()
  if (/\b(catalytic|catalyst|converter)\b/.test(text)) return withPos(DIAGRAM_TARGET_TERMS.P0420)
  if (/\b(o2|oxygen|a\/f|air[\s/]?fuel)\b/.test(text)) return withPos(['oxygen', 'a/f sensor', 'air fuel', 'air/fuel', 'ho2s'])
  if (/\b(misfire|coil|spark|ignition)\b/.test(text)) return withPos(DIAGRAM_TARGET_TERMS.P0300)
  if (/\b(maf|mass air|lean)\b/.test(text)) return withPos(DIAGRAM_TARGET_TERMS.P0171)
  if (/brake|rotor|caliper|\bpad/.test(text)) return withPos(['brake pad', 'disc brake', 'brake', 'pad', 'caliper', 'rotor'])
  if (/\b(fuse|relay|junction)\b/.test(text)) return withPos(['fuse', 'fuse box', 'fuse block', 'junction box', 'power distribution', 'relay box'])
  if (/\b(turn signal|blinker|headlight|tail ?light|bulb|lamp)\b/.test(text)) return withPos(['turn signal', 'bulb', 'lamp', 'headlight', 'tail light', 'exterior light'])
  if (/\b(alternator|starter|charging|battery)\b/.test(text)) return withPos(['alternator', 'generator', 'charging system', 'starting and charging', 'starter', 'battery'])
  if (/\b(coolant|radiator|thermostat|water pump|overheat)\b/.test(text)) return withPos(['radiator', 'coolant', 'thermostat', 'water pump', 'cooling'])
  const fromComponent = requiredTermsForComponent(query)
  if (fromComponent.length) return withPos(fromComponent)
  return withPos(tokenizeForManualSearch(query).filter(token =>
    token.length >= 4 && !REPAIR_TERM_STOP.has(token) && !/^(19|20)?\d{2,4}$/.test(token) && token !== 'front' && token !== 'rear',
  ))
}

// Procedure (steps) is the default; only treat it as a diagram request when asked.
function repairIntent(query: string): 'procedure' | 'diagram' {
  return /\b(diagram|picture|schematic|wiring|pinout|locations?|where is|exploded|drawing)\b/i.test(query) ? 'diagram' : 'procedure'
}

// From a manual page URL, find the vehicle's "Repair and Diagnosis" tree so we can
// navigate into the component branch where procedures and figures live.
function diagnosisBaseFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const segs = u.pathname.split('/').filter(Boolean)
    const idx = segs.findIndex(seg => {
      try { return /repair and diagnosis/i.test(decodeURIComponent(seg)) } catch { return false }
    })
    if (idx === -1) return null
    return `${u.origin}/${segs.slice(0, idx + 1).join('/')}/`
  } catch {
    return null
  }
}

function pathMatchesComponent(url: string, terms: string[]): boolean {
  let path = ''
  try { path = decodeURIComponent(new URL(url).pathname).toLowerCase().replace(/[-_]+/g, ' ') } catch { return false }
  return terms.some(term => path.includes(term))
}

function scoreManualLink(
  title: string,
  urlText: string,
  terms: string[],
  intent: 'procedure' | 'diagram',
  penalizeDistractors: boolean,
  sectionTerms: string[],
  query: string,
) {
  const text = `${title} ${urlText}`.toLowerCase().replace(/[-_]+/g, ' ')
  let score = 0
  // More matched part-words = a more specific link (e.g. "Ignition Coil" beats
  // "Ignition Switch", "Under-Dash Fuse and Relay Box" beats a bare relay folder).
  const hits = terms.filter(term => text.includes(term)).length
  if (hits) score += 25 + Math.min(hits - 1, 3) * 6
  if (sectionTerms.some(term => text.includes(term))) score += 12
  if (intent === 'procedure') {
    if (PROCEDURE_LEAF_HINTS.test(text)) score += 14
    if (DIAGRAM_LEAF_HINTS.test(text)) score -= 6
  } else {
    if (DIAGRAM_LEAF_HINTS.test(text)) score += 14
    if (/service\s*information/i.test(text)) score += 6
  }
  if (TEXT_LEAF_PENALTY.test(text)) score -= 18
  if (penalizeDistractors && DISTRACTOR_PENALTY.test(text)) score -= 16
  for (const sub of SUBSYSTEM_QUALIFIERS) {
    if (!sub.asked.test(query) && sub.penalty.test(text)) score -= 15
  }
  return score
}

// Real content = numbered steps or substantial prose that is NOT a table of
// contents (TOCs have many links and little text per link).
function pageContentQuality(page: RepairManualPage, terms: string[]) {
  const text = page.procedureText || ''
  const stepLines = text.split('\n').filter(l => /^\d+\.\s/.test(l)).length
  const related = pathMatchesComponent(page.url, terms) || terms.some(t => (page.title || '').toLowerCase().includes(t))
  const isToc = page.links.length > 12 && text.length < page.links.length * 60
  const meaty = text.length > 400 && !isToc
  return { stepLines, related, isToc, ok: related && (stepLines >= 2 || meaty) }
}

// The big one: turn a job/diagram request + a manual URL into the exact page that
// carries the steps (or the figure). Best-first search: explore the highest-scoring
// links across ALL visited pages, never accept a table of contents as the answer.
// Structure-based, so it works on any manual database layout — old, new, or future.
export async function readRepairManualPageDrilled(
  startUrl: string,
  query: string,
): Promise<RepairManualPage & { trail: string[]; intent: 'procedure' | 'diagram'; diagramFound: boolean }> {
  const terms = repairTargetTerms(query)
  const intent = repairIntent(query)
  const sectionTerms = requestedSectionTerms(query)
  const penalizeDistractors = !terms.some(term => DISTRACTOR_PENALTY.test(term))
  const visited = new Set<string>()
  const trail: string[] = []
  // Keep the whole drill inside a tight budget so the request never hangs.
  const deadline = Date.now() + 16000
  const MAX_FETCHES = 12

  // Enter the Repair-and-Diagnosis tree (procedures + figures live there).
  let diagBase = diagnosisBaseFromUrl(startUrl)
  if (!diagBase) {
    try {
      const startPage = await readRepairManualPage(startUrl, 7000, 6000)
      const rd = startPage.links.find(link =>
        /repair and diagnosis/i.test(link.title) || /repair and diagnosis/i.test(decodeURIComponent(link.url)),
      )
      diagBase = rd ? rd.url : `${startUrl.endsWith('/') ? startUrl : `${startUrl}/`}Repair%20and%20Diagnosis/`
    } catch {
      diagBase = `${startUrl.endsWith('/') ? startUrl : `${startUrl}/`}Repair%20and%20Diagnosis/`
    }
  }

  let bestText: RepairManualPage | null = null
  let bestTextSteps = -1
  let bestImgs: RepairManualPage | null = null
  const frontier: Array<{ url: string; score: number }> = []
  const pushLinks = (page: RepairManualPage) => {
    for (const link of page.links) {
      if (visited.has(link.url)) continue
      let decoded = link.url
      try { decoded = decodeURIComponent(link.url) } catch { /* raw */ }
      const score = scoreManualLink(link.title, decoded, terms, intent, penalizeDistractors, sectionTerms, query)
      if (score > 0) frontier.push({ url: link.url, score })
    }
    frontier.sort((a, b) => b.score - a.score)
    if (frontier.length > 60) frontier.length = 60
  }

  let fetches = 0
  let page: RepairManualPage
  try {
    page = await readRepairManualPage(diagBase, 7000, 6000)
    fetches++
  } catch {
    const base = await readRepairManualPage(startUrl)
    return { ...base, trail, intent, diagramFound: base.images.length > 0 }
  }
  visited.add(page.url)
  pushLinks(page)
  if (page.title) trail.push(page.title)

  while (fetches < MAX_FETCHES && Date.now() < deadline) {
    const q = pageContentQuality(page, terms)
    if (q.ok && q.stepLines > bestTextSteps) { bestText = page; bestTextSteps = q.stepLines }
    if (page.images.length && pathMatchesComponent(page.url, terms) && (!bestImgs || page.images.length > bestImgs.images.length)) bestImgs = page
    // early exit once the ask is satisfied by a non-TOC page
    if (intent === 'diagram' && bestImgs && !pageContentQuality(bestImgs, terms).isToc) break
    if (intent === 'procedure' && bestText && bestTextSteps >= 2) break
    // Fetch the top-scored candidates in PARALLEL — wall time is the scarce
    // resource on serverless, not bandwidth.
    const batch = frontier.splice(0, 3).filter(item => !visited.has(item.url))
    if (!batch.length) break
    batch.forEach(item => visited.add(item.url))
    const settled = await Promise.allSettled(batch.map(item => readRepairManualPage(item.url, 7000, 6000)))
    fetches += batch.length
    const pages = settled.filter((s): s is PromiseFulfilledResult<RepairManualPage> => s.status === 'fulfilled').map(s => s.value)
    if (!pages.length) continue
    for (const candidate of pages) {
      if (candidate.title) trail.push(candidate.title)
      const cq = pageContentQuality(candidate, terms)
      if (cq.ok && cq.stepLines > bestTextSteps) { bestText = candidate; bestTextSteps = cq.stepLines }
      if (candidate.images.length && pathMatchesComponent(candidate.url, terms) && (!bestImgs || candidate.images.length > bestImgs.images.length)) bestImgs = candidate
      pushLinks(candidate)
    }
    page = pages[0]
  }

  const result = intent === 'diagram' ? (bestImgs || bestText || page) : (bestText || bestImgs || page)

  // If a specific part of the job was asked for ("removal", "bleeding", specs),
  // hand back just that section of a multi-section document.
  let procedureText = result.procedureText || ''
  if (sectionTerms.length) {
    const sections = splitProcedureSections(procedureText)
    if (sections.length > 2) {
      const hit = sections.filter(s => sectionTerms.some(t => s.heading.toLowerCase().includes(t)))
      if (hit.length) procedureText = hit.map(s => `**${s.heading}**\n${s.text}`).join('\n\n').slice(0, 8000)
    }
  }

  return { ...result, procedureText, trail, intent, diagramFound: result.images.length > 0 }
}

async function browseManualDirectory(provider: 'LEMON' | 'CHARM', vehicle: RepairVehicle, component: string): Promise<RepairSource[]> {
  const make = canonicalMakeForManuals(vehicle.make)
  if (!make || !vehicle.year) return []
  const base = provider === 'LEMON' ? 'https://lemon-manuals.la' : 'https://charm.li'
  const year = Number(vehicle.year)
  if (provider === 'CHARM' && (!year || year > 2013)) return []

  const yearUrl = `${base}/${encodeURIComponent(make)}/${vehicle.year}/`
  const html = await fetchText(yearUrl)
  if (!html) {
    return [
      source(
        provider,
        'manual',
        `${provider} ${vehicle.year} ${make} manual directory`,
        'Directory link. The source did not return readable index content during this lookup.',
        yearUrl,
        vehicleLabel(vehicle),
        'source_directory',
        'free_public',
      ),
    ]
  }

  const links = extractManualLinks(html, yearUrl, vehicle.model)
  const vehicleText = vehicleLabel(vehicle)
  const description = provider === 'LEMON'
    ? 'Free manual directory result. LEMON is preferred for newer vehicles and often includes CHARM plus newer manuals.'
    : 'Free CHARM manual directory result. CHARM is strongest for 1982-2013 coverage.'

  const results = links.map(link => source(
    provider,
    inferCategory(`${link.title} ${component}`),
    `${provider}: ${vehicle.year} ${make} ${link.title}`,
    description,
    link.url,
    vehicleText,
    'public_manual',
    'free_public',
  ))

  if (!results.length) {
    results.push(source(provider, 'manual', `${provider} ${vehicle.year} ${make} directory`, description, yearUrl, vehicleText, 'source_directory', 'free_public'))
  }
  return results
}

function inferCategory(text: string): RepairCategory {
  if (/\b(recall|campaign)\b/i.test(text)) return 'recall'
  if (/\b(tsb|bulletin|communication)\b/i.test(text)) return 'tsb'
  if (/\b(wiring|diagram|schematic|connector|pinout)\b/i.test(text)) return 'diagram'
  if (/\b(torque|spec|capacity|fluid)\b/i.test(text)) return 'spec'
  if (/\b(labor|time|flat rate|book time)\b/i.test(text)) return 'labor'
  return 'manual'
}

async function fetchNhtsaRecalls(vehicle: RepairVehicle): Promise<RepairSource[]> {
  if (!vehicle.year || !vehicle.make || !vehicle.model) return []
  const make = canonicalMakeForNhtsa(vehicle.make)
  const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(vehicle.model)}&modelYear=${encodeURIComponent(vehicle.year)}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    const data = await res.json()
    const rows = Array.isArray(data?.results) ? data.results : Array.isArray(data?.Results) ? data.Results : []
    return rows.slice(0, 8).map((row: Record<string, unknown>, index: number) => {
      const campaign = String(row.NHTSACampaignNumber || row.CampaignNumber || `recall-${index + 1}`)
      return source(
        'NHTSA',
        'recall',
        `NHTSA recall ${campaign}: ${String(row.Component || 'Vehicle recall')}`,
        [row.Summary, row.Remedy].map(value => String(value || '').trim()).filter(Boolean).join(' Remedy: ').slice(0, 700) || 'Official NHTSA recall result.',
        'https://www.nhtsa.gov/recalls',
        vehicleLabel(vehicle),
        'official_government',
        'free_public',
      )
    })
  } catch {
    return []
  }
}

async function decodeVin(vin?: string): Promise<Partial<RepairVehicle>> {
  if (!vin) return {}
  try {
    const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`, {
      signal: AbortSignal.timeout(12000),
    })
    const data = await res.json()
    const row = data?.Results?.[0]
    if (!row) return {}
    return {
      year: row.ModelYear || '',
      make: row.Make || '',
      model: row.Model || '',
      engine: [row.DisplacementL ? `${row.DisplacementL}L` : '', row.EngineCylinders ? `${row.EngineCylinders} cyl` : '', row.EngineConfiguration || ''].filter(Boolean).join(' ').trim(),
      trim: row.Trim || row.Series || '',
      drivetrain: row.DriveType || '',
      transmission: row.TransmissionStyle || row.TransmissionSpeeds ? [row.TransmissionStyle, row.TransmissionSpeeds ? `${row.TransmissionSpeeds} speed` : ''].filter(Boolean).join(' ') : '',
      fuel: row.FuelTypePrimary || '',
      bodyClass: row.BodyClass || '',
      brakeSystem: row.BrakeSystemDesc || row.BrakeSystemType || '',
      adas: [row.AdaptiveCruiseControl, row.LaneDepartureWarning, row.LaneKeepingAssistance, row.ForwardCollisionWarning]
        .filter(value => value && value !== 'Not Applicable')
        .join(', '),
      emissions: row.OtherEngineInfo || '',
    }
  } catch {
    return {}
  }
}

async function searchTavily(query: string, vehicle: RepairVehicle): Promise<RepairSource[]> {
  const key = process.env.TAVILY_API_KEY || ''
  if (!key) return []
  const vehicleText = vehicleLabel(vehicle)
  const searchQuery = [
    vehicleText,
    query,
    '(site:charm.li OR site:lemon-manuals.la OR site:autozone.com/diy OR site:nhtsa.gov)',
  ].filter(Boolean).join(' ')

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: searchQuery, search_depth: 'advanced', include_answer: false, max_results: 8 }),
      signal: AbortSignal.timeout(16000),
    })
    const data = await res.json()
    const rows = Array.isArray(data?.results) ? data.results : []
    return rows.map((row: Record<string, unknown>) => {
      const url = String(row.url || '')
      const host = safeHost(url)
      const provider: RepairProvider = /charm\.li/i.test(host) ? 'CHARM' : /lemon-manuals/i.test(host) ? 'LEMON' : /nhtsa/i.test(host) ? 'NHTSA' : /autozone/i.test(host) ? 'AutoZone' : 'Web'
      return source(
        provider,
        inferCategory(`${row.title || ''} ${query}`),
        String(row.title || url),
        String(row.content || 'Web search result. Verify source before using for repair work.').slice(0, 600),
        url,
        vehicleText,
        provider === 'NHTSA' ? 'official_government' : 'search_result',
        provider === 'AutoZone' ? 'free_account' : 'source_link',
      )
    }).filter((item: RepairSource) => item.url)
  } catch {
    return []
  }
}

function safeHost(url: string) {
  try { return new URL(url).hostname } catch { return '' }
}

function staticSourceLinks(vehicle: RepairVehicle, component: string): RepairSource[] {
  const vehicleText = vehicleLabel(vehicle)
  const make = canonicalMakeForNhtsa(vehicle.make)
  const searchText = [vehicleText, component].filter(Boolean).join(' ')
  const results: RepairSource[] = [
    source('OEM1Stop', 'oem_link', 'OEM1Stop manufacturer repair information index', 'Official index for manufacturer repair information portals and position statements. Use it to jump to the OEM source for newer vehicles and safety-sensitive repairs.', 'https://www.oem1stop.com/', vehicleText, 'official_oem_index', 'source_link'),
    source('NHTSA', 'tsb', 'NHTSA manufacturer communications and TSB search', 'Official NHTSA area for manufacturer communications, technical service bulletins, warranty extensions, and other dealer communications.', 'https://www.nhtsa.gov/vehicle-manufacturers/manufacturer-communications', vehicleText, 'official_government', 'free_public'),
    source('AutoZone', 'procedure', 'AutoZone free repair guide search', 'Free repair-guide source. Some vehicle-specific guides require a free AutoZone Rewards login and coverage is incomplete.', `https://www.autozone.com/searchresult?searchText=${encodeURIComponent(searchText)}`, vehicleText, 'search_result', 'free_account'),
  ]

  if (vehicle.year && make && vehicle.model) {
    results.push(source('NHTSA', 'recall', 'NHTSA recall lookup', 'Official recall lookup for the selected year, make, and model.', `https://www.nhtsa.gov/recalls?vehicleId=${encodeURIComponent(`${vehicle.year}_${make}_${vehicle.model}`)}`, vehicleText, 'official_government', 'free_public'))
  }
  return results
}

function checklistFor(component: string, dtc?: string) {
  const text = `${component} ${dtc || ''}`.toLowerCase()
  if (/\bbrake|rotor|pad|caliper\b/.test(text)) {
    return [
      'Verify exact brake system, rotor diameter, trim, and parking-brake configuration from a source manual.',
      'Inspect pads, rotors, calipers, slides, hoses, fluid condition, and ABS warnings before quoting.',
      'Use source manual for torque specs, bleeding sequence, bedding procedure, and any electronic parking brake service mode.',
      'Document measurements and road-test result in the job notes.',
    ]
  }
  if (/\bcontrol arm|ball joint|strut|shock|sway|suspension\b/.test(text)) {
    return [
      'Confirm 2WD/4WD/AWD trim and suspension package from source manual before ordering parts.',
      'Inspect related bushings, ball joints, tie rods, sway links, struts/shocks, and tire wear.',
      'Use source manual for torque specs, loaded-suspension tightening requirements, and alignment prerequisites.',
      'Recommend alignment check after suspension work and document customer authorization.',
    ]
  }
  if (/\bcoolant|radiator|tank|reservoir|thermostat|water pump\b/.test(text)) {
    return [
      'Pressure test cooling system and verify leak source before replacement.',
      'Check cap, hoses, radiator, fan operation, thermostat behavior, and signs of overheating damage.',
      'Use source manual for coolant type, fill capacity, bleed procedure, and torque specs.',
      'Road test, recheck level after cool-down, and document any overheating risk.',
    ]
  }
  if (/\bturn signal|bulb|lamp|light|headlight|taillight\b/.test(text)) {
    return [
      'Verify bulb type, socket condition, fuse, relay, ground, and connector condition.',
      'Check for water intrusion or melted housing before replacing bulbs only.',
      'Use wiring diagrams if the lamp does not work with a known-good bulb.',
      'Confirm operation of hazard, brake, turn, marker, and headlamp circuits as applicable.',
    ]
  }
  if (dtc || /\b[pcbu][0-9a-f]{4}\b/i.test(text)) {
    return [
      'Record all DTCs, freeze-frame data, readiness monitors, and battery voltage before clearing codes.',
      'Check related TSBs and source diagnostic flow before replacing parts.',
      'Perform pinpoint testing from the source manual and document pass/fail readings.',
      'Verify repair with drive cycle or monitor completion when practical.',
    ]
  }
  return [
    'Open the source manual result that matches the exact year, make, model, trim, engine, and drivetrain.',
    'Verify warnings, required tools, torque specs, capacities, and special procedures from the source.',
    'Inspect related systems before quoting so the estimate is not missing required companion work.',
    'Save technician notes and source links on the job before customer authorization.',
  ]
}

export function buildRepairDraft(query: string, vehicle: RepairVehicle, component: string, dtc?: string): RepairDraft {
  const vehicleText = vehicleLabel(vehicle) || 'selected vehicle'
  const operation = component || dtc || query
  return {
    title: `${vehicleText} - ${operation}`,
    status: 'draft_needs_technician_review',
    operation,
    sourceRequired: true,
    warnings: [
      'Draft only. Technician must verify source procedure, warnings, torque specs, capacities, and labor before use.',
      'Do not copy protected manual text into customer documents. Save source links and internal notes.',
    ],
    checklist: checklistFor(component, dtc),
    estimateNotes: [
      `Repair research for ${vehicleText}: ${operation}.`,
      'Source-backed procedure required before work begins.',
      'Customer authorization required before repairs, parts ordering, or diagnostic teardown.',
    ],
  }
}

function dedupeSources(items: RepairSource[]) {
  const seen = new Set<string>()
  return items.filter(item => {
    const key = item.url || item.id
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function countCategories(sources: RepairSource[]) {
  const counts: Record<RepairCategory, number> = {
    manual: 0,
    procedure: 0,
    diagram: 0,
    spec: 0,
    labor: 0,
    tsb: 0,
    recall: 0,
    complaint: 0,
    oem_link: 0,
    shop_draft: 0,
  }
  for (const item of sources) counts[item.category] += 1
  return counts
}

function extractTargetTotal(text: string): number | null {
  const strongPattern = /(?:make\s+(?:the\s+)?(?:total|price)|(?:total|price)\s*(?:to\s*be|for|is|=)?|flat(?:\s*rate)?|for\s+everything|everything\s+for|all\s+in|out\s+the\s+door|parts\s+and\s+labor)\D{0,30}\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)/gi
  const strongMatches = [...text.matchAll(strongPattern)]
    .map(match => Number(String(match[1]).replace(/[$,\s]/g, '')))
    .filter(value => Number.isFinite(value) && value > 0 && value < 100000)
  if (strongMatches.length) return Math.round(strongMatches[strongMatches.length - 1] * 100) / 100

  const hasDocumentIntent = /\b(invoice|estimate|quote|total|price|flat|parts\s+and\s+labor|everything|all\s+in|out\s+the\s+door)\b/i.test(text)
  if (hasDocumentIntent) {
    const forAmountMatches = [...text.matchAll(/\bfor\s+\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\b/gi)]
      .map(match => Number(String(match[1]).replace(/[$,\s]/g, '')))
      .filter(value => Number.isFinite(value) && value > 0 && value < 100000)
    if (forAmountMatches.length) return Math.round(forAmountMatches[forAmountMatches.length - 1] * 100) / 100
  }
  return null
}

function allocateMoney(total: number, count: number) {
  const lineCount = Math.max(1, count)
  const cents = Math.round(total * 100)
  const base = Math.floor(cents / lineCount)
  const remainder = cents - base * lineCount
  return Array.from({ length: lineCount }, (_unused, index) =>
    Math.round((base + (index < remainder ? 1 : 0))) / 100
  )
}

function operationKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function operationLinesFor(query: string, component: string, manualMatches: RepairManualMatch[]): RepairOperationLine[] {
  const text = `${query} ${component}`.toLowerCase()
  const lines: RepairOperationLine[] = []
  const add = (label: string, system: string, risk: RepairOperationLine['risk'], side: RepairOperationLine['side'] | undefined = undefined, quantity = 1, kind: RepairOperationLine['kind'] = 'labor') => {
    const id = operationKey(label)
    if (lines.some(line => line.id === id)) return
    lines.push({
      id,
      label,
      system,
      kind,
      side,
      quantity,
      sourceStatus: manualMatches.some(match => match.matchType === 'exact_procedure') ? 'source_candidate' : 'needs_source',
      risk,
      estimateAmount: null,
    })
  }

  if (/(?:\b(?:all\s*)?(?:4|four)\b.{0,28}\bbrakes?\b|\bbrakes?\b.{0,28}\b(?:all\s*)?(?:4|four)\b|all\s+four\s+brakes?)/i.test(text)) {
    add('Four wheel brake service', 'brakes', 'elevated', 'all', 4)
  } else {
    if (/\bfront\b.{0,24}\bbrakes?\b|\bbrakes?\b.{0,24}\bfront\b/i.test(text)) add('Front brake service', 'brakes', 'elevated', 'front', 2)
    if (/\brear\b.{0,24}\bbrakes?\b|\bbrakes?\b.{0,24}\brear\b/i.test(text)) add('Rear brake service', 'brakes', 'elevated', 'rear', 2)
    if (!lines.some(line => line.system === 'brakes') && /\bbrakes?\b|rotors?|pads?|calipers?\b/i.test(text)) add('Brake service', 'brakes', 'elevated')
  }

  if (/\blower\s+control\s+arms?\b/i.test(text)) add('Replace lower control arms', 'suspension/steering', 'elevated', /\bboth\b|left.*right|right.*left/i.test(text) ? 'both' : undefined, /\bboth\b|left.*right|right.*left/i.test(text) ? 2 : 1)
  if (/\bupper\s+control\s+arms?\b/i.test(text)) add('Replace upper control arms', 'suspension/steering', 'elevated', /\bboth\b|left.*right|right.*left/i.test(text) ? 'both' : undefined, /\bboth\b|left.*right|right.*left/i.test(text) ? 2 : 1)
  if (/\bstruts?\b/i.test(text)) add('Replace struts', 'suspension/steering', 'elevated')
  if (/\bshocks?\b/i.test(text)) add('Replace shocks', 'suspension/steering', 'elevated')
  if (/\bsway\s+bar\s+links?\b/i.test(text)) add('Replace sway bar links', 'suspension/steering', 'elevated', /\bboth\b|left.*right|right.*left/i.test(text) ? 'both' : undefined, /\bboth\b|left.*right|right.*left/i.test(text) ? 2 : 1)
  if (/\bcoolant\s+(?:tank|reservoir|bottle)\b/i.test(text)) add('Replace coolant reservoir', 'cooling', 'elevated')
  if (/\bturn(?:ing)?\s+signal(?:\s+light)?\s+bulbs?\b/i.test(text)) add('Replace turn signal bulbs', 'lighting/electrical', 'standard')
  if (/\bfuse|relay|fuse box|junction box\b/i.test(text)) add('Fuse/relay location or wiring diagram lookup', 'lighting/electrical', 'standard', undefined, 1, 'inspection')
  if (/\bwiring|diagram|schematic|pinout\b/i.test(text) && !lines.some(line => /electrical|diagnostic/i.test(line.system))) add('Wiring diagram lookup', 'electrical', 'standard', undefined, 1, 'inspection')
  if (/\bthermostat\b/i.test(text)) add('Replace thermostat', 'cooling', 'elevated')
  if (/\bradiator\b/i.test(text)) add('Replace radiator', 'cooling', 'elevated')
  if (/\bwater\s+pump\b/i.test(text)) add('Replace water pump', 'cooling', 'elevated')
  if (/\balternator\b/i.test(text)) add('Replace alternator', 'charging/electrical', 'standard')
  if (/\bstarter\b/i.test(text)) add('Replace starter', 'starting/electrical', 'standard')
  if (/\bcatalyst|catalytic|converter|exhaust|oxygen\s+sensor|o2\s+sensor|emissions?\b/i.test(text)) {
    add(/\bremov|install|replace/i.test(text) ? 'Verify catalyst/exhaust removal procedure' : 'Catalyst efficiency diagnostic flow', 'emissions/exhaust', 'elevated')
  }
  if (/\bair\s*bag|srs\b/i.test(text)) add('SRS/airbag diagnosis or repair', 'airbag/SRS', 'critical')
  if (/\badas|calibration|radar|camera\b/i.test(text)) add('ADAS inspection/calibration', 'ADAS', 'critical')
  if (/\bfuel\s+(pump|line|injector|tank)\b/i.test(text)) add('Fuel system repair', 'fuel', 'critical')
  if (/\bhybrid|ev|high\s+voltage\b/i.test(text)) add('High-voltage system repair', 'hybrid/EV', 'critical')
  if (/\b[pcbu][0-9a-f]{4}\b/i.test(text)) add('Diagnostic flow and pinpoint testing', 'diagnostics', 'standard', undefined, 1, 'inspection')

  if (!lines.length) add(component || query, inferCategory(component) === 'spec' ? 'specifications' : 'general repair', 'standard')
  return lines.slice(0, 10)
}

function buildSafetyProfile(operations: RepairOperationLine[], component: string): RepairSafetyProfile {
  const systems = Array.from(new Set(operations.map(line => line.system)))
  const critical = operations.some(line => line.risk === 'critical')
  const elevated = operations.some(line => line.risk === 'elevated')
  const level: RepairSafetyProfile['level'] = critical ? 'critical' : elevated ? 'elevated' : 'standard'
  const gates: RepairSafetyProfile['gates'] = [
    {
      id: 'vehicle-fitment',
      label: 'Exact vehicle fitment verified',
      reason: 'Wrong engine, trim, drivetrain, brake package, or ADAS package can change procedure, parts, and safety steps.',
      required: true,
    },
    {
      id: 'source-procedure',
      label: 'Source procedure opened',
      reason: 'The app can point to sources, but a technician must verify the actual warnings, steps, and specs.',
      required: true,
    },
    {
      id: 'no-invented-specs',
      label: 'No torque specs or invented procedures',
      reason: 'Torque specs, wiring pinouts, diagnostic steps, labor times, capacities, and safety procedures are not final until source-verified.',
      required: true,
    },
  ]
  if (level !== 'standard') {
    gates.push({
      id: 'safety-system',
      label: `${level === 'critical' ? 'Critical' : 'Elevated'} safety system signoff`,
      reason: `${systems.join(', ')} work can affect braking, steering, cooling, fuel, airbags, ADAS, or vehicle support safety.`,
      required: true,
    })
  }
  if (/\btorque|spec|wiring|diagram|pinout|capacity|fluid\b/i.test(component)) {
    gates.push({
      id: 'spec-no-copy',
      label: 'Specs verified from source',
      reason: 'Do not invent or copy protected spec/procedure text into customer documents.',
      required: true,
    })
  }
  return { level, systems, technicianSignoffRequired: true, gates }
}

function tokenizeForManualSearch(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(?:for|the|and|a|an|of|to|with|from|into|about)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(token => token.length >= 3 && !MANUAL_TOKEN_STOP_WORDS.has(token))
}

function requiredTermsForComponent(component: string) {
  const text = component.toLowerCase()
  if (/\b(catalyst|catalytic|converter|exhaust|oxygen|o2|emission)\b/.test(text)) {
    return DTC_PROFILES.P0420.requiredTerms
  }
  if (/\b(misfire|spark|coil|injector|compression|ignition)\b/.test(text)) {
    return DTC_PROFILES.P0300.requiredTerms
  }
  if (/\b(lean|fuel trim|vacuum|intake|maf)\b/.test(text)) {
    return DTC_PROFILES.P0171.requiredTerms
  }
  if (/\bbrake|rotor|pad|caliper\b/.test(text)) return ['brake', 'rotor', 'pad', 'caliper']
  if (/\bcontrol arm|ball joint|strut|shock|sway|suspension\b/.test(text)) return ['control arm', 'ball joint', 'strut', 'shock', 'suspension', 'sway']
  if (/\bcoolant|radiator|reservoir|thermostat|water pump\b/.test(text)) return ['coolant', 'radiator', 'reservoir', 'thermostat', 'water pump']
  if (/\bturn signal|bulb|lamp|light|headlight|taillight\b/.test(text)) return ['turn signal', 'bulb', 'lamp', 'light', 'headlight', 'taillight']
  if (/\bfuse|relay|fuse box|junction box\b/.test(text)) return ['fuse', 'relay', 'fuse box', 'junction box']
  return []
}

function textHasAnyTerm(text: string, terms: string[]) {
  const normalized = text.toLowerCase().replace(/[-_]+/g, ' ')
  return terms.some(term => normalized.includes(term))
}

function scoreManualText(value: string, tokens: string[], category: RepairCategory, component = '') {
  const text = value.toLowerCase().replace(/[-_]+/g, ' ')
  const requiredTerms = requiredTermsForComponent(component)
  if (requiredTerms.length && !textHasAnyTerm(text, requiredTerms)) return 0

  let score = 0
  for (const token of tokens) {
    if (text.includes(token)) score += token.length > 5 ? 8 : 5
  }
  if (score > 0 && (category === 'diagram' || category === 'spec')) score += 4
  if (score > 0 && /\b(remove|install|replacement|diagnosis|testing|inspection|adjustment)\b/i.test(text)) score += 2
  return score
}

function manualMatchType(score: number, tokenCount: number, category: RepairCategory): RepairManualMatch['matchType'] {
  if ((category === 'diagram' || category === 'spec') && score >= 6) return 'diagram_or_spec'
  if (tokenCount > 0 && score >= Math.max(10, tokenCount * 5)) return 'exact_procedure'
  if (score >= 5) return 'likely_section'
  return 'general_manual'
}

async function deepSearchManualMatches(vehicle: RepairVehicle, component: string, sources: RepairSource[]) {
  const manualSources = sources
    .filter(item => item.provider === 'LEMON' || item.provider === 'CHARM')
    .slice(0, 3)
  const tokens = tokenizeForManualSearch(`${vehicleLabel(vehicle)} ${component}`)
  const queue = manualSources.map(item => item.url)
  const visited = new Set<string>()
  const matches: RepairManualMatch[] = []
  let indexedPages = 0
  let indexedLinks = 0

  while (queue.length && indexedPages < 8) {
    const url = queue.shift()!
    if (visited.has(url)) continue
    visited.add(url)
    try {
      const page = await readRepairManualPage(url, 5000)
      indexedPages += 1
      const path = [...page.breadcrumbs.map(link => link.title), page.title].filter(Boolean).slice(-6)
      const pageCategory = inferCategory(`${page.title} ${component}`)
      const pageScore = scoreManualText(`${page.title} ${decodeURIComponent(page.url)}`, tokens, pageCategory, component)
      if (pageScore >= 5) {
        const category = pageCategory
        matches.push({
          id: sourceId(page.provider, page.url),
          title: page.title,
          url: page.url,
          provider: page.provider,
          path,
          category,
          matchType: manualMatchType(pageScore, tokens.length, category),
          score: pageScore,
          hasImages: page.images.length > 0,
          sourceStatus: 'indexed',
          note: 'Source title/path indexed. Open original source and verify exact procedure, warnings, and specs before use.',
        })
      }

      const scoredLinks = page.links
        .map(link => ({
          link,
          score: scoreManualText(`${link.title} ${decodeURIComponent(link.url)}`, tokens, link.category, component),
        }))
        .sort((a, b) => b.score - a.score)
      indexedLinks += page.links.length

      for (const { link, score } of scoredLinks.slice(0, 10)) {
        const matchType = manualMatchType(score, tokens.length, link.category)
        if (score >= 5) {
          matches.push({
            id: sourceId(link.provider, link.url),
            title: link.title,
            url: link.url,
            provider: link.provider,
            path: [...path, link.title].slice(-6),
            category: link.category,
            matchType,
            score,
            hasImages: false,
            sourceStatus: 'source_link_only',
            note: 'Matching link found in manual tree. Open it to verify if it is the exact procedure.',
          })
        }
        if (score >= 5 && !visited.has(link.url) && queue.length < 10) queue.push(link.url)
      }
    } catch {
      // Keep search resilient; source cards still show the original link.
    }
  }

  const deduped = dedupeManualMatches(matches)
    .sort((a, b) => b.score - a.score || Number(b.hasImages) - Number(a.hasImages))
    .slice(0, 18)
  return { matches: deduped, indexedPages, indexedLinks }
}

function dedupeManualMatches(items: RepairManualMatch[]) {
  const seen = new Set<string>()
  return items.filter(item => {
    if (seen.has(item.url)) return false
    seen.add(item.url)
    return true
  })
}

function buildEstimateDraft(query: string, operations: RepairOperationLine[], vehicle: RepairVehicle): RepairEstimateDraft {
  const targetTotal = extractTargetTotal(query)
  const pricedOperations = operations.filter(line => line.kind === 'labor')
  const allocations = targetTotal !== null ? allocateMoney(targetTotal, pricedOperations.length || operations.length || 1) : []
  let allocationIndex = 0
  const labors = operations
    .filter(line => line.kind !== 'parts')
    .map(line => {
      const amount = targetTotal !== null && line.kind === 'labor' ? allocations[allocationIndex++] : null
      return {
        operation: line.label,
        ...(amount !== null ? { amount, pricing: 'flat' } : { hours: 0, rate: 0, pricing: 'needs_price' }),
        source_status: line.sourceStatus,
        risk: line.risk,
      }
    })
  const notes = [
    `Repair research estimate draft for ${vehicleLabel(vehicle) || 'selected vehicle'}.`,
    targetTotal !== null ? `Locked customer-facing total requested: $${targetTotal.toFixed(2)}. No tax applied until reviewed.` : 'No price supplied yet. Enter a locked total or verified labor/part pricing before saving.',
    'Technician must verify source procedures, warnings, torque/specs, and labor before work starts.',
  ].join('\n')
  return {
    targetTotal,
    totalLocked: targetTotal !== null,
    parts: [],
    labors,
    notes,
    warnings: targetTotal === null
      ? ['No total was provided, so the draft is not estimate-ready yet.']
      : ['Locked total is allocated across labor/service lines without inventing part prices.'],
  }
}

function vehicleConfidence(vehicle: RepairVehicle) {
  const fields = [vehicle.vin, vehicle.year, vehicle.make, vehicle.model, vehicle.engine, vehicle.trim, vehicle.drivetrain, vehicle.transmission, vehicle.brakeSystem]
  const present = fields.filter(Boolean).length
  return Math.min(100, Math.round((present / fields.length) * 100))
}

function buildCoverageDashboard(sources: RepairSource[], manualStats: { indexedPages: number; indexedLinks: number }, manualMatches: RepairManualMatch[]): RepairCoverageDashboard {
  const recallCount = sources.filter(item => item.provider === 'NHTSA' && item.category === 'recall').length
  return {
    lemonCharmManual: sources.some(item => item.provider === 'LEMON' || item.provider === 'CHARM') ? 'found' : 'missing',
    nhtsaRecalls: recallCount > 0 ? 'found' : sources.some(item => item.provider === 'NHTSA') ? 'not_found' : 'unknown',
    tsbCommunications: 'link_ready',
    oemOneStop: 'link_ready',
    autoZoneGuide: 'link_ready',
    shopProcedure: 'needs_database',
    indexedPages: manualStats.indexedPages,
    indexedLinks: manualStats.indexedLinks,
    exactMatches: manualMatches.filter(item => item.matchType === 'exact_procedure').length,
    likelyMatches: manualMatches.filter(item => item.matchType === 'likely_section').length,
    diagrams: manualMatches.filter(item => item.category === 'diagram' || item.matchType === 'diagram_or_spec').length,
    specs: manualMatches.filter(item => item.category === 'spec').length,
  }
}

function buildWorkflow(
  vehicle: RepairVehicle,
  sources: RepairSource[],
  draft: RepairDraft,
  manualMatches: RepairManualMatch[],
  operations: RepairOperationLine[],
  safetyProfile: RepairSafetyProfile,
  coverageDashboard: RepairCoverageDashboard,
): RepairWorkflow {
  const missing = [
    !vehicle.vin ? 'VIN' : '',
    !vehicle.year ? 'year' : '',
    !vehicle.make ? 'make' : '',
    !vehicle.model ? 'model' : '',
    !vehicle.engine ? 'engine/trim' : '',
    !vehicle.drivetrain ? 'drivetrain' : '',
    !vehicle.transmission ? 'transmission' : '',
    !vehicle.brakeSystem && operations.some(item => item.system === 'brakes') ? 'brake package' : '',
  ].filter(Boolean)
  const confidence = vehicleConfidence(vehicle)
  const vehicleMatch = vehicle.vin && !missing.includes('year') && !missing.includes('make') && !missing.includes('model')
    ? { level: 'exact_vin' as const, label: 'VIN decoded match', missing, confidence }
    : vehicle.year && vehicle.make && vehicle.model
      ? { level: 'year_make_model' as const, label: 'Year/make/model match', missing, confidence }
      : vehicle.year || vehicle.make || vehicle.model
        ? { level: 'partial' as const, label: 'Partial vehicle match', missing, confidence }
        : { level: 'unknown' as const, label: 'Vehicle not identified', missing, confidence }
  const hasManual = sources.some(item => item.provider === 'LEMON' || item.provider === 'CHARM')
  const hasOfficialData = sources.some(item => item.provider === 'NHTSA' || item.provider === 'OEM1Stop')
  const hasProcedureCandidate = sources.some(item => ['procedure', 'manual', 'diagram', 'spec'].includes(item.category))
  const hasExactProcedureMatch = manualMatches.some(item => item.matchType === 'exact_procedure')
  const steps: RepairWorkflowStep[] = [
    {
      id: 'vehicle',
      label: 'Identify Exact Vehicle',
      status: vehicleMatch.confidence >= 70 ? 'ready' : 'needs_review',
      detail: vehicleMatch.missing.length ? `${vehicleMatch.confidence}% confidence. Missing ${vehicleMatch.missing.join(', ')}.` : `${vehicleMatch.confidence}% confidence. ${vehicleMatch.label}.`,
    },
    {
      id: 'manual',
      label: 'Deep Manual Search',
      status: hasExactProcedureMatch ? 'ready' : hasManual ? 'needs_review' : 'needs_source',
      detail: hasExactProcedureMatch
        ? `${coverageDashboard.exactMatches} exact procedure candidate(s), ${coverageDashboard.likelyMatches} likely section(s), ${coverageDashboard.indexedPages} page(s) indexed.`
        : hasManual ? `${coverageDashboard.indexedPages} manual page(s) indexed. Choose likely source sections before quoting.` : 'No matching manual directory source verified yet.',
    },
    {
      id: 'official',
      label: 'Check Official Data',
      status: hasOfficialData ? 'ready' : 'needs_source',
      detail: hasOfficialData ? 'NHTSA or OEM index source available.' : 'Use OEM1Stop/NHTSA links before safety-sensitive work.',
    },
    {
      id: 'operations',
      label: 'Structure Work',
      status: operations.length ? 'ready' : 'needs_review',
      detail: `${operations.length} operation line(s) identified for checklist and estimate handoff.`,
    },
    {
      id: 'safety',
      label: 'Safety Signoff',
      status: safetyProfile.level === 'standard' ? 'needs_review' : 'needs_source',
      detail: `${safetyProfile.level.toUpperCase()} risk. Technician signoff required before work.`,
    },
  ]
  return {
    vehicleMatch,
    coverage: {
      hasManual,
      hasOfficialData,
      hasProcedureCandidate,
      hasEstimateReadyDraft: hasProcedureCandidate && vehicleMatch.level !== 'unknown',
      hasExactProcedureMatch,
      hasShopProcedure: coverageDashboard.shopProcedure === 'found',
    },
    steps,
    safetyGates: safetyProfile.gates.map(gate => `${gate.label}: ${gate.reason}`),
  }
}

export async function searchRepairSources(query: string, fallbackVehicle: Partial<RepairVehicle> = {}): Promise<RepairSearchResult> {
  const firstPass = parseRepairQuery(query, fallbackVehicle)
  const vinData = await decodeVin(firstPass.vin)
  const parsed = parseRepairQuery(query, { ...fallbackVehicle, ...vinData, vin: firstPass.vin })
  const vehicle: RepairVehicle = {
    vin: parsed.vin,
    year: parsed.year,
    make: parsed.make,
    model: parsed.model,
    engine: parsed.engine,
    trim: parsed.trim,
    drivetrain: parsed.drivetrain,
    transmission: parsed.transmission,
    fuel: parsed.fuel,
    bodyClass: parsed.bodyClass,
    brakeSystem: parsed.brakeSystem,
    adas: parsed.adas,
    emissions: parsed.emissions,
  }
  const component = parsed.component

  const [lemon, charm, recalls, webResults] = await Promise.all([
    browseManualDirectory('LEMON', vehicle, component),
    browseManualDirectory('CHARM', vehicle, component),
    fetchNhtsaRecalls(vehicle),
    searchTavily(query, vehicle),
  ])

  const sources = dedupeSources([
    ...lemon,
    ...charm,
    ...recalls,
    ...webResults,
    ...staticSourceLinks(vehicle, component),
  ]).slice(0, 40)

  const warnings = [
    !vehicle.year || !vehicle.make || !vehicle.model ? 'Vehicle could not be fully normalized. Enter year, make, model, and engine for better results.' : '',
    !sources.some(item => item.provider === 'LEMON' || item.provider === 'CHARM') ? 'No matching free manual directory was verified for this vehicle during the lookup.' : '',
  ].filter(Boolean)

  const draft = buildRepairDraft(query, vehicle, component, parsed.dtc)
  const manualStats = await deepSearchManualMatches(vehicle, component, sources)
  const manualMatches = manualStats.matches
  const operationLines = operationLinesFor(query, component, manualMatches)
  const safetyProfile = buildSafetyProfile(operationLines, component)
  const estimateDraft = buildEstimateDraft(query, operationLines, vehicle)
  const coverageDashboard = buildCoverageDashboard(sources, manualStats, manualMatches)

  return {
    query,
    normalizedVehicle: vehicle,
    sources,
    manualMatches,
    operationLines,
    estimateDraft,
    safetyProfile,
    coverageDashboard,
    draft,
    counts: countCategories(sources),
    workflow: buildWorkflow(vehicle, sources, draft, manualMatches, operationLines, safetyProfile, coverageDashboard),
    warnings,
  }
}
