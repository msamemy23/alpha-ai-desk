'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { phonePretty } from '@/lib/today'
import { CALL_KIND_LABEL, CALL_KIND_LAMP, CALL_KIND_TEXT, callKind, callTimeIn, formatDuration, formatTalkTime, mayMissCalls, monthBounds, otherNumber, recordingUrl, stamp } from './utils'
import type { CallKind, CallRecord } from './utils'
import { outcomeLabel } from './ai-types'
import type { Interaction } from './ai-types'

type Filter = 'all' | 'ai' | CallKind

export function LeadTag({ score }: { score: string | null }) {
  if (!score || score === 'unknown') return null
  const tone = score === 'hot' ? 'tag-red' : score === 'warm' ? 'tag-amber' : 'tag-gray'
  return <span className={`tag ${tone} shrink-0`}>{score.charAt(0).toUpperCase() + score.slice(1)} lead</span>
}

const PAGE = 50

/** Calls as ledger rows: who, how it went (lamp and word), how long, when, with play and call back one tap away. */
export default function CallsView({ calls, nameFor, playingId, onOpen, onPlay, onCallBack, ai, onSeen }: {
  calls: CallRecord[]
  nameFor: (c: CallRecord) => string
  playingId: string | null
  onOpen: (c: CallRecord) => void
  onPlay: (c: CallRecord) => void
  onCallBack: (c: CallRecord) => void
  /** What the assistant recorded for each AI-answered call, keyed by the call's id in this list. */
  ai?: Map<string, Interaction>
  /** Marks AI-answered calls as read (their ids in the assistant's own records). */
  onSeen?: (interactionIds: string[]) => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const rows = useMemo(() => calls.map(c => {
    const kind = callKind(c.direction, c.status, c.duration_secs, c.viaAi)
    const number = otherNumber(c)
    const name = nameFor(c)
    return { c, kind, number, name, title: name || phonePretty(number) || 'Unknown number' }
  }), [calls, nameFor])

  const counts = useMemo(() => {
    const m: Record<Filter, number> = { all: rows.length, ai: 0, missed: 0, incoming: 0, outgoing: 0 }
    rows.forEach(r => { m[r.kind] += 1; if (r.c.viaAi) m.ai += 1 })
    return m
  }, [rows])

  const unseen = useMemo(() => rows.filter(r => r.c.viaAi && ai?.get(r.c.id) && !ai.get(r.c.id)?.seen_at).map(r => ai!.get(r.c.id)!.id), [rows, ai])

  /** Phone time this month and last, from the call records already loaded. */
  const talk = useMemo(() => {
    const b = monthBounds(new Date())
    return {
      thisMonth: callTimeIn(calls, b.start, b.next),
      lastMonth: callTimeIn(calls, b.prev, b.start),
      partial: mayMissCalls(calls, b.start),
      prevName: b.prev.toLocaleDateString('en-US', { month: 'long' }),
    }
  }, [calls])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qd = q.replace(/\D/g, '')
    return rows.filter(r => {
      if (filter === 'ai' ? !r.c.viaAi : filter !== 'all' && r.kind !== filter) return false
      if (!q) return true
      return r.title.toLowerCase().includes(q)
        || (qd.length >= 3 && r.number.replace(/\D/g, '').includes(qd))
        || String(r.c.service_needed || '').toLowerCase().includes(q)
        || String(r.c.lead_score || '').toLowerCase().includes(q)
    })
  }, [rows, filter, search])

  const now = new Date()
  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'ai', label: 'AI answered' }, { key: 'missed', label: 'Missed' }, { key: 'incoming', label: 'Incoming' }, { key: 'outgoing', label: 'Outgoing' },
  ].filter(f => f.key !== 'ai' || counts.ai > 0 || filter === 'ai') as { key: Filter; label: string }[]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 pb-3">
        {calls.length > 0 && (
          <section aria-label="Phone time this month" className="rounded-lg border border-border bg-bg-card px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <h2 className="text-[0.9375rem] font-bold text-text-secondary">Phone time this month</h2>
              <span className="display num text-[1.5rem] font-bold leading-none">{talk.partial ? 'At least ' : ''}{formatTalkTime(talk.thisMonth.seconds)}</span>
            </div>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">
              {talk.thisMonth.calls === 0
                ? 'No calls yet this month.'
                : `${talk.thisMonth.calls} ${talk.thisMonth.calls === 1 ? 'call' : 'calls'}: ${talk.thisMonth.incoming} incoming, ${talk.thisMonth.outgoing} outgoing, ${talk.thisMonth.missed} missed.`}
              {talk.lastMonth.calls > 0 ? ` ${talk.prevName}: ${formatTalkTime(talk.lastMonth.seconds)} in ${talk.lastMonth.calls} ${talk.lastMonth.calls === 1 ? 'call' : 'calls'}.` : ''}
            </p>
            {talk.thisMonth.unmeasuredAi > 0 && (
              <p className="mt-1 text-[0.8125rem] text-text-secondary">
                {talk.thisMonth.unmeasuredAi} {talk.thisMonth.unmeasuredAi === 1 ? 'call' : 'calls'} the assistant handled {talk.thisMonth.unmeasuredAi === 1 ? 'has' : 'have'} no length on record, so {talk.thisMonth.unmeasuredAi === 1 ? 'it is' : 'they are'} not counted in the time.
              </p>
            )}
            <p className="mt-1 text-[0.8125rem] text-text-secondary">
              Call time recorded here, not a bill. Your phone company's bill has the cost.{talk.partial ? ' Only the most recent calls are loaded, so older calls this month may be missing.' : ''}
            </p>
          </section>
        )}
        <label className="relative block">
          <span className="sr-only">Search calls by name, number or service</span>
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
          <input type="search" inputMode="search" autoComplete="off" className="form-input pl-10" placeholder="Search name, number or service" value={search} onChange={e => { setSearch(e.target.value); setLimit(PAGE) }} />
        </label>
        <div role="group" aria-label="Filter calls" className="flex flex-wrap gap-2">
          {filters.map(f => {
            const on = filter === f.key
            return (
              <button
                key={f.key} type="button" aria-pressed={on} onClick={() => { setFilter(f.key); setLimit(PAGE) }}
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-[0.9375rem] font-bold transition-colors sm:min-h-[40px] ${on ? 'border-blue bg-blue/10 text-blue' : 'border-line bg-bg-card text-text-primary hover:bg-bg-hover'}`}
              >
                {f.key !== 'all' && f.key !== 'ai' && <span className={`lamp ${CALL_KIND_LAMP[f.key]}`} aria-hidden="true" style={{ boxShadow: 'none' }} />}
                {f.label}
                <span className="num font-normal opacity-80">{counts[f.key]}</span>
              </button>
            )
          })}
        </div>
        {unseen.length > 0 && onSeen && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-card px-4 py-2">
            <span className="flex items-center gap-2 text-[0.9375rem]"><span className="lamp lamp-blue" aria-hidden="true" /><span className="font-bold">{unseen.length === 1 ? '1 AI-answered call' : `${unseen.length} AI-answered calls`}</span> not looked at yet</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSeen(unseen)}>Mark all as read</button>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="empty-state">
          <p className="font-bold text-text-primary">{search.trim() ? <>No calls match &ldquo;{search.trim()}&rdquo;</> : filter === 'all' ? 'No calls yet' : filter === 'ai' ? 'No calls answered by the assistant' : `No ${filter} calls`}</p>
          <p className="mt-1">{calls.length === 0 ? 'Calls to and from your shop number show up here, with recordings and transcripts when you have them.' : 'Try fewer letters or a different filter.'}</p>
          {calls.length > 0 && <button className="btn btn-secondary mt-4" onClick={() => { setSearch(''); setFilter('all') }}>Show all calls</button>}
        </div>
      ) : (
        <div className="min-h-0 flex-1 lg:overflow-y-auto">
          <div className="hidden grid-cols-[8rem_minmax(0,1fr)_5rem_11rem] gap-4 border-t border-border px-3 pb-2 pt-3 pr-[6rem] text-[0.8125rem] font-bold text-text-secondary md:grid" aria-hidden="true">
            <span>Call</span><span>Who</span><span>Length</span><span>When</span>
          </div>
          <ul className="ledger">
            {shown.slice(0, limit).map(({ c, kind, number, name, title }) => {
              const rec = recordingUrl(c)
              const playing = playingId === c.id
              const hasText = !!c.transcript && c.transcript !== '[transcription_failed]'
              const when = stamp(c.start_time, now)
              const rec2 = c.viaAi ? ai?.get(c.id) : undefined
              const isNew = !!rec2 && !rec2.seen_at
              const result = rec2 ? (rec2.needs_person && !rec2.needs_resolved_at ? 'Needs a person' : outcomeLabel(rec2.outcome)) : ''
              const extra = [kind === 'missed' ? '' : formatDuration(c.duration_secs), c.service_needed && c.service_needed !== 'unknown' ? c.service_needed : '', hasText ? 'Transcript' : ''].filter(Boolean)
              return (
                <li key={c.id}>
                  <div className="flex items-center">
                    <button type="button" className="ledger-row min-w-0 flex-1" onClick={() => onOpen(c)} aria-label={`${CALL_KIND_LABEL[kind]} call, ${title}, ${when}. Open details`}>
                      {/* Phone layout */}
                      <span className="ledger-main md:hidden">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="ledger-title">{title}</span>
                          <LeadTag score={c.lead_score} />
                        </span>
                        <span className="ledger-sub flex items-center gap-1.5">
                          <span className={`lamp ${CALL_KIND_LAMP[kind]}`} aria-hidden="true" />
                          <span className={`font-bold ${CALL_KIND_TEXT[kind]}`}>{CALL_KIND_LABEL[kind]}</span>
                          <span>· {when}</span>
                          {isNew && <span className="font-bold text-blue">· Unread</span>}
                        </span>
                        {c.viaAi && <span className="ledger-sub block">AI assistant{result ? ` · ${result}` : ''}</span>}
                        {extra.length > 0 && <span className="ledger-sub block">{extra.join(' · ')}</span>}
                      </span>
                      {/* Wide layout */}
                      <span className="hidden min-w-0 flex-1 grid-cols-[8rem_minmax(0,1fr)_5rem_11rem] items-center gap-4 md:grid">
                        <span className="flex items-center gap-2 font-bold">
                          <span className={`lamp ${CALL_KIND_LAMP[kind]}`} aria-hidden="true" />
                          <span className={CALL_KIND_TEXT[kind]}>{CALL_KIND_LABEL[kind]}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="ledger-title">{title}</span>
                            <LeadTag score={c.lead_score} />
                            {c.viaAi && <span className="tag tag-gray shrink-0">AI assistant</span>}
                            {result && <span className={`tag shrink-0 ${rec2?.needs_person && !rec2.needs_resolved_at ? 'tag-red' : 'tag-gray'}`}>{result}</span>}
                            {isNew && <span className="tag tag-amber shrink-0">Unread</span>}
                          </span>
                          <span className="ledger-sub block">
                            {[name ? phonePretty(number) : '', c.service_needed && c.service_needed !== 'unknown' ? c.service_needed : '', hasText ? 'Transcript saved' : ''].filter(Boolean).join(' · ') || ' '}
                          </span>
                        </span>
                        <span className="num">{kind === 'missed' ? '–' : formatDuration(c.duration_secs)}</span>
                        <span className="text-[0.9375rem] text-text-secondary">{when}</span>
                      </span>
                    </button>
                    {rec && (
                      <button type="button" className="btn-icon shrink-0" onClick={() => onPlay(c)} aria-pressed={playing} aria-label={`${playing ? 'Pause' : 'Play'} recording, ${title}`} title={playing ? 'Pause recording' : 'Play recording'}>
                        <Icon name={playing ? 'pause' : 'play'} className="h-5 w-5" />
                      </button>
                    )}
                    {!rec && <span className="hidden h-10 w-10 shrink-0 md:block" aria-hidden="true" />}
                    {number ? (
                      <button type="button" className="btn-icon mr-1 shrink-0 text-blue hover:text-blue" onClick={() => onCallBack(c)} aria-label={`${kind === 'outgoing' ? 'Call' : 'Call back'} ${title}`} title={kind === 'outgoing' ? 'Call' : 'Call back'}>
                        <Icon name="phone" className="h-5 w-5" />
                      </button>
                    ) : <span className="mr-1 h-11 w-11 shrink-0 sm:h-10 sm:w-10" aria-hidden="true" />}
                  </div>
                </li>
              )
            })}
          </ul>
          {shown.length > limit && (
            <div className="py-4 text-center">
              <button type="button" className="btn btn-secondary" onClick={() => setLimit(l => l + PAGE)}>Show {Math.min(PAGE, shown.length - limit)} more</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
