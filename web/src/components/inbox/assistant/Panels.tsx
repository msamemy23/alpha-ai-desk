'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, FilterChips, RowsSkeleton } from '@/components/ListKit'
import { phonePretty } from '@/lib/today'
import { slotLabel } from '@/lib/voice/hours'
import { bookingConfirmation } from '@/lib/voice/templates'
import type { ResultCounts } from '@/lib/voice/results'
import { api } from '../api'
import { outcomeLabel, outcomeLamp, sinceLabel } from '../ai-types'
import type { BookingRow, Interaction } from '../ai-types'
import { stamp } from '../utils'

export type Load<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'unavailable' } | { status: 'ready'; data: T }

const UNAVAILABLE = 'This part switches on after a one-time database update. Your admin can apply it; nothing else is affected until then.'

/* ---------- results ---------- */

const TILES: Array<{ key: keyof ResultCounts; label: string; hint: string }> = [
  { key: 'answered', label: 'Answered', hint: 'Calls and texts the assistant dealt with' },
  { key: 'booked', label: 'Booked', hint: 'Put on the schedule' },
  { key: 'bookingRequests', label: 'Asked for a time', hint: 'Waiting for you to confirm' },
  { key: 'transferred', label: 'Passed to a person', hint: 'Calls put through to your team' },
  { key: 'missed', label: 'Missed', hint: 'Nobody could take the call' },
  { key: 'afterHours', label: 'After hours', hint: 'Came in while you were closed' },
  { key: 'messagesTaken', label: 'Messages taken', hint: 'Left for your team to answer' },
  { key: 'stillNeedsPerson', label: 'Still need a person', hint: 'Waiting on you right now' },
  { key: 'spamBlocked', label: 'Spam blocked', hint: 'Filtered out' },
]

export function ResultsPanel({ days, onDays, state, onRetry }: { days: number; onDays: (d: number) => void; state: Load<ResultCounts>; onRetry: () => void }) {
  return (
    <section aria-labelledby="as-results" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="as-results" className="section-title">Results</h2>
        <FilterChips label="Time period" value={String(days)} onChange={k => onDays(Number(k))} options={[{ key: '7', label: '7 days' }, { key: '30', label: '30 days' }, { key: '90', label: '90 days' }]} />
      </div>
      {state.status === 'loading' && <div className="grid grid-cols-2 gap-3 md:grid-cols-3" role="status" aria-busy="true" aria-label="Loading results">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-24" />)}</div>}
      {state.status === 'error' && <ErrorCard title="Results did not load" message={state.message} onRetry={onRetry} />}
      {state.status === 'unavailable' && <EmptyBlock icon="sparkle" title="Results start soon">{UNAVAILABLE}</EmptyBlock>}
      {state.status === 'ready' && (state.data.total === 0 ? (
        <EmptyBlock icon="sparkle" title={`Nothing in the last ${days} days`}>When the assistant answers a call or a text, you will see the numbers here.</EmptyBlock>
      ) : (
        <>
          <p className="text-[0.9375rem] text-text-secondary">
            <span className="num font-bold text-text-primary">{state.data.total}</span> in all: <span className="num">{state.data.calls}</span> {state.data.calls === 1 ? 'call' : 'calls'} and <span className="num">{state.data.texts}</span> {state.data.texts === 1 ? 'text' : 'texts'}.
            {state.data.good + state.data.bad > 0 && <> You marked <span className="num">{state.data.good}</span> handled well and <span className="num">{state.data.bad}</span> needing work.</>}
          </p>
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {TILES.map(t => (
              <li key={t.key} className="card !p-4">
                <p className="num text-[2rem] font-bold leading-none">{state.data[t.key]}</p>
                <p className="mt-2 font-bold">{t.label}</p>
                <p className="text-[0.8125rem] text-text-secondary">{t.hint}</p>
              </li>
            ))}
          </ul>
        </>
      ))}
    </section>
  )
}

/* ---------- waiting for you ---------- */

export function WaitingPanel({ items, bookingsPending, onOpen, onResolved }: {
  items: Interaction[]; bookingsPending: number; onOpen: (i: Interaction) => void; onResolved: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const needs = items.filter(i => i.needs_person && !i.needs_resolved_at)
  const drafts = items.filter(i => i.channel === 'sms' && i.draft)
  const resolve = async (i: Interaction) => {
    setBusy(i.id); setError('')
    const r = await api(`/api/receptionist/activity/${encodeURIComponent(i.id)}`, { method: 'PATCH', body: { action: 'resolve' } })
    setBusy(null)
    if (!r.ok) { setError(r.error); return }
    onResolved()
  }
  if (needs.length === 0 && drafts.length === 0 && bookingsPending === 0) return null
  return (
    <section aria-labelledby="as-wait" className="space-y-3">
      <h2 id="as-wait" className="section-title">Waiting for you</h2>
      {error && <p role="alert" className="font-bold text-red">{error}</p>}
      <ul className="ledger">
        {needs.map(i => (
          <li key={i.id}>
            <div className="flex items-center">
              <button type="button" className="ledger-row min-w-0 flex-1 text-left" onClick={() => onOpen(i)} aria-label={`Open ${i.contact_name || phonePretty(i.contact_phone || '')}. Needs a person`}>
                <span className="ledger-main">
                  <span className="flex min-w-0 items-center gap-2"><span className="lamp lamp-red" aria-hidden="true" /><span className="ledger-title">{i.contact_name || phonePretty(i.contact_phone || '') || 'Unknown'}</span></span>
                  <span className="ledger-sub block"><span className="font-bold text-red">Needs a person</span>{i.needs_reason ? ` · ${i.needs_reason}` : ''} · {i.channel === 'call' ? 'Call' : 'Text'} {sinceLabel(i.started_at)}</span>
                </span>
              </button>
              <button type="button" className="btn btn-secondary btn-sm mr-2 shrink-0" onClick={() => void resolve(i)} disabled={busy === i.id}>Mark handled</button>
            </div>
          </li>
        ))}
        {drafts.map(i => (
          <li key={`d-${i.id}`}>
            <Link href={`/messages?thread=${encodeURIComponent(i.contact_key)}`} className="ledger-row no-underline">
              <span className="ledger-main">
                <span className="flex min-w-0 items-center gap-2"><span className="lamp lamp-blue" aria-hidden="true" /><span className="ledger-title">{i.contact_name || phonePretty(i.contact_phone || '') || 'Unknown'}</span></span>
                <span className="ledger-sub block"><span className="font-bold text-blue">Reply waiting for your OK</span> · {i.draft ? i.draft.text.slice(0, 90) : ''}</span>
              </span>
              <Icon name="chevronRight" className="h-5 w-5 text-text-muted" />
            </Link>
          </li>
        ))}
        {bookingsPending > 0 && (
          <li>
            <a href="#as-bookings" className="ledger-row no-underline">
              <span className="ledger-main">
                <span className="flex items-center gap-2"><span className="lamp lamp-amber" aria-hidden="true" /><span className="ledger-title">{bookingsPending === 1 ? '1 appointment request' : `${bookingsPending} appointment requests`}</span></span>
                <span className="ledger-sub block">Pick a day and time to confirm them</span>
              </span>
              <Icon name="chevronDown" className="h-5 w-5 text-text-muted" />
            </a>
          </li>
        )}
      </ul>
    </section>
  )
}

/* ---------- appointment requests ---------- */

function timeChoices(): string[] {
  const out: string[] = []
  for (let h = 7; h <= 19; h++) for (const m of [0, 30]) out.push(`${String(h).padStart(2, '0')}:${m === 0 ? '00' : '30'}`)
  return out
}
const TIMES = timeChoices()
const fmtTime = (t: string): string => { const [h, m] = t.split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` }

function tomorrow(): string {
  const d = new Date(Date.now() + 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function BookingsPanel({ state, shopName, onChanged, onRetry }: { state: Load<BookingRow[]>; shopName: string; onChanged: () => void; onRetry: () => void }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [date, setDate] = useState(tomorrow())
  const [time, setTime] = useState('09:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ phone: string; text: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const decide = async (b: BookingRow, action: 'approve' | 'decline' | 'cancel') => {
    setBusy(true); setError('')
    const r = await api('/api/receptionist/bookings', { body: { id: b.id, action, date, time } })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setOpenId(null)
    if (action === 'approve') {
      setDone({ phone: b.phone || '', text: bookingConfirmation({ name: b.customer_name || '', shop: shopName, slotLabel: slotLabel(date, time) }) })
      setCopied(false)
    }
    onChanged()
  }

  const pending = useMemo(() => (state.status === 'ready' ? state.data.filter(b => b.status === 'pending') : []), [state])
  const booked = useMemo(() => (state.status === 'ready' ? state.data.filter(b => b.status === 'booked' || b.status === 'approved') : []), [state])

  return (
    <section id="as-bookings" aria-labelledby="as-bk" className="scroll-mt-20 space-y-3">
      <h2 id="as-bk" className="section-title">Appointments from the assistant</h2>
      {state.status === 'loading' && <RowsSkeleton rows={2} label="Loading appointment requests" />}
      {state.status === 'error' && <ErrorCard title="Appointments did not load" message={state.message} onRetry={onRetry} />}
      {state.status === 'unavailable' && <EmptyBlock icon="calendar" title="Appointments start soon">{UNAVAILABLE}</EmptyBlock>}
      {done && (
        <div role="status" className="rounded-lg border border-green/40 bg-green/[0.08] p-4">
          <p className="font-bold text-green">Added to your schedule</p>
          <p className="mt-1 text-[0.9375rem]">The customer has not been told yet. Here is a text you can send:</p>
          <p className="mt-2 rounded-md border border-border bg-bg-card p-3 text-[0.9375rem]">{done.text}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { void navigator.clipboard?.writeText(done.text).then(() => setCopied(true)).catch(() => setCopied(false)) }}>
              <Icon name="copy" className="h-4 w-4" />{copied ? 'Copied' : 'Copy text'}
            </button>
            {done.phone && <Link className="btn btn-primary btn-sm no-underline" href={`/messages?new=1&to=${encodeURIComponent(done.phone)}`}>Open the text box</Link>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDone(null)}>Close</button>
          </div>
        </div>
      )}
      {state.status === 'ready' && pending.length === 0 && booked.length === 0 && (
        <EmptyBlock icon="calendar" title="No appointment requests">When a customer asks the assistant for an appointment, it shows up here for you to confirm.</EmptyBlock>
      )}
      {error && <p role="alert" className="font-bold text-red">{error}</p>}
      {pending.length > 0 && (
        <ul className="space-y-3">
          {pending.map(b => (
            <li key={b.id} className="card !p-4">
              <p className="flex flex-wrap items-center gap-x-2 font-bold"><span className="lamp lamp-amber" aria-hidden="true" />{b.customer_name || 'New customer'}<span className="font-normal text-text-secondary">{b.phone ? phonePretty(b.phone) : ''}</span></p>
              <p className="mt-1 text-[0.9375rem]">{[b.vehicle, b.problem].filter(Boolean).join(' · ') || 'No details yet'}</p>
              <p className="text-[0.9375rem] text-text-secondary">Wants: {b.preferred_text || 'no time given'} · {b.channel === 'call' ? 'Call' : 'Text'} {sinceLabel(b.created_at)}</p>
              {openId === b.id ? (
                <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); void decide(b, 'approve') }}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block"><span className="form-label">Day</span><input type="date" className="form-input" value={date} onChange={e => setDate(e.target.value)} required /></label>
                    <label className="block"><span className="form-label">Time</span>
                      <select className="form-select" value={time} onChange={e => setTime(e.target.value)}>{TIMES.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}</select>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className="btn btn-primary" disabled={busy || !date}>{busy ? 'Saving...' : 'Put on the schedule'}</button>
                    <button type="button" className="btn btn-secondary" onClick={() => setOpenId(null)} disabled={busy}>Cancel</button>
                  </div>
                </form>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => { setOpenId(b.id); setError('') }}>Pick a time</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void decide(b, 'decline')} disabled={busy}>Decline</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {booked.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[0.9375rem] font-bold text-text-secondary">Booked</h3>
          <ul className="ledger">
            {booked.slice(0, 10).map(b => (
              <li key={b.id}>
                <div className="flex items-center">
                  <div className="ledger-row min-w-0 flex-1">
                    <span className="ledger-main">
                      <span className="flex items-center gap-2"><span className="lamp lamp-green" aria-hidden="true" /><span className="ledger-title">{b.customer_name || 'New customer'}</span></span>
                      <span className="ledger-sub block">{b.slot_date && b.slot_time ? slotLabel(b.slot_date, b.slot_time) : b.preferred_text || 'On the schedule'}{b.vehicle ? ` · ${b.vehicle}` : ''}</span>
                    </span>
                  </div>
                  <button type="button" className="btn btn-ghost btn-sm mr-2 shrink-0" onClick={() => void decide(b, 'cancel')} disabled={busy}>Cancel</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/* ---------- review ---------- */

type ReviewFilter = 'all' | 'calls' | 'texts' | 'needs' | 'booked' | 'unreviewed' | 'bad'

export function ReviewPanel({ state, onOpen, onRetry }: { state: Load<Interaction[]>; onOpen: (i: Interaction) => void; onRetry: () => void }) {
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const rows = useMemo(() => {
    if (state.status !== 'ready') return []
    return state.data.filter(i => {
      if (filter === 'calls') return i.channel === 'call'
      if (filter === 'texts') return i.channel === 'sms'
      if (filter === 'needs') return i.needs_person && !i.needs_resolved_at
      if (filter === 'booked') return i.outcome === 'booked' || i.outcome === 'booking_requested'
      if (filter === 'unreviewed') return !i.review && !['spam', 'silent', 'opt_out'].includes(i.outcome)
      if (filter === 'bad') return i.review === 'bad'
      return true
    })
  }, [state, filter])
  return (
    <section aria-labelledby="as-review" className="space-y-3">
      <h2 id="as-review" className="section-title">What it did</h2>
      <FilterChips<ReviewFilter> label="Filter conversations" value={filter} onChange={setFilter} scroll options={[
        { key: 'all', label: 'All' }, { key: 'calls', label: 'Calls' }, { key: 'texts', label: 'Texts' }, { key: 'needs', label: 'Needs a person' },
        { key: 'booked', label: 'Appointments' }, { key: 'unreviewed', label: 'Not checked' }, { key: 'bad', label: 'Needs work' },
      ]} />
      {state.status === 'loading' && <RowsSkeleton rows={4} label="Loading conversations" />}
      {state.status === 'error' && <ErrorCard title="Conversations did not load" message={state.message} onRetry={onRetry} />}
      {state.status === 'unavailable' && <EmptyBlock icon="sparkle" title="The log starts soon">{UNAVAILABLE}</EmptyBlock>}
      {state.status === 'ready' && rows.length === 0 && (
        <EmptyBlock icon="sparkle" title={state.data.length === 0 ? 'No conversations yet' : 'Nothing matches this filter'}>
          {state.data.length === 0 ? 'Every call and text the assistant handles is listed here, so you can check its work.' : 'Try a different filter.'}
        </EmptyBlock>
      )}
      {rows.length > 0 && (
        <ul className="ledger">
          {rows.map(i => {
            const needs = i.needs_person && !i.needs_resolved_at
            const who = i.contact_name || (i.contact_phone ? phonePretty(i.contact_phone) : 'Unknown')
            return (
              <li key={i.id}>
                <button type="button" className="ledger-row w-full text-left" onClick={() => onOpen(i)} aria-label={`${i.channel === 'call' ? 'Call' : 'Text'} with ${who}, ${needs ? 'needs a person' : outcomeLabel(i.outcome)}. Open`}>
                  <span className="ledger-main">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`lamp lamp-${outcomeLamp(i.outcome, needs)}`} aria-hidden="true" />
                      <span className="ledger-title">{who}</span>
                      {i.review === 'good' && <span className="tag tag-green shrink-0">Handled well</span>}
                      {i.review === 'bad' && <span className="tag tag-red shrink-0">Needs work</span>}
                    </span>
                    <span className="ledger-sub block">{needs ? 'Needs a person' : outcomeLabel(i.outcome)} · {i.channel === 'call' ? 'Call' : 'Text'} · {stamp(i.started_at)}</span>
                    {i.summary && <span className="ledger-sub line-clamp-2 block">{i.summary}</span>}
                  </span>
                  <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
