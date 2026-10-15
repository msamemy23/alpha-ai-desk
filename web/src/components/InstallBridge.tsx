'use client'
import { useEffect } from 'react'

/** The browser's install prompt, kept on window so the Settings screen can use it whenever it opens. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
declare global {
  interface Window { __alphaInstallPrompt?: InstallPromptEvent | null }
}

/**
 * Two small jobs, both for putting Alpha Desk on a phone's home screen.
 * 1. Register the service worker (production only) that shows a plain offline screen when there is no connection.
 * 2. Catch the browser's "install" offer early, because it can fire before anyone opens Settings.
 * Renders nothing. Every call is wrapped: a browser that does not support this simply carries on.
 */
export default function InstallBridge() {
  useEffect(() => {
    try {
      if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {})
      }
    } catch { /* no service worker here */ }

    const onPrompt = (e: Event) => {
      e.preventDefault()
      window.__alphaInstallPrompt = e as InstallPromptEvent
      window.dispatchEvent(new Event('alpha-install-ready'))
    }
    const onInstalled = () => {
      window.__alphaInstallPrompt = null
      window.dispatchEvent(new Event('alpha-install-ready'))
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])
  return null
}
