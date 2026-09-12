'use client'
import { useCallback, useEffect, useState } from 'react'

type Connection = { status: string; code?: string; interval?: number }
export default function ChatGPTConnection() {
  const [connection, setConnection] = useState<Connection>({ status: 'checking' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useCallback(async (action?: string) => {
    setBusy(true); setError('')
    try {
      const response = await fetch('/api/chatgpt-connection', action ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      } : { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Connection could not be checked')
      setConnection(data)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Connection failed')
      setConnection(value => value.status === 'checking' ? { status: 'disconnected' } : value)
    } finally { setBusy(false) }
  }, [])
  useEffect(() => { void request() }, [request])
  useEffect(() => {
    if (connection.status !== 'pending' || busy || error) return
    const timer = setTimeout(() => void request('poll'), Math.max(5, connection.interval || 5) * 1000)
    return () => clearTimeout(timer)
  }, [connection, busy, error, request])
  return <div className="space-y-3">
    {connection.status === 'checking' ? <p className="text-sm text-text-muted">Checking connection…</p>
      : connection.status === 'connected' ? <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-green">✓ Your ChatGPT account is connected</span>
        <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void request('disconnect')}>Disconnect</button>
      </div> : connection.status === 'pending' ? <>
        <p className="text-sm">Open OpenAI’s sign-in page and enter this one-time code:</p>
        <div className="flex flex-wrap items-center gap-3">
          <code className="select-all rounded-lg border border-border px-4 py-2 text-xl tracking-widest">{connection.code}</code>
          <a className="btn btn-primary btn-sm" href="https://auth.openai.com/codex/device" target="_blank" rel="noopener noreferrer">Open OpenAI sign-in</a>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void request('disconnect')}>Cancel</button>
        </div>
        <p className="text-xs text-text-muted">Waiting for your approval. Code expires in 15 minutes. You may need to enable device-code sign-in in ChatGPT security settings. Approve only the connection you started here.</p>
      </> : <>
        {connection.status === 'expired' && <p className="text-sm text-amber">Your connection expired. Sign in again.</p>}
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void request('start')}>{busy ? 'Connecting…' : 'Connect ChatGPT — no extension'}</button>
      </>}
    {error && <div role="alert" className="text-sm text-red"><p>{error}</p><button className="mt-2 underline" disabled={busy} onClick={() => void request(connection.status === 'pending' ? 'poll' : undefined)}>Check again</button></div>}
  </div>
}
