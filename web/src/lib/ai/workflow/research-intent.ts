export type ResearchIntentInput = {
  message: string
  task?: { action?: unknown; payload?: unknown; instructions?: unknown } | null
  conversation?: Array<{ role?: unknown; text?: unknown }>
  facts?: { retailer?: unknown } | null
}

export type ResearchIntent = {
  query: string
  stores: string[]
  wantsParts: boolean
  wantsLabor: boolean
  vehicle?: { year: string; make: string; model: string }
}

const MAX_SOURCE_CHARS = 4_000
const MAX_QUERY_CHARS = 600
const MAX_VALUES = 32
const RETAILERS = [
  ['AutoZone', /\bauto\s*zone\b/i],
  ["O'Reilly", /\bo['’]?reilly(?:\s+auto\s+parts)?\b/i],
  ['NAPA', /\bnapa(?:\s+auto\s+parts)?\b/i],
  ['RockAuto', /\brock\s*auto\b/i],
  ['Advance Auto', /\badvance\s+auto(?:\s+parts)?\b/i],
  ['Pep Boys', /\bpep\s+boys\b/i],
  ['Amazon', /\bamazon\b/i],
  ['eBay', /\be\s*bay\b/i],
] as const

const PART_TERMS = /\b(?:part|parts|brake(?:s|\s+(?:pad|pads|rotor|rotors|caliper|calipers|shoe|shoes|line|lines))?|rotor(?:s)?|pad(?:s)?|caliper(?:s)?|control[ -]?arm(?:s)?|ball[ -]?joint(?:s)?|tie[ -]?rod(?:s)?|wheel[ -]?bearing(?:s)?|strut(?:s)?|shock(?:s)?|alternator|starter|water[ -]?pump|radiator|battery|belt(?:s)?|hose(?:s)?|filter(?:s)?|spark[ -]?plug(?:s)?|clutch|axle(?:s)?|cv[ -]?joint(?:s)?)\b/i
const SERVICE_TERMS = /\b(?:replace|replacement|repair|install|installation|service|change|flush|diagnos(?:e|is|tic)|alignment|tune[ -]?up|brake\s+job|oil\s+change)\b/i
const RESEARCH_TERMS = /\b(?:look\s*(?:it\s*)?up|look\s+online|search(?:\s+for)?|find(?:\s+(?:me\s+)?)?(?:prices?|parts?)?|check\s+(?:the\s+)?prices?|price(?:\s+out)?|compare\s+prices?|source\s+(?:the\s+)?parts?)\b/i
const PRICING_TERMS = /\b(?:price|prices|pricing|quote|cost|costs|labor|labour)\b/i
const KNOWN_NON_DOCUMENT_ACTIONS = new Set([
  'createCustomer', 'createAppointment', 'createJob', 'updateDocument', 'convertEstimateToInvoice',
  'updateCustomer', 'updateInventory', 'deleteRecord', 'searchCustomers', 'lookupParts', 'searchWeb',
])
const RESEARCH_FIELDS = /(?:vehicle|year|make|model|engine|trim|service|repair|work|note|description|operation|part|item|name|position|side|location|quantity|qty|store|retailer|brand|instruction)/i

function text(value: unknown, limit = MAX_SOURCE_CHARS): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function hasClearDocumentWording(source: string): boolean {
  return /\b(?:invoice|estimate)\b/i.test(source)
}

function isDocumentAction(action: unknown, source: string): boolean {
  if (action === 'createInvoice' || action === 'createEstimate') return true
  if (typeof action === 'string' && KNOWN_NON_DOCUMENT_ACTIONS.has(action)) return false
  return hasClearDocumentWording(source)
}

function collectResearchValues(value: unknown, values: string[], key = '', depth = 0): void {
  if (values.length >= MAX_VALUES || depth > 4 || value === null || value === undefined) return
  if (typeof value === 'string' || typeof value === 'number') {
    if (!key || RESEARCH_FIELDS.test(key)) {
      const item = text(String(value), 180)
      if (item) values.push(item)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 12)) collectResearchValues(item, values, key, depth + 1)
    return
  }
  if (typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>).slice(0, 24)) {
      if (RESEARCH_FIELDS.test(childKey)) collectResearchValues(child, values, childKey, depth + 1)
    }
  }
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  return values.filter(value => {
    const key = value.toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function missingPricedLines(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return true
  const record = payload as Record<string, unknown>
  const parts = Array.isArray(record.parts) ? record.parts : []
  const labors = Array.isArray(record.labors) ? record.labors : []
  const hasNumber = (value: unknown): boolean => value !== null && value !== '' && value !== undefined && Number.isFinite(Number(value))
  const pricedPart = parts.some(line => line && typeof line === 'object' && hasNumber((line as Record<string, unknown>).unitPrice))
  const pricedLabor = labors.some(line => {
    if (!line || typeof line !== 'object') return false
    const item = line as Record<string, unknown>
    return hasNumber(item.amount) || (hasNumber(item.hours) && hasNumber(item.rate))
  })
  return !pricedPart && !pricedLabor
}

function extractVehicle(value: unknown): { year: string; make: string; model: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const year = typeof source.vehicle_year === 'string' ? source.vehicle_year.trim() : ''
  const make = typeof source.vehicle_make === 'string' ? source.vehicle_make.trim() : ''
  const model = typeof source.vehicle_model === 'string' ? source.vehicle_model.trim() : ''
  if (/^(?:19|20)\d{2}$/.test(year) && make && model) return { year, make, model }
  return undefined
}

function vehicleFromText(source: string): { year: string; make: string; model: string } | undefined {
  const match = source.match(/\b((?:19|20)\d{2})\s+([A-Za-z][A-Za-z-]+)\s+([A-Za-z0-9][A-Za-z0-9-]*)\b/i)
  return match ? { year: match[1], make: match[2], model: match[3] } : undefined
}

function compactQuery(values: string[]): string {
  const query = unique(values).join('; ').replace(/\s+/g, ' ').trim()
  return query.length <= MAX_QUERY_CHARS ? query : query.slice(0, MAX_QUERY_CHARS).replace(/\s+\S*$/, '').trim()
}

export function inferResearchIntent(input: ResearchIntentInput): ResearchIntent | null {
  const current = text(input.message)
  const priorUserTurns = (input.conversation || [])
    .filter(turn => String(turn?.role || '').toLowerCase() === 'user')
    .map(turn => text(turn?.text, 500))
    .filter(Boolean)
  const userSource = [current, ...priorUserTurns].join(' ').slice(0, MAX_SOURCE_CHARS)
  const taskValues: string[] = []
  collectResearchValues(input.task?.payload, taskValues)
  collectResearchValues(input.task?.instructions, taskValues, 'instructions')
  const source = [userSource, ...taskValues].join(' ').slice(0, MAX_SOURCE_CHARS)

  const documentTask = isDocumentAction(input.task?.action, userSource)
  if (!documentTask) return null

  const wantsParts = PART_TERMS.test(source)
  const isService = SERVICE_TERMS.test(source) || wantsParts
  const wantsLabor = /\blabo(?:r|ur)\b/i.test(source) || (documentTask && isService)
  const currentHasServiceScope = SERVICE_TERMS.test(current) || PART_TERMS.test(current)
  const explicitResearch = RESEARCH_TERMS.test(current) || PRICING_TERMS.test(current) || RETAILERS.some(([, pattern]) => pattern.test(current))
  // Do not restart a retailer lookup on every follow-up in a long chat. An
  // implicit lookup is triggered by the turn that supplies the repair scope;
  // later turns must explicitly ask to research again or provide new scope.
  const implicitResearch = documentTask && currentHasServiceScope && missingPricedLines(input.task?.payload)

  if (!isService || (!explicitResearch && !implicitResearch)) return null

  const currentStores = RETAILERS.filter(([, pattern]) => pattern.test(current)).map(([store]) => store)
  const rememberedStore = typeof input.facts?.retailer === 'string' && input.facts.retailer.trim() ? [input.facts.retailer.trim()] : []
  const stores = (currentStores.length ? currentStores : rememberedStore.length ? rememberedStore : RETAILERS.filter(([, pattern]) => pattern.test(source)).map(([store]) => store))
  const vehicle = extractVehicle(input.task?.payload) || vehicleFromText(current) || vehicleFromText(userSource)
  const relevantPriorTurns = priorUserTurns
    .filter(turn => turn !== current)
    .filter(turn => !vehicle || !vehicleFromText(turn))
    .filter(turn => SERVICE_TERMS.test(turn) || PART_TERMS.test(turn) || RESEARCH_TERMS.test(turn) || RETAILERS.some(([, pattern]) => pattern.test(turn)))
    .slice(-6)
  const query = compactQuery([
    vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : '',
    ...relevantPriorTurns,
    ...taskValues,
    current,
  ])
  if (!query) return null
  return { query, stores, wantsParts, wantsLabor, ...(vehicle ? { vehicle } : {}) }
}

