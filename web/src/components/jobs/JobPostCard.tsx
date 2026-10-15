'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Switch } from '@/components/ScreenParts'
import Notice from '@/components/Notice'
import { readJobBrief, sendAction } from '@/components/growth/posts/postsApi'
import type { JobSummary } from '@/lib/posts-api-types'

/**
 * On a job: has the customer said a post about their car is fine, and (optional) how did they hear about the shop.
 * The customer's yes starts off for every job and nothing is posted about a job without it. Self-contained: it reads and writes
 * only the repair-post records and never touches the estimate or invoice.
 */
export default function JobPostCard({ jobId }: { jobId: string }) {
  const base = useId()
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [job, setJob] = useState<JobSummary | null>(null)
  const [available, setAvailable] = useState(true)
  const [canEdit, setCanEdit] = useState(false)
  const [heard, setHeard] = useState('')
  const [busy, setBusy] = useState<'' | 'ok' | 'heard'>('')
  const [said, setSaid] = useState('')
  const [problem, setProblem] = useState('')
  const lock = useRef(false)
  const alive = useRef(true)

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const fetchBrief = useCallback(async () => {
    const r = await readJobBrief(jobId)
    if (!alive.current) return
    if (r.ok) { setJob(r.data.job); setAvailable(r.data.available); setCanEdit(r.data.can_edit); setHeard(r.data.job.heard_from); setState('ready'); setError('') }
    else { setError(r.error); setState('error') }
  }, [jobId])
  useEffect(() => { void fetchBrief() }, [fetchBrief])

  const setOk = async (next: boolean) => {
    if (lock.current) return
    lock.current = true; setBusy('ok'); setProblem(''); setSaid('')
    try {
      const r = await sendAction({ action: 'set_permission', job_id: jobId, ok: next })
      if (!r.ok) { setProblem(r.error); return }
      if (r.data.job) setJob(r.data.job)
      setSaid(r.data.message)
    } finally { lock.current = false; setBusy('') }
  }

  const saveHeard = async () => {
    if (lock.current) return
    lock.current = true; setBusy('heard'); setProblem(''); setSaid('')
    try {
      const r = await sendAction({ action: 'set_heard_from', job_id: jobId, heard_from: heard })
      if (!r.ok) { setProblem(r.error); return }
      if (r.data.job) { setJob(r.data.job); setHeard(r.data.job.heard_from) }
      setSaid('Saved.')
    } finally { lock.current = false; setBusy('') }
  }

  return (
    <section className="mt-5" aria-label="Posting about this job">
      <h3 className="section-title mb-1.5">Posting about this job</h3>
      {state === 'loading' ? (
        <div className="skeleton h-16" role="status" aria-busy="true" aria-label="Loading" />
      ) : state === 'error' || !job ? (
        <div role="alert" className="text-[0.9375rem]">
          <p className="text-text-secondary">{error || 'This could not be loaded.'}</p>
          <button type="button" className="btn btn-secondary mt-2" onClick={() => { setState('loading'); void fetchBrief() }}>Try again</button>
        </div>
      ) : (
        <div className="space-y-3 text-[0.9375rem]">
          {!available && <Notice kind="info">Repair posts need a database update before Alpha can remember the customer’s yes. Ask your developer to apply it.</Notice>}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-bold">Customer OK to post</p>
              <p className="flex items-start gap-2 text-text-secondary"><span className={`lamp mt-1.5 shrink-0 ${job.customer_ok ? 'lamp-green' : 'lamp-off'}`} aria-hidden="true" />{job.customer_ok ? 'Yes. The customer said a post about this job is fine.' : 'No. Nothing about this job is posted.'}</p>
              <p className="form-hint">Turn on only after the customer tells you it is fine to post photos of their car. It starts off for every job. Turning it off cancels any post waiting for this job.</p>
            </div>
            <Switch checked={job.customer_ok} onChange={v => void setOk(v)} label="Customer OK to post about this job" disabled={!canEdit || !available || busy !== ''} />
          </div>
          <form onSubmit={e => { e.preventDefault(); void saveHeard() }}>
            <label htmlFor={`${base}-heard`} className="form-label">How did you hear about us? (optional)</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input id={`${base}-heard`} className="form-input" value={heard} maxLength={120} disabled={!available || busy !== ''} onChange={e => { setHeard(e.target.value); setSaid('') }} placeholder="A friend, Google, our Facebook page" autoComplete="off" />
              <button type="submit" className="btn btn-secondary shrink-0" disabled={!available || busy !== '' || heard.trim() === job.heard_from.trim()} aria-busy={busy === 'heard'}>{busy === 'heard' ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
          {problem && <p role="alert" className="form-error">{problem}</p>}
          {said && <p role="status" className="text-text-secondary">{said}</p>}
        </div>
      )}
    </section>
  )
}
