'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PostAction, PostActionOk, PostOverview, QueueItemView } from '@/lib/posts-api-types'
import { readOverview, sendAction } from './postsApi'
import type { Done } from './postsApi'

export type Load = 'loading' | 'ready' | 'error'

export interface PostsState {
  overview: PostOverview | null
  load: Load
  error: string
  /** True while a refresh is running behind a screen that already has something to show. */
  refreshing: boolean
  reload: () => Promise<void>
  /** Reload after the first load failed: shows the loading skeleton again. */
  retry: () => Promise<void>
  /** Sends one change. The screen is refreshed afterwards so the counts, the queue and the log always agree with the server. */
  act: (action: PostAction) => Promise<Done<PostActionOk>>
  /** Puts a post the server just returned into the list right away. */
  place: (item: QueueItemView) => void
}

export function usePosts(): PostsState {
  const [overview, setOverview] = useState<PostOverview | null>(null)
  const [load, setLoad] = useState<Load>('loading')
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const alive = useRef(true)
  const seen = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const reload = useCallback(async () => {
    if (seen.current) setRefreshing(true)
    const r = await readOverview()
    if (!alive.current) return
    setRefreshing(false)
    if (r.ok) { seen.current = true; setOverview(r.data); setLoad('ready'); setError('') }
    else {
      setError(r.error)
      // A screen that already has something keeps it; only a first load that failed shows the error card.
      setLoad(seen.current ? 'ready' : 'error')
    }
  }, [])

  const retry = useCallback(async () => { setLoad('loading'); await reload() }, [reload])

  useEffect(() => { void reload() }, [reload])

  const place = useCallback((item: QueueItemView) => {
    setOverview(o => (o ? { ...o, items: o.items.some(x => x.id === item.id) ? o.items.map(x => (x.id === item.id ? item : x)) : [item, ...o.items] } : o))
  }, [])

  const act = useCallback(async (action: PostAction): Promise<Done<PostActionOk>> => {
    const r = await sendAction(action)
    if (r.ok && r.data.item) place(r.data.item)
    if (!r.ok && r.fail?.item) place(r.fail.item)
    if (r.ok && r.data.settings) {
      const settings = r.data.settings
      setOverview(o => (o ? { ...o, settings } : o))
    }
    void reload()
    return r
  }, [place, reload])

  return { overview, load, error, refreshing, reload, retry, act, place }
}
