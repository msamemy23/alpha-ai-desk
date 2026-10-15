'use client'
import { useEffect, useState } from 'react'
import { api } from './api'
import type { DocEvent } from '@/lib/voice/timeline'

/** Estimate and invoice moments for one customer's conversation. A failure or a missing table just means no extra rows. */
export function useThreadEvents(key: string, version: string): DocEvent[] {
  const [events, setEvents] = useState<DocEvent[]>([])
  useEffect(() => {
    let off = false
    const load = async () => {
      const r = await api<{ items: DocEvent[] }>(`/api/inbox/timeline?key=${encodeURIComponent(key)}`)
      if (!off && r.ok && r.data) setEvents(r.data.items || [])
    }
    void load()
    const t = setInterval(() => { void load() }, 60_000)
    return () => { off = true; clearInterval(t) }
  }, [key, version])
  return events
}
