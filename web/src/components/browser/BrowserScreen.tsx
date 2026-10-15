'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Icon from '@/components/Icon'
import { ScreenToast, Segmented, useToast } from '@/components/ScreenParts'
import { resolveTyped, shownAddress } from './address'
import ActivitySheet from './ActivitySheet'
import AddressBar from './AddressBar'
import { addBookmark } from './api'
import AskPanel from './AskPanel'
import { copyText, sendToAskAlpha } from './files'
import { liveCopyText, livePrefill, pageCopyText, pagePrefill } from './found'
import LivePanel from './LivePanel'
import LoadProblem from './LoadProblem'
import PageTools from './PageTools'
import { PageSkeleton } from './parts'
import ReaderView from './ReaderView'
import SearchResults from './SearchResults'
import { UNKNOWN_PERMS, quickSites } from './settings'
import SettingsSheet from './SettingsSheet'
import StartPage from './StartPage'
import TabStrip from './TabStrip'
import { MAX_TABS, entryUrl } from './tabs'
import type { Mode } from './tabs'
import { useAgentRun } from './useAgentRun'
import { useBrowserSettings } from './useBrowserSettings'
import { useBrowserTabs } from './useBrowserTabs'
import { useMounted } from './useMounted'

type View = 'browse' | 'ask'
type SheetName = 'activity' | 'settings' | null

const VIEWS = [{ key: 'browse' as const, label: 'Browse' }, { key: 'ask' as const, label: 'Ask Alpha' }]
const PAGE_MODES = [{ key: 'reader' as const, label: 'Reader view' }, { key: 'live' as const, label: 'Live view' }]

/**
 * The Browser screen: tabs, an address and search bar, Reader view, Live view and Ask Alpha. Reading and searching work on
 * their own; Alpha, the saved rules and the quick sites are extras that say plainly when they are not ready.
 */
export default function BrowserScreen() {
  const tabs = useBrowserTabs()
  const settings = useBrowserSettings()
  const agent = useAgentRun()
  const { toast, notify, dismiss } = useToast()
  const mounted = useMounted()
  const params = useSearchParams()
  const router = useRouter()
  const [view, setView] = useState<View>(() => (params.get('ask') ? 'ask' : 'browse'))
  const [askSeed] = useState(() => (params.get('ask') || '').slice(0, 1200))
  const [sheet, setSheet] = useState<SheetName>(null)
  const [saving, setSaving] = useState(false)
  const handled = useRef(false)

  const { openPage, openSearch } = tabs
  const { tab, entry } = tabs
  const payload = settings.payload
  const perms = payload?.perms ?? UNKNOWN_PERMS
  const aiEnabled = payload ? payload.settings.aiEnabled : true

  // A link from Ask Alpha or another screen: /browser?url=..., ?q=... or ?ask=... Used once, then the address is tidied.
  useEffect(() => {
    if (handled.current) return
    handled.current = true
    const url = params.get('url')
    const q = params.get('q')
    const ask = params.get('ask')
    if (url) {
      const typed = resolveTyped(url)
      if (typed.kind === 'page') openPage(typed.url, { mode: params.get('mode') === 'live' ? 'live' : 'reader' })
      else if (typed.kind === 'search') openSearch(typed.query)
      else notify(typed.kind === 'invalid' ? typed.message : 'That address could not be opened.', 'error')
    } else if (q && q.trim()) {
      openSearch(q)
    }
    if (url || q || ask) router.replace('/browser', { scroll: false })
  }, [params, router, openPage, openSearch, notify])

  const quick = useMemo(() => quickSites(payload).map(b => ({ title: b.title, url: b.url })), [payload])
  const pageUrl = entry && entry.target.kind === 'page' ? entryUrl(entry) : ''
  const isWebPage = /^https?:\/\//i.test(pageUrl)
  const current = useMemo(() => (isWebPage ? { url: pageUrl, label: (entry?.title || '').slice(0, 40) || shownAddress(pageUrl) } : null), [isWebPage, pageUrl, entry?.title])
  const shown = !entry ? '' : entry.target.kind === 'search' ? entry.target.query : shownAddress(pageUrl)

  const read = entry?.load?.status === 'ready' && entry.load.content.kind === 'read' ? entry.load.content : null
  const snap = entry?.live?.snapshot ?? null
  const hasText = tab.mode === 'live' ? !!snap : !!read

  const openSettings = useCallback(() => setSheet('settings'), [])
  const goReader = useCallback((url: string) => { openPage(url); setView('browse') }, [openPage])
  const goNewTab = useCallback((url: string) => { openPage(url, { newTab: true }); setView('browse') }, [openPage])
  const setMode = (mode: Mode) => { if (mode !== tab.mode) tabs.setMode(mode) }

  const copyPage = async () => {
    const text = tab.mode === 'live' && snap ? liveCopyText(snap) : read ? pageCopyText(read.doc, read.finalUrl) : ''
    if (!text) return
    const ok = await copyText(text)
    if (mounted.current) notify(ok ? 'Page text copied.' : 'Your device would not copy it. Select the text and copy it yourself.', ok ? 'success' : 'error')
  }
  const askAboutPage = () => {
    const text = tab.mode === 'live' && snap ? livePrefill(snap) : read ? pagePrefill(read.doc, read.finalUrl) : ''
    if (!text) return
    if (!sendToAskAlpha(text, router.push)) notify('Your device would not keep the note for Ask Alpha. Copy the page and paste it there.', 'error')
  }
  const copyAnswer = async (text: string, what: string) => {
    const ok = await copyText(text)
    if (mounted.current) notify(ok ? `${what} copied.` : 'Your device would not copy it. Select the text and copy it yourself.', ok ? 'success' : 'error')
  }
  const askAboutAnswer = (text: string) => {
    if (!sendToAskAlpha(text, router.push)) notify('Your device would not keep the note for Ask Alpha. Copy the answer and paste it there.', 'error')
  }
  const savePage = async () => {
    if (!isWebPage || saving) return
    setSaving(true)
    try {
      const r = await addBookmark({ title: (entry?.title || shownAddress(pageUrl)).slice(0, 80), url: pageUrl, kind: 'saved' })
      if (!mounted.current) return
      if (r.ok) {
        settings.reload()
        notify('Page saved. It shows on the start page of a new tab.', 'success')
      } else if (!r.aborted) {
        notify(r.failure.message, 'error')
      }
    } catch {
      if (mounted.current) notify('That did not work. Try again in a moment.', 'error')
    } finally {
      if (mounted.current) setSaving(false)
    }
  }
  const newTab = () => {
    if (!tabs.newTab()) notify(`You can have up to ${MAX_TABS} tabs open. Close one to open another.`, 'info')
  }

  let content: ReactNode
  if (!entry) {
    content = <StartPage settings={settings} aiEnabled={aiEnabled} onOpen={goReader} onAsk={() => setView('ask')} onOpenSettings={openSettings} />
  } else if (entry.target.kind === 'search') {
    const load = entry.load
    if (!load || load.status === 'loading') content = <PageSkeleton label="Searching" />
    else if (load.status === 'failed') {
      content = <LoadProblem failure={load.failure} url="" isSearch payload={payload} canManage={perms.canManage} onOpenSettings={openSettings} onRetry={tabs.reload} />
    } else if (load.content.kind === 'search') {
      content = <SearchResults query={load.content.query} hits={load.content.hits} hidden={load.content.hidden} onOpen={openPage} onSearchAgain={tabs.reload} />
    } else content = null
  } else if (tab.mode === 'live') {
    content = entry.live
      ? (
        <LivePanel
          live={entry.live}
          canAct={perms.canAct}
          canManage={perms.canManage}
          payload={payload}
          onOpenSettings={openSettings}
          onTap={tabs.tap}
          onSelect={tabs.select}
          onRefresh={tabs.refresh}
          onAnswer={tabs.answer}
          onDismiss={tabs.dismiss}
        />
      )
      : <PageSkeleton label="Opening the page in Live view" />
  } else {
    const load = entry.load
    if (!load || load.status === 'loading') content = <PageSkeleton label="Opening the page" />
    else if (load.status === 'failed') {
      content = <LoadProblem failure={load.failure} url={entry.target.url} isSearch={false} payload={payload} canManage={perms.canManage} onOpenSettings={openSettings} onRetry={tabs.reload} />
    } else if (load.content.kind === 'read') {
      content = <ReaderView doc={load.content.doc} finalUrl={load.content.finalUrl} images={load.content.images} onOpen={openPage} onLive={() => tabs.setMode('live')} />
    } else content = null
  }

  return (
    <div className="page-container">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Browser</h1>
          <p className="page-subtitle">Look things up on public websites. Alpha asks you before it sends, buys or saves anything.</p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSheet('activity')}>
            <Icon name="list" className="h-4 w-4" />Activity
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSheet('settings')}>
            <Icon name="settings" className="h-4 w-4" />Settings
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4">
        <Segmented label="Browser views" idPrefix="browser-screen" columns="grid-cols-2" options={VIEWS} value={view} onChange={setView} />

        <div id="browser-screen-panel" role="tabpanel" aria-labelledby={`browser-screen-tab-${view}`}>
          <div hidden={view !== 'browse'} className="space-y-3">
            <TabStrip tabs={tabs.state.tabs} activeId={tabs.state.activeId} onSelect={tabs.selectTab} onClose={tabs.closeTab} onNew={newTab} />
            <AddressBar
              shown={shown}
              onSubmit={tabs.submit}
              canBack={tabs.canBack}
              canForward={tabs.canForward}
              canReload={!!entry}
              onBack={tabs.back}
              onForward={tabs.forward}
              onReload={tabs.reload}
            />
            {entry && entry.target.kind === 'page' && (
              <>
                <Segmented label="How to show this page" idPrefix="browser-view" columns="grid-cols-2" options={PAGE_MODES} value={tab.mode} onChange={setMode} />
                <p className="text-[0.875rem] text-text-secondary">
                  {tab.mode === 'live'
                    ? 'Live view shows a picture of the page that you can tap. One tap does one thing.'
                    : 'Reader view draws the page as clean text. Use Live view to fill in boxes or tap buttons.'}
                </p>
                <PageTools
                  hasText={hasText}
                  url={pageUrl}
                  canSave={isWebPage && perms.canAct}
                  saving={saving}
                  aiEnabled={aiEnabled}
                  onCopy={copyPage}
                  onAskAbout={askAboutPage}
                  onLookUp={() => setView('ask')}
                  onSave={savePage}
                />
              </>
            )}
            <div id="browser-panel" role="tabpanel" aria-labelledby={`browser-tab-${tabs.state.activeId}`} className="min-w-0">
              <div id="browser-view-panel" role={entry && entry.target.kind === 'page' ? 'tabpanel' : undefined} aria-labelledby={entry && entry.target.kind === 'page' ? `browser-view-tab-${tab.mode}` : undefined}>
                {content}
              </div>
            </div>
          </div>

          <div hidden={view !== 'ask'}>
            <AskPanel
              agent={agent}
              aiEnabled={aiEnabled}
              canAct={perms.canAct}
              canManage={perms.canManage}
              aiReady={payload ? payload.aiReady : null}
              current={current}
              quick={quick}
              initialGoal={askSeed}
              onOpenSettings={openSettings}
              onOpenAiSettings={() => router.push('/settings')}
              onOpenPage={goNewTab}
              onTakeOver={(live, title) => { tabs.takeOver(live, title); setView('browse') }}
              onCopy={copyAnswer}
              onAskAlpha={askAboutAnswer}
            />
          </div>
        </div>
      </div>

      <ActivitySheet open={sheet === 'activity'} onClose={() => setSheet(null)} />
      <SettingsSheet open={sheet === 'settings'} onClose={() => setSheet(null)} settings={settings} canManage={perms.canManage} />
      <ScreenToast toast={toast} onClose={dismiss} />
    </div>
  )
}
