// The browsing log as the screen shows it: a plain sentence for each kind of entry, a lamp and a word, and a few filters.
import type { Lamp } from './live.ts'

export interface ActivityItem {
  id: string
  action: string
  at: string
  who: 'you' | 'alpha' | 'teammate'
  host: string
  url: string
  detail: string
}

const WORDS: Record<string, string> = {
  'browser.visit': 'Opened a page',
  'browser.read': 'Read a page',
  'browser.search': 'Searched the web',
  'browser.fill': 'Filled in a box',
  'browser.click': 'Tapped on a page',
  'browser.approval_asked': 'Asked for an OK',
  'browser.approval_decided': 'Answered a request',
  'browser.sent': 'Sent after an OK',
  'browser.download': 'Saved a file',
  'browser.blocked': 'Stopped by a rule',
  'browser.handoff': 'Needed a person',
  'browser.settings': 'Changed the settings',
  'browser.rule': 'Changed a site rule',
  'browser.bookmark': 'Changed the saved sites',
  'browser.ai_step': 'Alpha took a step',
  'browser.host': 'Connected computer',
}

export function activityWord(action: string): string {
  return WORDS[action] || 'Browser activity'
}

export function activityLamp(item: Pick<ActivityItem, 'action' | 'detail'>): Lamp {
  switch (item.action) {
    case 'browser.sent': case 'browser.download': return 'green'
    case 'browser.approval_decided': return /^approved/i.test(item.detail) ? 'green' : 'off'
    case 'browser.approval_asked': case 'browser.handoff': return 'amber'
    case 'browser.blocked': return 'red'
    case 'browser.ai_step': return 'blue'
    default: return 'off'
  }
}

export function whoWord(who: string): string {
  return who === 'alpha' ? 'Alpha' : who === 'you' ? 'You' : 'A teammate'
}

export type ActivityFilter = 'all' | 'alpha' | 'sent' | 'stopped'

export const ACTIVITY_FILTERS: Array<{ key: ActivityFilter; label: string }> = [
  { key: 'all', label: 'Everything' },
  { key: 'alpha', label: 'Alpha’s steps' },
  { key: 'sent', label: 'Sent and saved' },
  { key: 'stopped', label: 'Stopped' },
]

export function filterActivity(items: ActivityItem[], filter: ActivityFilter): ActivityItem[] {
  switch (filter) {
    case 'alpha': return items.filter(i => i.who === 'alpha')
    case 'sent': return items.filter(i => i.action === 'browser.sent' || i.action === 'browser.download')
    case 'stopped': return items.filter(i => i.action === 'browser.blocked' || i.action === 'browser.handoff')
    default: return items
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/** Read the activity answer without trusting its shape. */
export function cleanActivity(raw: unknown): ActivityItem[] {
  const list = isObj(raw) && Array.isArray(raw.items) ? raw.items : []
  return list.flatMap((r, i) => {
    if (!isObj(r)) return []
    const action = text(r.action, 60)
    if (!action) return []
    return [{
      id: text(r.id, 64) || `row-${i}`, action, at: text(r.at, 40),
      who: r.who === 'alpha' ? 'alpha' as const : r.who === 'you' ? 'you' as const : 'teammate' as const,
      host: text(r.host, 253), url: text(r.url, 600), detail: text(r.detail, 300),
    }]
  })
}

/** "just now", "5 minutes ago", "3 hours ago", "yesterday", "Mon, Oct 12". */
export function agoText(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now - t)
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} ${min === 1 ? 'minute' : 'minutes'} ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/* ---------- approvals waiting for this person ---------- */

export interface WaitingApproval {
  id: string
  kind: string
  title: string
  summary: string
  host: string
  url: string
  actor: 'user' | 'ai'
  expiresAt: string
}

export function cleanWaiting(raw: unknown): { items: WaitingApproval[]; missing: boolean } {
  const o = isObj(raw) ? raw : {}
  const list = Array.isArray(o.items) ? o.items : []
  const items = list.flatMap(r => {
    if (!isObj(r)) return []
    const id = text(r.id, 64)
    if (!id) return []
    const details = isObj(r.details) ? r.details : {}
    return [{
      id, kind: text(r.kind, 30), title: text(details.title, 80) || 'Needs your OK', summary: text(r.summary, 800), host: text(r.host, 253),
      url: text(r.url, 600), actor: r.actor === 'ai' ? 'ai' as const : 'user' as const, expiresAt: text(r.expiresAt, 40),
    }]
  })
  return { items, missing: o.missing === true }
}
