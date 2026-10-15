'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublicShop } from '@/lib/booking'

export interface BookingInfo {
  shop: PublicShop
  today: string
  token: string
  suggested: { id: string; name: string }[]
}

export type Phase = 'loading' | 'ready' | 'gone' | 'error'

/** One call to the public booking routes: never throws, always says what happened. */
export async function callBook(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init })
    const data = await res.json().catch(() => ({})) as Record<string, unknown>
    return { ok: res.ok && data.ok === true, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: 'No connection. Check your internet and try again.' } }
  }
}

/** The shop's public page: name, phone, hours, services, and a signed form token. */
export function useBookingInfo(slug: string, r: string) {
  const [info, setInfo] = useState<BookingInfo | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState('')
  const live = useRef(0)

  const load = useCallback(async (quiet = false) => {
    const mine = ++live.current
    if (!quiet) setPhase('loading')
    const qs = `slug=${encodeURIComponent(slug)}${r ? `&r=${encodeURIComponent(r)}` : ''}`
    const res = await callBook(`/api/book/info?${qs}`)
    if (mine !== live.current) return
    if (!res.ok) {
      setMessage(typeof res.data.error === 'string' ? res.data.error : 'This page did not load. Check your connection and try again.')
      // A shop that is not found or has turned booking off will not come back by retrying.
      if (!quiet) setPhase(res.status === 404 || res.status === 503 ? 'gone' : 'error')
      return
    }
    const shop = res.data.shop as PublicShop
    setInfo({
      shop,
      today: String(res.data.today || ''),
      token: String(res.data.token || ''),
      suggested: Array.isArray(res.data.suggested) ? (res.data.suggested as { id: string; name: string }[]).filter(s => s && typeof s.id === 'string' && typeof s.name === 'string') : [],
    })
    setPhase('ready')
  }, [slug, r])

  useEffect(() => { void load() }, [load])

  return { info, phase, message, reload: load }
}

export interface DayOpen { date: string; times: number }
export interface Load<T> { status: 'idle' | 'loading' | 'error' | 'ready'; data: T; message: string }

/** The days that have an open time for this service, and the times on the chosen day. Late answers to old questions are dropped. */
export function useOpenTimes(slug: string, service: string, kind: string, date: string) {
  const [days, setDays] = useState<Load<DayOpen[]>>({ status: 'idle', data: [], message: '' })
  const [times, setTimes] = useState<Load<string[]>>({ status: 'idle', data: [], message: '' })
  const dayCall = useRef(0)
  const timeCall = useRef(0)

  const loadDays = useCallback(async () => {
    const mine = ++dayCall.current
    if (!service) { setDays({ status: 'idle', data: [], message: '' }); return }
    setDays({ status: 'loading', data: [], message: '' })
    const res = await callBook(`/api/book/slots?slug=${encodeURIComponent(slug)}&service=${encodeURIComponent(service)}&kind=${encodeURIComponent(kind)}`)
    if (mine !== dayCall.current) return
    if (!res.ok) { setDays({ status: 'error', data: [], message: typeof res.data.error === 'string' ? res.data.error : 'The days could not be loaded.' }); return }
    const list = (Array.isArray(res.data.days) ? res.data.days : []) as { date: string; times: number }[]
    setDays({ status: 'ready', data: list.filter(d => d.times > 0).map(d => ({ date: d.date, times: d.times })), message: '' })
  }, [slug, service, kind])

  const loadTimes = useCallback(async () => {
    const mine = ++timeCall.current
    if (!service || !date) { setTimes({ status: 'idle', data: [], message: '' }); return }
    setTimes({ status: 'loading', data: [], message: '' })
    const res = await callBook(`/api/book/slots?slug=${encodeURIComponent(slug)}&service=${encodeURIComponent(service)}&kind=${encodeURIComponent(kind)}&date=${encodeURIComponent(date)}`)
    if (mine !== timeCall.current) return
    if (!res.ok) { setTimes({ status: 'error', data: [], message: typeof res.data.error === 'string' ? res.data.error : 'The times could not be loaded.' }); return }
    setTimes({ status: 'ready', data: (Array.isArray(res.data.times) ? res.data.times : []).filter((t): t is string => typeof t === 'string'), message: '' })
  }, [slug, service, kind, date])

  useEffect(() => { void loadDays() }, [loadDays])
  useEffect(() => { void loadTimes() }, [loadTimes])

  return { days, times, reloadDays: loadDays, reloadTimes: loadTimes }
}
