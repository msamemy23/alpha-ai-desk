export type ResearchIntentInput = {
  message: string
  task?: { action?: unknown; payload?: unknown; instructions?: unknown } | null
  conversation?: Array<{ role?: unknown; text?: unknown }>
  facts?: { retailer?: unknown; fitment?: unknown } | null
  research?: ResearchIntent | null
}

export type ResearchFitment = { trim?: string; engine?: string; brakeType?: string }

export type ResearchIntent = {
  query: string
  stores: string[]
  wantsParts: boolean
  wantsLabor: boolean
  createsDocument: boolean
  documentType: 'Invoice' | 'Estimate'
  vehicle?: { year: string; make: string; model: string }
  fitment?: ResearchFitment
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

function missingPricedLines(payload: unknown, wantsParts: boolean, wantsLabor: boolean): boolean {
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
  // A priced labor line must not make missing parts look complete (and vice
  // versa). This is the distinction the old `some priced line` check lost.
  const partsRequested = wantsParts || parts.length > 0
  const laborRequested = wantsLabor || labors.length > 0
  return (partsRequested && !pricedPart) || (laborRequested && !pricedLabor)
}

function extractVehicle(value: unknown): { year: string; make: string; model: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const year = typeof source.vehicle_year === 'number'
    ? String(source.vehicle_year)
    : typeof source.vehicle_year === 'string' ? source.vehicle_year.trim() : ''
  const make = typeof source.vehicle_make === 'string' ? source.vehicle_make.trim() : ''
  const model = typeof source.vehicle_model === 'string' ? source.vehicle_model.trim() : ''
  if (/^(?:19|20)\d{2}$/.test(year) && make && model) return { year, make, model }
  return undefined
}

function extractFitment(value: unknown): ResearchFitment | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const trim = ['vehicle_trim', 'trim'].map(key => source[key]).find(item => typeof item === 'string' && item.trim())
  const engine = ['vehicle_engine', 'engine'].map(key => source[key]).find(item => typeof item === 'string' && item.trim())
  const brakeType = ['brake_type', 'rear_brake_type'].map(key => source[key]).find(item => typeof item === 'string' && item.trim())
  if (!trim && !engine && !brakeType) return undefined
  return {
    ...(typeof trim === 'string' ? { trim: text(trim, 80) } : {}),
    ...(typeof engine === 'string' ? { engine: text(engine, 80) } : {}),
    ...(typeof brakeType === 'string' ? { brakeType: text(brakeType, 80) } : {}),
  }
}

function fitmentFromText(source: string): ResearchFitment | undefined {
  const trim = source.match(/\b(?:trim|package|edition)\s*(?:is|:|=)?\s*([A-Za-z0-9][A-Za-z0-9 .+\-/]{0,50}?)(?=\s*(?:,|;|\.(?=\s|$)|$)|\s+(?:engine|motor)\b)/i)?.[1]?.trim()
  const engine = source.match(/\b(?:engine|motor)\s*(?:is|:|=)?\s*([A-Za-z0-9][A-Za-z0-9 .+\-/]{0,50}?)(?=\s*(?:,|;|\.(?=\s|$)|$))/i)?.[1]?.trim()
  const brakeType = source.match(/\b(?:rear\s+)?(?:brakes?\s+are|brake\s+type\s*(?:is|:|=)?)\s*(disc|drum)\b/i)?.[1]
  if (!trim && !engine && !brakeType) return undefined
  return {
    ...(trim ? { trim: trim.slice(0, 80) } : {}),
    ...(engine ? { engine: engine.slice(0, 80) } : {}),
    ...(brakeType ? { brakeType: brakeType.toLowerCase() } : {}),
  }
}

function looksLikeFitmentAnswer(source: string): boolean {
  return Boolean(fitmentFromText(source))
    || /\b(?:v6|v8|i4|l4|4[- ]?cylinder|6[- ]?cylinder)\b/i.test(source)
    || /^\s*[A-Za-z][A-Za-z0-9 +\/-]{1,30}\s+\d+(?:\.\d+)?(?:\s*(?:l|liter))?(?:\s+(?:turbo|hybrid))?\s*$/i.test(source)
}

function vehicleFromText(source: string): { year: string; make: string; model: string } | undefined {
  const match = source.match(/\b((?:19|20)\d{2})\s+([A-Za-z][A-Za-z-]+)\s+([A-Za-z0-9][A-Za-z0-9-]*)\b/i)
  return match ? { year: match[1], make: match[2], model: match[3] } : undefined
}

function sameVehicle(left: { year: string; make: string; model: string }, right: { year: string; make: string; model: string }) {
  return left.year === right.year
    && left.make.toLowerCase() === right.make.toLowerCase()
    && left.model.toLowerCase() === right.model.toLowerCase()
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
  if (input.research?.query) taskValues.push(input.research.query)
  const source = [userSource, ...taskValues].join(' ').slice(0, MAX_SOURCE_CHARS)

  // Document intent is a turn boundary, not a keyword that can be inherited
  // from an old conversational transcript. If a task is already an invoice
  // or estimate, its action is the durable continuation signal. Otherwise a
  // current lookup such as "look on AutoZone for brakes" must stay read-only
  // even when an earlier, unrelated turn mentioned an invoice.
  const createsDocument = isDocumentAction(input.task?.action, current)
  const hasActiveDocumentTask = input.task?.action === 'createInvoice' || input.task?.action === 'createEstimate'
  const scopeSource = hasActiveDocumentTask || hasClearDocumentWording(current)
    ? source
    : [current, input.research?.query || ''].join(' ')

  const wantsParts = PART_TERMS.test(scopeSource)
  const isService = SERVICE_TERMS.test(scopeSource) || wantsParts
  const wantsLabor = /\blabo(?:r|ur)\b/i.test(scopeSource) || (createsDocument && isService) || Boolean(input.research?.wantsLabor && isService)
  const documentType: 'Invoice' | 'Estimate' = input.task?.action === 'createInvoice'
    ? String((input.task?.payload as Record<string, unknown> | undefined)?.type || '').toLowerCase() === 'estimate' ? 'Estimate' : 'Invoice'
    : /\binvoice\b/i.test(current) || /\binvoice\b/i.test(userSource) ? 'Invoice' : 'Estimate'
  const currentHasServiceScope = SERVICE_TERMS.test(current) || PART_TERMS.test(current)
  const currentVehicle = vehicleFromText(current)
  const currentFitment = fitmentFromText(current)
  const explicitResearch = RESEARCH_TERMS.test(current) || PRICING_TERMS.test(current) || RETAILERS.some(([, pattern]) => pattern.test(current))
    || Boolean(input.research && (currentHasServiceScope || looksLikeFitmentAnswer(current) || currentVehicle || /\b(?:front|rear|left|right|all\s+four|both)\b/i.test(current)))
  // Do not restart a retailer lookup on every follow-up in a long chat. An
  // implicit lookup is triggered by the turn that supplies the repair scope;
  // later turns must explicitly ask to research again or provide new scope.
  const implicitResearch = createsDocument && currentHasServiceScope && missingPricedLines(input.task?.payload, wantsParts, wantsLabor)

  if (!isService || (!explicitResearch && !implicitResearch)) return null

  const currentStores = RETAILERS.filter(([, pattern]) => pattern.test(current)).map(([store]) => store)
  const rememberedStore = typeof input.facts?.retailer === 'string' && input.facts.retailer.trim() ? [input.facts.retailer.trim()] : []
  const stores = (currentStores.length ? currentStores : rememberedStore.length ? rememberedStore : RETAILERS.filter(([, pattern]) => pattern.test(source)).map(([store]) => store))
  const vehicle = extractVehicle(input.task?.payload) || currentVehicle || vehicleFromText(userSource)
  const fitment = extractFitment(input.task?.payload) || extractFitment(input.facts?.fitment) || currentFitment
  const relevantPriorTurns = priorUserTurns
    .filter(turn => turn !== current)
    // Keep the earlier service turn when it describes the active vehicle. A
    // retry often contains only "look it up again"; filtering every prior
    // vehicle mention would erase the brake/part scope and produce a useless
    // vehicle-only query. Conflicting vehicles remain excluded.
    .filter(turn => {
      const priorVehicle = vehicleFromText(turn)
      return !priorVehicle || !vehicle || sameVehicle(priorVehicle, vehicle)
    })
    .filter(turn => {
      if (!currentStores.length) return true
      const priorStores = RETAILERS.filter(([, pattern]) => pattern.test(turn)).map(([store]) => store)
      return !priorStores.length || priorStores.some(store => currentStores.includes(store))
    })
    // Once the current message supplies a new repair scope, its words are
    // authoritative. Carry prior turns only for terse continuation turns
    // such as "retry", a retailer-only correction, or a fitment answer; old
    // brake terms must not leak into a new water-pump or rotor request.
    .filter(() => !currentHasServiceScope || (!currentFitment && !currentVehicle && !RESEARCH_TERMS.test(current)))
    .filter(turn => SERVICE_TERMS.test(turn) || PART_TERMS.test(turn) || RESEARCH_TERMS.test(turn) || RETAILERS.some(([, pattern]) => pattern.test(turn)) || Boolean(fitmentFromText(turn)))
    .slice(-6)
  // Query priority is deliberate. The current user message is the latest
  // correction/scope, followed by the newest same-vehicle service turns. Old
  // task instructions are only a fallback. Putting the accumulated task
  // history first lets a long retry query truncate the current request and
  // silently repeat stale research.
  const query = compactQuery([
    vehicle ? `${vehicle.year} ${vehicle.make} ${vehicle.model}` : '',
    current,
    ...relevantPriorTurns.slice(-6).reverse(),
    ...taskValues,
    fitment?.trim ? `trim ${fitment.trim}` : '',
    fitment?.engine ? `engine ${fitment.engine}` : '',
    fitment?.brakeType ? `brake type ${fitment.brakeType}` : '',
  ])
  if (!query) return null
  return { query, stores, wantsParts, wantsLabor, createsDocument, documentType, ...(vehicle ? { vehicle } : {}), ...(fitment ? { fitment } : {}) }
}
