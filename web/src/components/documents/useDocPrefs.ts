'use client'
import { useEffect, useRef, useState } from 'react'
import { DEFAULT_PREFS, normalizePrefs } from '@/lib/doc-prefs'
import type { DocPrefs } from '@/lib/doc-prefs'
import { getPrefs } from './api'

/**
 * The shop's paperwork settings (usual fees, markup rules and so on), read once when the editor first opens. Nothing here
 * writes them. When they cannot be read, the editor carries on with the plain defaults: no usual fees to tap and no
 * price suggestions, which is how it behaved before these settings were used here.
 */
export function useDocPrefs(enabled: boolean): { prefs: DocPrefs; loaded: boolean } {
  const [prefs, setPrefs] = useState<DocPrefs>(DEFAULT_PREFS)
  const [loaded, setLoaded] = useState(false)
  const started = useRef(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (!enabled || started.current) return
    started.current = true
    void getPrefs().then(r => {
      if (!alive.current) return
      if (r.ok && r.data.prefs) setPrefs(normalizePrefs(r.data.prefs))
      setLoaded(true)
    })
  }, [enabled])

  return { prefs, loaded }
}
