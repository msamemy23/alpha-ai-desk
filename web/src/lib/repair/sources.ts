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
  warnings: string[]
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
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
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

  return {
    query,
    normalizedVehicle: vehicle,
    sources,
    draft: buildRepairDraft(query, vehicle, component, parsed.dtc),
    counts: countCategories(sources),
    warnings,
  }
}
