// Shared types and small helpers for the Customers screen.

export interface Customer {
  id: string
  name: string
  phone: string
  email: string
  address: string
  preferred_contact: string
  vehicle_year: string
  vehicle_make: string
  vehicle_model: string
  vehicle_vin: string
  vehicle_plate: string
  vehicle_mileage: string
  notes: string
  created_at: string
  sentiment?: string
  vehicle_color?: string
  vehicle_engine?: string
}

export type SentimentKey = 'happy' | 'neutral' | 'unhappy' | 'vip' | 'at-risk'

export const SENTIMENTS: { key: SentimentKey; label: string; icon: string; tag: string }[] = [
  { key: 'happy', label: 'Happy', icon: 'smile', tag: 'tag-green' },
  { key: 'neutral', label: 'Neutral', icon: 'meh', tag: 'tag-gray' },
  { key: 'unhappy', label: 'Unhappy', icon: 'frown', tag: 'tag-red' },
  { key: 'vip', label: 'VIP', icon: 'star', tag: 'tag-blue' },
  { key: 'at-risk', label: 'At risk', icon: 'alert', tag: 'tag-amber' },
]

export function sentimentOf(c: { sentiment?: string | null }) {
  return SENTIMENTS.find(s => s.key === (c.sentiment || 'neutral')) || SENTIMENTS[1]
}

/** Values can arrive as numbers (year, mileage) or null from the database. */
export const text = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

export function vehicleLabel(c: Partial<Customer>): string {
  return [text(c.vehicle_year), text(c.vehicle_make), text(c.vehicle_model)].filter(Boolean).join(' ')
}

export const digitsOf = (v: unknown) => text(v).replace(/\D/g, '')

/** Last ten digits, so +1 713 555 0142 and (713) 555-0142 compare equal. */
export const digits10 = (v: unknown) => digitsOf(v).slice(-10)

export function matchesSearch(c: Customer, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = [c.name, c.phone, c.email, vehicleLabel(c), c.vehicle_plate, c.vehicle_vin].map(v => text(v).toLowerCase()).join(' ')
  const phoneDigits = digitsOf(c.phone)
  return q.split(/\s+/).every(token => {
    if (hay.includes(token)) return true
    const d = token.replace(/\D/g, '')
    return d.length >= 3 && phoneDigits.includes(d)
  })
}

export function toTitleCase(str: string) {
  return str.replace(/\b\w/g, c => c.toUpperCase())
}

/** PostgREST treats these characters as syntax inside or() filters. */
export const cleanFilterText = (s: string) => s.replace(/[,()%*\\"'`:;]/g, ' ').replace(/\s+/g, ' ').trim()

export function fmtDay(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtDayTime(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function fmtMonthYear(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}
