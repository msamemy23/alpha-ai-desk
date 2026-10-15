'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, updateSettings, getSettings, getShopProfile, getShopId } from '@/lib/supabase'
import {
  AI_BASE_URLS,
  DEFAULT_OPENROUTER_MODEL,
  normalizeAiBaseUrl,
  normalizeAiModel,
} from '@/lib/ai-config'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { SettingsProvider, type Settings } from './fields'
import { AiSection, CommsSection, OutreachSection, ReviewsSection, ShopSection } from './sections'

type SectionId = 'shop' | 'ai' | 'comms' | 'outreach' | 'reviews'
type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SECTIONS: { id: SectionId; label: string; sub: string; icon: string; hasFields: boolean }[] = [
  { id: 'shop', label: 'Shop info', sub: 'Name, phone, rates, tax', icon: 'map', hasFields: true },
  { id: 'ai', label: 'AI assistant', sub: 'AI key, model, ChatGPT', icon: 'alpha', hasFields: true },
  { id: 'comms', label: 'Communications', sub: 'Texts, calls and email', icon: 'inbox', hasFields: true },
  { id: 'outreach', label: 'AI outreach', sub: 'Win back past customers', icon: 'send', hasFields: false },
  { id: 'reviews', label: 'Reviews', sub: 'Draft replies to reviews', icon: 'star', hasFields: false },
]

// The server never sends credentials back. Once one is saved the field is cleared and marked "Saved".
const SECRET_KEYS = ['ai_api_key', 'telnyx_api_key', 'resend_api_key']

const norm = (v: unknown) => (v === undefined || v === null ? '' : v)
const sameSettings = (a: Settings, b: Settings) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (norm(a[k]) !== norm(b[k])) return false
  return true
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({})
  const [baseline, setBaseline] = useState<Settings>({})
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [settingsMissing, setSettingsMissing] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')
  const [section, setSection] = useState<SectionId | null>(null)
  const [visited, setVisited] = useState<SectionId[]>(['shop'])

  // On a desktop one section is always open; on a phone the list comes first.
  const active: SectionId = section ?? 'shop'
  const activeMeta = SECTIONS.find(s => s.id === active)!

  const load = useCallback(async () => {
    setLoadState('loading')
    try {
      // Load settings filtered by shop_id
      const settingsData = await getSettings()
      let merged: Settings = {}
      if (settingsData) {
        merged = { ...(settingsData as Record<string, unknown>) }
        const aiBase = normalizeAiBaseUrl(merged.ai_base_url || AI_BASE_URLS.OPENROUTER)
        merged.ai_base_url = aiBase
        merged.ai_model = normalizeAiModel(merged.ai_model || DEFAULT_OPENROUTER_MODEL, aiBase)
      }
      // Also load shop profile to populate shop info fields
      const profile = await getShopProfile()
      if (!settingsData && !profile) {
        setLoadState('error')
        return
      }
      if (profile) {
        merged = {
          ...merged,
          shop_name: merged.shop_name || profile.shop_name || '',
          shop_phone: merged.shop_phone || profile.phone || '',
          shop_address: merged.shop_address || profile.address || '',
          shop_email: merged.shop_email || (profile as { email?: string }).email || '',
        }
      }
      setSettings(merged)
      setBaseline(merged)
      setSettingsMissing(!settingsData)
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [])

  useEffect(() => { load() }, [load])

  // The open section lives in the address (#ai) so the back button works.
  useEffect(() => {
    const ids = SECTIONS.map(s => s.id as string)
    const read = () => {
      const hash = window.location.hash.replace('#', '')
      setSection(ids.includes(hash) ? (hash as SectionId) : null)
    }
    read()
    window.addEventListener('popstate', read)
    window.addEventListener('hashchange', read)
    return () => {
      window.removeEventListener('popstate', read)
      window.removeEventListener('hashchange', read)
    }
  }, [])

  useEffect(() => {
    setVisited(v => (v.includes(active) ? v : [...v, active]))
  }, [active])

  const openSection = (id: SectionId | null) => {
    window.history.pushState(null, '', id ? `#${id}` : window.location.pathname + window.location.search)
    setSection(id)
    document.getElementById('main')?.scrollTo({ top: 0 })
  }

  const dirty = useMemo(() => !sameSettings(settings, baseline), [settings, baseline])

  // Warn before a refresh or tab close throws edits away.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const set = useCallback((key: string, value: unknown) => {
    setSettings(s => ({ ...s, [key]: value }))
    setSaveState(s => (s === 'saved' ? 'idle' : s))
  }, [])

  const save = async () => {
    const snapshot = settings
    setSaveState('saving')
    setSaveError('')
    const settingsResult = await updateSettings(snapshot)
    if (settingsResult?.error) {
      setSaveState('error')
      setSaveError(settingsResult.error.message || 'Settings could not be saved')
      return
    }

    // Keep the tenant profile's display information in sync as well.
    const shopId = await getShopId()
    if (shopId) {
      const { error: profileError } = await supabase.from('shop_profiles').update({
        shop_name: snapshot.shop_name || '',
        phone: snapshot.shop_phone || '',
        address: snapshot.shop_address || '',
      }).eq('id', shopId)
      if (profileError) {
        setSaveState('error')
        setSaveError(profileError.message || 'Shop profile could not be saved')
        return
      }
    }

    // A saved credential is cleared from the page and shown as "Saved".
    const stored: Settings = { ...snapshot }
    for (const key of SECRET_KEYS) {
      if (typeof stored[key] === 'string' && (stored[key] as string).trim()) {
        stored[key] = ''
        stored[`${key}_configured`] = true
      }
    }
    setBaseline(stored)
    setSettings(prev => {
      const next: Settings = { ...prev }
      for (const key of SECRET_KEYS) {
        if (prev[key] === snapshot[key] && typeof prev[key] === 'string' && (prev[key] as string).trim()) {
          next[key] = ''
          next[`${key}_configured`] = true
        }
      }
      return next
    })
    setSaveState('saved')
  }

  const saving = saveState === 'saving'
  const barNeeded = loadState === 'ready' && (dirty || saving || saveState === 'error' || activeMeta.hasFields)
  // On a phone the list is just a menu, so the bar only appears there when there is something to save.
  const barPhoneHidden = section === null && !dirty && !saving && saveState !== 'error'

  return (
    <SettingsProvider value={{ settings, set }}>
      <div className="page-container animate-fade-in">
        <header className={`page-header ${section ? 'sr-only lg:not-sr-only lg:mb-5' : ''}`}>
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-subtitle">Your shop, your assistant, and how you reach customers.</p>
          </div>
        </header>

        {section && (
          <div className="mb-3 lg:hidden">
            <button type="button" className="btn btn-ghost -ml-3" onClick={() => openSection(null)}>
              <Icon name="chevronLeft" className="h-5 w-5" />
              All settings
            </button>
          </div>
        )}

        {loadState === 'loading' && (
          <div className="space-y-2 lg:max-w-2xl" aria-busy="true" aria-label="Loading settings">
            {[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton h-[3.75rem]" />)}
          </div>
        )}

        {loadState === 'error' && (
          <div role="alert" className="card max-w-xl">
            <p className="font-bold">Settings could not load.</p>
            <p className="mt-1 text-text-secondary">Check your connection and try again. Nothing was changed.</p>
            <button type="button" className="btn btn-secondary mt-3" onClick={load}>Try again</button>
          </div>
        )}

        {loadState === 'ready' && (
          <div className="lg:grid lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:items-start lg:gap-10">
            {/* Section list: the whole screen on a phone, a left rail on a desktop. */}
            <nav aria-label="Settings sections" className={`lg:sticky lg:top-6 ${section === null ? 'block' : 'hidden lg:block'}`}>
              <ul className="ledger lg:border-t-0">
                {SECTIONS.map(s => (
                  <li key={s.id} className="lg:border-b-0">
                    <a
                      href={`#${s.id}`}
                      onClick={e => { e.preventDefault(); openSection(s.id) }}
                      aria-current={active === s.id ? 'true' : undefined}
                      className="ledger-row no-underline lg:min-h-[44px] lg:rounded-md lg:py-2 lg:aria-[current=true]:bg-blue/10 lg:aria-[current=true]:text-blue"
                    >
                      <Icon name={s.icon} className="h-5 w-5 shrink-0 text-text-secondary lg:text-current" />
                      <span className="ledger-main">
                        <span className="ledger-title block">{s.label}</span>
                        <span className="ledger-sub block lg:hidden">{s.sub}</span>
                      </span>
                      <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted lg:hidden" />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="min-w-0 lg:max-w-2xl">
              {settingsMissing && (
                <Notice kind="warn" className="mb-4">
                  <p>Your saved settings did not load, so some fields may look empty. Fields that did not load stay as they are when you save.</p>
                  <button type="button" className="mt-1 font-bold text-blue underline underline-offset-4" onClick={load}>Try again</button>
                </Notice>
              )}

              {SECTIONS.map(s => visited.includes(s.id) && (
                <section
                  key={s.id}
                  aria-labelledby={`sec-${s.id}`}
                  className={s.id === active ? (section === null ? 'hidden lg:block' : 'block') : 'hidden'}
                >
                  <h2 id={`sec-${s.id}`} className="display mb-4 text-[1.5rem] font-bold leading-tight">{s.label}</h2>
                  {s.id === 'shop' && <ShopSection />}
                  {s.id === 'ai' && <AiSection />}
                  {s.id === 'comms' && <CommsSection />}
                  {s.id === 'outreach' && <OutreachSection />}
                  {s.id === 'reviews' && <ReviewsSection shopName={String(settings.shop_name || '')} />}
                </section>
              ))}
            </div>
          </div>
        )}
      </div>

      {barNeeded && (
        <div className={`no-print sticky bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-30 border-t border-border bg-bg-chrome lg:bottom-0 ${barPhoneHidden ? 'hidden lg:block' : ''}`}>
          <div className="mx-auto flex w-full max-w-[1180px] items-center gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
            <div className="min-w-0 flex-1 text-[0.875rem] leading-snug sm:text-[0.9375rem] lg:pl-[calc(14.5rem+2.5rem)]" aria-live="polite">
              {saveState === 'error' ? (
                <p role="alert" className="flex items-start gap-2">
                  <span className="lamp lamp-red mt-1" aria-hidden="true" />
                  <span><strong>Not saved.</strong> {saveError}</span>
                </p>
              ) : saving ? (
                <p className="flex items-center gap-2"><span className="lamp lamp-blue" aria-hidden="true" />Saving…</p>
              ) : dirty ? (
                <p className="flex items-center gap-2"><span className="lamp lamp-amber" aria-hidden="true" /><strong>Unsaved changes</strong></p>
              ) : saveState === 'saved' ? (
                <p className="flex items-center gap-2"><span className="lamp lamp-green" aria-hidden="true" />All changes saved</p>
              ) : (
                <p className="flex items-center gap-2 text-text-secondary"><span className="lamp lamp-off" aria-hidden="true" />No changes to save</p>
              )}
            </div>
            <button type="button" className="btn btn-primary shrink-0" onClick={save} disabled={saving || (!dirty && saveState !== 'error')} aria-busy={saving}>
              {saving && <span aria-hidden="true" className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />}
              Save changes
            </button>
          </div>
        </div>
      )}
    </SettingsProvider>
  )
}
