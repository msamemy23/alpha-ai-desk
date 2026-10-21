'use client'
import { ErrorCard, EmptyBlock } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { cannotKeepCadence, checkedWords, dayLabel, plural, whenWords } from './model'
import type { Card, Upcoming } from './model'

interface Props {
  state: 'loading' | 'ready' | 'error'
  error: string
  upcoming: Upcoming | null
  cards: Card[]
  timezone: string
  /** Minutes between the checks Alpha really makes. */
  checkEvery: number
  onRetry: () => void
}

/** The next 30 days: what is waiting to go out, when each automation next checks, and who is coming due. */
export default function UpcomingPanel({ state, error, upcoming, cards, timezone, checkEvery, onRetry }: Props) {
  const name = (id: string) => cards.find(c => c.id === id)?.name || id
  // A schedule closer together than Alpha checks cannot be kept, so no time is promised for it.
  const checkedAt = (id: string, at: string) => { const c = cards.find(x => x.id === id); return c && cannotKeepCadence(c.schedule, checkEvery) ? `Checked ${checkedWords(checkEvery)}` : whenWords(at, timezone) }
  if (state === 'loading' && !upcoming) return <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading what is coming up"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>
  if (state === 'error' && !upcoming) return <ErrorCard title="What is coming up did not load" message={error || 'Check your connection and try again.'} onRetry={onRetry} />
  if (!upcoming) return null
  const nothing = upcoming.waiting_total === 0 && upcoming.next_runs.length === 0 && upcoming.appointments_to_remind === 0 && upcoming.service_due_soon.length === 0
  return (
    <div className="space-y-8">
      {state === 'error' && <Notice kind="error">This could not be refreshed. {error}</Notice>}
      {!upcoming.available && <Notice kind="info">The queue needs a database update before waiting messages can be listed. Ask your developer to apply it.</Notice>}
      {nothing && <EmptyBlock icon="calendar" title="Nothing is lined up">Switch an automation on and what it plans to send in the next 30 days will show here.</EmptyBlock>}

      {upcoming.next_runs.length > 0 && (
        <section aria-labelledby="up-runs">
          <h2 id="up-runs" className="section-title mb-2">Next checks</h2>
          <ul className="ledger">
            {upcoming.next_runs.map(r => (
              <li key={r.automation_id}><div className="ledger-row"><span className="ledger-main"><span className="ledger-title block">{r.name}</span></span><span className="shrink-0 text-[0.9375rem] text-text-secondary">{checkedAt(r.automation_id, r.at)}</span></div></li>
            ))}
          </ul>
        </section>
      )}

      {upcoming.waiting_by_day.length > 0 && (
        <section aria-labelledby="up-wait">
          <h2 id="up-wait" className="section-title mb-1">Waiting to go out</h2>
          <p className="mb-2 text-[0.9375rem] text-text-secondary">{plural(upcoming.waiting_total, 'message')} lined up. Pausing an automation cancels what it has waiting.</p>
          <ul className="ledger">
            {upcoming.waiting_by_day.map(d => (
              <li key={d.date}>
                <div className="ledger-row">
                  <span className="ledger-main">
                    <span className="ledger-title block">{dayLabel(d.date, timezone)}</span>
                    <span className="ledger-sub !whitespace-normal block">{Object.entries(d.by).map(([id, n]) => `${name(id)}: ${n}`).join(' · ')}</span>
                  </span>
                  <span className="ledger-amt shrink-0">{d.count.toLocaleString('en-US')}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(upcoming.appointments_to_remind > 0 || upcoming.service_due_soon.length > 0) && (
        <section aria-labelledby="up-due">
          <h2 id="up-due" className="section-title mb-2">Coming due</h2>
          {upcoming.appointments_to_remind > 0 && <p className="mb-2 text-[0.9375rem]">{plural(upcoming.appointments_to_remind, 'appointment')} in the next 30 days will each get a reminder.</p>}
          {upcoming.service_due_soon.length > 0 && (
            <>
              <p className="mb-2 text-[0.9375rem] text-text-secondary">Vehicles that reach their service interval in the next 30 days:</p>
              <ul className="ledger">
                {upcoming.service_due_soon.map((s, i) => (
                  <li key={`${s.name}-${i}`}><div className="ledger-row"><span className="ledger-main"><span className="ledger-title block">{s.name}{s.vehicle ? `, ${s.vehicle}` : ''}</span><span className="ledger-sub !whitespace-normal block">{s.why}</span></span></div></li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  )
}
