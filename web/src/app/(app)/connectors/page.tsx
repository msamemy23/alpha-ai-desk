'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useSearchParams } from 'next/navigation'

interface Connector {
  id: string
  service: string
  enabled: boolean
  page_id: string | null
  metadata: Record<string, unknown>
  updated_at: string
}

const SERVICE_INFO: Record<string, {
  icon: string
  name: string
  description: string
  color: string
  bgColor: string
  oauthPath: string
}> = {
  facebook: {
    icon: '📘',
    name: 'Facebook Pages',
    description: 'Post updates, reply to comments, manage messages',
    color: '#1877F2',
    bgColor: 'rgba(24,119,242,0.1)',
    oauthPath: '/api/auth/facebook',
  },
  instagram: {
    icon: '📸',
    name: 'Instagram Business',
    description: 'Post photos, reply to comments and DMs',
    color: '#E1306C',
    bgColor: 'rgba(225,48,108,0.1)',
    oauthPath: '/api/auth/facebook',  // Instagram shares the Facebook OAuth flow
  },
  google_business: {
    icon: '🗺️',
    name: 'Google Business Profile',
    description: 'Post updates, reply to reviews, see ratings',
    color: '#4285F4',
    bgColor: 'rgba(66,133,244,0.1)',
    oauthPath: '/api/auth/google',
  },
  google_calendar: {
    icon: '📅',
    name: 'Google Calendar',
    description: 'Schedule appointments, manage bookings',
    color: '#0F9D58',
    bgColor: 'rgba(15,157,88,0.1)',
    oauthPath: '/api/auth/google',
  },
}

const SERVICE_ORDER = ['facebook', 'instagram', 'google_business', 'google_calendar']

function ConnectorsContent() {
  const [connectors, setConnectors] = useState<Record<string, Connector>>({})
  const [loading, setLoading] = useState(true)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const searchParams = useSearchParams()

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 4000)
  }

  const loadConnectors = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.from('connectors').select('*')
      if (error) {
        // Table might not exist yet — show instructions
        console.error('connectors table error:', error)
        setLoading(false)
        return
      }
      const map: Record<string, Connector> = {}
      for (const c of (data || [])) {
        map[c.service] = c
      }
      setConnectors(map)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadConnectors()
    // Check for OAuth callback params
    const success = searchParams.get('success')
    const error = searchParams.get('error')
    if (success === 'facebook') showToast('Facebook & Instagram connected successfully!')
    else if (success === 'google') showToast('Google Business & Calendar connected successfully!')
    else if (error === 'facebook_denied') showToast('Facebook connection was cancelled', 'error')
    else if (error === 'google_denied') showToast('Google connection was cancelled', 'error')
    else if (error) showToast(`Connection error: ${error.replace(/_/g, ' ')}`, 'error')
  }, [loadConnectors, searchParams])

  const handleConnect = (service: string) => {
    const info = SERVICE_INFO[service]
    if (!info) return
    // Facebook covers Instagram too
    window.location.href = info.oauthPath
  }

  const handleDisconnect = async (service: string) => {
    setDisconnecting(service)
    try {
      const { error } = await supabase
        .from('connectors')
        .update({
          enabled: false,
          access_token: null,
          refresh_token: null,
          token_expires_at: null,
          page_id: null,
          page_access_token: null,
          metadata: {},
          updated_at: new Date().toISOString(),
        })
        .eq('service', service)

      if (error) throw error
      showToast(`${SERVICE_INFO[service]?.name || service} disconnected`)
      await loadConnectors()
    } catch (e) {
      showToast(`Disconnect failed: ${e instanceof Error ? e.message : 'Unknown error'}`, 'error')
    }
    setDisconnecting(null)
  }

  const getAccountName = (connector: Connector): string | null => {
    const meta = connector.metadata || {}
    if (meta.page_name) return meta.page_name as string
    if (connector.page_id) return `ID: ${connector.page_id}`
    return null
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Connectors</h1>
        <p className="text-text-muted text-sm mt-1">
          Connect your social media and calendar accounts. Once connected, Alpha AI can post, reply, and manage them for you.
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mb-4 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
          toast.type === 'success'
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'
        }`}>
          {toast.type === 'success' ? '✅ ' : '❌ '}{toast.msg}
        </div>
      )}

      {/* Table-not-found notice */}
      {!loading && Object.keys(connectors).length === 0 && (
        <div className="mb-6 p-4 rounded-xl bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
          <div className="font-semibold mb-2">⚠️ Connectors table not found in Supabase</div>
          <p className="mb-2">Run this SQL in your Supabase dashboard (SQL Editor):</p>
          <pre className="bg-black/30 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap text-yellow-200">{`CREATE TABLE IF NOT EXISTS connectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL UNIQUE,
  enabled BOOLEAN DEFAULT false,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  page_id TEXT,
  page_access_token TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE connectors DISABLE ROW LEVEL SECURITY;
INSERT INTO connectors (service) VALUES
  ('facebook'),('instagram'),('google_business'),('google_calendar')
ON CONFLICT (service) DO NOTHING;`}</pre>
          <button
            className="mt-3 px-4 py-2 bg-yellow-500/20 hover:bg-yellow-500/30 rounded-lg text-xs font-semibold transition-colors"
            onClick={loadConnectors}
          >
            Retry
          </button>
        </div>
      )}

      {/* Connector cards grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SERVICE_ORDER.map(s => (
            <div key={s} className="card animate-pulse h-36" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SERVICE_ORDER.map(service => {
            const info = SERVICE_INFO[service]
            if (!info) return null
            const connector = connectors[service]
            const isConnected = connector?.enabled === true
            const accountName = connector ? getAccountName(connector) : null
            const isLoading = disconnecting === service

            return (
              <div
                key={service}
                className="card p-5 flex flex-col gap-4"
                style={{ borderTop: `3px solid ${info.color}` }}
              >
                {/* Icon + name + status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
                      style={{ background: info.bgColor }}
                    >
                      {info.icon}
                    </div>
                    <div>
                      <div className="font-semibold text-text-primary text-sm">{info.name}</div>
                      <div className="text-xs text-text-muted mt-0.5">{info.description}</div>
                    </div>
                  </div>
                  {/* Status badge */}
                  <div className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${
                    isConnected
                      ? 'bg-green-500/15 text-green-400'
                      : 'bg-bg-hover text-text-muted'
                  }`}>
                    {isConnected ? '● Connected' : '○ Not connected'}
                  </div>
                </div>

                {/* Account name if connected */}
                {isConnected && accountName && (
                  <div className="text-xs text-text-muted bg-bg-hover rounded-lg px-3 py-2 truncate">
                    <span className="text-text-secondary font-medium">Account:</span> {accountName}
                  </div>
                )}

                {/* Action button */}
                <div className="flex justify-end">
                  {isConnected ? (
                    <button
                      className="btn-ghost text-sm px-4 py-1.5 text-red-400 border-red-500/20 hover:bg-red-500/10"
                      onClick={() => handleDisconnect(service)}
                      disabled={isLoading}
                    >
                      {isLoading ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  ) : (
                    <button
                      className="btn-primary text-sm px-4 py-1.5"
                      style={{ background: info.color }}
                      onClick={() => handleConnect(service)}
                    >
                      Connect
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Info note */}
      <div className="mt-8 p-4 rounded-xl bg-bg-card border border-border text-sm text-text-muted">
        <div className="font-medium text-text-secondary mb-1">💡 How it works</div>
        <ul className="space-y-1 text-xs">
          <li>• <span className="text-text-primary">Facebook & Instagram</span> share a single OAuth flow — connecting Facebook automatically connects Instagram if linked.</li>
          <li>• <span className="text-text-primary">Google Business & Calendar</span> share a single Google OAuth flow — both connect at once.</li>
          <li>• Once connected, ask Alpha AI to post, reply to reviews, check comments, or schedule appointments.</li>
        </ul>
      </div>
    </div>
  )
}

export default function ConnectorsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-text-muted">Loading...</div>}>
      <ConnectorsContent />
    </Suspense>
  )
}
