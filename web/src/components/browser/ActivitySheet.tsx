'use client'
import { useState } from 'react'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { EmptyBlock, ErrorCard, FilterChips, RowsSkeleton } from '@/components/ListKit'
import { ACTIVITY_FILTERS, activityLamp, activityWord, agoText, filterActivity, whoWord } from './activity'
import type { ActivityFilter, ActivityItem, WaitingApproval } from './activity'
import { decideApproval, listWaiting, loadActivity } from './api'
import { setupText } from './failure'
import { StatusLine } from './parts'
import { useLoaded } from './useLoaded'
import { useMounted } from './useMounted'

const MAX_SHOWN = 100

function WaitingList({ items, onDone }: { items: WaitingApproval[]; onDone: () => void }) {
  const mounted = useMounted()
  const [busy, setBusy] = useState('')
  const [problem, setProblem] = useState('')
  const deny = async (id: string) => {
    if (busy) return
    setBusy(id)
    setProblem('')
    try {
      const r = await decideApproval(id, 'denied')
      if (!mounted.current) return
      if (r.ok || (!r.aborted && (r.failure.status === 404))) onDone()
      else if (!r.aborted) setProblem(r.failure.message)
    } catch {
      if (mounted.current) setProblem('That did not work. Try again in a moment.')
    } finally {
      if (mounted.current) setBusy('')
    }
  }
  return (
    <section aria-label="Waiting for your OK" className="space-y-2">
      <h3 className="section-title">Waiting for your OK</h3>
      <p className="text-[0.9375rem] text-text-secondary">
        To go ahead with one of these, do the same step again in Live view. The approval card there shows what will happen and asks you first. Nothing is sent from this list.
      </p>
      {problem && <Notice kind="error">{problem}</Notice>}
      <ul className="space-y-2">
        {items.map(w => (
          <li key={w.id} className="card space-y-1.5">
            <StatusLine lamp="amber">{w.title}</StatusLine>
            <p className="break-words text-[0.9375rem]">{w.summary}</p>
            <p className="text-[0.875rem] text-text-secondary">{w.actor === 'ai' ? 'Alpha asked' : 'You asked'}{w.host ? ` · ${w.host}` : ''}</p>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy === w.id} onClick={() => deny(w.id)}>
              {busy === w.id ? 'Saying no…' : 'Do not do this'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Row({ item }: { item: ActivityItem }) {
  const lamp = activityLamp(item)
  const when = agoText(item.at)
  return (
    <li className="px-3 py-3">
      <div className="flex items-start gap-3">
        <span className={`lamp lamp-${lamp} mt-1.5`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{activityWord(item.action)}<span className="font-normal text-text-secondary"> · {whoWord(item.who)}</span></p>
          {item.host && <p className="break-all text-[0.875rem] text-text-secondary">{item.host}</p>}
          {item.detail && <p className="break-words text-[0.9375rem]">{item.detail}</p>}
        </div>
        {when && <span className="shrink-0 text-[0.8125rem] text-text-secondary">{when}</span>}
      </div>
    </li>
  )
}

function ActivityBody({ onClose }: { onClose: () => void }) {
  const activity = useLoaded<ActivityItem[]>(loadActivity)
  const waiting = useLoaded<{ items: WaitingApproval[]; missing: boolean }>(listWaiting)
  const [filter, setFilter] = useState<ActivityFilter>('all')

  const all = activity.data ?? []
  const shown = filterActivity(all, filter).slice(0, MAX_SHOWN)
  const pending = waiting.data?.items ?? []

  return (
    <div className="space-y-4">
      {waiting.status === 'ready' && waiting.data?.missing && (
        <Notice kind="info">{setupText('Approving requests')} Until then nothing can be sent or saved from the Browser. Reading, searching and lookups still work.</Notice>
      )}
      {waiting.status === 'error' && (
        <Notice kind="warn">
          <p>Requests waiting for your OK could not be loaded.</p>
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={waiting.reload}>Try again</button>
        </Notice>
      )}
      {pending.length > 0 && <WaitingList items={pending} onDone={waiting.reload} />}

      <section aria-label="What happened" className="space-y-3">
        <h3 className="section-title">What happened</h3>
        {activity.status === 'loading' && <RowsSkeleton rows={5} label="Loading activity" />}
        {activity.status === 'error' && (
          <ErrorCard title="Activity could not be loaded" message={activity.failure?.message || 'That did not work. Try again in a moment.'} onRetry={activity.reload} />
        )}
        {activity.status === 'ready' && all.length === 0 && (
          <EmptyBlock icon="list" title="Nothing yet" action={<button type="button" className="btn btn-primary" onClick={onClose}>Start browsing</button>}>
            Pages you open, searches and what Alpha does will be listed here.
          </EmptyBlock>
        )}
        {activity.status === 'ready' && all.length > 0 && (
          <>
            <FilterChips label="Show" options={ACTIVITY_FILTERS} value={filter} onChange={setFilter} scroll />
            {shown.length === 0 ? (
              <EmptyBlock icon="list" title="Nothing matches this" action={<button type="button" className="btn btn-primary" onClick={() => setFilter('all')}>Show everything</button>}>
                Nothing in the log fits this filter.
              </EmptyBlock>
            ) : (
              <ul className="ledger">{shown.map(i => <Row key={i.id} item={i} />)}</ul>
            )}
          </>
        )}
      </section>
    </div>
  )
}

/** The browsing log, and any requests still waiting for an OK. */
export default function ActivitySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Browser activity" wide>
      <ActivityBody onClose={onClose} />
    </Sheet>
  )
}
