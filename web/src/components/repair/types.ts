import type { RepairCategory, RepairConfidence, RepairCoverageDashboard, RepairManualMatch, RepairOperationLine, RepairSource, RepairVehicle, RepairWorkflowStep } from '@/lib/repair/sources'

export type Lamp = 'green' | 'amber' | 'red' | 'blue' | 'off'

export type MainTab = 'answer' | 'sources' | 'estimate' | 'workspace'

export interface SavedDraft {
  id: string
  title: string
  operation: string
  vehicle: string
  checklist: string[]
  sourceUrls: string[]
  savedAt: string
}

/** A message the person should see and hear: success, warning or error. */
export interface Say { kind: 'success' | 'error' | 'warn' | 'info'; text: string }

export const EMPTY_VEHICLE: RepairVehicle = { year: '', make: '', model: '', engine: '', vin: '' }

export const EXAMPLES = [
  '2004 Honda Civic front brakes',
  '2018 Jeep Wrangler coolant tank turn signal bulbs',
  '2005 Honda Civic front lower control arms',
  'P0420 2012 Honda Accord diagnostic procedure',
]

export const CATEGORIES: { value: RepairCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'manual', label: 'Manuals' },
  { value: 'procedure', label: 'Procedures' },
  { value: 'diagram', label: 'Diagrams' },
  { value: 'spec', label: 'Specs' },
  { value: 'labor', label: 'Labor' },
  { value: 'tsb', label: 'Bulletins' },
  { value: 'recall', label: 'Recalls' },
  { value: 'oem_link', label: 'OEM links' },
  { value: 'complaint', label: 'Complaints' },
  { value: 'shop_draft', label: 'Shop drafts' },
]

export function categoryLabel(value: string): string {
  return CATEGORIES.find(c => c.value === value)?.label || value.replace(/_/g, ' ')
}

export function isManualProvider(source: Pick<RepairSource, 'provider'>): boolean {
  return source.provider === 'LEMON' || source.provider === 'CHARM'
}

/** How far to trust a source, in words, with the lamp that goes beside them. */
export function confidenceInfo(value: RepairConfidence): { word: string; lamp: Lamp } {
  switch (value) {
    case 'official_government': return { word: 'Official government record', lamp: 'green' }
    case 'official_oem_index': return { word: 'Manufacturer index', lamp: 'green' }
    case 'public_manual': return { word: 'Public manual', lamp: 'green' }
    case 'source_directory': return { word: 'Directory of pages', lamp: 'amber' }
    case 'shop_draft': return { word: 'Shop draft', lamp: 'off' }
    default: return { word: 'Search result', lamp: 'amber' }
  }
}

export function matchInfo(value: RepairManualMatch['matchType']): { word: string; lamp: Lamp } {
  switch (value) {
    case 'exact_procedure': return { word: 'Likely the right page', lamp: 'green' }
    case 'likely_section': return { word: 'Likely section', lamp: 'amber' }
    case 'diagram_or_spec': return { word: 'Diagram or spec', lamp: 'blue' }
    default: return { word: 'General page', lamp: 'off' }
  }
}

export function riskInfo(value: string): { word: string; lamp: Lamp } {
  if (value === 'critical') return { word: 'Critical risk', lamp: 'red' }
  if (value === 'elevated') return { word: 'Elevated risk', lamp: 'amber' }
  return { word: 'Standard risk', lamp: 'green' }
}

export function stepInfo(value: RepairWorkflowStep['status']): { word: string; lamp: Lamp } {
  if (value === 'ready') return { word: 'Ready', lamp: 'green' }
  if (value === 'needs_source') return { word: 'Needs a source', lamp: 'amber' }
  return { word: 'Needs a technician’s review', lamp: 'blue' }
}

export function sourceStatusWord(value: RepairOperationLine['sourceStatus']): string {
  if (value === 'source_verified') return 'Source checked'
  if (value === 'source_candidate') return 'Source found, not checked'
  return 'Needs a source'
}

/** The coverage figures from the lookup, each with a plain name, a word for its state and a lamp. */
export function coverageRows(c: RepairCoverageDashboard): { key: string; label: string; word: string; lamp: Lamp }[] {
  const s = (k: keyof RepairCoverageDashboard) => String(c[k] ?? '')
  const rows: { key: string; label: string; word: string; lamp: Lamp }[] = [
    { key: 'lemonCharmManual', label: 'Repair manual', word: s('lemonCharmManual') === 'found' ? 'Found' : 'Not found', lamp: s('lemonCharmManual') === 'found' ? 'green' : 'off' },
    {
      key: 'nhtsaRecalls',
      label: 'Recalls (NHTSA)',
      word: s('nhtsaRecalls') === 'found' ? 'Recalls found' : s('nhtsaRecalls') === 'not_found' ? 'None found' : 'Not checked',
      lamp: s('nhtsaRecalls') === 'found' ? 'amber' : s('nhtsaRecalls') === 'not_found' ? 'green' : 'off',
    },
    { key: 'tsbCommunications', label: 'Service bulletins', word: 'Link ready', lamp: 'green' },
    { key: 'oemOneStop', label: 'OEM1Stop', word: 'Link ready', lamp: 'green' },
    { key: 'autoZoneGuide', label: 'AutoZone guide', word: 'Link ready', lamp: 'green' },
    {
      key: 'shopProcedure',
      label: 'Your shop’s procedure',
      word: s('shopProcedure') === 'found' ? 'Found' : s('shopProcedure') === 'needs_database' ? 'Setup needed' : 'None yet',
      lamp: s('shopProcedure') === 'found' ? 'green' : s('shopProcedure') === 'needs_database' ? 'amber' : 'off',
    },
  ]
  return rows
}

export const WORKSPACE_SECTIONS = [
  { key: 'overview', label: 'Overview' },
  { key: 'safety', label: 'Safety' },
  { key: 'pages', label: 'Manual pages' },
  { key: 'specs', label: 'Specs' },
  { key: 'diagrams', label: 'Diagrams' },
  { key: 'tools', label: 'Tools and parts' },
  { key: 'notes', label: 'Shop notes' },
] as const
export type WorkspaceSection = typeof WORKSPACE_SECTIONS[number]['key']

export type { RepairSource, RepairVehicle }
