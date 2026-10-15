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
    {connection.status === 'checking' ? <p className="flex items-center gap-2 text-[0.9375rem] text-text-secondary"><span className="lamp lamp-off" aria-hidden="true" />Checking connection…</p>
      : connection.status === 'connected' ? <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-2 text-[0.9375rem] font-bold"><span className="lamp lamp-green" aria-hidden="true" />Connected: your ChatGPT account</span>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void request('disconnect')}>Disconnect</button>
      </div> : connection.status === 'pending' ? <>
        <p className="flex items-center gap-2 text-[0.9375rem] font-bold"><span className="lamp lamp-amber" aria-hidden="true" />Waiting for you to approve</p>
        <p className="text-[0.9375rem]">Open OpenAI’s sign-in page and enter this one-time code:</p>
        <div className="flex flex-wrap items-center gap-3">
          <code className="num select-all rounded-md border border-line bg-bg-input px-4 py-2 text-[1.375rem] font-bold tracking-[0.18em]">{connection.code}</code>
          <a className="btn btn-primary" href="https://auth.openai.com/codex/device" target="_blank" rel="noopener noreferrer">Open OpenAI sign-in</a>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void request('disconnect')}>Cancel</button>
        </div>
        <p className="text-[0.8125rem] text-text-secondary">The code expires in 15 minutes. You may need to turn on device-code sign-in in ChatGPT security settings. Approve only the connection you started here.</p>
      </> : <>
        {connection.status === 'expired' && <p className="flex items-center gap-2 text-[0.9375rem] font-bold"><span className="lamp lamp-amber" aria-hidden="true" />Your connection expired. Sign in again.</p>}
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void request('start')}>{busy ? 'Connecting…' : 'Connect ChatGPT, no extension needed'}</button>
      </>}
    {error && <div role="alert" className="text-[0.9375rem]">
      <p className="flex items-start gap-2 font-bold text-red"><span className="lamp lamp-red mt-1.5" aria-hidden="true" />{error}</p>
      <button type="button" className="btn btn-secondary btn-sm mt-2" disabled={busy} onClick={() => void request(connection.status === 'pending' ? 'poll' : undefined)}>Check again</button>
    </div>}
  </div>
}
