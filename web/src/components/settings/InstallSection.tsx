'use client'
import { useCallback, useEffect, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { Group } from './fields'
import { StatusLine } from './shared'

type Where = 'installed' | 'ios' | 'android' | 'desktop'

/** What this browser is, from the outside. Only used to pick which steps to show. */
function detectWhere(): Where {
  try {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
    if (standalone) return 'installed'
    const ua = navigator.userAgent || ''
    // iPads report as a Mac with a touch screen.
    if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
    if (/Android/i.test(ua)) return 'android'
  } catch { /* fall through to the desktop wording */ }
  return 'desktop'
}

/**
 * Put Alpha Desk on the home screen. A phone app with no app store: it opens full screen, has its own icon,
 * and shows a clear offline screen when there is no signal. Steps differ by phone, so they are shown for this one.
 */
export default function InstallSection() {
  const [where, setWhere] = useState<Where | null>(null)
  const [canPrompt, setCanPrompt] = useState(false)
  const [result, setResult] = useState<'idle' | 'done' | 'declined'>('idle')

  useEffect(() => {
    setWhere(detectWhere())
    const sync = () => { setCanPrompt(!!window.__alphaInstallPrompt); setWhere(detectWhere()) }
    sync()
    window.addEventListener('alpha-install-ready', sync)
    return () => window.removeEventListener('alpha-install-ready', sync)
  }, [])

  const install = useCallback(async () => {
    const offer = window.__alphaInstallPrompt
    if (!offer) return
    try {
      await offer.prompt()
      const choice = await offer.userChoice
      setResult(choice.outcome === 'accepted' ? 'done' : 'declined')
    } catch {
      setResult('declined')
    }
    window.__alphaInstallPrompt = null
    setCanPrompt(false)
  }, [])

  if (!where) return <div className="skeleton h-[8rem]" aria-busy="true" aria-label="Checking this device" />

  return (
    <div className="space-y-4">
      <Group title="Add Alpha Desk to your home screen" description="It opens full screen like an app, with its own icon, and it needs no app store. You stay signed in.">
        {where === 'installed' && <StatusLine lamp="green">Installed on this device</StatusLine>}

        {where !== 'installed' && result === 'done' && <StatusLine lamp="green">Added. Look for the Alpha Desk icon on your home screen.</StatusLine>}
        {where !== 'installed' && result === 'declined' && (
          <Notice kind="info">You closed the install window. Nothing was added. You can try again whenever you like.</Notice>
        )}

        {where !== 'installed' && canPrompt && result !== 'done' && (
          <button type="button" className="btn btn-primary btn-lg w-full sm:w-auto" onClick={install}>
            <Icon name="phone" className="h-5 w-5" />Install Alpha Desk
          </button>
        )}

        {where === 'ios' && (
          <ol className="list-decimal space-y-2 pl-5 text-[0.9375rem] leading-snug">
            <li>Open Alpha Desk in <strong>Safari</strong>. Other iPhone browsers cannot add it.</li>
            <li>Tap the <strong>Share</strong> button (a square with an arrow pointing up).</li>
            <li>Scroll and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>. The Alpha Desk icon appears on your home screen.</li>
          </ol>
        )}

        {where === 'android' && !canPrompt && result !== 'done' && (
          <ol className="list-decimal space-y-2 pl-5 text-[0.9375rem] leading-snug">
            <li>Open Alpha Desk in <strong>Chrome</strong>.</li>
            <li>Tap the <strong>three dots</strong> at the top right.</li>
            <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>), then tap <strong>Install</strong>.</li>
          </ol>
        )}

        {where === 'desktop' && !canPrompt && result !== 'done' && (
          <p className="text-[0.9375rem] leading-snug text-text-secondary">
            In Chrome or Edge, click the <strong>install icon</strong> at the right end of the address bar, or open the browser menu and choose <strong>Install Alpha Desk</strong>. To put it on a phone, open this page on the phone and follow the steps shown there.
          </p>
        )}
      </Group>

      <Group title="What works without a connection" description="Not much, on purpose.">
        <p className="text-[0.9375rem] leading-snug text-text-secondary">
          With no signal, Alpha Desk shows a clear &ldquo;You are offline&rdquo; screen and a Try again button instead of a browser error. Customers, estimates, invoices and messages always load fresh from the server, so what you see is never out of date and never left behind on a shared phone. Anything you typed but had not saved may not go through while you are offline.
        </p>
      </Group>
    </div>
  )
}
