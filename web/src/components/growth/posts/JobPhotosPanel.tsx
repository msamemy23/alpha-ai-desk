'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { ErrorCard } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { Switch } from '@/components/ScreenParts'
import { MAX_ITEM_PHOTOS, POST_PLATFORMS, reachable } from '@/lib/posts-rules'
import type { Connection, PostPhoto, PostPlatform } from '@/lib/posts-rules'
import type { JobPhoto, JobPhotosResponse, JobSummary, PostAction, PostActionOk, QueueItemView } from '@/lib/posts-api-types'
import type { CheckedPhoto } from './PhotoCheckSheet'
import { readJobPhotos } from './postsApi'
import type { Done } from './postsApi'

interface Props {
  jobId: string
  platforms: PostPlatform[]
  connections: Record<PostPlatform, Connection>
  canEdit: boolean
  /** Photos checked in this sitting, by inspection photo. */
  local: Record<string, CheckedPhoto>
  /** Photos the owner chose to leave out while checking. */
  dropped: string[]
  act: (action: PostAction) => Promise<Done<PostActionOk>>
  onBack: () => void
  onCheck: (photos: Array<{ ref: string; label: string }>) => void
  onMade: (item: QueueItemView) => void
  onOpenItem: (id: string) => void
  onJobChanged: (job: JobSummary) => void
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

/** One job: the customer's yes, Alpha's photo picks and why, what the post would say, and the one button that makes the post. */
export default function JobPhotosPanel({ jobId, platforms, connections, canEdit, local, dropped, act, onBack, onCheck, onMade, onOpenItem, onJobChanged, notify }: Props) {
  const [data, setData] = useState<JobPhotosResponse | null>(null)
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [picks, setPicks] = useState<string[]>([])
  const [asking, setAsking] = useState(false)
  const [permBusy, setPermBusy] = useState(false)
  const [making, setMaking] = useState(false)
  const [problem, setProblem] = useState('')
  const busy = useRef(false)
  const alive = useRef(true)

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const fetchData = useCallback(async (ai: boolean): Promise<JobPhotosResponse | null> => {
    const r = await readJobPhotos(jobId, { ai })
    if (!alive.current) return null
    if (!r.ok) { setError(r.error); return null }
    setData(r.data)
    setPicks(r.data.photos.filter(p => p.proposed).map(p => p.ref))
    return r.data
  }, [jobId])

  useEffect(() => {
    void (async () => {
      const got = await fetchData(false)
      if (alive.current) setLoad(got ? 'ready' : 'error')
    })()
  }, [fetchData])

  const checkedOf = (p: JobPhoto): { path: string; covered: boolean } | null => local[p.ref] ?? (p.cleared ? { path: p.cleared.path, covered: p.cleared.covered } : null)
  const picked = data ? data.photos.filter(p => picks.includes(p.ref) && !dropped.includes(p.ref)) : []
  const unchecked = picked.filter(p => !checkedOf(p))

  const askAgain = async () => {
    if (busy.current) return
    busy.current = true; setAsking(true); setProblem('')
    try {
      const got = await fetchData(true)
      if (got) notify(got.ai_used ? 'Alpha looked at the photos again and chose a new set.' : 'Alpha used its standard rules because the AI service did not answer.', got.ai_used ? 'success' : 'info')
      else setProblem('Alpha could not choose again just now. Your current picks are unchanged.')
    } finally { busy.current = false; setAsking(false) }
  }

  const setOk = async (next: boolean) => {
    if (busy.current || !data) return
    busy.current = true; setPermBusy(true); setProblem('')
    try {
      const r = await act({ action: 'set_permission', job_id: jobId, ok: next })
      if (!r.ok) { setProblem(r.error); return }
      const job = r.data.job
      if (job) { setData(d => (d ? { ...d, job } : d)); onJobChanged(job) }
      notify(r.data.message, 'success')
    } finally { busy.current = false; setPermBusy(false) }
  }

  const toggle = (ref: string, on: boolean) => setPicks(list => (on ? (list.includes(ref) ? list : [...list, ref]) : list.filter(x => x !== ref)))

  const places: PostPlatform[] = platforms.length ? platforms : reachable(POST_PLATFORMS, connections)

  const make = async () => {
    if (busy.current || !data) return
    busy.current = true; setMaking(true); setProblem('')
    try {
      const photos: PostPhoto[] = []
      for (const p of picked) {
        const c = checkedOf(p)
        if (!c) { setProblem('Check every picked photo first.'); return }
        photos.push({ ref: p.ref, path: c.path, covered: c.covered, label: p.label })
      }
      const r = await act({ action: 'create', job_id: jobId, photos, caption: data.caption, platforms: places })
      if (!r.ok) { setProblem(r.error); return }
      if (r.data.item) { notify('Your post is ready. Look it over, then post it.', 'success'); onMade(r.data.item) }
    } finally { busy.current = false; setMaking(false) }
  }

  if (load === 'loading') {
    return (
      <div className="space-y-3">
        <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={onBack}><Icon name="chevronLeft" className="h-4 w-4" />All jobs</button>
        <div className="skeleton h-20" role="status" aria-busy="true" aria-label="Loading the job" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="skeleton aspect-square" /><div className="skeleton aspect-square" /><div className="skeleton aspect-square" /></div>
      </div>
    )
  }
  if (load === 'error' || !data) {
    return (
      <div className="space-y-3">
        <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={onBack}><Icon name="chevronLeft" className="h-4 w-4" />All jobs</button>
        <ErrorCard title="This job did not load" message={error || 'Check your connection and try again.'} onRetry={() => { setLoad('loading'); setError(''); void fetchData(false).then(got => { if (alive.current) setLoad(got ? 'ready' : 'error') }) }} />
      </div>
    )
  }

  const { job } = data
  const stops: string[] = []
  if (!data.available) stops.push('Alpha cannot save the customer’s yes until the database update for repair posts is applied.')
  else if (!job.customer_ok) stops.push('The customer has not said yes. Turn on Customer OK to post above once they have.')
  if (job.open_item_id) stops.push('A post for this job is already waiting. Open it, or skip it first.')
  if (data.photos.length === 0) stops.push('This job has no inspection photos. Post photos from this device instead.')
  else if (picked.length === 0) stops.push('Pick at least one photo.')
  else if (unchecked.length > 0) stops.push(`${unchecked.length} picked ${unchecked.length === 1 ? 'photo still needs' : 'photos still need'} your check for license plates and VINs.`)
  if (data.problems.length > 0) stops.push('The job record does not say enough for Alpha to write the post. See above.')
  if (places.length === 0) stops.push('Choose where posts go, and connect an app, under Automatic posting.')
  const ready = canEdit && stops.length === 0

  return (
    <div className="space-y-4 text-[0.9375rem]">
      <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={onBack}><Icon name="chevronLeft" className="h-4 w-4" />All jobs</button>

      <div>
        <h3 className="text-[1.125rem] font-bold">{job.title}</h3>
        <p className="text-text-secondary">{job.customer ? `${job.customer} · ` : ''}{job.status}{job.finished ? '' : '. Not finished yet'}</p>
      </div>

      <div className="card flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold">Customer OK to post</p>
          <p className="mt-0.5 flex items-start gap-2"><span className={`lamp mt-1.5 shrink-0 ${job.customer_ok ? 'lamp-green' : 'lamp-off'}`} aria-hidden="true" />{job.customer_ok ? 'Yes. The customer said a post about this job is fine.' : 'No. Nothing about this job can be posted.'}</p>
          <p className="form-hint">Turn this on only after the customer told you it is fine to post photos of their car. Turning it off cancels any post waiting for this job. It starts off for every job.</p>
        </div>
        <Switch checked={job.customer_ok} onChange={v => void setOk(v)} label="Customer OK to post about this job" disabled={!canEdit || !data.available || permBusy} />
      </div>

      {!data.available && <Notice kind="info">Repair posts need a database update before Alpha can remember the customer’s yes. Ask your developer to apply it. Until then nothing is posted for a job.</Notice>}
      {!job.finished && <Notice kind="info">This job is not finished. You can still make a post by hand, but Auto only posts finished jobs.</Notice>}
      {job.open_item_id && (
        <Notice kind="info">
          <p>A post for this job is already waiting.</p>
          <button type="button" className="btn btn-secondary mt-2" onClick={() => onOpenItem(job.open_item_id as string)}>Open the waiting post</button>
        </Notice>
      )}

      <section aria-label="What the post would say">
        <h3 className="section-title mb-1.5">What the post would say</h3>
        {data.problems.length > 0 ? (
          <Notice kind="warn">
            <p className="font-bold">The job record does not say enough yet</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{data.problems.map(p => <li key={p}>{p}</li>)}</ul>
          </Notice>
        ) : (
          <>
            <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-bg-hover px-3 py-2.5">{data.caption}</p>
            <p className="form-hint">
              Alpha wrote this from the job record only{data.facts?.engine ? `, including the engine (${data.facts.engine})` : ''}. It does not invent prices, offers, warranties or credentials. {data.facts && !data.facts.engine ? 'The engine is not known, so the post says nothing about it. ' : ''}You can change the words before anything is posted.
            </p>
            {data.caption_flags.length > 0 && <Notice kind="warn" className="mt-2"><ul className="list-disc space-y-0.5 pl-5">{data.caption_flags.map(f => <li key={f}>{f}</li>)}</ul></Notice>}
          </>
        )}
      </section>

      <section aria-label="Photos">
        <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
          <h3 className="section-title">Photos from this job</h3>
          {data.photos.length > 1 && canEdit && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void askAgain()} disabled={asking || making} aria-busy={asking}><Icon name="refresh" className="h-4 w-4" />{asking ? 'Choosing…' : 'Ask Alpha to choose again'}</button>
          )}
        </div>
        {data.proposal_note && <p className="mb-2 text-text-secondary">{data.proposal_note}</p>}
        {data.photos.length === 0 ? (
          <p className="text-text-secondary">This job has no inspection photos yet. Take photos in an inspection, or post photos from this device.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {data.photos.map(p => {
              const on = picks.includes(p.ref) && !dropped.includes(p.ref)
              const checked = checkedOf(p)
              return (
                <li key={p.ref} className={`min-w-0 rounded-md border p-2 ${on ? 'border-blue' : 'border-border'}`}>
                  <div className="aspect-square overflow-hidden rounded bg-bg-hover">
                    {p.url
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={p.url} alt={p.label} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      : <div className="grid h-full place-items-center p-2 text-center text-[0.8125rem] text-text-secondary">Preview not available</div>}
                  </div>
                  <label className="mt-1 flex min-h-[44px] items-start gap-2.5">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={on} disabled={!canEdit || (!on && picked.length >= MAX_ITEM_PHOTOS)} onChange={e => toggle(p.ref, e.target.checked)} />
                    <span className="min-w-0 break-words font-bold">{on ? 'Picked: ' : 'Not picked: '}{p.label}</span>
                  </label>
                  {(p.reason || p.proposed) && <p className="text-[0.8125rem] text-text-secondary">{p.proposed ? 'Alpha picked this. ' : 'Alpha left this out. '}{p.reason}</p>}
                  <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-text-secondary"><span className={`lamp ${checked ? 'lamp-green' : 'lamp-amber'}`} aria-hidden="true" />{checked ? (checked.covered ? 'Checked, plate or VIN covered' : 'Checked, nothing covered') : 'Not checked yet'}</p>
                  {canEdit && on && checked && <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => onCheck([{ ref: p.ref, label: p.label }])}>Check again</button>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {data.photos.length > 0 && canEdit && unchecked.length > 0 && (
        <div>
          <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={() => onCheck(unchecked.map(p => ({ ref: p.ref, label: p.label })))}>
            <Icon name="eye" className="h-5 w-5" />Check {unchecked.length === picked.length ? 'Alpha’s picks' : `the ${unchecked.length} unchecked ${unchecked.length === 1 ? 'photo' : 'photos'}`}
          </button>
          <p className="form-hint">You look at each photo and cover any license plate or VIN. Alpha cannot find them by itself, so nothing is posted until you have.</p>
        </div>
      )}

      {stops.length > 0 && (
        <section aria-label="What is still needed">
          <h3 className="section-title mb-1.5">Still needed before the post can be made</h3>
          <ul className="space-y-1.5">{stops.map(s => <li key={s} className="flex items-start gap-2"><span className="lamp lamp-amber mt-1.5 shrink-0" aria-hidden="true" />{s}</li>)}</ul>
        </section>
      )}

      {problem && <Notice kind="error">{problem}</Notice>}

      {canEdit && (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-primary" onClick={() => void make()} disabled={!ready || making || asking} aria-busy={making}>
            <Icon name="plus" className="h-5 w-5" />{making ? 'Making the post…' : 'Make the post'}
          </button>
        </div>
      )}
      <p className="form-hint">Making the post does not publish it. It waits in your queue for you to look it over and tap Post now.</p>
    </div>
  )
}
