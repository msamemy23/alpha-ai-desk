'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Icon from '@/components/Icon'
import { ErrorCard } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { ScreenToast, useToast } from '@/components/ScreenParts'
import { connectNotice, type ConnectNotice } from '@/lib/connector-messages'
import ServiceCard from '@/components/connectors/ServiceCard'
import { SERVICE_INFO, SERVICE_ORDER, type Connector } from '@/components/connectors/services'

function ConnectorsContent() {
  const [connectors, setConnectors] = useState<Record<string, Connector>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [notice, setNotice] = useState<ConnectNotice | null>(null)
  const { toast, notify, dismiss } = useToast()
  const searchParams = useSearchParams()

  const loadConnectors = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/connectors', { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.error || 'Connected apps could not be loaded')
      }
      const map: Record<string, Connector> = {}
      for (const c of (payload.connectors || [])) map[c.service] = c
      setConnectors(map)
      setLoadError(null)
    } catch {
      setLoadError('Your connected apps could not be loaded. Check your connection and try again. Nothing was changed.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadConnectors() }, [loadConnectors])

  // Coming back from a sign-in on Facebook or Google: say how it went, then tidy the address bar.
  useEffect(() => {
    const result = connectNotice(searchParams.get('success'), searchParams.get('error'), searchParams.get('detail'))
    if (!result) return
    setNotice(result)
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* the message already showed */ }
  }, [searchParams])

  // Backing out of a sign-in page returns here with the page as it was left: let the buttons work again.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => { if (e.persisted) setConnecting(null) }
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])

  const handleConnect = (service: string) => {
    const info = SERVICE_INFO[service]
    if (!info) return
    setNotice(null)
    setConnecting(service)
    // Facebook covers Instagram too
    window.location.href = info.oauthPath
  }

  const handleDisconnect = async (service: string) => {
    const name = SERVICE_INFO[service]?.name || service
    if (!window.confirm(`Disconnect ${name}? Alpha will stop posting and replying there until you connect it again.`)) return
    setDisconnecting(service)
    try {
      const response = await fetch('/api/connectors/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.ok !== true) throw new Error(result.error || 'Disconnect failed')
      notify(`${name} is disconnected.`, 'success')
      await loadConnectors()
    } catch {
      notify(`${name} was not disconnected and is still connected. Check your connection, then try again.`, 'error')
    }
    setDisconnecting(null)
  }

  const connectedCount = SERVICE_ORDER.filter(s => connectors[s]?.enabled === true).length
  const anyBusy = disconnecting !== null || connecting !== null

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Connected apps</h1>
          <p className="page-subtitle">Connect Facebook, Instagram and Google so Alpha can post, reply and book for you.</p>
        </div>
        {!loading && !loadError && (
          <p className="flex items-center gap-2 font-bold text-text-primary">
            <span className={`lamp ${connectedCount > 0 ? 'lamp-green' : 'lamp-off'}`} aria-hidden="true" />
            <span><span className="num">{connectedCount}</span> of <span className="num">{SERVICE_ORDER.length}</span> connected</span>
          </p>
        )}
      </header>

      {notice && (
        <Notice kind={notice.kind} className="mb-4 max-w-2xl">
          <div className="flex items-start justify-between gap-3">
            <p>{notice.message}</p>
            <button type="button" className="btn-icon -my-2 -mr-2 shrink-0" onClick={() => setNotice(null)} aria-label="Dismiss message">
              <Icon name="close" className="h-5 w-5" />
            </button>
          </div>
        </Notice>
      )}

      {loadError ? (
        <ErrorCard title="Connected apps did not load" message={loadError} onRetry={loadConnectors} busy={loading} className="max-w-xl" />
      ) : loading && Object.keys(connectors).length === 0 ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2" aria-busy="true" role="status" aria-label="Loading connected apps">
          {SERVICE_ORDER.map(s => <div key={s} className="skeleton h-44" />)}
        </div>
      ) : (
        <>
          {connectedCount === 0 && (
            <div className="mb-4 flex items-start gap-3 rounded-lg border border-border bg-bg-card p-4">
              <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0 text-blue" />
              <p className="text-[0.9375rem] text-text-secondary">
                <span className="font-bold text-text-primary">Nothing is connected yet.</span>{' '}
                Tap Connect on an app below. You sign in on that app&apos;s own site and come straight back here.
              </p>
            </div>
          )}

          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {SERVICE_ORDER.map(service => {
              const info = SERVICE_INFO[service]
              if (!info) return null
              return (
                <ServiceCard
                  key={service}
                  info={info}
                  connector={connectors[service]}
                  busy={disconnecting === service}
                  connecting={connecting === service}
                  anyBusy={anyBusy}
                  onConnect={() => handleConnect(service)}
                  onDisconnect={() => handleDisconnect(service)}
                />
              )
            })}
          </ul>

          <section className="mt-8 max-w-2xl" aria-labelledby="how-h">
            <h2 id="how-h" className="section-title mb-2">How it works</h2>
            <ul className="space-y-2 text-[0.9375rem] text-text-secondary">
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-green" /><span><span className="font-bold text-text-primary">Facebook and Instagram</span> use one sign-in. Connecting Facebook connects Instagram too, when it is linked to your page.</span></li>
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-green" /><span><span className="font-bold text-text-primary">Google Business and Calendar</span> use one Google sign-in. Both connect at once.</span></li>
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-green" /><span>Once connected, ask Alpha to post, reply to reviews, check comments or book appointments.</span></li>
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-green" /><span>Disconnecting stops Alpha right away. Your posts and reviews on those sites stay as they are.</span></li>
            </ul>
          </section>
        </>
      )}

      <ScreenToast toast={toast} onClose={dismiss} />
    </div>
  )
}

export default function ConnectorsPage() {
  return (
    <Suspense fallback={<div className="page-container"><div className="skeleton h-10 w-56" /></div>}>
      <ConnectorsContent />
    </Suspense>
  )
}
