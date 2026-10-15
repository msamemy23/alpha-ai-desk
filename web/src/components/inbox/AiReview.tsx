'use client'
import { useCallback, useEffect, useState } from 'react'
import Icon from '@/components/Icon'
import { phonePretty } from '@/lib/today'
import { api } from './api'
import { firedLabels, outcomeLabel, outcomeLamp } from './ai-types'
import type { BookingRow, Interaction } from './ai-types'
import { clock, stamp } from './utils'

interface Detail {
  interaction: Interaction
  transcript: Array<{ speaker: string; text: string }>
  texts: Array<{ id: string; direction: string; body: string; created_at: string; ai_handled: boolean }>
  hasRecording: boolean
  bookings: BookingRow[]
}

const CAPTURED: Array<[keyof Interaction['captured'], string]> = [
  ['name', 'Name'], ['callback', 'Call back at'], ['vehicle', 'Vehicle'], ['problem', 'What they need'], ['preferred', 'Wanted'],
]

/**
 * One conversation the assistant had, for the person who is checking its work: what happened, what it wrote down,
 * what it said, which of the shop's rules it used, the recording, and a way to mark it good or not.
 */
export default function AiReview({ interactionId, onChanged, showRecording = true }: { interactionId: string; onChanged?: () => void; showRecording?: boolean }) {
  const [state, setState] = useState<{ status: 'loading' | 'error' | 'ready'; detail?: Detail; error?: string }>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState('')

  const load = useCallback(async () => {
    const r = await api<Detail>(`/api/receptionist/activity/${encodeURIComponent(interactionId)}`)
    if (!r.ok || !r.data) { setState({ status: 'error', error: r.error }); return }
    setNote(r.data.interaction.review_note || '')
    setState({ status: 'ready', detail: r.data })
  }, [interactionId])

  useEffect(() => { setState({ status: 'loading' }); void load() }, [load])

  const act = async (body: Record<string, unknown>) => {
    setBusy(true); setProblem('')
    const r = await api(`/api/receptionist/activity/${encodeURIComponent(interactionId)}`, { method: 'PATCH', body })
    setBusy(false)
    if (!r.ok) { setProblem(r.error); return }
    await load()
    onChanged?.()
  }

  if (state.status === 'loading') return <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading the assistant's notes"><div className="skeleton h-16" /><div className="skeleton h-28" /></div>
  if (state.status === 'error' || !state.detail) {
    return (
      <div role="alert" className="rounded-lg border border-red/40 bg-red/[0.08] p-4">
        <p className="font-bold text-red">The assistant&rsquo;s notes did not load</p>
        <p className="mt-1 text-text-secondary">{state.error || 'Check your connection and try again.'}</p>
        <button type="button" className="btn btn-secondary mt-3" onClick={() => { setState({ status: 'loading' }); void load() }}>Try again</button>
      </div>
    )
  }

  const { interaction: it, transcript, texts, hasRecording, bookings } = state.detail
  const needs = it.needs_person && !it.needs_resolved_at
  const lamp = outcomeLamp(it.outcome, needs)
  const captured = CAPTURED.filter(([k]) => it.captured?.[k])
  const fired = firedLabels(it.rules_fired)
  const who = it.contact_name || (it.contact_phone ? phonePretty(it.contact_phone) : 'Unknown caller')

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2 font-bold"><span className={`lamp lamp-${lamp}`} aria-hidden="true" />{needs ? 'Needs a person' : outcomeLabel(it.outcome)}</span>
        <span className="text-text-secondary">{it.channel === 'call' ? 'Phone call' : 'Text conversation'} with {who}</span>
        <span className="text-text-secondary">{stamp(it.started_at)}</span>
      </div>

      {needs && (
        <div className="rounded-lg border border-red/40 bg-red/[0.08] p-4">
          <p className="font-bold text-red">Waiting for you{it.needs_reason ? `: ${it.needs_reason}` : ''}</p>
          <p className="mt-1 text-[0.9375rem]">The assistant stopped replying to this customer. Call or text them, then mark it handled.</p>
          <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={() => act({ action: 'resolve' })} disabled={busy}>Mark handled</button>
        </div>
      )}

      {it.summary && (
        <section aria-labelledby={`ar-sum-${it.id}`} className="space-y-2">
          <h3 id={`ar-sum-${it.id}`} className="section-title">What happened</h3>
          <p className="rounded-lg border border-border bg-bg-base p-4 text-[0.9375rem] leading-relaxed">{it.summary}</p>
        </section>
      )}

      {captured.length > 0 && (
        <section aria-labelledby={`ar-cap-${it.id}`} className="space-y-2">
          <h3 id={`ar-cap-${it.id}`} className="section-title">What the assistant wrote down</h3>
          <dl className="rounded-lg border border-border bg-bg-base px-4">
            {captured.map(([k, label]) => (
              <div key={k} className="flex gap-3 border-b border-border py-2.5 last:border-b-0">
                <dt className="w-28 shrink-0 text-[0.9375rem] text-text-secondary">{label}</dt>
                <dd className="min-w-0 flex-1 break-words">{k === 'callback' ? phonePretty(String(it.captured[k])) : String(it.captured[k])}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {bookings.length > 0 && (
        <section aria-labelledby={`ar-bk-${it.id}`} className="space-y-2">
          <h3 id={`ar-bk-${it.id}`} className="section-title">Booking</h3>
          <ul className="space-y-2">
            {bookings.map(b => (
              <li key={b.id} className="rounded-lg border border-border bg-bg-base p-3 text-[0.9375rem]">
                <span className="font-bold">{b.status === 'booked' ? 'On the schedule' : b.status === 'declined' ? 'Declined' : b.status === 'cancelled' ? 'Cancelled' : b.status === 'approved' ? 'Approved' : 'Waiting for you to confirm'}</span>
                <span className="text-text-secondary"> · {b.slot_date ? `${b.slot_date}${b.slot_time ? ` at ${b.slot_time}` : ''}` : b.preferred_text || 'No time picked yet'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fired.length > 0 && (
        <section aria-labelledby={`ar-rul-${it.id}`} className="space-y-2">
          <h3 id={`ar-rul-${it.id}`} className="section-title">Rules it used</h3>
          <ul className="flex flex-wrap gap-2">{fired.map(f => <li key={f} className="rounded-full border border-border bg-bg-card px-3 py-1 text-[0.875rem] font-bold text-text-secondary">{f}</li>)}</ul>
        </section>
      )}

      {showRecording && hasRecording && it.channel === 'call' && (
        <section aria-labelledby={`ar-rec-${it.id}`} className="space-y-2">
          <h3 id={`ar-rec-${it.id}`} className="section-title">Recording</h3>
          <audio controls preload="none" src={`/api/recording-proxy?callId=${encodeURIComponent(it.ref_id)}`} className="w-full" aria-label="Call recording" />
        </section>
      )}

      <section aria-labelledby={`ar-tx-${it.id}`} className="space-y-2">
        <h3 id={`ar-tx-${it.id}`} className="section-title">{it.channel === 'call' ? 'What was said' : 'The texts'}</h3>
        {it.channel === 'call' ? (
          transcript.length > 0 ? (
            <ol className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border bg-bg-base p-4 text-[0.9375rem] leading-snug">
              {transcript.map((t, i) => (
                <li key={i}><span className="font-bold">{t.speaker === 'ai' ? 'Assistant' : 'Caller'}:</span> {t.text}</li>
              ))}
            </ol>
          ) : <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">There is no transcript for this call.</p>
        ) : (
          texts.length > 0 ? (
            <ol className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border bg-bg-base p-4 text-[0.9375rem] leading-snug">
              {texts.map(m => (
                <li key={m.id}><span className="font-bold">{m.direction === 'inbound' ? 'Customer' : m.ai_handled ? 'Assistant' : 'Your team'}</span> <span className="text-text-secondary">{clock(m.created_at)}</span><br />{m.body || 'Picture or video'}</li>
              ))}
            </ol>
          ) : <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">No texts were found for this conversation.</p>
        )}
      </section>

      <section aria-labelledby={`ar-rev-${it.id}`} className="space-y-2">
        <h3 id={`ar-rev-${it.id}`} className="section-title">Was this handled well?</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`btn ${it.review === 'good' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={it.review === 'good'} disabled={busy} onClick={() => act({ action: 'review', value: it.review === 'good' ? null : 'good' })}>
            <Icon name="thumbsUp" className="h-5 w-5" />Handled well
          </button>
          <button type="button" className={`btn ${it.review === 'bad' ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={it.review === 'bad'} disabled={busy} onClick={() => act({ action: 'review', value: it.review === 'bad' ? null : 'bad', note })}>
            <Icon name="flag" className="h-5 w-5" />Needs work
          </button>
        </div>
        {it.review === 'bad' && (
          <label className="block">
            <span className="form-label">What went wrong? (only your team sees this)</span>
            <textarea className="form-textarea" rows={3} value={note} maxLength={500} onChange={e => setNote(e.target.value)} onBlur={() => { if (note !== (it.review_note || '')) void act({ action: 'review', value: 'bad', note }) }} />
          </label>
        )}
        {problem && <p role="alert" className="font-bold text-red">{problem}</p>}
        <p className="text-[0.8125rem] text-text-secondary">Your marks help you spot what to change in the assistant&rsquo;s rules. They do not change anything on their own.</p>
      </section>
    </div>
  )
}
