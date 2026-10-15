// Tabs for the Browser screen, kept in memory. Each tab has its own history, so Back and Forward work inside one tab.
// This file only decides what the state becomes. The screen does the fetching and tells it what came back.
import { sameAddress, sameTarget, tabTitle } from './address.ts'
import type { Target } from './address.ts'
import type { FailureInfo } from './failure.ts'
import { initialLive, liveReduce } from './live.ts'
import type { LiveEvent, LiveState, Viewport } from './live.ts'
import type { ReaderDoc, SearchHit } from '../../lib/browser/reader.ts'

export const MAX_TABS = 8
export const MAX_ENTRIES = 30
/** Entries further back than this keep their text but give up their picture, to save memory. */
const KEEP_PICTURES = 3

export type Mode = 'reader' | 'live'

export type Content =
  | { kind: 'read'; doc: ReaderDoc; finalUrl: string; images: boolean }
  | { kind: 'search'; query: string; hits: SearchHit[]; hidden: number }

export type Load =
  | { status: 'loading' }
  | { status: 'ready'; content: Content }
  | { status: 'failed'; failure: FailureInfo }

export interface Entry {
  id: string
  target: Target
  title: string
  /** Reader view or search results. Null until asked for. */
  load: Load | null
  /** Live view. Null until asked for. */
  live: LiveState | null
}

export interface Tab {
  id: string
  entries: Entry[]
  /** -1 for a new tab with nothing opened yet. */
  index: number
  mode: Mode
}

export interface TabsState {
  tabs: Tab[]
  activeId: string
  seq: number
}

export function initialTabs(): TabsState {
  return { tabs: [{ id: 't1', entries: [], index: -1, mode: 'reader' }], activeId: 't1', seq: 1 }
}

export type TabsAction =
  | { type: 'new' }
  | { type: 'close'; tabId: string }
  | { type: 'select'; tabId: string }
  | { type: 'go'; tabId: string; target: Target; mode?: Mode; viewport?: Viewport; live?: LiveState; title?: string }
  | { type: 'back'; tabId: string }
  | { type: 'forward'; tabId: string }
  | { type: 'reload'; tabId: string }
  | { type: 'mode'; tabId: string; mode: Mode; viewport: Viewport }
  | { type: 'loaded'; tabId: string; entryId: string; load: Load }
  | { type: 'live'; tabId: string; entryId: string; event: LiveEvent }

/* ---------- reading the state ---------- */

export function tabById(s: TabsState, id: string): Tab | undefined {
  return s.tabs.find(t => t.id === id)
}
export function activeTab(s: TabsState): Tab {
  return tabById(s, s.activeId) || s.tabs[0]
}
export function currentEntry(t: Tab | undefined): Entry | null {
  return t && t.index >= 0 && t.index < t.entries.length ? t.entries[t.index] : null
}
export function canGoBack(t: Tab | undefined): boolean {
  return !!t && t.index > 0
}
export function canGoForward(t: Tab | undefined): boolean {
  return !!t && t.index >= 0 && t.index < t.entries.length - 1
}

/** The address of a page entry: where it ended up after redirects, if it has loaded. */
export function entryUrl(e: Entry | null): string {
  if (!e || e.target.kind !== 'page') return ''
  if (e.live?.snapshot?.url) return e.live.snapshot.url
  if (e.load?.status === 'ready' && e.load.content.kind === 'read') return e.load.content.finalUrl
  return e.target.url
}

export function tabName(t: Tab): string {
  const e = currentEntry(t)
  return tabTitle(e ? e.target : null, e ? e.title : '')
}

/* ---------- changing it ---------- */

function newId(s: TabsState, prefix: string): { id: string; seq: number } {
  const seq = s.seq + 1
  return { id: `${prefix}${seq}`, seq }
}

function mapTab(s: TabsState, tabId: string, fn: (t: Tab) => Tab): TabsState {
  let changed = false
  const tabs = s.tabs.map(t => {
    if (t.id !== tabId) return t
    const next = fn(t)
    if (next !== t) changed = true
    return next
  })
  return changed ? { ...s, tabs } : s
}

function trimPictures(entries: Entry[], index: number): Entry[] {
  let changed = false
  const out = entries.map((e, i) => {
    const snap = e.live?.snapshot
    if (Math.abs(i - index) > KEEP_PICTURES && snap && snap.image) {
      changed = true
      return { ...e, live: { ...e.live!, snapshot: { ...snap, image: '' } } }
    }
    return e
  })
  return changed ? out : entries
}

function pushEntry(t: Tab, entry: Entry): Tab {
  let entries = [...t.entries.slice(0, t.index + 1), entry]
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES)
  const index = entries.length - 1
  return { ...t, entries: trimPictures(entries, index), index }
}

function replaceEntry(t: Tab, entryId: string, fn: (e: Entry) => Entry): Tab {
  let changed = false
  const entries = t.entries.map(e => {
    if (e.id !== entryId) return e
    const next = fn(e)
    if (next !== e) changed = true
    return next
  })
  return changed ? { ...t, entries } : t
}

function titleOf(load: Load): string | null {
  if (load.status !== 'ready') return null
  return load.content.kind === 'read' ? load.content.doc.title : `Search: ${load.content.query}`
}

export function tabsReducer(s: TabsState, a: TabsAction): TabsState {
  switch (a.type) {
    case 'new': {
      if (s.tabs.length >= MAX_TABS) return s
      const { id, seq } = newId(s, 't')
      return { tabs: [...s.tabs, { id, entries: [], index: -1, mode: 'reader' }], activeId: id, seq }
    }
    case 'close': {
      const at = s.tabs.findIndex(t => t.id === a.tabId)
      if (at < 0) return s
      if (s.tabs.length === 1) {
        const { id, seq } = newId(s, 't')
        return { tabs: [{ id, entries: [], index: -1, mode: 'reader' }], activeId: id, seq }
      }
      const tabs = s.tabs.filter(t => t.id !== a.tabId)
      const activeId = s.activeId === a.tabId ? tabs[Math.min(at, tabs.length - 1)].id : s.activeId
      return { ...s, tabs, activeId }
    }
    case 'select':
      return tabById(s, a.tabId) && s.activeId !== a.tabId ? { ...s, activeId: a.tabId } : s
    case 'go': {
      const tab = tabById(s, a.tabId)
      if (!tab) return s
      const here = currentEntry(tab)
      const mode: Mode = a.target.kind === 'search' ? 'reader' : a.mode || 'reader'
      // Going to the page you are already on is a reload, not a second copy in the history.
      if (here && sameTarget(here.target, a.target) && !a.live) {
        const url = a.target.kind === 'page' ? a.target.url : ''
        return mapTab(s, a.tabId, t => ({
          ...replaceEntry(t, here.id, e => (mode === 'live'
            ? { ...e, live: e.live ? liveReduce(e.live, { type: 'reload' }) : initialLive(url, a.viewport || 'phone') }
            : { ...e, load: { status: 'loading' } })),
          mode,
        }))
      }
      const { id, seq } = newId(s, 'e')
      const live = mode === 'live' && a.target.kind === 'page' ? a.live || initialLive(a.target.url, a.viewport || 'phone') : null
      const entry: Entry = { id, target: a.target, title: a.title || '', load: mode === 'live' ? null : { status: 'loading' }, live }
      const next = mapTab({ ...s, seq }, a.tabId, t => ({ ...pushEntry(t, entry), mode }))
      return next
    }
    case 'back':
      return mapTab(s, a.tabId, t => (t.index > 0 ? { ...t, index: t.index - 1, entries: trimPictures(t.entries, t.index - 1) } : t))
    case 'forward':
      return mapTab(s, a.tabId, t => (t.index >= 0 && t.index < t.entries.length - 1 ? { ...t, index: t.index + 1, entries: trimPictures(t.entries, t.index + 1) } : t))
    case 'reload':
      return mapTab(s, a.tabId, t => {
        const e = currentEntry(t)
        if (!e) return t
        if (t.mode === 'live' && e.live) return replaceEntry(t, e.id, x => ({ ...x, live: liveReduce(x.live, { type: 'reload' }) }))
        return replaceEntry(t, e.id, x => ({ ...x, load: { status: 'loading' } }))
      })
    case 'mode':
      return mapTab(s, a.tabId, t => {
        const e = currentEntry(t)
        if (!e) return t.mode === a.mode ? t : { ...t, mode: a.mode }
        // Search results only exist as a reader page.
        if (a.mode === 'live' && e.target.kind !== 'page') return t
        let next: Tab = t.mode === a.mode ? t : { ...t, mode: a.mode }
        if (a.mode === 'live' && !e.live && e.target.kind === 'page') {
          next = replaceEntry(next, e.id, x => ({ ...x, live: initialLive(entryUrl(x), a.viewport) }))
        }
        if (a.mode === 'reader' && !e.load) next = replaceEntry(next, e.id, x => ({ ...x, load: { status: 'loading' } }))
        return next
      })
    case 'loaded':
      return mapTab(s, a.tabId, t => replaceEntry(t, a.entryId, e => ({ ...e, load: a.load, title: titleOf(a.load) || e.title })))
    case 'live': {
      const tab = tabById(s, a.tabId)
      const entry = tab?.entries.find(e => e.id === a.entryId)
      if (!tab || !entry) return s
      if (!entry.live && a.event.type !== 'start') return s
      const prev = entry.live
      const next = liveReduce(prev, a.event)
      const snap = a.event.type === 'ok' ? a.event.snapshot : null
      const isCurrent = currentEntry(tab)?.id === entry.id
      // A tap that took the page somewhere else is a new place in the history, so Back comes back here.
      if (snap && prev?.snapshot && isCurrent && !sameAddress(prev.snapshot.url, snap.url)) {
        const { id, seq } = newId(s, 'e')
        const moved: Entry = { id, target: { kind: 'page', url: snap.url }, title: snap.title || '', load: null, live: next }
        return mapTab({ ...s, seq }, a.tabId, t => {
          const settled = replaceEntry(t, entry.id, e => ({ ...e, live: e.live ? { ...e.live, busy: false } : e.live }))
          return pushEntry(settled, moved)
        })
      }
      return mapTab(s, a.tabId, t => replaceEntry(t, entry.id, e => {
        const target: Target = snap && e.target.kind === 'page' ? { kind: 'page', url: snap.url } : e.target
        return { ...e, live: next, target, title: snap ? snap.title || e.title : e.title }
      }))
    }
  }
}
