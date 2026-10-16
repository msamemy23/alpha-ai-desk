'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { fetchJson, asText } from './http'
import { fmtDayTime } from './types'

type CallState = 'calling' | 'live' | 'ended' | 'unknown'

interface AlphaCall {
  id: string
  state: CallState
  label: string
  startedAt: string
  summary: string
  askedNotToCall: boolean
  lines: Array<{ speaker: string; text: string }>
}

const LAMP: Record<CallState, string> = { calling: 'lamp-amber', live: 'lamp-green', ended: 'lamp-off', unknown: 'lamp-off' }
const FALLBACK_LABEL: Record<CallState, string> = { calling: 'Calling now', live: 'On the call', ended: 'Call ended', unknown: 'Checking' }
const SHOWN = 5

function readCalls(d: Record<string, unknown>): AlphaCall[] {
  if (!Array.isArray(d.calls)) return []
  const out: AlphaCall[] = []
  for (const x of d.calls) {
    if (!x || typeof x !== 'object') continue
    const o = x as Record<string, unknown>
    const id = asText(o.id)
    if (!id) continue
    const raw = asText(o.state)
    const state: CallState = raw === 'calling' || raw === 'live' || raw === 'ended' ? raw : 'unknown'
    const lines: AlphaCall['lines'] = []
    if (Array.isArray(o.lines)) {
      for (const l of o.lines) {
        if (!l || typeof l !== 'object') continue
        const lo = l as Record<string, unknown>
        const text = asText(lo.text).trim()
        if (text) lines.push({ speaker: asText(lo.speaker), text })
      }
    }
    out.push({
      id, state,
      label: asText(o.label) || FALLBACK_LABEL[state],
      startedAt: asText(o.started_at),
      summary: asText(o.summary).trim(),
      askedNotToCall: o.asked_not_to_call === true,
      lines,
    })
  }
  // Newest first. A call with no start time goes last.
  return out.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
}

/** The calls Alpha has placed to one customer: when, how it went, and the words said. */
export default function AlphaCalls({ customerId, refreshKey = 0, onWatch }: {
  customerId: string
  /** Change this number to read the list again, for example after a call starts or ends. */
  refreshKey?: number
  /** Opens a call that is still running so it can be watched or stopped. */
  onWatch?: (callId: string) => void
}) {
  const [calls, setCalls] = useState<AlphaCall[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [showAll, setShowAll] = useState(false)
  const seq = useRef(0)
  const shownFor = useRef('')

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++seq.current
    if (!quiet) { setStatus('loading'); setCalls([]) }
    try {
      const r = await fetchJson(`/api/ai-call/history?customer_id=${encodeURIComponent(customerId)}`, { cache: 'no-store' })
      if (mine !== seq.current) return
      if (r.ok && r.data && r.data.ok === true) { setCalls(readCalls(r.data)); setStatus('ready') }
      else { setCalls([]); setStatus('error') }
    } catch {
      if (mine !== seq.current) return
      setCalls([])
      setStatus('error')
    }
  }, [customerId])

  useEffect(() => {
    // Reading again after a call should not flash the loading state; opening a different customer should.
    const quiet = shownFor.current === customerId
    shownFor.current = customerId
    void load(quiet)
  }, [load, customerId, refreshKey])

  if (status === 'loading') {
    return <div className="space-y-2" aria-busy="true" aria-label="Loading Alpha's calls">{[0, 1].map(i => <div key={i} className="skeleton h-16" />)}</div>
  }

  if (status === 'error') {
    return (
      <Notice kind="error">
        <p className="font-bold">Alpha&apos;s calls could not be loaded.</p>
        <p className="mt-1">Check your connection and try again.</p>
        <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => void load(false)}>Try again</button>
      </Notice>
    )
  }

  if (calls.length === 0) {
    return <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">Alpha has not called this customer yet.</p>
  }

  const shown = showAll ? calls : calls.slice(0, SHOWN)
  return (
    <>
      <ul className="ledger">
        {shown.map(c => (
          <li key={c.id} className="flex items-start gap-3 px-3 py-3">
            <Icon name="phone" className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <p className="flex min-w-0 items-center gap-1.5 font-bold"><span className={`lamp ${LAMP[c.state]}`} aria-hidden="true" /><span className="min-w-0 break-words">{c.label}</span></p>
                {c.startedAt && <span className="shrink-0 text-[0.875rem] text-text-secondary">{fmtDayTime(c.startedAt)}</span>}
              </div>
              <p className="mt-0.5 whitespace-pre-line break-words text-[0.9375rem] text-text-secondary">{c.summary || (c.state === 'ended' ? 'No summary was written for this call.' : 'The summary is written when the call ends.')}</p>
              {c.askedNotToCall && (
                <p className="mt-1 flex items-start gap-1.5 text-[0.9375rem] font-bold">
                  <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-amber" />They asked not to be called again
                </p>
              )}
              {onWatch && (c.state === 'calling' || c.state === 'live') && (
                <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => onWatch(c.id)}>Watch or stop this call</button>
              )}
              {c.lines.length > 0 && (
                <details>
                  <summary className="flex min-h-[44px] cursor-pointer items-center font-bold text-blue">Show what was said</summary>
                  <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-bg-base p-3">
                    {c.lines.map((l, i) => (
                      <p key={i} className="break-words py-1 text-[0.9375rem]">
                        <span className="font-bold">{l.speaker === 'ai' ? 'Alpha' : 'Customer'}: </span>{l.text}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </li>
        ))}
      </ul>
      {calls.length > SHOWN && (
        <button type="button" className="btn btn-ghost mt-1" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show fewer' : `Show all ${calls.length}`}
        </button>
      )}
    </>
  )
}
