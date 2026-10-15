/** What the parts lookup API sends back. Fields it may leave out are optional. */
export type Confidence = 'verified_exact_product_page' | 'search_result_only'

export interface PartResult {
  position: string
  name: string
  partNumber?: string
  price: number
  url: string
  store: string
  inStock?: boolean | null
  storeLocation?: string | null
  quantity: number
  sourceConfidence?: Confidence
}

export interface PartOption {
  tier: string
  brand: string
  parts: PartResult[]
  partsTotal: number
}

export interface KitOption {
  name: string
  brand: string
  price: number
  url: string
  store: string
  includes?: string
  positions?: string
  sourceConfidence?: Confidence
}

export interface PartsLookupResult {
  vehicle: string
  query: string
  positions: string[]
  options: PartOption[]
  kits: KitOption[]
  taxRate?: number | null
  laborHours: number | null
  laborRate: number | null
  laborGuidance?: { operation?: string; hours?: number; note?: string }
  searchUrls: Array<{ store: string; url: string }>
  sourceConfidence: Confidence | 'price_unavailable'
  warnings?: string[]
}

/** The columns of the shop's own inventory that the lookup compares against. */
export interface StockItem {
  id: string
  name: string
  part_number: string
  supplier_part_number: string
  brand: string
  category: string
  qty_on_hand: number | null
  location: string
}

export const STORE_CHOICES = [
  { label: 'AutoZone', value: 'autozone' },
  { label: "O'Reilly", value: 'oreilly' },
  { label: 'NAPA', value: 'napa' },
  { label: 'RockAuto', value: 'rockauto' },
  { label: 'Advance', value: 'advance' },
]

/** One tap fills the part box. */
export const QUICK_PARTS = ['Front brake pads and rotors', 'Rear brake pads', 'Oil change kit', 'Battery', 'Alternator', 'Spark plugs', 'Wheel bearing', 'Water pump']

export function confidenceLabel(value: PartsLookupResult['sourceConfidence'] | undefined): string {
  if (value === 'verified_exact_product_page') return 'Verified exact product page'
  if (value === 'search_result_only') return 'Search result only'
  return 'Price unavailable'
}

export const confidenceLamp = (value: PartsLookupResult['sourceConfidence'] | undefined) =>
  value === 'verified_exact_product_page' ? 'green' as const : value === 'search_result_only' ? 'amber' as const : 'off' as const
