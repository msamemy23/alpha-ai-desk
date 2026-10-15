'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { phonePretty } from '@/lib/today'
import { CALL_KIND_LABEL, CALL_KIND_LAMP, CALL_KIND_TEXT, callKind, formatDuration, otherNumber, recordingUrl, stamp } from './utils'
import type { CallKind, CallRecord } from './utils'

type Filter = 'all' | CallKind

export function LeadTag({ score }: { score: string | null }) {
  if (!score || score === 'unknown') return null
  const tone = score === 'hot' ? 'tag-red' : score === 'warm' ? 'tag-amber' : 'tag-gray'
  return <span className={`tag ${tone} shrink-0`}>{score.charAt(0).toUpperCase() + score.slice(1)} lead</span>
}

const PAGE = 50

/** Calls as ledger rows: who, how it went (lamp and word), how long, when, with play and call back one tap away. */
export default function CallsView({ calls, nameFor, playingId, onOpen, onPlay, onCallBack }: {
  calls: CallRecord[]
  nameFor: (c: CallRecord) => string
  playingId: string | null
  onOpen: (c: CallRecord) => void
  onPlay: (c: CallRecord) => void
  onCallBack: (c: CallRecord) => void
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
    const m: Record<Filter, number> = { all: rows.length, missed: 0, incoming: 0, outgoing: 0 }
    rows.forEach(r => { m[r.kind] += 1 })
    return m
  }, [rows])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const qd = q.replace(/\D/g, '')
    return rows.filter(r => {
      if (filter !== 'all' && r.kind !== filter) return false
      if (!q) return true
      return r.title.toLowerCase().includes(q)
        || (qd.length >= 3 && r.number.replace(/\D/g, '').includes(qd))
        || String(r.c.service_needed || '').toLowerCase().includes(q)
        || String(r.c.lead_score || '').toLowerCase().includes(q)
    })
  }, [rows, filter, search])

  const now = new Date()
  const filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'missed', label: 'Missed' }, { key: 'incoming', label: 'Incoming' }, { key: 'outgoing', label: 'Outgoing' },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 pb-3">
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
                {f.key !== 'all' && <span className={`lamp ${CALL_KIND_LAMP[f.key]}`} aria-hidden="true" style={{ boxShadow: 'none' }} />}
                {f.label}
                <span className="num font-normal opacity-80">{counts[f.key]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty-state">
          <p className="font-bold text-text-primary">{search.trim() ? <>No calls match &ldquo;{search.trim()}&rdquo;</> : filter === 'all' ? 'No calls yet' : `No ${filter} calls`}</p>
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
                        </span>
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
