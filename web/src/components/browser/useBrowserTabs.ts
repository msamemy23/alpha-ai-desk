'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resolveTyped } from './address'
import type { Target } from './address'
import { answerApproval } from './approval-flow'
import type { FlowDeps } from './approval-flow'
import { decideApproval, fetchApprovedFile, readPage, runLive, searchWeb } from './api'
import { describeFailure, setupText } from './failure'
import { saveToDevice } from './files'
import { initialLive, liveBody } from './live'
import type { LiveEvent, LiveState, Viewport } from './live'
import { activeTab, canGoBack, canGoForward, currentEntry, initialTabs, MAX_TABS, tabById, tabsReducer } from './tabs'
import type { Entry, Load, Mode, Tab, TabsAction, TabsState } from './tabs'
import type { LiveAction } from '../../lib/browser/actions'

export function pickViewport(): Viewport {
  return typeof window !== 'undefined' && window.innerWidth < 768 ? 'phone' : 'desktop'
}

export const FLOW_DEPS: FlowDeps = { decide: decideApproval, fetchFile: fetchApprovedFile, save: saveToDevice }

const SEND_SETUP = `${setupText('Sending, buying and saving files from here')} Nothing was sent.`

export interface TabsActions {
  /** The address bar was submitted. Returns a plain-words problem if it could not be used. */
  submit: (input: string) => string | null
  openPage: (url: string, opts?: { mode?: Mode; newTab?: boolean }) => void
  openSearch: (query: string) => void
  back: () => void
  forward: () => void
  reload: () => void
  newTab: () => boolean
  closeTab: (id: string) => void
  selectTab: (id: string) => void
  setMode: (mode: Mode) => void
  takeOver: (live: LiveState, title: string) => void
  tap: (action: LiveAction) => void
  select: (n: number | null) => void
  refresh: () => void
  answer: (decision: 'approved' | 'denied') => void
  dismiss: () => void
}

export interface TabsApi extends TabsActions {
  state: TabsState
  tab: Tab
  entry: Entry | null
  canBack: boolean
  canForward: boolean
}

/**
 * The tabs, kept in memory for as long as the screen is open. Every change goes through one function that updates a
 * copy the code can read straight away, so a Back tap followed by a load never works from out-of-date state.
 */
export function useBrowserTabs(): TabsApi {
  const [state, setState] = useState<TabsState>(initialTabs)
  const ref = useRef<TabsState>(state)
  const mounted = useRef(true)
  const loads = useRef(new Map<string, AbortController>())
  const lives = useRef(new Map<string, AbortController>())

  const apply = useCallback((action: TabsAction): TabsState => {
    const next = tabsReducer(ref.current, action)
    if (next !== ref.current) {
      ref.current = next
      if (mounted.current) setState(next)
    }
    return next
  }, [])

  /** Stop requests for pages that are no longer in any tab. */
  const prune = useCallback(() => {
    const alive = new Set<string>()
    for (const t of ref.current.tabs) for (const e of t.entries) alive.add(e.id)
    for (const map of [loads.current, lives.current]) {
      for (const [id, ctl] of map) if (!alive.has(id)) { ctl.abort(); map.delete(id) }
    }
  }, [])

  const startLoad = useCallback((tabId: string, entry: Entry) => {
    loads.current.get(entry.id)?.abort()
    const ctl = new AbortController()
    loads.current.set(entry.id, ctl)
    const finish = (load: Load) => {
      if (loads.current.get(entry.id) === ctl) loads.current.delete(entry.id)
      if (ctl.signal.aborted || !mounted.current) return
      apply({ type: 'loaded', tabId, entryId: entry.id, load })
    }
    const t = entry.target
    void (async () => {
      try {
        if (t.kind === 'page') {
          const r = await readPage(t.url, ctl.signal)
          if (r.ok) finish({ status: 'ready', content: { kind: 'read', doc: r.data.doc, finalUrl: r.data.finalUrl, images: r.data.images } })
          else if (!r.aborted) finish({ status: 'failed', failure: r.failure })
        } else {
          const r = await searchWeb(t.query, ctl.signal)
          if (r.ok) finish({ status: 'ready', content: { kind: 'search', query: r.data.query || t.query, hits: r.data.hits, hidden: r.data.hidden } })
          else if (!r.aborted) finish({ status: 'failed', failure: r.failure })
        }
      } catch {
        finish({ status: 'failed', failure: describeFailure({ status: 500 }) })
      }
    })()
  }, [apply])

  const liveCall = useCallback(async (tabId: string, entryId: string, opts: { action?: LiveAction; approvalId?: string; actor?: 'user' | 'ai' }): Promise<void> => {
    const entry = tabById(ref.current, tabId)?.entries.find(e => e.id === entryId)
    if (!entry?.live || lives.current.has(entryId)) return
    const ctl = new AbortController()
    lives.current.set(entryId, ctl)
    const send = (event: LiveEvent) => apply({ type: 'live', tabId, entryId, event })
    try {
      const r = await runLive(liveBody(entry.live, opts), ctl.signal)
      if (lives.current.get(entryId) === ctl) lives.current.delete(entryId)
      if (ctl.signal.aborted || !mounted.current) return
      if (!r.ok) {
        if (!r.aborted) send({ type: 'failed', message: r.failure.setup ? SEND_SETUP : r.failure.message, setup: r.failure.setup, blocked: r.failure.blocked })
        return
      }
      const o = r.data
      if (o.status === 'ok') send({ type: 'ok', snapshot: o.snapshot, did: o.did || '' })
      else if (o.status === 'approval') send({ type: 'approval', snapshot: o.snapshot, details: o.approval, approvalId: o.approvalId, action: o.approval.kind === 'download' ? null : opts.action ?? null, actor: opts.actor || 'user' })
      else if (o.status === 'handoff') send({ type: 'handoff', snapshot: o.snapshot, reason: o.reason, message: o.message })
      else if (o.status === 'refused') send({ type: 'refused', snapshot: o.snapshot, message: o.message })
      else send({ type: 'failed', message: o.code === 'needs_update' ? SEND_SETUP : o.message, setup: o.code === 'needs_update', blocked: o.code === 'blocked' })
    } catch {
      if (lives.current.get(entryId) === ctl) lives.current.delete(entryId)
      if (!ctl.signal.aborted && mounted.current) send({ type: 'failed', message: describeFailure({ status: 500 }).message, setup: false })
    }
  }, [apply])

  /** Start whatever the current page of a tab is waiting for. */
  const kick = useCallback((tabId: string) => {
    const tab = tabById(ref.current, tabId)
    const entry = currentEntry(tab)
    if (!tab || !entry) return
    if (tab.mode === 'reader' || entry.target.kind === 'search') {
      if (entry.load?.status === 'loading' && !loads.current.has(entry.id)) startLoad(tabId, entry)
    } else if (entry.live && entry.live.busy && !entry.live.approval && !lives.current.has(entry.id)) {
      void liveCall(tabId, entry.id, {})
    }
  }, [startLoad, liveCall])

  useEffect(() => {
    mounted.current = true
    const l = loads.current
    const v = lives.current
    // If the screen was set up again (React does this once in development), start again whatever was still waiting.
    kick(ref.current.activeId)
    return () => {
      mounted.current = false
      l.forEach(c => c.abort())
      v.forEach(c => c.abort())
      l.clear()
      v.clear()
    }
  }, [kick])

  /** After moving to a page in the history, or to another tab, make sure it has what the current view needs, then start it. */
  const settle = useCallback((tabId: string) => {
    const t = tabById(ref.current, tabId)
    const e = currentEntry(t)
    if (t && e) {
      const needsLive = t.mode === 'live' && e.target.kind === 'page' && !e.live
      const needsLoad = (t.mode === 'reader' || e.target.kind === 'search') && !e.load
      if (needsLive || needsLoad) apply({ type: 'mode', tabId, mode: t.mode, viewport: pickViewport() })
    }
    kick(tabId)
  }, [apply, kick])

  const goTo = useCallback((target: Target, opts: { mode?: Mode; newTab?: boolean } = {}) => {
    let tabId = ref.current.activeId
    if (opts.newTab) {
      const hereEmpty = currentEntry(activeTab(ref.current)) === null
      if (!hereEmpty && ref.current.tabs.length < MAX_TABS) {
        apply({ type: 'new' })
        tabId = ref.current.activeId
      }
    }
    const tab = tabById(ref.current, tabId)
    const mode: Mode = target.kind === 'search' ? 'reader' : opts.mode || tab?.mode || 'reader'
    apply({ type: 'go', tabId, target, mode, viewport: pickViewport() })
    prune()
    kick(tabId)
  }, [apply, kick, prune])

  // The actions never read what was rendered, only the live copy, so they keep the same identity for the life of the screen.
  const actions = useMemo<TabsActions>(() => ({
    submit: input => {
      const typed = resolveTyped(input)
      if (typed.kind === 'empty') return 'Type a web address, or words to search for.'
      if (typed.kind === 'invalid') return typed.message
      goTo(typed)
      return null
    },
    openPage: (url, opts) => {
      const typed = resolveTyped(url)
      if (typed.kind === 'page') goTo(typed, opts)
    },
    openSearch: query => goTo({ kind: 'search', query: query.trim().slice(0, 300) }),
    back: () => { apply({ type: 'back', tabId: ref.current.activeId }); settle(ref.current.activeId) },
    forward: () => { apply({ type: 'forward', tabId: ref.current.activeId }); settle(ref.current.activeId) },
    reload: () => {
      const id = ref.current.activeId
      const t = tabById(ref.current, id)
      const e = currentEntry(t)
      if (e) { loads.current.get(e.id)?.abort(); loads.current.delete(e.id); lives.current.get(e.id)?.abort(); lives.current.delete(e.id) }
      apply({ type: 'reload', tabId: id })
      kick(id)
    },
    newTab: () => {
      if (ref.current.tabs.length >= MAX_TABS) return false
      apply({ type: 'new' })
      return true
    },
    closeTab: id => { apply({ type: 'close', tabId: id }); prune() },
    selectTab: id => { apply({ type: 'select', tabId: id }); settle(id) },
    setMode: mode => {
      const id = ref.current.activeId
      apply({ type: 'mode', tabId: id, mode, viewport: pickViewport() })
      kick(id)
    },
    takeOver: (live, title) => {
      let tabId = ref.current.activeId
      if (currentEntry(activeTab(ref.current)) !== null && ref.current.tabs.length < MAX_TABS) {
        apply({ type: 'new' })
        tabId = ref.current.activeId
      }
      const seed: LiveState = { ...initialLive(live.url, live.viewport), snapshot: live.snapshot, prepared: live.prepared, scrollY: live.scrollY, busy: !live.snapshot }
      apply({ type: 'go', tabId, target: { kind: 'page', url: live.url }, mode: 'live', viewport: live.viewport, live: seed, title })
      prune()
      kick(tabId)
    },
    tap: action => {
      const tabId = ref.current.activeId
      const e = currentEntry(tabById(ref.current, tabId))
      if (!e?.live || e.live.busy || e.live.approval) return
      apply({ type: 'live', tabId, entryId: e.id, event: { type: 'busy' } })
      void liveCall(tabId, e.id, { action })
    },
    select: n => {
      const tabId = ref.current.activeId
      const e = currentEntry(tabById(ref.current, tabId))
      if (e?.live) apply({ type: 'live', tabId, entryId: e.id, event: { type: 'select', n } })
    },
    refresh: () => {
      const tabId = ref.current.activeId
      const e = currentEntry(tabById(ref.current, tabId))
      if (!e?.live || e.live.busy || e.live.approval) return
      apply({ type: 'live', tabId, entryId: e.id, event: { type: 'busy' } })
      void liveCall(tabId, e.id, {})
    },
    answer: decision => {
      const tabId = ref.current.activeId
      const e = currentEntry(tabById(ref.current, tabId))
      const p = e?.live?.approval
      if (!e || !p) return
      const send = (event: LiveEvent) => apply({ type: 'live', tabId, entryId: e.id, event })
      void answerApproval(p, decision, FLOW_DEPS, {
        setPhase: (phase, error) => send({ type: 'approvalPhase', phase, error }),
        denied: () => send({ type: 'approvalCleared', notice: { kind: 'info', text: 'You said no. Nothing was sent.' } }),
        gone: message => send({ type: 'approvalCleared', notice: { kind: 'warn', text: message } }),
        resend: pending => liveCall(tabId, e.id, { action: pending.action ?? undefined, approvalId: pending.approvalId, actor: pending.actor }),
        openApproved: () => send({ type: 'approvalCleared', notice: null }),
        saved: (name, size) => { send({ type: 'approvalCleared', notice: null }); send({ type: 'saved', text: `Saved ${name} (${size}) to your device.` }) },
        fileProblem: message => send({ type: 'approvalCleared', notice: { kind: 'warn', text: message } }),
      })
    },
    dismiss: () => {
      const tabId = ref.current.activeId
      const e = currentEntry(tabById(ref.current, tabId))
      if (e?.live) apply({ type: 'live', tabId, entryId: e.id, event: { type: 'dismiss' } })
    },
  }), [apply, goTo, kick, liveCall, prune, settle])

  const tab = activeTab(state)
  const entry = currentEntry(tab)
  return { ...actions, state, tab, entry, canBack: canGoBack(tab), canForward: canGoForward(tab) }
}
