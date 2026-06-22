import type { RepairManualMatch, RepairSearchResult, RepairSource } from './sources'

export type RepairActionKind = 'diagnostic' | 'removal' | 'wiring' | 'fuse' | 'spec' | 'manual' | 'workspace'

export interface RepairActionLink {
  kind: RepairActionKind
  label: string
  detail: string
  url: string
  confidence: 'exact' | 'closest' | 'manual_choice'
  provider?: string
}

interface RepairGuide {
  meaning: string
  checks: string[]
  dontAssume: string[]
  action: string
  focusTerms: string
  removalTerms: string
  requiredTerms: string[]
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
    dontAssume: [
      'Do not sell a catalytic converter just because P0420 is stored.',
      'Do not replace oxygen sensors until signal behavior and exhaust leaks are checked.',
    ],
    action: 'Start with diagnosis. Quote converter or sensor work only after testing proves it.',
    focusTerms: 'catalyst system catalytic converter exhaust oxygen sensor emissions diagnosis',
    removalTerms: 'catalytic converter exhaust oxygen sensor removal procedure',
    requiredTerms: ['catalyst', 'catalytic', 'converter', 'exhaust', 'oxygen', 'o2', 'emission', 'sensor', 'diagnostic trouble code'],
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
  return value.match(/\b[PCBU][0-9A-F]{4}\b/i)?.[0]?.toUpperCase() || ''
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

function manualChoiceLinks(sources: RepairSource[]) {
  return sources
    .filter(item => item.provider === 'LEMON' || item.provider === 'CHARM')
    .map(item => ({
      kind: 'manual' as const,
      label: item.title.replace(/^LEMON:\s*/i, '').replace(/^CHARM:\s*/i, ''),
      detail: 'Choose this manual if it matches the exact engine/trim.',
      url: item.url,
      confidence: 'manual_choice' as const,
      provider: item.provider,
    }))
    .filter((item, index, all) => item.label && all.findIndex(other => other.url === item.url) === index)
    .slice(0, 5)
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

export function buildRepairPresentation(query: string, data: RepairSearchResult) {
  const vehicle = repairVehicleLabel(data.normalizedVehicle)
  const dtc = detectRepairDtc(`${query} ${data.query}`)
  const guide = dtc ? REPAIR_DTC_GUIDES[dtc] : undefined
  const firstOperation = data.operationLines?.[0]
  const title = guide ? `${dtc}: ${guide.meaning}` : (firstOperation?.label || data.draft?.operation || data.draft?.title || query)
  const checks = guide?.checks || data.draft?.checklist?.slice(0, 5) || ['Open the source and verify the exact vehicle before quoting or starting work.']
  const dontAssume = guide?.dontAssume || [
    'Do not invent torque specs, wiring pinouts, labor times, or protected procedure text.',
    'Do not replace parts until inspection or testing confirms the failure.',
  ]
  const action = guide?.action || (data.estimateDraft?.totalLocked
    ? 'Review the itemized estimate draft, verify the source, then create the estimate.'
    : 'Verify the source and create a diagnostic or repair estimate only after pricing is known.')
  const missingVehicle = data.workflow?.vehicleMatch?.missing || []
  const confidence = data.workflow?.vehicleMatch?.confidence ?? 0
  const needsExactVehicle = confidence < 70 || missingVehicle.includes('engine/trim')
  const matches = data.manualMatches || []
  const sources = data.sources || []

  const diagnostic = linkFromMatch('diagnostic', 'Open diagnostic flow', 'Best source-backed diagnostic page found.', findManualMatch(matches, [/diagnos|trouble code|dtc|testing|inspection|pinpoint/i], guide))
  const removal = linkFromMatch('removal', 'Open removal procedure', 'Best matching removal or replacement page found.', findManualMatch(matches, [/remov|replace|replacement|install/i], guide))
  const wiring = linkFromMatch('wiring', 'Open wiring diagram', 'Best matching wiring, schematic, connector, or pinout page found.', findManualMatch(matches, [/wiring|diagram|schematic|connector|pinout|oxygen sensor|o2 sensor|fuse|relay/i], guide))
  const fuse = linkFromMatch('fuse', 'Open fuse/relay info', 'Best matching fuse, relay, or fuse box page found.', findManualMatch(matches, [/fuse|relay|junction box|fuse box/i], guide))
  const spec = linkFromMatch('spec', 'Open specs', 'Best matching spec or torque page found.', findManualMatch(matches, [/torque|spec|capacity|fluid/i], guide))

  const directLinks = [diagnostic, removal, wiring, fuse, spec].filter(Boolean) as RepairActionLink[]
  const manualFallback = closestManualLink(sources, guide)
  const manualChoices = manualChoiceLinks(sources)
  const actionLinks = needsExactVehicle
    ? manualChoices
    : directLinks.length
      ? [...directLinks, ...(manualFallback ? [manualFallback] : [])].slice(0, 5)
      : (manualFallback ? [manualFallback] : [])

  const plainAnswer = guide
    ? `${dtc} on ${vehicle} means ${guide.meaning.toLowerCase()} Start with testing before selling parts.`
    : `${title} for ${vehicle}. Start by verifying the exact vehicle and opening the closest source page.`

  return {
    dtc,
    guide,
    vehicle,
    title,
    plainAnswer,
    checks,
    dontAssume,
    action,
    missingVehicle,
    confidence,
    needsExactVehicle,
    actionLinks,
    directLinks,
    manualChoices,
    sources: sources.filter(item => isFocusedSource(item, guide)).slice(0, 5),
  }
}
