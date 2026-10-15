'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, FilterChips, RowsSkeleton } from '@/components/ListKit'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import type { JobSummary, PostAction, PostActionOk, PostOverview, QueueItemView } from '@/lib/posts-api-types'
import JobPhotosPanel from './JobPhotosPanel'
import PhotoCheckSheet from './PhotoCheckSheet'
import type { CheckedPhoto } from './PhotoCheckSheet'
import { fetchJobPhoto, readJobs } from './postsApi'
import type { Done } from './postsApi'

interface Props {
  overview: PostOverview
  act: (action: PostAction) => Promise<Done<PostActionOk>>
  onClose: () => void
  onMade: (item: QueueItemView) => void
  onOpenItem: (id: string) => void
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

type Filter = 'photos' | 'all'
interface CheckRun { items: Array<{ ref: string; label: string }>; i: number }

/**
 * Pick shop photos: every job with inspection photos, grouped by job. Choose a job, see Alpha's picks and why, check each photo,
 * and make the post. The photos are already in Alpha, so nothing is retyped or uploaded again.
 */
export default function ShopPhotosSheet({ overview, act, onClose, onMade, onOpenItem, notify }: Props) {
  const [jobs, setJobs] = useState<JobSummary[]>([])
  const [available, setAvailable] = useState(true)
  const [load, setLoad] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('photos')
  const [jobId, setJobId] = useState<string | null>(null)
  const [local, setLocal] = useState<Record<string, CheckedPhoto>>({})
  const [dropped, setDropped] = useState<string[]>([])
  const [run, setRun] = useState<CheckRun | null>(null)
  const alive = useRef(true)

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const fetchJobs = useCallback(async () => {
    const r = await readJobs()
    if (!alive.current) return
    if (r.ok) { setJobs(r.data.jobs); setAvailable(r.data.available); setLoad('ready'); setError('') }
    else { setError(r.error); setLoad('error') }
  }, [])
  useEffect(() => { void fetchJobs() }, [fetchJobs])

  const open = (id: string | null) => { setJobId(id); setLocal({}); setDropped([]); setRun(null) }
  const changed = (job: JobSummary) => setJobs(list => list.map(j => (j.job_id === job.job_id ? { ...j, ...job } : j)))

  const withPhotos = jobs.filter(j => j.photo_count > 0)
  const shown = filter === 'photos' ? withPhotos : jobs
  const next = () => setRun(r => (r && r.i + 1 < r.items.length ? { ...r, i: r.i + 1 } : null))
  const current = run ? run.items[run.i] : null

  return (
    <>
      <Sheet open onClose={() => { if (!run) onClose() }} title="Pick shop photos" wide>
        {jobId ? (
          <JobPhotosPanel
            key={jobId}
            jobId={jobId}
            platforms={overview.settings.platforms}
            connections={overview.connections}
            canEdit={overview.can_edit}
            local={local}
            dropped={dropped}
            act={act}
            onBack={() => { open(null); void fetchJobs() }}
            onCheck={items => setRun({ items, i: 0 })}
            onMade={onMade}
            onOpenItem={onOpenItem}
            onJobChanged={changed}
            notify={notify}
          />
        ) : (
          <div className="space-y-3 text-[0.9375rem]">
            <p className="text-text-secondary">Photos come from the inspections done on each job, so there is nothing to type or upload again. Pictures in Google Photos or Apple iCloud are not connected. To use one of those, save it to your phone and use Post photos from this device.</p>
            {!available && <Notice kind="info">Repair posts need a database update before Alpha can remember which customers said yes. Ask your developer to apply it. You can still look at the jobs.</Notice>}
            {load === 'loading' ? <RowsSkeleton rows={4} label="Loading jobs" />
              : load === 'error' ? <ErrorCard title="Your jobs did not load" message={error || 'Check your connection and try again.'} onRetry={() => { setLoad('loading'); void fetchJobs() }} />
              : jobs.length === 0 ? (
                <EmptyBlock icon="wrench" title="No jobs yet" action={<a className="btn btn-primary no-underline" href="/jobs">Open Jobs</a>}>Add a job and do an inspection with photos. Then it shows up here.</EmptyBlock>
              ) : (
                <>
                  <FilterChips<Filter> label="Which jobs" value={filter} onChange={setFilter} options={[{ key: 'photos', label: 'With photos', count: withPhotos.length }, { key: 'all', label: 'All jobs', count: jobs.length }]} />
                  {shown.length === 0 ? (
                    <EmptyBlock icon="image" title="No job has photos yet" action={<button type="button" className="btn btn-primary" onClick={() => setFilter('all')}>Show all jobs</button>}>Take photos in an inspection and the job appears here.</EmptyBlock>
                  ) : (
                    <ul className="ledger" aria-label="Jobs">
                      {shown.map(j => (
                        <li key={j.job_id}>
                          <button type="button" className="ledger-row w-full text-left" onClick={() => open(j.job_id)}>
                            <span className={`lamp shrink-0 ${j.customer_ok ? 'lamp-green' : 'lamp-off'}`} aria-hidden="true" />
                            <span className="ledger-main">
                              <span className="ledger-title block">{j.title}</span>
                              <span className="ledger-sub block">{[j.customer, j.status].filter(Boolean).join(' · ')}</span>
                              <span className="ledger-sub block">
                                {j.customer_ok ? 'Customer OK to post' : j.customer_ok_known ? 'Customer has not said yes' : 'Customer OK not known'} · {j.photo_count} {j.photo_count === 1 ? 'photo' : 'photos'}{j.open_item_id ? ' · Post waiting' : ''}
                              </span>
                            </span>
                            <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            <div className="flex justify-end"><button type="button" className="btn btn-secondary" onClick={onClose}>Close</button></div>
          </div>
        )}
      </Sheet>
      {run && current && jobId && (
        <PhotoCheckSheet
          key={`${current.ref}:${run.i}`}
          title="Check this photo"
          progress={run.items.length > 1 ? `Photo ${run.i + 1} of ${run.items.length}` : undefined}
          load={() => fetchJobPhoto(jobId, current.ref)}
          meta={{ jobId, ref: current.ref, label: current.label }}
          saveLabel={run.i + 1 < run.items.length ? 'Save and go to the next photo' : 'Save and finish'}
          onSaved={saved => { setLocal(l => ({ ...l, [current.ref]: saved })); setDropped(d => d.filter(x => x !== current.ref)); next() }}
          onSkip={() => { setDropped(d => (d.includes(current.ref) ? d : [...d, current.ref])); next() }}
          onClose={() => setRun(null)}
        />
      )}
    </>
  )
}
