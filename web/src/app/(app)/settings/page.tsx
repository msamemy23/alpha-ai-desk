'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase, updateSettings, getSettings, getShopProfile, getShopId } from '@/lib/supabase'
import {
  AI_BASE_URLS,
  DEFAULT_OPENROUTER_MODEL,
  normalizeAiBaseUrl,
  normalizeAiModel,
} from '@/lib/ai-config'
import Icon from '@/components/Icon'
import { ErrorCard } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { FIELD_SECTION, firstErrorKey, joinShopAddress, splitShopAddress, validateSettings, type FieldErrors } from '@/lib/shop-form'
import { SettingsProvider, type Settings } from '@/components/settings/fields'
import ShopSection from '@/components/settings/ShopSection'
import AiSection from '@/components/settings/AiSection'
import CommsSection from '@/components/settings/CommsSection'
import ReceptionistSection from '@/components/settings/ReceptionistSection'
import OutreachSection from '@/components/settings/OutreachSection'
import ReviewsSection from '@/components/settings/ReviewsSection'
import AiRulesSection from '@/components/ai/AiRulesSection'
import InstallSection from '@/components/settings/InstallSection'
import ProblemsSection from '@/components/settings/ProblemsSection'
import MarkupSection from '@/components/settings/MarkupSection'
import FeePresetsSection from '@/components/settings/FeePresetsSection'

type SectionId = 'shop' | 'pricing' | 'fees' | 'ai' | 'assistant' | 'receptionist' | 'comms' | 'outreach' | 'reviews' | 'problems' | 'install'
type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SECTIONS: { id: SectionId; label: string; sub: string; icon: string; hasFields: boolean }[] = [
  { id: 'shop', label: 'Shop info', sub: 'Name, phone, rates, tax', icon: 'map', hasFields: true },
  { id: 'pricing', label: 'Parts pricing', sub: 'Markup rules for part prices', icon: 'tag', hasFields: false },
  { id: 'fees', label: 'Usual charges', sub: 'Fees you add to bills often', icon: 'dollar', hasFields: false },
  { id: 'ai', label: 'AI assistant', sub: 'AI key, model, ChatGPT', icon: 'alpha', hasFields: true },
  { id: 'assistant', label: 'Assistant rules', sub: 'What it may do and never do', icon: 'shield', hasFields: false },
  { id: 'receptionist', label: 'AI receptionist', sub: 'Answers calls and texts for you', icon: 'phone', hasFields: false },
  { id: 'comms', label: 'Communications', sub: 'Texts, calls and email', icon: 'inbox', hasFields: true },
  { id: 'outreach', label: 'AI outreach', sub: 'Win back past customers', icon: 'send', hasFields: false },
  { id: 'reviews', label: 'Reviews', sub: 'Draft replies to reviews', icon: 'star', hasFields: false },
  { id: 'problems', label: 'Problems reported', sub: 'Screens that stopped working', icon: 'alert', hasFields: false },
  { id: 'install', label: 'Install on your phone', sub: 'Add Alpha Desk to your home screen', icon: 'phone', hasFields: false },
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
  const [errors, setErrors] = useState<FieldErrors>({})
  const [wide, setWide] = useState(false)
  // The city line of the shop profile, so saving an address keeps the profile's street and city apart.
  const profileCity = useRef('')
  // What is on screen right now, so a reload (Try again) can keep anything typed since the last save.
  const latest = useRef<{ settings: Settings; baseline: Settings }>({ settings: {}, baseline: {} })
  useEffect(() => { latest.current = { settings, baseline } })

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
        profileCity.current = profile.city_state_zip || ''
        merged = {
          ...merged,
          shop_name: merged.shop_name || profile.shop_name || '',
          shop_phone: merged.shop_phone || profile.phone || '',
          shop_address: merged.shop_address || joinShopAddress(profile.address, profile.city_state_zip),
          shop_email: merged.shop_email || (profile as { email?: string }).email || '',
        }
      }
      const typed: Settings = {}
      for (const key of Object.keys(latest.current.settings)) {
        if (norm(latest.current.settings[key]) !== norm(latest.current.baseline[key])) typed[key] = latest.current.settings[key]
      }
      setSettings({ ...merged, ...typed })
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

  // The same for a tap on a link to another screen: ask first, and stay put if the answer is no.
  useEffect(() => {
    if (!dirty) return
    const guard = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const link = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return
      const href = link.getAttribute('href') || ''
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
      let url: URL
      try { url = new URL(link.href, window.location.href) } catch { return }
      if (url.origin === window.location.origin && url.pathname === window.location.pathname) return
      if (!window.confirm('You have changes that are not saved. Leave Settings without saving them?')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener('click', guard, true)
    return () => document.removeEventListener('click', guard, true)
  }, [dirty])

  // Wide screens always show one section; narrow ones show the list first.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const sync = () => setWide(query.matches)
    sync()
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  const set = useCallback((key: string, value: unknown) => {
    setSettings(s => ({ ...s, [key]: value }))
    setSaveState(s => (s === 'saved' ? 'idle' : s))
    setErrors(e => {
      if (!e[key]) return e
      const rest = { ...e }
      delete rest[key]
      return rest
    })
  }, [])

  const save = async () => {
    const snapshot = settings

    // Check only what was changed, so an old odd value in a section nobody opened never blocks a save.
    const changed: Settings = {}
    for (const key of Object.keys(snapshot)) if (norm(snapshot[key]) !== norm(baseline[key])) changed[key] = snapshot[key]
    const found = validateSettings(changed)
    const firstKey = firstErrorKey(found)
    if (firstKey) {
      setErrors(found)
      setSaveState('error')
      const count = Object.keys(found).length
      setSaveError(count === 1 ? 'One field needs a change. It is marked in red.' : `${count} fields need a change. They are marked in red.`)
      const target = FIELD_SECTION[firstKey]
      if (target) openSection(target)
      window.setTimeout(() => {
        const el = document.getElementById(`set-${firstKey}`)
        el?.scrollIntoView({ block: 'center' })
        el?.focus()
      }, 80)
      return
    }

    setErrors({})
    setSaveState('saving')
    setSaveError('')
    const settingsResult = await updateSettings(snapshot)
    if (settingsResult?.error) {
      setSaveState('error')
      const raw = (settingsResult.error.message || '').trim()
      const why = /^forbidden$/i.test(raw)
        ? 'Your account can look at settings but not change them. Ask the shop owner'
        : /^unauthorized$/i.test(raw)
          ? 'You were signed out. Sign in again in another tab'
          : (raw || 'Your settings could not be saved').replace(/[.\s]+$/, '')
      setSaveError(`${why}. What you typed is still here.${/^forbidden$/i.test(raw) ? '' : ' Choose Save changes to try again.'}`)
      return
    }

    // Keep the tenant profile's display information in sync as well.
    const shopId = await getShopId()
    if (shopId) {
      const split = splitShopAddress(snapshot.shop_address, profileCity.current)
      const { error: profileError } = await supabase.from('shop_profiles').update({
        shop_name: snapshot.shop_name || '',
        phone: snapshot.shop_phone || '',
        address: split.address,
        city_state_zip: split.cityStateZip,
      }).eq('id', shopId)
      if (profileError) {
        setSaveState('error')
        setSaveError('Your settings were saved, but the name, phone and address in your shop profile were not updated. Choose Save changes to try again.')
        return
      }
      profileCity.current = split.cityStateZip
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
    <SettingsProvider value={{ settings, set, errors }}>
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
          <ErrorCard title="Settings did not load" message="Check your connection and try again. Nothing was changed." onRetry={load} className="max-w-xl" />
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
                      aria-current={(section ?? (wide ? 'shop' : null)) === s.id ? 'true' : undefined}
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
                  <p className="font-bold">Some of your saved settings did not load.</p>
                  <p>Those fields may look empty. They are left as they are when you save. Your AI key and phone details are safe.</p>
                  <button type="button" className="mt-1 min-h-[44px] font-bold text-blue underline underline-offset-4" onClick={load}>Try again</button>
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
                  {s.id === 'pricing' && <MarkupSection />}
                  {s.id === 'fees' && <FeePresetsSection />}
                  {s.id === 'ai' && <AiSection />}
                  {s.id === 'assistant' && <AiRulesSection />}
                  {s.id === 'receptionist' && <ReceptionistSection />}
                  {s.id === 'comms' && <CommsSection />}
                  {s.id === 'outreach' && <OutreachSection />}
                  {s.id === 'reviews' && <ReviewsSection shopName={String(settings.shop_name || '')} />}
                  {s.id === 'problems' && <ProblemsSection />}
                  {s.id === 'install' && <InstallSection />}
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
