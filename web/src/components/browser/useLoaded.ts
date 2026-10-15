'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiResult } from './api'
import type { FailureInfo } from './failure'

export type LoadStatus = 'loading' | 'ready' | 'error'

export interface Loaded<T> {
  status: LoadStatus
  data: T | null
  failure: FailureInfo | null
  reload: () => void
}

/**
 * Load something once when the screen using it appears, and again on request. The loader never throws (it returns a result);
 * a late answer after the screen is gone, or after a newer request, is dropped.
 */
export function useLoaded<T>(load: (signal: AbortSignal) => Promise<ApiResult<T>>): Loaded<T> {
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [data, setData] = useState<T | null>(null)
  const [failure, setFailure] = useState<FailureInfo | null>(null)
  const mounted = useRef(true)
  const ctl = useRef<AbortController | null>(null)
  const loader = useRef(load)
  useEffect(() => { loader.current = load })

  const run = useCallback(async (): Promise<void> => {
    ctl.current?.abort()
    const c = new AbortController()
    ctl.current = c
    try {
      const r = await loader.current(c.signal)
      if (c.signal.aborted || !mounted.current) return
      if (r.ok) {
        setData(r.data)
        setFailure(null)
        setStatus('ready')
      } else if (!r.aborted) {
        setFailure(r.failure)
        setStatus('error')
      }
    } catch {
      if (!c.signal.aborted && mounted.current) {
        setFailure(null)
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
    setStatus('loading')
    void run()
  }, [run])

  return { status, data, failure, reload }
}
