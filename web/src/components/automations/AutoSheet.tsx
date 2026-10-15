'use client'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'
import { smsParts } from '@/lib/growth-text'
import { blastTemplate, hasOptOutLine } from '@/lib/automation-text'
import type { ResultSummary } from '@/lib/automation-text'
import { loadAudience } from './audience'
import type { Audience } from './audience'
import { copyFor, sampleFor } from './copy'
import { plural } from './parts'
import type { ShopFacts, SystemAutomation } from './types'

export interface Outcome {
  ok: boolean
  error?: string
  summary?: ResultSummary
  failures?: { name: string; reason: string }[]
}

interface Props {
  auto: SystemAutomation
  /** view: look only. run: send now. enable: let it send from now on. */
  mode: 'view' | 'run' | 'enable'
  shop: ShopFacts
  onClose: () => void
  onConfirm: () => Promise<Outcome>
  /** Adds the opt-out line to the promotional text and saves it. */
  onAddOptOut?: () => Promise<boolean>
  onRetryShop: () => void
}

type Load = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ready'; data: Audience }

/** Shows exactly what an automation sends and to how many people, then runs it or turns it on. */
export default function AutoSheet({ auto, mode, shop, onClose, onConfirm, onAddOptOut, onRetryShop }: Props) {
  const c = copyFor(auto.id, auto.name)
  const [aud, setAud] = useState<Load>({ state: 'loading' })
  const [tick, setTick] = useState(0)
  const [showWho, setShowWho] = useState(false)
  const [ack, setAck] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle')
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [fixing, setFixing] = useState(false)
  const whoId = useId()
  const ackId = useId()

  const cfgKey = JSON.stringify(auto.state.config)
  const tz = shop.timezone
  useEffect(() => {
    let off = false
    setAud({ state: 'loading' })
    loadAudience(auto.id, JSON.parse(cfgKey) as Record<string, unknown>, tz)
      .then(data => { if (!off) setAud({ state: 'ready', data }) })
      .catch(e => { if (!off) setAud({ state: 'error', error: e instanceof Error && e.message ? e.message : 'We could not work out who would get it.' }) })
    return () => { off = true }
  }, [auto.id, cfgKey, tz, tick])

  const data = aud.state === 'ready' ? aud.data : null
  const sample = useMemo(() => sampleFor(auto.id, shop, auto.state.config, data?.first), [auto.id, shop, auto.state.config, data])
  const parts = sample.how === 'exact' && c.kind === 'text' ? smsParts(sample.body) : null
  const template = blastTemplate(auto.state.config.message_template)
  const needsStop = auto.id === 'sms_blast' && !hasOptOutLine(template)
  const needsLink = auto.id === 'review_requests' && shop.state === 'ready' && !shop.reviewUrl
  const needsAck = auto.id === 'lead_outreach'
  const working = phase === 'working'
  const count = data?.people.length ?? 0

  const blocker = mode === 'view' ? ''
    : shop.state === 'loading' ? 'Loading your shop details…'
    : shop.state === 'error' ? 'Your shop details did not load, so the text cannot be shown.'
    : aud.state === 'loading' ? 'Working out who would get it…'
    : aud.state === 'error' ? 'We could not work out who would get it, so it will not run.'
    : needsLink ? 'Add your Google review link in Settings first, so the text has a link.'
    : needsStop ? 'Add the opt-out line to the text first.'
    : needsAck && !ack ? 'Tick the box above to confirm.'
    : mode === 'run' && data?.counted && count === 0 ? 'Nobody would get it right now, so there is nothing to run.'
    : ''

  const go = async () => {
    if (working || blocker) return
    setPhase('working')
    const out = await onConfirm()
    setOutcome(out)
    setPhase('done')
  }

  const fix = async () => {
    if (!onAddOptOut || fixing) return
    setFixing(true)
    await onAddOptOut()
    setFixing(false)
  }

  const close = useCallback(() => { if (!working) onClose() }, [working, onClose])
  const title = phase === 'done' ? c.name : mode === 'run' ? `Run ${c.name.toLowerCase()} now?` : mode === 'enable' ? `Turn on ${c.name.toLowerCase()}?` : `${c.name}: what it sends`

  return (
    <Sheet open onClose={close} title={title} wide>
      {phase !== 'done' && (
        <>
          <p className="text-[0.9375rem]">{c.does}</p>
          {mode === 'enable' && <p className="mt-2 text-[0.9375rem] text-text-secondary">Once it is on, it runs by itself in the daily check and sends without asking you again.</p>}

          {/* Who */}
          <div className="mt-4 rounded-lg border border-border bg-bg-base p-3">
            {aud.state === 'loading' && <div className="skeleton h-14" role="status" aria-label="Working out who would get it" />}
            {aud.state === 'error' && (
              <div role="alert">
                <p className="font-bold">We could not work out who would get it.</p>
                <p className="mt-0.5 text-[0.9375rem] text-text-secondary">{aud.error} Check your connection and try again.</p>
                <button type="button" className="btn btn-secondary mt-2" onClick={() => setTick(t => t + 1)}>Try again</button>
              </div>
            )}
            {data && !data.counted && (
              <>
                <p className="font-bold">Who gets it</p>
                <p className="mt-0.5 text-[0.9375rem] text-text-secondary">{c.who}</p>
                {c.contacts && <p className="mt-1 text-[0.9375rem] text-text-secondary">Alpha works this out when it runs, so the number is not known ahead of time.</p>}
              </>
            )}
            {data?.counted && (
              <>
                <p className="font-bold">
                  {count === 0
                    ? 'Nobody would get it right now'
                    : `${data.complete ? '' : 'At least '}${plural(count, 'person', 'people')} ${mode === 'run' ? 'will get it' : 'would get it right now'}`}
                </p>
                <p className="mt-0.5 text-[0.9375rem] text-text-secondary">{c.who}</p>
                {count > 0 && (
                  <>
                    <button type="button" className="btn btn-ghost -ml-2 mt-1" aria-expanded={showWho} aria-controls={whoId} onClick={() => setShowWho(v => !v)}>
                      <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${showWho ? 'rotate-180' : ''}`} />
                      {showWho ? 'Hide the list' : 'See who'}
                    </button>
                    {showWho && (
                      <ul id={whoId} className="mt-1 max-h-52 divide-y divide-border overflow-y-auto rounded-md border border-border bg-bg-card">
                        {data.people.map(p => (
                          <li key={p.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[0.9375rem]">
                            <span className="min-w-0 break-words font-bold">{p.name}</span>
                            <span className="num min-w-0 shrink-0 break-all text-right text-text-secondary">{p.detail}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
                {data.left.length > 0 && <p className="mt-2 text-[0.9375rem] text-text-secondary">Left out: {data.left.map(l => `${l.count} ${l.label}`).join(', ')}.</p>}
                {data.facts.map((f, i) => <p key={i} className="mt-1 text-[0.9375rem] text-text-secondary">{f}</p>)}
              </>
            )}
          </div>

          {/* The words */}
          {sample.how === 'exact' && (
            <div className="mt-4">
              <p className="form-label">{c.kind === 'email' ? 'The email they get' : c.kind === 'draft' ? 'The draft it saves' : 'The text they get'}</p>
              <div className="rounded-lg bg-bg-hover px-3 py-2.5">
                {sample.subject && <p className="mb-2 break-words text-[0.9375rem]"><span className="font-bold">If it is sent by email, the subject is: </span>{sample.subject}</p>}
                <p className="whitespace-pre-wrap break-words text-[0.9375rem]" data-testid="automation-preview">{sample.body}</p>
              </div>
              <p className="mt-1.5 text-[0.8125rem] text-text-secondary">
                {data?.first?.name ? `Shown for ${data.first.name}. ` : ''}Anything in [brackets] is filled in for each person.
                {parts ? ` About ${parts.chars} characters, ${plural(parts.parts, 'text message', 'text messages')}.` : ''}
              </p>
            </div>
          )}
          {sample.how === 'written' && (
            <Notice kind="info" className="mt-4">
              <p className="font-bold">Alpha writes the words each time</p>
              <p className="mt-0.5">{sample.body} You cannot read them before they go out.</p>
            </Notice>
          )}

          {/* Things to know */}
          <div className="mt-4 space-y-2">
            {needsStop && (
              <Notice kind="error">
                <p className="font-bold">This text has no opt-out line.</p>
                <p className="mt-0.5">Promotional texts need “Reply STOP to opt out.” so people can say no. It will not send until the line is added.</p>
                {onAddOptOut && <button type="button" className="btn btn-secondary mt-2" onClick={fix} disabled={fixing}>{fixing ? 'Adding…' : 'Add the opt-out line'}</button>}
              </Notice>
            )}
            {needsLink && (
              <Notice kind="error">
                <p className="font-bold">There is no Google review link yet.</p>
                <p className="mt-0.5">The text would ask for a review without a link. <Link href="/settings" className="font-bold text-blue underline underline-offset-2">Add it in Settings</Link>, then come back.</p>
              </Notice>
            )}
            {shop.state === 'error' && (
              <Notice kind="error">
                <p>Your shop name and phone did not load.</p>
                <button type="button" className="btn btn-secondary mt-2" onClick={onRetryShop}>Try again</button>
              </Notice>
            )}
            {shop.state === 'ready' && !shop.name && c.kind !== 'search' && (
              <Notice kind="warn">Your shop name is not set, so the text says “our shop”. <Link href="/settings" className="font-bold text-blue underline underline-offset-2">Add it in Settings</Link>.</Notice>
            )}
            {c.notes.map((n, i) => <Notice key={i} kind={n.warn ? 'warn' : 'info'}>{n.text}</Notice>)}
          </div>

          {needsAck && mode !== 'view' && (
            <label htmlFor={ackId} className="mt-4 flex min-h-[44px] cursor-pointer items-start gap-3 text-[0.9375rem]">
              <input id={ackId} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={ack} onChange={e => setAck(e.target.checked)} />
              <span>I understand these emails go to people who may not have asked to hear from me, and they have no unsubscribe link.</span>
            </label>
          )}
        </>
      )}

      {phase === 'done' && outcome && (
        <div className="space-y-3" role="status" aria-live="polite">
          {outcome.ok
            ? <Notice kind={outcome.summary?.tone === 'warn' ? 'warn' : 'success'}><p className="font-bold">{mode === 'enable' ? `${c.name} is on.` : 'It ran.'}</p>{outcome.summary && <p className="mt-0.5">{outcome.summary.text}</p>}</Notice>
            : outcome.summary?.tone === 'warn'
              ? <Notice kind="warn"><p className="font-bold">It stopped part of the way.</p><p className="mt-0.5">{outcome.summary.text}</p></Notice>
              : <Notice kind="error"><p className="font-bold">{mode === 'enable' ? 'It was not turned on.' : 'It did not finish.'}</p><p className="mt-0.5">{outcome.error || outcome.summary?.text || 'Something went wrong.'}</p></Notice>}
          {outcome.failures && outcome.failures.length > 0 && (
            <div>
              <p className="font-bold">What did not go out</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.9375rem]">
                {outcome.failures.slice(0, 5).map((f, i) => <li key={i}><span className="font-bold">{f.name}:</span> {f.reason}</li>)}
              </ul>
              {outcome.failures.length > 5 && <p className="mt-1 text-[0.9375rem] text-text-secondary">And {outcome.failures.length - 5} more.</p>}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {phase === 'done' || mode === 'view' ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>{phase === 'done' ? 'Done' : 'Close'}</button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={working}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={go} disabled={working || !!blocker} aria-busy={working}>
              <Icon name={mode === 'run' ? 'play' : 'check'} className="h-5 w-5" />
              {working ? (mode === 'run' ? 'Running…' : 'Turning on…') : mode === 'run' ? 'Run now' : 'Turn on'}
            </button>
          </>
        )}
      </div>
      {phase !== 'done' && mode !== 'view' && blocker && <p className="mt-2 text-right text-[0.875rem] text-text-secondary" role="note">{blocker}</p>}
      {working && mode === 'run' && <p className="mt-2 text-right text-[0.875rem] text-text-secondary" role="status">This can take a minute. Keep this open.</p>}
    </Sheet>
  )
}
