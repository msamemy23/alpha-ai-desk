'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Icon from '@/components/Icon'
import { ErrorCard } from '@/components/ListKit'
import { ScreenToast, useToast } from '@/components/ScreenParts'

interface Connector {
  id: string
  service: string
  enabled: boolean
  page_id: string | null
  metadata: Record<string, unknown>
  updated_at: string
}

interface ServiceInfo {
  icon: string
  name: string
  short: string
  description: string
  note: string
  oauthPath: string
}

const SERVICE_INFO: Record<string, ServiceInfo> = {
  facebook: {
    icon: 'globe',
    name: 'Facebook Pages',
    short: 'Facebook',
    description: 'Post updates, reply to comments and manage messages.',
    note: 'Connecting Facebook also connects Instagram when your page is linked to it.',
    oauthPath: '/api/auth/facebook',
  },
  instagram: {
    icon: 'camera',
    name: 'Instagram Business',
    short: 'Instagram',
    description: 'Post photos and reply to comments and messages.',
    note: 'Instagram signs in through Facebook, so you will see the Facebook sign-in.',
    oauthPath: '/api/auth/facebook', // Instagram shares the Facebook OAuth flow
  },
  google_business: {
    icon: 'map',
    name: 'Google Business Profile',
    short: 'Google Business',
    description: 'Post updates, reply to reviews and see your ratings.',
    note: 'Connecting Google Business also connects Google Calendar.',
    oauthPath: '/api/auth/google',
  },
  google_calendar: {
    icon: 'calendar',
    name: 'Google Calendar',
    short: 'Google Calendar',
    description: 'Schedule appointments and manage bookings.',
    note: 'Google Calendar signs in through Google, together with Google Business.',
    oauthPath: '/api/auth/google',
  },
}

const SERVICE_ORDER = ['facebook', 'instagram', 'google_business', 'google_calendar']

function ConnectorsContent() {
  const [connectors, setConnectors] = useState<Record<string, Connector>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
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
      setLoadError('Your connected apps could not be loaded. Check your connection and try again.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { void loadConnectors() }, [loadConnectors])

  // Coming back from a sign-in on Facebook or Google: say how it went, then tidy the address bar.
  useEffect(() => {
    const success = searchParams.get('success')
    const error = searchParams.get('error')
    const detail = searchParams.get('detail')
    if (!success && !error) return
    if (success === 'facebook') notify('Facebook and Instagram are connected.', 'success')
    else if (success === 'google') notify('Google Business and Google Calendar are connected.', 'success')
    else if (error === 'facebook_denied') notify(`Facebook was not connected. The sign-in was cancelled${detail ? ': ' + detail : '.'}`, 'error')
    else if (error === 'google_denied') notify(`Google was not connected. The sign-in was cancelled${detail ? ': ' + detail : '.'}`, 'error')
    else if (error) notify(`Connection problem: ${error.replace(/_/g, ' ')}${detail ? ' - ' + detail : ''}`, 'error')
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* the message already showed */ }
  }, [searchParams, notify])

  const handleConnect = (service: string) => {
    const info = SERVICE_INFO[service]
    if (!info) return
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
    } catch (e) {
      notify(`${name} was not disconnected: ${e instanceof Error ? e.message : 'something went wrong'}. Try again.`, 'error')
    }
    setDisconnecting(null)
  }

  const getAccountName = (connector: Connector): string | null => {
    const meta = connector.metadata || {}
    for (const key of ['page_name', 'account_name', 'profile_name', 'location_name']) {
      if (typeof meta[key] === 'string' && meta[key]) return meta[key] as string
    }
    if (connector.page_id) return `ID ${connector.page_id}`
    return null
  }

  const connectedCount = SERVICE_ORDER.filter(s => connectors[s]?.enabled === true).length

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Connected apps</h1>
          <p className="page-subtitle">Connect Facebook, Instagram and Google so Alpha can post, reply and book for you.</p>
        </div>
        {!loading && !loadError && connectedCount > 0 && (
          <p className="flex items-center gap-2 font-bold text-text-primary">
            <span className="lamp lamp-green" aria-hidden="true" />
            {connectedCount} of {SERVICE_ORDER.length} connected
          </p>
        )}
      </header>

      {loadError ? (
        <ErrorCard title="Connected apps did not load" message={loadError} onRetry={loadConnectors} busy={loading} className="max-w-xl" />
      ) : loading ? (
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
              const connector = connectors[service]
              const isConnected = connector?.enabled === true
              const accountName = connector ? getAccountName(connector) : null
              const busy = disconnecting === service

              return (
                <li key={service} className="card flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary">
                      <Icon name={info.icon} className="h-6 w-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="section-title">{info.name}</h2>
                      <p className="mt-0.5 text-[0.9375rem] text-text-secondary">{info.description}</p>
                    </div>
                  </div>

                  {isConnected && accountName && (
                    <p className="truncate rounded-md bg-bg-hover px-3 py-2 text-[0.9375rem]">
                      <span className="text-text-secondary">Signed in as </span>
                      <span className="font-bold">{accountName}</span>
                    </p>
                  )}

                  {!isConnected && <p className="text-[0.875rem] text-text-secondary">{info.note}</p>}

                  <div className="mt-auto flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex items-center gap-2 font-bold">
                      <span className={`lamp ${isConnected ? 'lamp-green' : 'lamp-off'}`} aria-hidden="true" />
                      {isConnected ? 'Connected' : 'Not connected'}
                    </p>
                    {isConnected ? (
                      <button
                        type="button"
                        className="btn btn-danger w-full sm:w-auto"
                        onClick={() => handleDisconnect(service)}
                        disabled={busy}
                        aria-label={`Disconnect ${info.name}`}
                      >
                        {busy ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    ) : (
                      <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={() => handleConnect(service)}>
                        <Icon name="link" className="h-5 w-5" />
                        Connect {info.short}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          <section className="mt-8 max-w-2xl" aria-labelledby="how-h">
            <h2 id="how-h" className="section-title mb-2">How it works</h2>
            <ul className="space-y-2 text-[0.9375rem] text-text-secondary">
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-green" /><span><span className="font-bold text-text-primary">Facebook and Instagram</span> use one sign-in. Connecting Facebook connects Instagram too, when it is linked to your page.</span></li>
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-green" /><span><span className="font-bold text-text-primary">Google Business and Calendar</span> use one Google sign-in. Both connect at once.</span></li>
              <li className="flex gap-2"><Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-green" /><span>Once connected, ask Alpha to post, reply to reviews, check comments or book appointments.</span></li>
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
