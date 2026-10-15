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

export async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  } catch { /* the request still goes out and the server says if you are signed out */ }
  return headers
}

/** Only http(s) links are shown as links. Scanned data can hold anything. */
export function safeUrl(value: unknown): string | null {
  const v = String(value || '').trim()
  if (/^https?:\/\//i.test(v)) return v
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v)) return `https://${v}`
  return null
}

export type LampName = 'green' | 'amber' | 'red' | 'blue' | 'off'

export const LEAD_STATUSES: { value: string; label: string; lamp: LampName }[] = [
  { value: 'new', label: 'New', lamp: 'blue' },
  { value: 'contacted', label: 'Contacted', lamp: 'amber' },
  { value: 'converted', label: 'Became a customer', lamp: 'green' },
  { value: 'not_interested', label: 'Not interested', lamp: 'off' },
]

/** Lead status as a lamp and a word. */
export function leadStatus(status: unknown): { lamp: LampName; word: string } {
  const s = String(status || 'new')
  const known = LEAD_STATUSES.find(x => x.value === s)
  if (known) return { lamp: known.lamp, word: known.label }
  return { lamp: 'off', word: s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') }
}

export const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

/** Shop details the messages are written from. Always from this shop's own settings. */
export interface ShopInfo { name: string; phone: string; reviewUrl: string; state: 'loading' | 'ready' | 'error' }
