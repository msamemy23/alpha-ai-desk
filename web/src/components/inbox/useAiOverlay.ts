'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import type { Interaction } from './ai-types'

export interface Teammate { id: string; name: string; role: string }
export interface Assignment { contact_key: string; assignee_id: string; assignee_name: string }
export interface Template { id: string; title: string; body: string }
export interface MediaRef { id: string; message_id: string | null; direction: 'inbound' | 'outbound'; content_type: string; has_copy: boolean }

/**
 * What the AI receptionist added to the Inbox: its recent conversations (for badges, "needs a person" and the AI call filter)
 * and who each text thread is assigned to. Every part is optional: when a database update has not been applied yet, or a request
 * fails, the Inbox simply shows what it always showed.
 */
export function useAiOverlay(refreshMs = 15000) {
  const [items, setItems] = useState<Interaction[]>([])
  const [available, setAvailable] = useState(false)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [team, setTeam] = useState<Teammate[]>([])
  const [assignAvailable, setAssignAvailable] = useState(false)
  const alive = useRef(true)

  const load = useCallback(async () => {
    const [act, asg] = await Promise.all([
      api<{ items: Interaction[]; unavailable: boolean }>('/api/receptionist/activity?filter=all&days=30&limit=100'),
      api<{ assignments: Assignment[]; team: Teammate[]; unavailable: boolean }>('/api/inbox/assign'),
    ])
    if (!alive.current) return
    if (act.ok && act.data && !act.data.unavailable) { setItems(act.data.items || []); setAvailable(true) }
    else if (act.ok) { setItems([]); setAvailable(false) }
    if (asg.ok && asg.data) {
      setAssignments(asg.data.assignments || [])
      setTeam(asg.data.team || [])
      setAssignAvailable(!asg.data.unavailable)
    }
  }, [])

  useEffect(() => {
    alive.current = true
    void load()
    const t = setInterval(() => { void load() }, refreshMs)
    return () => { alive.current = false; clearInterval(t) }
  }, [load, refreshMs])

  /** AI call records are listed in the Inbox as `ai-<call id>`. */
  const byCall = useMemo(() => {
    const m = new Map<string, Interaction>()
    items.forEach(i => { if (i.channel === 'call') m.set(`ai-${i.ref_id}`, i) })
    return m
  }, [items])

  /** The most recent conversation record for each text thread (the thread key is the last ten digits). */
  const byThread = useMemo(() => {
    const m = new Map<string, Interaction>()
    items.forEach(i => { if (i.channel === 'sms' && !m.has(i.contact_key)) m.set(i.contact_key, i) })
    return m
  }, [items])

  const needsPerson = useMemo(() => {
    const m = new Map<string, Interaction>()
    items.forEach(i => { if (i.needs_person && !i.needs_resolved_at && !m.has(i.contact_key)) m.set(i.contact_key, i) })
    return m
  }, [items])

  const assigneeOf = useMemo(() => {
    const m = new Map<string, Assignment>()
    assignments.forEach(a => m.set(a.contact_key, a))
    return m
  }, [assignments])

  const unseenAiCalls = useMemo(() => items.filter(i => i.channel === 'call' && !i.seen_at).length, [items])

  const markSeen = useCallback(async (ids: string[]) => {
    const now = new Date().toISOString()
    setItems(prev => prev.map(i => (ids.includes(i.id) ? { ...i, seen_at: i.seen_at || now } : i)))
    await Promise.all(ids.map(id => api(`/api/receptionist/activity/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action: 'seen' } })))
  }, [])

  return { items, available, byCall, byThread, needsPerson, assigneeOf, assignments, team, assignAvailable, unseenAiCalls, reload: load, markSeen }
}

export interface ThreadAi {
  loaded: boolean
  unavailable: boolean
  textsMode: 'off' | 'draft' | 'auto'
  paused: boolean
  pausedUntil: string | null
  needsPerson: boolean
  needsReason: string | null
}

const EMPTY: ThreadAi = { loaded: false, unavailable: false, textsMode: 'auto', paused: false, pausedUntil: null, needsPerson: false, needsReason: null }

/** The assistant's state for one text thread: paused, waiting for a person, and the shop's text mode. */
export function useThreadAi(key: string) {
  const [state, setState] = useState<ThreadAi>(EMPTY)
  const load = useCallback(async () => {
    const r = await api<Record<string, any>>(`/api/receptionist/thread?key=${encodeURIComponent(key)}`)
    if (!r.ok || !r.data) { setState(s => ({ ...s, loaded: true, unavailable: true })); return }
    setState({
      loaded: true, unavailable: r.data.unavailable === true, textsMode: r.data.textsMode || 'auto',
      paused: r.data.paused === true, pausedUntil: r.data.pausedUntil || null,
      needsPerson: r.data.needsPerson === true, needsReason: r.data.needsReason || null,
    })
  }, [key])
  useEffect(() => {
    setState(EMPTY)
    void load()
  }, [load])
  const act = useCallback(async (action: 'pause' | 'resume' | 'resolve'): Promise<string> => {
    const r = await api('/api/receptionist/thread', { method: 'POST', body: { key, action } })
    await load()
    return r.ok ? '' : r.error
  }, [key, load])
  return { state, act, reload: load }
}
