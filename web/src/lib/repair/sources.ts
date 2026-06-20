export type RepairProvider = 'LEMON' | 'CHARM' | 'NHTSA' | 'OEM1Stop' | 'AutoZone' | 'Web'
export type RepairCategory = 'manual' | 'procedure' | 'diagram' | 'spec' | 'labor' | 'tsb' | 'recall' | 'complaint' | 'oem_link' | 'shop_draft'
export type RepairConfidence = 'public_manual' | 'official_government' | 'official_oem_index' | 'source_directory' | 'search_result' | 'shop_draft'

export interface RepairVehicle {
  vin?: string
  year?: string
  make?: string
  model?: string
  engine?: string
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
  }
  coverage: {
    hasManual: boolean
    hasOfficialData: boolean
    hasProcedureCandidate: boolean
    hasEstimateReadyDraft: boolean
  }
  steps: RepairWorkflowStep[]
  safetyGates: string[]
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

export function parseRepairQuery(input: string, fallback: Partial<RepairVehicle> = {}): RepairVehicle & { component: string; dtc?: string } {
  let text = input.replace(/\s+/g, ' ').trim()
  const vin = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0]?.toUpperCase() || fallback.vin
  const dtc = text.match(/\b[PCBU][0-9A-F]{4}\b/i)?.[0]?.toUpperCase()
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

  const component = text
    .replace(/\b(open|find|look\s+up|search|repair|manual|procedure|steps?|for|on|a|an|the|please|me|show|get)\b/gi, ' ')
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, ' ')
    .replace(/\b(19|20)?\d{2}\b/g, ' ')
    .replace(new RegExp(`\\b(${MAKES.join('|').replace(/\s+/g, '\\s+')})\\b`, 'gi'), ' ')
    .replace(new RegExp(`\\b(${MODEL_HINTS.map(escapeRegExp).join('|').replace(/\s+/g, '\\s+')})\\b`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    vin,
    year,
    make: canonicalMakeForManuals(make),
    model: normalizeModel(model),
    engine: fallback.engine,
    component: component || dtc || input,
    dtc,
  }
}

export function vehicleLabel(vehicle: RepairVehicle) {
  return [vehicle.year, canonicalMakeForNhtsa(vehicle.make), vehicle.model, vehicle.engine].filter(Boolean).join(' ').trim()
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

async function fetchText(url: string) {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'AlphaAIRepairResearch/1.0' },
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return ''
    return await res.text()
  } catch {
    return ''
  }
}

function extractManualLinks(html: string, baseUrl: string, model?: string) {
  const links: Array<{ title: string; url: string }> = []
  const seen = new Set<string>()
  const modelLower = (model || '').toLowerCase().replace(/-/g, '')
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const href = decodeHtml(match[1])
    const label = decodeHtml(match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    if (!href || href.startsWith('#') || href === '/' || /about|nfo|style/i.test(href)) continue
    const url = new URL(href, baseUrl).toString()
    if (seen.has(url)) continue
    const comparable = `${label} ${decodeURIComponent(url)}`.toLowerCase().replace(/-/g, '')
    if (modelLower && !comparable.includes(modelLower)) continue
    seen.add(url)
    links.push({ title: label || decodeURIComponent(url.split('/').filter(Boolean).pop() || url), url })
  }
  return links.slice(0, 12)
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
    const url = new URL(decodeHtml(href), baseUrl)
    url.hash = ''
    const provider = providerFromUrl(url.toString())
    if (!provider) return null
    const cleanLabel = stripTags(label) || titleFromUrl(url.toString())
    if (!cleanLabel || /^(home|temporarily|permanently|read the announcement)$/i.test(cleanLabel)) return null
    if (/\/(style\.css|about\.html|nfo\.html)$/i.test(url.pathname)) return null
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
      const alt = stripTags(tag.match(/\salt=["']([^"']*)["']/i)?.[1] || 'Manual image')
      images.push({ alt, url: src })
      seen.add(src)
      if (images.length >= 12) break
    } catch {}
  }
  return images
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

export async function readRepairManualPage(url: string): Promise<RepairManualPage> {
  const normalized = normalizeManualUrl(url)
  if (!normalized) throw new Error('Only CHARM and LEMON manual URLs are supported')
  const html = await fetchText(normalized.url)
  if (!html) throw new Error('Manual source did not return readable content')
  return {
    provider: normalized.provider,
    url: normalized.url,
    title: extractTitle(html, normalized.url),
    breadcrumbs: extractBreadcrumbs(html, normalized.url),
    links: extractManualLinksDetailed(mainFragment(html), normalized.url, 80),
    sections: extractReaderSections(html, normalized.url),
    images: extractManualImages(mainFragment(html), normalized.url),
    canStoreContent: false,
    warning: 'Source preview only. Do not copy protected manual text into customer documents. Verify exact trim, engine, warnings, torque specs, and safety procedures from the source before work.',
  }
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
      engine: row.DisplacementL ? `${row.DisplacementL}L` : '',
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
    }).filter(item => item.url)
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

function buildWorkflow(vehicle: RepairVehicle, sources: RepairSource[], draft: RepairDraft): RepairWorkflow {
  const missing = [
    !vehicle.vin ? 'VIN' : '',
    !vehicle.year ? 'year' : '',
    !vehicle.make ? 'make' : '',
    !vehicle.model ? 'model' : '',
    !vehicle.engine ? 'engine/trim' : '',
  ].filter(Boolean)
  const vehicleMatch = vehicle.vin && !missing.includes('year') && !missing.includes('make') && !missing.includes('model')
    ? { level: 'exact_vin' as const, label: 'VIN decoded match', missing }
    : vehicle.year && vehicle.make && vehicle.model
      ? { level: 'year_make_model' as const, label: 'Year/make/model match', missing }
      : vehicle.year || vehicle.make || vehicle.model
        ? { level: 'partial' as const, label: 'Partial vehicle match', missing }
        : { level: 'unknown' as const, label: 'Vehicle not identified', missing }
  const hasManual = sources.some(item => item.provider === 'LEMON' || item.provider === 'CHARM')
  const hasOfficialData = sources.some(item => item.provider === 'NHTSA' || item.provider === 'OEM1Stop')
  const hasProcedureCandidate = sources.some(item => ['procedure', 'manual', 'diagram', 'spec'].includes(item.category))
  const steps: RepairWorkflowStep[] = [
    {
      id: 'vehicle',
      label: 'Identify Exact Vehicle',
      status: vehicleMatch.level === 'exact_vin' || vehicleMatch.level === 'year_make_model' ? 'ready' : 'needs_review',
      detail: vehicleMatch.missing.length ? `Missing ${vehicleMatch.missing.join(', ')}.` : vehicleMatch.label,
    },
    {
      id: 'manual',
      label: 'Open Matching Manual',
      status: hasManual ? 'ready' : 'needs_source',
      detail: hasManual ? 'Manual source candidate found from LEMON/CHARM.' : 'No matching manual directory source verified yet.',
    },
    {
      id: 'official',
      label: 'Check Official Data',
      status: hasOfficialData ? 'ready' : 'needs_source',
      detail: hasOfficialData ? 'NHTSA or OEM index source available.' : 'Use OEM1Stop/NHTSA links before safety-sensitive work.',
    },
    {
      id: 'draft',
      label: 'Build Shop Procedure Draft',
      status: draft.sourceRequired ? 'needs_review' : 'ready',
      detail: 'Draft checklist is ready, but a technician must verify source procedure, specs, and warnings.',
    },
  ]
  return {
    vehicleMatch,
    coverage: {
      hasManual,
      hasOfficialData,
      hasProcedureCandidate,
      hasEstimateReadyDraft: hasProcedureCandidate && vehicleMatch.level !== 'unknown',
    },
    steps,
    safetyGates: [
      'No torque specs, wiring pinouts, diagnostic steps, labor times, or safety procedures are final until source-verified.',
      'Customer authorization is required before teardown, repairs, parts ordering, sends, or payments.',
      'High-voltage, airbag, ADAS, brake, steering, fuel, and lift operations require technician review before work.',
    ],
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

  return {
    query,
    normalizedVehicle: vehicle,
    sources,
    draft,
    counts: countCategories(sources),
    workflow: buildWorkflow(vehicle, sources, draft),
    warnings,
  }
}
