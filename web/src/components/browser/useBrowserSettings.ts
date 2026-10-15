'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadSettings } from './api'
import type { SettingsPayload } from './settings'
import type { BrowserSettings } from '../../lib/browser/policy'

export type SettingsStatus = 'loading' | 'ready' | 'error'

export interface SettingsApi {
  status: SettingsStatus
  /** Null until the first good answer. After a later error the last good copy is kept, so reading and searching keep working. */
  payload: SettingsPayload | null
  error: string
  /** Load it again. Keeps showing what is already there while it does. */
  reload: () => void
  /** Show a saved change straight away, while the fresh copy is on its way. */
  patch: (change: Partial<BrowserSettings>) => void
}

/**
 * The shop's browser settings: the master switch for Alpha, who may change things, the allow and block lists and the
 * quick sites. Reading, searching and Live view do not wait for this; the server applies the same rules whether or not it loaded.
 */
export function useBrowserSettings(): SettingsApi {
  const [status, setStatus] = useState<SettingsStatus>('loading')
  const [payload, setPayload] = useState<SettingsPayload | null>(null)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const ctl = useRef<AbortController | null>(null)

  const run = useCallback(async (): Promise<void> => {
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    try {
      const r = await loadSettings(c.signal)
      if (c.signal.aborted || !mounted.current) return
      if (r.ok) {
        setPayload(r.data)
        setError('')
        setStatus('ready')
      } else if (!r.aborted) {
        setError(r.failure.message)
        setStatus('error')
      }
    } catch {
      if (!c.signal.aborted && mounted.current) {
        setError('The settings could not be loaded. Try again in a moment.')
        setStatus('error')
      }
    }
  }, [])

  useEffect(() => {
    mounted.current = true
    void run()
    return () => {
      mounted.current = false
      ctl.current?.abort()
    }
  }, [run])

  const reload = useCallback(() => {
    if (!mounted.current) return
    setStatus(s => (s === 'ready' ? s : 'loading'))
    void run()
  }, [run])

  const patch = useCallback((change: Partial<BrowserSettings>) => {
    setPayload(prev => (prev ? { ...prev, settings: { ...prev.settings, ...change } } : prev))
  }, [])

  return { status, payload, error, reload, patch }
}
