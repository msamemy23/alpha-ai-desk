import type { RepairManualMatch, RepairSearchResult, RepairSource } from './sources'

export type RepairActionKind = 'diagnostic' | 'location' | 'removal' | 'wiring' | 'fuse' | 'spec' | 'manual' | 'estimate' | 'workspace'
export type RepairPrimaryIntent = 'diagnostic' | 'location' | 'removal' | 'diagram' | 'fuse' | 'spec' | 'estimate' | 'general'

export interface RepairActionLink {
  kind: RepairActionKind
  label: string
  detail: string
  url: string
  confidence: 'exact' | 'closest' | 'manual_choice'
  provider?: string
}

export interface RepairVehicleChoice {
  label: string
  detail: string
  url: string
  provider?: string
  selectionQuery: string
}

export interface RepairJobCard {
  vehicle: string
  problem: string
  risk: string
  sourceState: string
  estimateState: string
}

interface RepairGuide {
  meaning: string
  checks: string[]
  locations?: string[]
  dontAssume: string[]
  action: string
  focusTerms: string
  removalTerms: string
  requiredTerms: string[]
  exactVehicleQuestion?: string
}

export const REPAIR_DTC_GUIDES: Record<string, RepairGuide> = {
  P0420: {
    meaning: 'Catalyst system efficiency below threshold, Bank 1.',
    checks: [
      'Confirm freeze-frame data and check for other engine, fuel trim, or misfire codes.',
      'Inspect for exhaust leaks before or near the catalytic converter.',
      'Compare upstream and downstream oxygen sensor activity on a fully warm engine.',
      'Check fuel trims, coolant temp, misfire history, and oil/coolant contamination.',
      'Verify converter condition only after the basic checks pass.',
    ],
    locations: [
      'The catalytic converter is in the exhaust stream near or after the exhaust manifold.',
      'The upstream air/fuel or oxygen sensor is before the converter.',
      'The downstream oxygen sensor is after the converter.',
      'On the 4-cylinder Accord, Bank 1 is the only bank. On the V6, Bank 1 depends on the cylinder-1 bank.',
    ],
    dontAssume: [
      'Do not sell a catalytic converter just because P0420 is stored.',
      'Do not replace oxygen sensors until signal behavior and exhaust leaks are checked.',
    ],
    action: 'Start with diagnosis. Quote converter or sensor work only after testing proves it.',
    focusTerms: 'catalyst system catalytic converter exhaust oxygen sensor emissions diagnosis',
    removalTerms: 'catalytic converter exhaust oxygen sensor removal procedure',
    requiredTerms: ['catalyst', 'catalytic', 'converter', 'exhaust', 'oxygen', 'o2', 'emission', 'sensor', 'diagnostic trouble code'],
    exactVehicleQuestion: 'Which engine is in it: 2.4L 4-cylinder or 3.5L V6? Locations and diagrams change by engine.',
  },
  P0300: {
    meaning: 'Random or multiple cylinder misfire detected.',
    checks: [
      'Read freeze-frame data, pending codes, and cylinder misfire counters.',
      'Inspect plugs, coils, vacuum leaks, compression, injector operation, and fuel pressure.',
      'Check firing order or coil routing before moving parts around.',
      'Check relevant TSBs before replacing parts.',
    ],
    dontAssume: ['Do not replace all coils until the failed cylinder or system is verified.'],
    action: 'Start with misfire diagnosis and document the failed cylinder/system before parts.',
    focusTerms: 'random multiple cylinder misfire ignition fuel compression firing order cylinder order diagnosis',
    removalTerms: 'spark plug ignition coil injector misfire firing order cylinder order removal testing procedure',
    requiredTerms: ['misfire', 'ignition', 'spark', 'coil', 'injector', 'compression', 'fuel', 'firing', 'order', 'cylinder'],
  },
  P0171: {
    meaning: 'System too lean, Bank 1.',
    checks: [
      'Check fuel trims at idle and under load.',
      'Inspect for vacuum leaks, intake leaks, PCV issues, exhaust leaks, and weak fuel delivery.',
      'Verify MAF readings and oxygen sensor response.',
    ],
    dontAssume: ['Do not replace oxygen sensors just because the mixture is lean.'],
    action: 'Quote diagnosis first, then parts after trim data confirms the cause.',
    focusTerms: 'system too lean fuel trim vacuum leak maf oxygen sensor diagnosis',
    removalTerms: 'maf sensor oxygen sensor intake vacuum leak oxygen sensor removal testing procedure',
    requiredTerms: ['lean', 'fuel trim', 'vacuum', 'intake', 'maf', 'oxygen', 'sensor'],
  },
}

export function detectRepairDtc(value: string) {
  // Full code first (hex is valid in some, e.g. P0A1F)...
  const full = value.match(/\b([PCBU])([0-9A-F]{4})\b/i)
  if (full) return `${full[1]}${full[2]}`.toUpperCase()
  // ...then the shorthand people actually text: "p420" means P0420.
  const short = value.match(/\b([PCBU])\s?-?\s?(\d{3})\b/i)
  if (short) return `${short[1].toUpperCase()}0${short[2]}`
  return ''
}

export function repairVehicleLabel(vehicle: RepairSearchResult['normalizedVehicle']) {
  return [vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.trim, vehicle?.engine].filter(Boolean).join(' ') || 'Vehicle not fully identified'
}

export function repairWorkspaceUrl(query: string) {
  return `/repair?query=${encodeURIComponent(query)}`
}

function normalizedText(value: string) {
  return value.toLowerCase().replace(/[-_]+/g, ' ')
}

export function repairTextMatchesFocus(value: string, guide?: RepairGuide) {
  if (!guide) return true
  const text = normalizedText(value)
  return guide.requiredTerms.some(term => text.includes(term))
}

function repairIntentFor(query: string): RepairPrimaryIntent {
  if (/\b(where|location|located|bank\s*1|bank\s*one)\b/i.test(query)) return 'location'
  if (/\b(wiring|diagram|schematic|pinout|connector|o2\s*sensor|oxygen\s*sensor)\b/i.test(query)) return 'diagram'
  if (/\b(fuse|relay|fuse\s*box|junction\s*box)\b/i.test(query)) return 'fuse'
  if (/\b(removal|remove|install|installation|replace|replacement|procedure|steps?)\b/i.test(query)) return 'removal'
  if (/\b(torque|spec|specs|capacity|fluid)\b/i.test(query)) return 'spec'
  if (/\b(estimate|invoice|quote|price|labor|total|\$\d+)\b/i.test(query)) return 'estimate'
  if (detectRepairDtc(query) || /\b(diagnos|diagnostic|test|testing|check|symptom|code|dtc)\b/i.test(query)) return 'diagnostic'
  return 'general'
}

function matchText(match: RepairManualMatch) {
  return `${match.title} ${match.path?.join(' ')} ${match.url}`
}

function sourceText(source: RepairSource) {
  return `${source.title} ${source.description} ${source.url}`
}

function isFocusedSource(source: RepairSource, guide?: RepairGuide) {
  if (!guide) return true
  if (source.provider === 'LEMON' || source.provider === 'CHARM' || source.provider === 'NHTSA' || source.provider === 'OEM1Stop') return true
  return repairTextMatchesFocus(sourceText(source), guide)
}

function findManualMatch(matches: RepairManualMatch[], patterns: RegExp[], guide?: RepairGuide) {
  const focused = matches.filter(item => repairTextMatchesFocus(matchText(item), guide))
  return focused
    .filter(item => patterns.some(pattern => pattern.test(matchText(item))))
    .sort((a, b) => {
      const exact = Number(b.matchType === 'exact_procedure') - Number(a.matchType === 'exact_procedure')
      if (exact) return exact
      return b.score - a.score
    })[0]
}

function linkFromMatch(kind: RepairActionKind, label: string, detail: string, match?: RepairManualMatch): RepairActionLink | null {
  if (!match) return null
  return {
    kind,
    label,
    detail,
    url: match.url,
    confidence: match.matchType === 'exact_procedure' || match.matchType === 'diagram_or_spec' ? 'exact' : 'closest',
    provider: match.provider,
  }
}

function cleanedManualLabel(title: string) {
  return title
    .replace(/^LEMON:\s*/i, '')
    .replace(/^CHARM:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function friendlyManualChoiceLabel(title: string) {
  const clean = cleanedManualLabel(title)
  const engine = clean.match(/\b(\d\.\dL)\s+Eng\b/i)?.[1]
    || clean.match(/\b(\d\.\dL)\b/i)?.[1]
  const transmission = /\bAutomatic\s+Trans\b/i.test(clean)
    ? 'Automatic'
    : /\b(Standard|Manual)\s+Trans\b/i.test(clean)
      ? 'Manual'
      : ''
  const body = clean.match(/\b(2D\s+Coupe|4D\s+Sedan|4D\s+Pickup|2D\s+Hatchback|4D\s+Hatchback|SUV|Wagon)\b/i)?.[1]
  const trim = clean.match(/^\d{4}\s+[A-Z][a-zA-Z-]+\s+([^,]+),/)?.[1]?.trim()
  const short = [engine, transmission, trim, body].filter(Boolean).join(' - ')
  return short || clean
}

function manualChoiceLinks(sources: RepairSource[]): RepairActionLink[] {
  return sources
    .filter(item => item.provider === 'LEMON' || item.provider === 'CHARM')
    .map(item => ({
      kind: 'manual' as const,
      label: friendlyManualChoiceLabel(item.title),
      detail: cleanedManualLabel(item.title),
      url: item.url,
      confidence: 'manual_choice' as const,
      provider: item.provider,
    }))
    .filter((item, index, all) => item.label && all.findIndex(other => other.url === item.url) === index)
    .slice(0, 5)
}

function vehicleChoicesFor(query: string, sources: RepairSource[]): RepairVehicleChoice[] {
  return manualChoiceLinks(sources).map(link => ({
    label: link.label,
    detail: link.detail,
    url: link.url,
    provider: link.provider,
    selectionQuery: `${query} ${link.detail}`.replace(/\s+/g, ' ').trim(),
  }))
}

function closestManualLink(sources: RepairSource[], guide?: RepairGuide) {
  const source = sources.find(item => isFocusedSource(item, guide) && (item.provider === 'LEMON' || item.provider === 'CHARM'))
    || sources.find(item => item.provider === 'LEMON' || item.provider === 'CHARM')
  if (!source) return null
  return {
    kind: 'manual' as const,
    label: 'Open source manual',
    detail: 'Closest manual source. Use it when no exact page was found yet.',
    url: source.url,
    confidence: 'closest' as const,
    provider: source.provider,
  }
}

function orderActionLinks(links: RepairActionLink[], intent: RepairPrimaryIntent) {
  const rank: Record<RepairActionKind, number> = {
    diagnostic: intent === 'diagnostic' ? 0 : 1,
    location: intent === 'location' ? 0 : 2,
    wiring: intent === 'diagram' ? 0 : 3,
    fuse: intent === 'fuse' ? 0 : 4,
    removal: intent === 'removal' ? 0 : 2,
    spec: intent === 'spec' ? 0 : 5,
    manual: 8,
    estimate: intent === 'estimate' ? 0 : 9,
    workspace: 10,
  }
  return [...links].sort((a, b) => (rank[a.kind] ?? 99) - (rank[b.kind] ?? 99))
}

function actionLabelFor(intent: RepairPrimaryIntent, needsExactVehicle: boolean) {
  if (needsExactVehicle) return 'Pick Engine First'
  if (intent === 'location') return 'Open Location Info'
  if (intent === 'diagram') return 'Open Diagram Info'
  if (intent === 'removal') return 'Open Removal Info'
  if (intent === 'fuse') return 'Open Fuse/Relay Info'
  if (intent === 'spec') return 'Open Specs'
  if (intent === 'estimate') return 'Build Estimate From This'
  return 'Open The Info'
}

function sourceStateFor(data: RepairSearchResult) {
  if (data.coverageDashboard?.exactMatches > 0) return 'Likely matching manual page found'
  if (data.coverageDashboard?.diagrams > 0) return 'Diagram or spec page found'
  if (data.coverageDashboard?.likelyMatches > 0) return 'Likely manual section found'
  if (data.workflow?.coverage?.hasManual) return 'Manual found; pick the exact engine for the right page'
  return 'No useful source page found yet'
}

function estimateStateFor(data: RepairSearchResult, intent: RepairPrimaryIntent) {
  if (data.estimateDraft?.totalLocked) return `locked total ${data.estimateDraft.targetTotal ?? ''}`.trim()
  if (intent !== 'estimate') return 'Not needed for this question'
  if (data.operationLines?.length) return `${data.operationLines.length} item(s) ready for estimate draft`
  return 'needs price or diagnostic total'
}

function askNextFor(intent: RepairPrimaryIntent, dtc: string) {
  if (intent === 'location') return dtc ? ['2.4L 4-cylinder', '3.5L V6', 'show me diagram'] : ['show me diagram', 'show me removal', 'show me testing steps']
  if (intent === 'diagram') return ['show me testing steps', 'show me removal', 'build a diagnostic estimate']
  if (intent === 'removal') return ['show me diagram', 'show me specs', 'build an estimate']
  if (intent === 'fuse') return ['show me wiring', 'show me connector location', 'show me testing steps']
  if (intent === 'spec') return ['show me removal', 'show me diagram', 'build an estimate']
  if (dtc) return ['show me removal', 'show me diagram', 'build a diagnostic estimate']
  return ['show me diagram', 'show me removal', 'build an estimate']
}

export function buildRepairPresentation(query: string, data: RepairSearchResult) {
  const vehicle = repairVehicleLabel(data.normalizedVehicle)
  const dtc = detectRepairDtc(`${query} ${data.query}`)
  const guide = dtc ? REPAIR_DTC_GUIDES[dtc] : undefined
  const primaryIntent = repairIntentFor(query)
  const firstOperation = data.operationLines?.[0]
  const title = guide ? `${dtc}: ${guide.meaning}` : (firstOperation?.label || data.draft?.operation || data.draft?.title || query)
  const locationNotes = primaryIntent === 'location' && guide?.locations ? guide.locations : []
  const checks = locationNotes.length ? locationNotes : (guide?.checks || data.draft?.checklist?.slice(0, 5) || ['Open the source and verify the exact vehicle before quoting or starting work.'])
  const dontAssume = guide?.dontAssume || [
    'Do not invent torque specs, wiring pinouts, labor times, or protected procedure text.',
    'Do not replace parts until inspection or testing confirms the failure.',
  ]
  const action = guide?.action || (data.estimateDraft?.totalLocked
    ? 'Review the itemized estimate draft, verify the source, then create the estimate.'
    : 'Verify the source and create a diagnostic or repair estimate only after pricing is known.')
  const missingVehicle = data.workflow?.vehicleMatch?.missing || []
  const confidence = data.workflow?.vehicleMatch?.confidence ?? 0
  const hasUsableEngineMatch = Boolean(data.normalizedVehicle?.year && data.normalizedVehicle?.make && data.normalizedVehicle?.model && data.normalizedVehicle?.engine)
  const needsExactVehicle = !hasUsableEngineMatch && (confidence < 70 || missingVehicle.includes('engine/trim'))
  const matches = data.manualMatches || []
  const sources = data.sources || []

  const diagnostic = linkFromMatch('diagnostic', 'Open diagnostic flow', 'Best source-backed diagnostic page found.', findManualMatch(matches, [/diagnos|trouble code|dtc|testing|inspection|pinpoint/i], guide))
  const location = linkFromMatch('location', 'Open component location', 'Best matching component location, sensor, or exhaust page found.', findManualMatch(matches, [/location|component|sensor|oxygen|o2|catalyst|catalytic|converter|exhaust|bank/i], guide))
  const removal = linkFromMatch('removal', 'Open removal procedure', 'Best matching removal or replacement page found.', findManualMatch(matches, [/remov|replace|replacement|install/i], guide))
  const wiring = linkFromMatch('wiring', 'Open wiring diagram', 'Best matching wiring, schematic, connector, or pinout page found.', findManualMatch(matches, [/wiring|diagram|schematic|connector|pinout|oxygen sensor|o2 sensor|fuse|relay/i], guide))
  const fuse = linkFromMatch('fuse', 'Open fuse/relay info', 'Best matching fuse, relay, or fuse box page found.', findManualMatch(matches, [/fuse|relay|junction box|fuse box/i], guide))
  const spec = linkFromMatch('spec', 'Open specs', 'Best matching spec or torque page found.', findManualMatch(matches, [/torque|spec|capacity|fluid/i], guide))

  const directLinks = [diagnostic, location, removal, wiring, fuse, spec].filter(Boolean) as RepairActionLink[]
  const manualFallback = closestManualLink(sources, guide)
  const manualChoices = manualChoiceLinks(sources)
  const vehicleChoices = vehicleChoicesFor(query, sources)
  const actionLinks = needsExactVehicle
    ? manualChoices
    : directLinks.length
      ? orderActionLinks([...directLinks, ...(manualFallback ? [manualFallback] : [])], primaryIntent).slice(0, 5)
      : (manualFallback ? [manualFallback] : [])

  const exactVehiclePrompt = needsExactVehicle && guide?.exactVehicleQuestion ? guide.exactVehicleQuestion : ''
  const plainAnswer = guide
    ? primaryIntent === 'location'
      ? `${dtc} points you to the catalyst, exhaust, and oxygen sensor area on ${vehicle}. ${exactVehiclePrompt || 'Pick the exact engine before trusting the exact diagram or component location.'}`.trim()
      : `${dtc} on ${vehicle} means ${guide.meaning.toLowerCase()} Start with testing before selling parts.`
    : `${title} for ${vehicle}. Start by verifying the exact vehicle and opening the closest source page.`
  const sourceState = sourceStateFor(data)
  const estimateState = estimateStateFor(data, primaryIntent)
  const mechanicSummary = [
    plainAnswer,
    needsExactVehicle && !exactVehiclePrompt ? 'Pick the exact engine/trim before trusting diagrams, removal steps, or specs.' : '',
    sourceState,
  ].filter(Boolean).join(' ')

  return {
    dtc,
    guide,
    primaryIntent,
    vehicle,
    title,
    plainAnswer,
    mechanicSummary,
    checks,
    dontAssume,
    action,
    exactVehiclePrompt,
    checkHeading: locationNotes.length ? 'Location To Check' : 'What To Check First',
    missingVehicle,
    confidence,
    needsExactVehicle,
    primaryActionLabel: actionLabelFor(primaryIntent, needsExactVehicle),
    actionLinks,
    directLinks,
    manualChoices,
    vehicleChoices,
    askNext: askNextFor(primaryIntent, dtc),
    jobCard: {
      vehicle,
      problem: title,
      risk: data.safetyProfile?.level || 'standard',
      sourceState,
      estimateState,
    } satisfies RepairJobCard,
    showEstimateCard: primaryIntent === 'estimate' || Boolean(data.estimateDraft?.totalLocked),
    sources: sources.filter(item => isFocusedSource(item, guide)).slice(0, 5),
  }
}
