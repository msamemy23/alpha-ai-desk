import { supabase } from '@/lib/supabase'

export type Rec = Record<string, any>

/** Where a lead came from when Alpha found it by scanning. */
export const AI_SOURCES = ['ai-competitor-scan', 'ai-social-scan', 'ai-fleet-scan'] as const

const SOURCE_LABEL: Record<string, string> = {
  'ai-competitor-scan': 'Other shops’ customers',
  'ai-social-scan': 'Social media',
  'ai-fleet-scan': 'Fleet businesses',
  manual: 'Added by hand',
}

export function sourceLabel(source: unknown): string {
  const s = String(source || 'manual')
  if (SOURCE_LABEL[s]) return SOURCE_LABEL[s]
  const plain = s.replace(/[_]+/g, ' ')
  return plain.charAt(0).toUpperCase() + plain.slice(1)
}

export function isAiLead(l: Rec): boolean {
  return (AI_SOURCES as readonly string[]).includes(l.source)
}

export function timeAgo(d: string | null | undefined): string {
  if (!d) return 'never'
  const t = new Date(d).getTime()
  if (!Number.isFinite(t)) return 'never'
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) { const m = Math.floor(days / 30); return `${m} ${m === 1 ? 'month' : 'months'} ago` }
  const y = Math.floor(days / 365)
  return `${y} ${y === 1 ? 'year' : 'years'} ago`
}

export const firstName = (name: unknown): string => String(name || '').trim().split(' ')[0] || 'there'

export async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {}
  return headers
}

/** Only http(s) links are shown as links. Scanned data can hold anything. */
export function safeUrl(value: unknown): string | null {
  const v = String(value || '').trim()
  if (/^https?:\/\//i.test(v)) return v
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`
  return null
}

/** "Houston, TX 77025" becomes the city the lead scans search near. */
export function cityFromProfile(cityStateZip: unknown): { search: string; label: string } | null {
  const raw = String(cityStateZip || '').trim()
  if (!raw) return null
  const label = raw.split(',')[0].trim()
  const search = raw.replace(/\s*\d{5}(-\d{4})?\s*$/, '').replace(/,/g, '').trim()
  if (!label || !search) return null
  return { search, label }
}

export type LampName = 'green' | 'amber' | 'red' | 'blue' | 'off'

/** Lead status as a lamp and a word. */
export function leadStatus(status: unknown): { lamp: LampName; word: string } {
  const s = String(status || 'new')
  if (s === 'new') return { lamp: 'blue', word: 'New' }
  if (s === 'contacted') return { lamp: 'amber', word: 'Contacted' }
  if (s === 'converted') return { lamp: 'green', word: 'Became a customer' }
  return { lamp: 'off', word: s.charAt(0).toUpperCase() + s.slice(1) }
}
