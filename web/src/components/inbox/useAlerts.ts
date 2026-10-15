'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { alertWords, freshInbound, tabTitle } from '@/lib/voice/alerts'
import type { AlertMessage } from '@/lib/voice/alerts'

const PREF_KEY = 'inbox.alerts'

export type AlertSupport = 'ready' | 'blocked' | 'unsupported'

function readPref(): boolean {
  try { return window.localStorage.getItem(PREF_KEY) !== 'off' } catch { return true }
}
function writePref(on: boolean) {
  try { window.localStorage.setItem(PREF_KEY, on ? 'on' : 'off') } catch { /* private window: the choice lasts until the page closes */ }
}

/**
 * Alerts for new texts while the Inbox is open: a notice on screen, the count in the tab title, and (if the person allows it)
 * a desktop notification. Nothing is sent anywhere, and nothing happens until the first load has finished.
 */
export function useInboxAlerts<M extends AlertMessage>(messages: M[], loaded: boolean, nameFor: (m: AlertMessage) => string, unread: number) {
  const [on, setOn] = useState(true)
  const [support, setSupport] = useState<AlertSupport>('unsupported')
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null)
  const seen = useRef<Set<string> | null>(null)
  const baseTitle = useRef('')

  useEffect(() => {
    setOn(readPref())
    if (typeof Notification === 'undefined') setSupport('unsupported')
    else setSupport(Notification.permission === 'denied' ? 'blocked' : 'ready')
  }, [])

  useEffect(() => {
    if (!loaded) return
    const fresh = freshInbound(seen.current, messages)
    seen.current = new Set(messages.map(m => m.id))
    if (!on || fresh.length === 0) return
    const words = alertWords(fresh, nameFor)
    if (!words) return
    setToast(words)
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        new Notification(words.title, { body: words.body, tag: 'inbox-new-text' })
      }
    } catch { /* the notice on screen still shows */ }
  }, [messages, loaded, on, nameFor])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 8000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (!baseTitle.current) baseTitle.current = document.title || 'Inbox'
    document.title = tabTitle(baseTitle.current, on ? unread : 0)
    return () => { document.title = tabTitle(baseTitle.current, 0) }
  }, [unread, on])

  const toggle = useCallback(async () => {
    if (on) { setOn(false); writePref(false); return }
    setOn(true); writePref(true)
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        const result = await Notification.requestPermission()
        setSupport(result === 'denied' ? 'blocked' : 'ready')
      }
    } catch { /* on-screen alerts still work */ }
  }, [on])

  return { on, support, toast, dismiss: () => setToast(null), toggle }
}
