'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_PREFS } from '@/lib/doc-prefs'
import type { DocPrefs } from '@/lib/doc-prefs'
import type { CannedExtras } from '@/lib/canned-match'
import type { LinkSummary } from '@/lib/doc-history'
import { getExtras, getLinkSummaries, getPrefs, getTemplates } from './api'
import type { Template } from './api'

const LINK_POLL_MS = 45_000

export interface DocExtras {
  prefs: DocPrefs
  prefsLoaded: boolean
  canEditPrefs: boolean
  templates: Template[]
  templatesAvailable: boolean
  extras: Record<string, CannedExtras>
  extrasAvailable: boolean
  links: Record<string, LinkSummary>
  linksAvailable: boolean
  reloadLinks: () => Promise<void>
  reloadTemplates: () => Promise<void>
  setTemplates: React.Dispatch<React.SetStateAction<Template[]>>
}

/**
 * The small data that sits beside the documents: the shop's paperwork settings, saved templates, per-job extras and
 * what customers did with their links. Each part loads on its own, so one missing part (a database update that has
 * not been applied) never hides the others. The links are refreshed every 45 seconds while the tab is open, so
 * "customer looked" and "customer approved" show up without anyone reloading the page.
 */
export function useDocExtras(): DocExtras {
  const [prefs, setPrefs] = useState<DocPrefs>(DEFAULT_PREFS)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [canEditPrefs, setCanEditPrefs] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [templatesAvailable, setTemplatesAvailable] = useState(true)
  const [extras, setExtras] = useState<Record<string, CannedExtras>>({})
  const [extrasAvailable, setExtrasAvailable] = useState(true)
  const [links, setLinks] = useState<Record<string, LinkSummary>>({})
  const [linksAvailable, setLinksAvailable] = useState(true)
  const alive = useRef(true)

  const reloadLinks = useCallback(async () => {
    const r = await getLinkSummaries()
    if (!alive.current || !r.ok) return
    setLinks(r.data.summaries || {})
    setLinksAvailable(r.data.available !== false)
  }, [])

  const reloadTemplates = useCallback(async () => {
    const r = await getTemplates()
    if (!alive.current || !r.ok) return
    setTemplates(Array.isArray(r.data.templates) ? r.data.templates : [])
    setTemplatesAvailable(r.data.available !== false)
  }, [])

  useEffect(() => {
    alive.current = true
    ;(async () => {
      const [p, , e] = await Promise.all([getPrefs(), reloadTemplates(), getExtras()])
      if (!alive.current) return
      if (p.ok && p.data.prefs) { setPrefs(p.data.prefs); setCanEditPrefs(p.data.canEdit === true) }
      setPrefsLoaded(true)
      if (e.ok) { setExtras(e.data.extras || {}); setExtrasAvailable(e.data.available !== false) }
    })()
    void reloadLinks()
    const tick = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void reloadLinks() }
    const timer = window.setInterval(tick, LINK_POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void reloadLinks() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive.current = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [reloadLinks, reloadTemplates])

  return { prefs, prefsLoaded, canEditPrefs, templates, templatesAvailable, extras, extrasAvailable, links, linksAvailable, reloadLinks, reloadTemplates, setTemplates }
}
