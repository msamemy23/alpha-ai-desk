'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'

type Phase = 'loading' | 'update' | 'none' | 'has' | 'open' | 'error'

/**
 * On a job: the private page where the customer can see where their car stands. Making the link sends nothing.
 * The shop copies it, or opens the text composer with the link in it and reads the message before it goes.
 * Self-contained: it reads and writes only the extras table, never the repair order, estimate or invoice.
 */
export default function StatusLinkCard({ jobId, canText, onText }: {
  jobId: string
  /** The customer has a phone number on file. */
  canText: boolean
  /** Opens the text composer with the link already in the message. The shop still presses Send. */
  onText: (url: string) => void
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [said, setSaid] = useState('')
  const [asking, setAsking] = useState(false)
  const lock = useRef(false)
  const alive = useRef(true)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const read = useCallback(async () => {
    setPhase('loading'); setProblem('')
    try {
      const res = await fetch(`/api/jobflow?job_id=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      const d = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!alive.current) return
      if (!res.ok || d.ok !== true) { setProblem(typeof d.error === 'string' ? d.error : 'The status link could not be checked. Try again.'); setPhase('error'); return }
      if (d.available === false) { setPhase('update'); return }
      const flows = Array.isArray(d.flows) ? d.flows as Record<string, unknown>[] : []
      setPhase(flows.some(f => f.job_id === jobId && f.has_link === true) ? 'has' : 'none')
    } catch {
      if (alive.current) { setProblem('No connection. Check your internet and try again.'); setPhase('error') }
    }
  }, [jobId])
  useEffect(() => { void read() }, [read])

  /** Make the link, or fetch the one that exists: asking twice gives the same address. */
  const link = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setProblem(''); setSaid('')
    try {
      const res = await fetch('/api/jobflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'link', job_id: jobId }) })
      const d = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!alive.current) return
      if (d.available === false) { setPhase('update'); return }
      if (!res.ok || d.ok !== true || typeof d.token !== 'string' || !d.token) { setProblem(typeof d.error === 'string' ? d.error : 'The link was not made. Try again.'); return }
      setUrl(`${window.location.origin}/status/${d.token}`)
      setPhase('open')
    } catch {
      if (alive.current) setProblem('No connection. Check your internet and try again.')
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }

  const turnOff = async () => {
    if (lock.current) return
    lock.current = true; setBusy(true); setProblem(''); setSaid('')
    try {
      const res = await fetch('/api/jobflow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revoke', job_id: jobId }) })
      const d = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!alive.current) return
      if (!res.ok || d.ok !== true) { setProblem(typeof d.error === 'string' ? d.error : 'The link was not turned off. Try again.'); return }
      setUrl(''); setAsking(false); setPhase('none'); setSaid('The link is off. The page it opened no longer works.')
    } catch {
      if (alive.current) setProblem('No connection. Check your internet and try again.')
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }

  const copy = async () => {
    setProblem(''); setSaid('')
    try { await navigator.clipboard.writeText(url); setSaid('Link copied.') }
    catch { field.current?.focus(); field.current?.select(); setProblem('Copying did not work here. The link is selected: press and hold it to copy.') }
  }

  return (
    <section className="mt-5" aria-label="Customer status page">
      <h3 className="section-title mb-1.5">Status link</h3>
      {phase === 'loading' && <div className="skeleton h-16" aria-busy="true" aria-label="Checking the status link" />}

      {phase === 'update' && (
        <Notice kind="info">Status links need a database update before they can be made. Nothing else on this job is affected.</Notice>
      )}

      {phase === 'error' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-[0.9375rem]">
          <span className="min-w-0 flex-1 basis-56 text-red">{problem}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void read()}>Try again</button>
        </div>
      )}

      {(phase === 'none' || phase === 'has' || phase === 'open') && (
        <>
          <p className="text-[0.9375rem] text-text-secondary">
            {phase === 'none'
              ? 'A private page where the customer sees where their car stands: the status, the parts, and when it is expected. It never shows prices, notes or other customers. Making it sends nothing.'
              : 'The customer can open this link to see where their car stands. It shows no prices, notes or other customers.'}
          </p>

          {phase === 'open' && (
            <div className="mt-2.5">
              <label htmlFor={`sl-${jobId}`} className="form-label">Link for the customer</label>
              <input id={`sl-${jobId}`} ref={field} className="form-input" readOnly value={url} onFocus={e => e.currentTarget.select()} />
            </div>
          )}

          {!asking ? (
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              {phase === 'open' ? (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => void copy()}><Icon name="copy" className="h-5 w-5" />Copy link</button>
                  {canText && <button type="button" className="btn btn-secondary" onClick={() => onText(url)}><Icon name="send" className="h-5 w-5" />Write the text</button>}
                </>
              ) : (
                <button type="button" className="btn btn-secondary sm:col-span-2" disabled={busy} onClick={() => void link()}>
                  <Icon name="link" className="h-5 w-5" />{busy ? 'Working…' : phase === 'none' ? 'Make a status link' : 'Show the link'}
                </button>
              )}
              {phase !== 'none' && <button type="button" className="btn btn-ghost btn-sm sm:col-span-2" disabled={busy} onClick={() => setAsking(true)}>Turn off the link</button>}
            </div>
          ) : (
            <div role="group" aria-label="Turn off the link" className="mt-2.5 rounded-md border border-border bg-bg-base p-3">
              <p className="text-[0.9375rem]">Turn off this link? The page the customer has open stops working. You can make a new link later.</p>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setAsking(false)}>Keep it</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void turnOff()}>{busy ? 'Turning off…' : 'Turn it off'}</button>
              </div>
            </div>
          )}
        </>
      )}

      {said && <p role="status" className="mt-2 flex items-center gap-2 text-[0.9375rem] text-green"><Icon name="check" className="h-5 w-5 shrink-0" />{said}</p>}
      {problem && phase !== 'error' && <p role="alert" className="form-error">{problem}</p>}
    </section>
  )
}
