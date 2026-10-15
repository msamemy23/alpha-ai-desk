'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { call, load } from '@/components/automations/api'
import { agoWords, messageStatus, money, outcomeParts, plural, whenWords } from '@/components/automations/model'
import type { HistoryRow, Outcome } from '@/components/automations/model'
import { PROMOTION_STATUS, countsLine } from './promotions-model'
import type { PromotionShop, PromotionView } from './promotions-model'

interface Props {
  promotion: PromotionView
  shop: PromotionShop
  outcome: Outcome | undefined
  deliveryTracking: boolean
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
  onCopy: (p: PromotionView) => void
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

/** A promotion that has gone out (or is going out): what it said, who it reached, what happened to each message, and what it brought in. */
export default function PromotionDetail({ promotion: p, shop, outcome, deliveryTracking, canEdit, onClose, onChanged, onCopy, notify }: Props) {
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [available, setAvailable] = useState(true)
  const [more, setMore] = useState(false)
  const [working, setWorking] = useState<'' | 'stop' | 'continue'>('')
  const [confirmStop, setConfirmStop] = useState(false)
  const [actionError, setActionError] = useState('')
  const busy = useRef(false)

  const status = PROMOTION_STATUS[p.status]
  const c = p.counts
  const canStop = canEdit && p.waiting > 0 && (p.status === 'scheduled' || p.status === 'sending')

  const loadRows = useCallback(async () => {
    const r = await load(`/api/automations/history?campaign=${encodeURIComponent(p.id)}&limit=50`, d => ({
      rows: (Array.isArray(d.messages) ? d.messages : []) as HistoryRow[], next: typeof d.next === 'string' && d.next ? d.next : null, available: d.available !== false,
    }))
    if (r.ok) { setRows(r.value.rows); setNext(r.value.next); setAvailable(r.value.available); setState('ready'); setError('') } else { setError(r.error); setState('error') }
  }, [p.id])
  useEffect(() => { void loadRows() }, [loadRows])

  const loadMore = async () => {
    if (!next || more) return
    setMore(true)
    const r = await load(`/api/automations/history?campaign=${encodeURIComponent(p.id)}&limit=50&before=${encodeURIComponent(next)}`, d => ({
      rows: (Array.isArray(d.messages) ? d.messages : []) as HistoryRow[], next: typeof d.next === 'string' && d.next ? d.next : null,
    }))
    if (r.ok) { setRows(prev => [...prev, ...r.value.rows.filter(x => !prev.some(y => y.id === x.id))]); setNext(r.value.next) } else setActionError(r.error)
    setMore(false)
  }

  const act = async (what: 'stop' | 'continue') => {
    if (busy.current) return
    busy.current = true; setWorking(what); setActionError('')
    try {
      const r = await call('/api/growth/promotions', { action: what, id: p.id })
      if (!r.ok) { setActionError(r.error); setConfirmStop(false); return }
      notify(what === 'stop'
        ? `Stopped. ${plural(Number(r.data.cancelled) || 0, 'message')} cancelled. ${plural(Number(r.data.already_sent) || 0, 'message')} had already gone out.`
        : `${Number(r.data.sent) || 0} more sent, ${Number(r.data.waiting) || 0} still waiting.`, 'success')
      onChanged(); void loadRows(); setConfirmStop(false)
    } finally { busy.current = false; setWorking('') }
  }

  return (
    <Sheet open onClose={() => { if (!working) onClose() }} title={p.name} wide>
      <div className="space-y-5 text-[0.9375rem]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-2 font-bold"><span className={`lamp lamp-${status.lamp}`} aria-hidden="true" />{status.word}</span>
          <span className="text-text-secondary">
            {p.status === 'scheduled' && p.send_at ? `Goes out ${whenWords(p.send_at, shop.timezone)}` : p.sent_at ? `Sent ${agoWords(p.sent_at)}` : `Made ${agoWords(p.created_at)}`}
          </span>
        </div>
        <p className="text-text-secondary">For {p.audience_text || 'all customers'}.</p>

        <section aria-label="What it said">
          <h3 className="section-title mb-2">What it said</h3>
          <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-bg-hover px-3 py-2.5">{p.message}</p>
          <p className="form-hint">Words in curly brackets, such as {'{name}'}, are filled in for each person. An opt-out line is added at the end.</p>
        </section>

        <section aria-label="What happened">
          <h3 className="section-title mb-2">What happened</h3>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
            <Big label="Sent" value={c.sent} />
            <Big label="Waiting" value={p.waiting} />
            <Big label="Did not send" value={c.failed + c.unknown} />
            <Big label="Left out" value={c.skipped} />
          </div>
          <p className="mt-2 text-text-secondary">{countsLine(p)}</p>
          {outcome && outcome.sent > 0 ? (
            <p className="mt-2">
              <span className="font-bold">What it brought in: </span>
              {outcomeParts(outcome, { delivery: deliveryTracking, revenue: true, paid: false }).join(' · ')}
              {outcome.revenue > 0 ? <> · <span className="num font-bold">{money(outcome.revenue)}</span> paid afterwards</> : null}
            </p>
          ) : (
            <p className="mt-2 text-text-secondary">Replies, bookings and payments show here after customers act on it.</p>
          )}
        </section>

        {actionError && <Notice kind="error">{actionError}</Notice>}

        <section aria-label="Every message">
          <h3 className="section-title mb-2">Every message</h3>
          {state === 'loading' ? (
            <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading the messages">{[0, 1, 2].map(i => <div key={i} className="skeleton h-14" />)}</div>
          ) : state === 'error' ? (
            <Notice kind="error">
              <p className="font-bold">The messages did not load.</p>
              <p>{error}</p>
              <button type="button" className="btn btn-secondary mt-2" onClick={() => { setState('loading'); void loadRows() }}>Try again</button>
            </Notice>
          ) : !available ? (
            <Notice kind="info">The message history needs a database update before it can be shown. Ask your developer to apply it.</Notice>
          ) : rows.length === 0 ? (
            <p className="text-text-secondary">No messages are on record for this promotion.</p>
          ) : (
            <>
              <ul className="ledger" aria-label="Messages in this promotion">
                {rows.map(m => {
                  const s = messageStatus(m)
                  return (
                    <li key={m.id}>
                      <div className="ledger-row !items-start">
                        <span className={`lamp lamp-${s.lamp} mt-1.5`} aria-hidden="true" />
                        <span className="ledger-main">
                          <span className="ledger-title block">{m.name || 'Customer'}</span>
                          <span className="ledger-sub block">{m.to}{m.channel === 'email' ? ' · Email' : ''}</span>
                          <span className="ledger-sub !whitespace-normal block">{s.word}{m.reason ? `: ${m.reason}` : ''}{m.error && m.status !== 'sent' ? `: ${m.error}` : ''}{m.sent_at ? ` · ${agoWords(m.sent_at)}` : m.send_after && m.status === 'queued' ? ` · ${whenWords(m.send_after, shop.timezone)}` : ''}</span>
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {next && <button type="button" className="btn btn-secondary mt-3" onClick={() => void loadMore()} disabled={more}>{more ? 'Loading…' : 'Show more'}</button>}
            </>
          )}
        </section>

        {confirmStop ? (
          <div className="rounded-md border border-border bg-bg-hover p-3" role="alertdialog" aria-label="Confirm stopping">
            <p className="font-bold">Stop sending to {plural(p.waiting, 'person', 'people')}?</p>
            <p className="mt-1 text-text-secondary">Messages that already went out cannot be taken back. The ones still waiting are cancelled, and this promotion cannot be started again.</p>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirmStop(false)} disabled={working === 'stop'}>Keep sending</button>
              <button type="button" className="btn btn-danger" onClick={() => void act('stop')} disabled={working === 'stop'} aria-busy={working === 'stop'}>{working === 'stop' ? 'Stopping…' : 'Yes, stop'}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={working !== ''}>Close</button>
            {canEdit && <button type="button" className="btn btn-secondary" onClick={() => onCopy(p)}><Icon name="copy" className="h-5 w-5" />Use as a new promotion</button>}
            {canStop && p.status === 'sending' && <button type="button" className="btn btn-secondary" onClick={() => void act('continue')} disabled={working !== ''} aria-busy={working === 'continue'}><Icon name="refresh" className="h-5 w-5" />{working === 'continue' ? 'Sending…' : 'Send what is due'}</button>}
            {canStop && <button type="button" className="btn btn-secondary" onClick={() => setConfirmStop(true)} disabled={working !== ''}>Stop sending</button>}
          </div>
        )}
      </div>
    </Sheet>
  )
}

function Big({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-bg-card px-3 py-3">
      <p className="text-[0.8125rem] font-bold text-text-secondary">{label}</p>
      <p className="display num mt-0.5 text-[1.5rem] leading-none">{value.toLocaleString('en-US')}</p>
    </div>
  )
}
