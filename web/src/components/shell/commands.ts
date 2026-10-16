/**
 * The command menu: what Ctrl or Cmd+K can jump to or start, how a typed word finds it, and the "G then a letter"
 * shortcuts. No imports, so the browser and `node --test` run the same code. The pages themselves are handed in
 * (from nav.ts), so the menu can never list a page the navigation does not have.
 */

export type CommandGroup = 'Recent' | 'Write' | 'Go to' | 'Switch'

export interface Command {
  id: string
  label: string
  group: CommandGroup
  icon: string
  /** Where it goes. Commands that change something on this screen (the theme) have an action instead. */
  href?: string
  action?: 'theme'
  /** Other words a person might type for it: "check in" finds Write up a car. */
  keywords: string[]
  /** The "G then a letter" shortcut, shown beside it. */
  keys?: string
}

/** "G then a letter" takes you to a main page. Letters are chosen to be the first letter of the page name where they can be. */
export const GO_KEYS: Record<string, string> = {
  d: '/dashboard',
  c: '/customers',
  w: '/work',
  i: '/messages',
  a: '/ai',
  j: '/jobs',
  b: '/shopboard',
  s: '/appointments',
  e: '/estimates',
  v: '/vehicles',
  p: '/parts',
  r: '/reports',
  t: '/staff',
}

/** Words people type for pages, beyond the page's name. */
const PAGE_WORDS: Record<string, string[]> = {
  '/dashboard': ['home', 'dashboard', 'briefing'],
  '/customers': ['clients', 'people', 'contacts'],
  '/work': ['paperwork', 'work orders'],
  '/messages': ['texts', 'sms', 'messages', 'inbox', 'voicemail'],
  '/ai': ['assistant', 'ai', 'chat', 'ask'],
  '/appointments': ['calendar', 'bookings', 'schedule', 'appointments'],
  '/shopboard': ['board', 'technicians', 'wall', 'tv'],
  '/jobs': ['repair orders', 'ro', 'work in progress'],
  '/dvi': ['inspection', 'inspections', 'dvi', 'multi-point'],
  '/vehicles': ['cars', 'vin'],
  '/inventory': ['stock', 'parts on hand'],
  '/parts': ['parts lookup', 'order parts', 'price parts'],
  '/estimates': ['quotes', 'quote'],
  '/invoices': ['bills', 'payments', 'receipts'],
  '/reports': ['numbers', 'profit', 'payroll', 'sales'],
  '/growth': ['marketing', 'posts', 'ads', 'reviews', 'campaigns'],
  '/automations': ['auto text', 'reminders'],
  '/staff': ['team', 'employees', 'time clock', 'clock in', 'hours', 'payroll'],
  '/settings': ['preferences', 'options', 'shop info', 'fees', 'tax'],
  '/connectors': ['connected apps', 'integrations', 'quickbooks'],
}

export interface PageItem { href: string; label: string; icon: string }

/** Every page in the navigation, the common things to start, and the theme switch. */
export function buildCommands(pages: PageItem[], dark: boolean): Command[] {
  const keyFor = new Map(Object.entries(GO_KEYS).map(([k, href]) => [href, `G then ${k.toUpperCase()}`]))
  const write: Command[] = [
    { id: 'new-job', label: 'Write up a car', group: 'Write', icon: 'wrench', href: '/jobs?new=1', keywords: ['new job', 'check in', 'intake', 'repair order', 'new ro'] },
    { id: 'new-estimate', label: 'New estimate', group: 'Write', icon: 'doc', href: '/estimates?new=1', keywords: ['quote', 'write estimate'] },
    { id: 'new-invoice', label: 'New invoice', group: 'Write', icon: 'invoice', href: '/invoices?new=1', keywords: ['bill', 'write invoice', 'charge'] },
    { id: 'new-inspection', label: 'Start an inspection', group: 'Write', icon: 'inspect', href: '/dvi?new=1', keywords: ['dvi', 'inspect', 'multi-point', 'walk around'] },
    { id: 'new-text', label: 'New text message', group: 'Write', icon: 'send', href: '/messages?new=1', keywords: ['sms', 'text a customer', 'message'] },
    { id: 'new-appointment', label: 'Book an appointment', group: 'Write', icon: 'calendar', href: '/appointments?new=1', keywords: ['schedule', 'new appointment', 'calendar'] },
  ]
  const go: Command[] = pages.map(p => ({
    id: `go:${p.href}`,
    label: p.label,
    group: 'Go to' as const,
    icon: p.icon,
    href: p.href,
    keywords: PAGE_WORDS[p.href] || [],
    keys: keyFor.get(p.href),
  }))
  const sw: Command = { id: 'theme', label: dark ? 'Switch to light mode' : 'Switch to dark mode', group: 'Switch', icon: dark ? 'sun' : 'moon', action: 'theme', keywords: ['theme', 'dark', 'light', 'night', 'appearance'] }
  return [...write, ...go, sw]
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Commands that match what was typed, best first. Every word typed has to match the start of a word in the label or in
 * a keyword, so "est" finds Estimates and New estimate but "stim" does not. A match in the label ranks above a keyword.
 * Nothing typed gives the empty list: the menu shows its starting choices instead.
 */
export function matchCommands(commands: Command[], query: string, limit = 8): Command[] {
  const words = norm(query).split(' ').filter(Boolean)
  if (words.length === 0) return []
  const scored: { c: Command; score: number; i: number }[] = []
  commands.forEach((c, i) => {
    const label = norm(c.label).split(' ')
    const keys = c.keywords.flatMap(k => norm(k).split(' ')).filter(Boolean)
    let score = 0
    for (const w of words) {
      if (label[0]?.startsWith(w)) score += 4
      else if (label.some(l => l.startsWith(w))) score += 3
      else if (keys.some(k => k.startsWith(w))) score += 1
      else return
    }
    // A command whose whole label starts with what was typed comes first.
    if (norm(c.label).startsWith(norm(query))) score += 3
    scored.push({ c, score, i })
  })
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).slice(0, limit).map(s => s.c)
}

/* ---------- recent pages ---------- */

/** Where the browser keeps the last pages opened. Only page addresses, never a name, a number or a search. */
export const RECENT_KEY = 'alpha_recent_pages'
/** How many are kept, and how many the menu shows. One more is kept than shown, because the page you are on is left out. */
export const RECENT_KEEP = 5
export const RECENT_SHOWN = 4

/** The page of the navigation that an address belongs to: "/jobs" and "/jobs/anything" are Jobs. The longest match wins. */
export function pageOf(pathname: string, pages: { href: string }[]): string {
  const path = String(pathname || '').split(/[?#]/)[0]
  let best = ''
  for (const p of pages) {
    if ((path === p.href || path.startsWith(`${p.href}/`)) && p.href.length > best.length) best = p.href
  }
  return best
}

/** Puts the page being opened at the front. An address that is not a page of the navigation is ignored. */
export function pushRecent(list: string[], pathname: string, pages: { href: string }[]): string[] {
  const href = pageOf(pathname, pages)
  if (!href) return list
  return [href, ...list.filter(h => h !== href)].slice(0, RECENT_KEEP)
}

/** What the browser stored, made safe: a list of page addresses, or nothing. */
export function parseRecent(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string' && x.startsWith('/') && x.length <= 60).slice(0, RECENT_KEEP)
  } catch {
    return []
  }
}

/** What the menu shows before anything is typed: the pages just visited, the things people start most, then the main pages. */
export function startingCommands(commands: Command[], recent: string[] = [], current = ''): Command[] {
  const main = new Set(Object.values(GO_KEYS))
  const recents: Command[] = []
  for (const href of recent) {
    if (href === current || recents.length >= RECENT_SHOWN) continue
    const page = commands.find(c => c.id === `go:${href}`)
    if (page) recents.push({ ...page, id: `recent:${href}`, group: 'Recent', keys: undefined })
  }
  return [
    ...recents,
    ...commands.filter(c => c.group === 'Write').slice(0, 5),
    ...commands.filter(c => c.group === 'Go to' && c.href && main.has(c.href)),
    ...commands.filter(c => c.group === 'Switch'),
  ]
}

/* ---------- keys ---------- */

interface KeyLike { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean }

/** Ctrl+K on Windows and Linux, Cmd+K on a Mac. */
export function isOpenKey(e: KeyLike): boolean {
  return e.key.toLowerCase() === 'k' && !!(e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
}

/** A place where typing letters is typing, so a shortcut must not fire. */
export function isEditableTarget(t: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!t) return false
  const tag = String(t.tagName || '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true
}

/** How long after G the next letter still counts. */
export const CHORD_MS = 1200

/**
 * "G then a letter". Feed it every key press; it says where to go, if anywhere, and what to carry to the next press.
 * G alone only arms it. "/" and "?" open the menu itself. Any other key, a modifier, a key held down, or a pause longer than CHORD_MS disarms it.
 * While `blocked` (typing in a field, a dialog open) nothing arms and nothing fires.
 */
export function chordStep(armedAt: number | null, e: KeyLike, now: number, blocked: boolean): { armedAt: number | null; go?: string; open?: boolean } {
  if (blocked || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return { armedAt: null }
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  // "/" opens the menu to search, and "?" opens it to see every shortcut (each page lists its own).
  if (k === '/' || k === '?') return { armedAt: null, open: true }
  if (armedAt !== null && now - armedAt <= CHORD_MS) {
    // A second G just starts again, so a double tap never leaves the shortcut half armed.
    if (k === 'g' && !e.shiftKey) return { armedAt: now }
    const to = GO_KEYS[k]
    return to && !e.shiftKey ? { armedAt: null, go: to } : { armedAt: null }
  }
  return k === 'g' && !e.shiftKey ? { armedAt: now } : { armedAt: null }
}
