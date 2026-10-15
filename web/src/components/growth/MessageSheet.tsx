'use client'
import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'
import { fillName, smsParts } from '@/lib/growth-text'
import type { RunState } from './useBatchSend'

export interface Who { id: string; name: string; to: string }
export interface Skipped { name: string; reason: string; kind: 'noPhone' | 'optedOut' | 'duplicate' }
export interface Flag { kind: 'warn' | 'error' | 'info'; text: ReactNode }

interface Props {
  title: string
  channel: 'text' | 'email' | 'call'
  onClose: () => void
  who: Who[]
  /** People on the list who were taken off by hand. */
  off?: Set<string>
  onToggle?: (id: string) => void
  skipped: Skipped[]
  /** Fields that shape the message, shown above it. */
  top?: ReactNode
  subject?: string
  message: string
  onMessage?: (next: string) => void
  /** Text and email are written with {name}; the example shows the first person on the list. */
  exampleName?: string
  flags?: Flag[]
  /** Why sending is blocked right now, in words. */
  blocker?: string
  sendLabel: string
  run: RunState
  onSend: () => void
  onStop: () => void
  /** A problem from a single send that did not use the batch (for example a code that could not be saved). */
  error?: string
  /** Alpha is writing a draft. */
  drafting?: boolean
  onRedraft?: () => void
  /** Shown once the send is over, for example a code to copy. */
  after?: ReactNode
  /** Calls have no words to show; this says what will happen. */
  callNote?: ReactNode
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Shows exactly what will be sent and to whom, then sends, with progress and a stop button. */
export default function MessageSheet(p: Props) {
  const [editing, setEditing] = useState(false)
  const [showWho, setShowWho] = useState(false)
  const [showSkipped, setShowSkipped] = useState(false)
  const areaId = useId()
  const whoId = useId()
  const running = p.run.phase === 'running' || p.run.phase === 'waiting'
  const finished = p.run.phase === 'done'
  const off = p.off
  const active = p.who.length - (off ? p.who.filter(w => off.has(w.id)).length : 0)
  const many = p.who.length > 1
  const example = p.exampleName ?? p.who[0]?.name ?? ''
  const shown = p.channel === 'call' ? '' : fillName(p.message, example)
  const parts = smsParts(shown)
  const needsOptOutLine = p.channel === 'text' && !/\bSTOP\b/i.test(p.message)
  const noun = p.channel === 'email' ? 'email' : p.channel === 'call' ? 'call' : 'text'
  const nounPlural = `${noun}s`
  const pct = p.run.total ? Math.round((p.run.done / p.run.total) * 100) : 0

  const close = () => { if (running) p.onStop(); else p.onClose() }

  return (
    <Sheet open onClose={close} title={p.title} wide>
      {!finished && (
        <>
          {/* Who gets it */}
          <div className="rounded-lg border border-border bg-bg-base p-3">
            <p className="font-bold">
              {p.who.length === 0
                ? `Nobody to ${p.channel === 'email' ? 'email' : p.channel === 'call' ? 'call' : 'text'}`
                : p.channel === 'call'
                  ? `Alpha will phone ${p.who[0].name} at ${p.who[0].to}`
                  : many
                    ? `${plural(active, 'person gets', 'people get')} this ${noun}`
                    : `To ${p.who[0].name}, ${p.who[0].to}`}
            </p>
            {many && (
              <>
                <button type="button" className="btn btn-ghost -ml-2 mt-1" aria-expanded={showWho} aria-controls={whoId} onClick={() => setShowWho(v => !v)}>
                  <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${showWho ? 'rotate-180' : ''}`} />
                  {showWho ? 'Hide the list' : p.onToggle ? 'See who, or take people off' : 'See who'}
                </button>
                {showWho && (
                  <ul id={whoId} className="mt-1 max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border bg-bg-card">
                    {p.who.map(w => {
                      const skippedByHand = !!off?.has(w.id)
                      return (
                        <li key={w.id}>
                          <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-3 py-1.5 text-[0.9375rem]">
                            {p.onToggle && <input type="checkbox" className="h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={!skippedByHand} onChange={() => p.onToggle?.(w.id)} disabled={running} aria-label={`Include ${w.name}`} />}
                            <span className={`min-w-0 flex-1 break-words font-bold ${skippedByHand ? 'text-text-muted line-through' : ''}`}>{w.name}</span>
                            <span className="num shrink-0 text-text-secondary">{w.to}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
            {p.skipped.length > 0 && (
              <>
                <p className="mt-2 text-[0.9375rem] text-text-secondary">
                  Left out: {summarizeSkips(p.skipped)}.
                </p>
                <button type="button" className="btn btn-ghost -ml-2" aria-expanded={showSkipped} onClick={() => setShowSkipped(v => !v)}>
                  <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${showSkipped ? 'rotate-180' : ''}`} />
                  {showSkipped ? 'Hide who was left out' : 'See who was left out'}
                </button>
                {showSkipped && (
                  <ul className="mt-1 max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border bg-bg-card">
                    {p.skipped.map((s, i) => (
                      <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[0.9375rem]">
                        <span className="min-w-0 break-words font-bold">{s.name}</span>
                        <span className="shrink-0 text-text-secondary">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {p.top && <div className="mt-4">{p.top}</div>}

          {/* The words */}
          {p.channel !== 'call' ? (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="form-label !mb-0">{p.channel === 'email' ? 'The email they get' : 'The text they get'}</p>
                {p.onRedraft && !running && (
                  <button type="button" className="btn btn-ghost -mr-2" onClick={p.onRedraft} disabled={p.drafting}>
                    <Icon name="sparkle" className="h-4 w-4" />{p.drafting ? 'Writing…' : 'Write it again'}
                  </button>
                )}
              </div>
              {p.drafting ? (
                <div className="skeleton h-24" role="status" aria-label="Alpha is writing the message" />
              ) : editing && p.onMessage ? (
                <>
                  <label htmlFor={areaId} className="sr-only">Message text</label>
                  <textarea id={areaId} className="form-textarea" rows={p.channel === 'email' ? 8 : 5} value={p.message} onChange={e => p.onMessage?.(e.target.value)} disabled={running} />
                  {many && <p className="form-hint">Type {'{name}'} where each person’s first name goes.</p>}
                </>
              ) : (
                <div className="rounded-lg bg-bg-hover px-3 py-2.5">
                  {p.subject && <p className="mb-2 break-words text-[0.9375rem]"><span className="font-bold">Subject: </span>{p.subject}</p>}
                  <p className="whitespace-pre-wrap break-words text-[0.9375rem]" data-testid="message-preview">{shown}</p>
                </div>
              )}
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <p className="text-[0.8125rem] text-text-secondary">
                  {many && example ? `Shown for ${example}. Each person gets their own first name. ` : ''}
                  {p.channel === 'text' ? `${parts.chars} characters, ${plural(parts.parts, 'text message', 'text messages')}${many ? ' each' : ''}.` : ''}
                </p>
                {p.onMessage && !p.drafting && (
                  <button type="button" className="btn btn-ghost -mr-2" onClick={() => setEditing(v => !v)} disabled={running}>
                    <Icon name={editing ? 'check' : 'edit'} className="h-4 w-4" />{editing ? 'Done editing' : 'Edit the words'}
                  </button>
                )}
              </div>
              {needsOptOutLine && (
                <Notice kind="warn" className="mt-2">
                  <p>This text has no opt-out line. Texts to customers need “Reply STOP to opt out.” so people can say no.</p>
                  {p.onMessage && <button type="button" className="btn btn-secondary mt-2" onClick={() => p.onMessage?.(`${p.message.trim()} Reply STOP to opt out.`)}>Add the opt-out line</button>}
                </Notice>
              )}
            </div>
          ) : (
            p.callNote && <div className="mt-4 text-[0.9375rem]">{p.callNote}</div>
          )}

          {(p.flags || []).map((f, i) => <Notice key={i} kind={f.kind} className="mt-3">{f.text}</Notice>)}
          {p.error && <Notice kind="error" className="mt-3">{p.error}</Notice>}
        </>
      )}

      {/* Progress */}
      {running && (
        <div className="mt-4 rounded-lg border border-border bg-bg-base p-4" role="status" aria-live="polite">
          <p className="font-bold">
            {p.run.phase === 'waiting'
              ? 'Waiting a moment. The carrier limits how fast texts go out.'
              : `Sending ${p.run.current ? `to ${p.run.current}` : ''}`.trim()}
          </p>
          <p className="num mt-1 text-[0.9375rem] text-text-secondary">{p.run.done} of {p.run.total} done{p.run.failed > 0 ? `, ${p.run.failed} did not send` : ''}</p>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-text-primary/10" role="progressbar" aria-label="Sending progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full rounded-full bg-blue transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {/* Result */}
      {finished && <Result run={p.run} nounPlural={nounPlural} noun={noun} skipped={p.skipped} calling={p.channel === 'call'} quietEmpty={!!p.after} />}
      {finished && p.after}

      {/* Buttons */}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {finished ? (
          <button type="button" className="btn btn-primary" onClick={p.onClose}>Done</button>
        ) : running ? (
          <button type="button" className="btn btn-danger" onClick={p.onStop}>
            <Icon name="pause" className="h-5 w-5" />Stop sending
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={p.onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={p.onSend} disabled={!!p.blocker || active === 0 || p.drafting || (p.channel === 'text' && needsOptOutLine && !!p.onMessage) || (p.channel !== 'call' && !p.message.trim())}>
              <Icon name={p.channel === 'call' ? 'phone' : p.channel === 'email' ? 'mail' : 'send'} className="h-5 w-5" />{p.sendLabel}
            </button>
          </>
        )}
      </div>
      {!finished && !running && p.blocker && <p className="mt-2 text-right text-[0.875rem] text-text-secondary" role="note">{p.blocker}</p>}
    </Sheet>
  )
}

const SKIP_WORDS: Record<Skipped['kind'], (n: number) => string> = {
  noPhone: n => `${n} with no phone number`,
  optedOut: n => `${n} who replied STOP`,
  duplicate: n => `${n} sharing a number with someone else on the list`,
}

function summarizeSkips(skipped: Skipped[]): string {
  const counts = new Map<Skipped['kind'], number>()
  for (const s of skipped) counts.set(s.kind, (counts.get(s.kind) || 0) + 1)
  return [...counts.entries()].map(([kind, n]) => SKIP_WORDS[kind](n)).join(', ')
}

function Result({ run, noun, nounPlural, skipped, calling, quietEmpty }: { run: RunState; noun: string; nounPlural: string; skipped: Skipped[]; calling: boolean; quietEmpty: boolean }) {
  const sentWord = run.sent === 1 ? noun : nounPlural
  return (
    <div className="mt-2 space-y-3" role="status" aria-live="polite">
      {run.sent > 0 && (
        <Notice kind="success"><p className="font-bold">{calling ? 'Alpha is calling.' : `Sent ${run.sent} ${sentWord}.`}</p>{run.unlogged > 0 && <p className="mt-0.5">{plural(run.unlogged, 'send was', 'sends were')} not saved to the activity list. They did go out.</p>}</Notice>
      )}
      {run.halted && run.total - run.done > 0 && <Notice kind="warn"><p className="font-bold">Alpha stopped early.</p><p className="mt-0.5">{plural(run.total - run.done, 'person was', 'people were')} not contacted, because the same problem would have stopped each of them.</p></Notice>}
      {run.stopped && <Notice kind="warn"><p className="font-bold">You stopped it.</p><p className="mt-0.5">{plural(run.total - run.done, 'person was', 'people were')} not contacted. Nothing more will go out.</p></Notice>}
      {run.optedOut > 0 && <Notice kind="info"><p>{plural(run.optedOut, 'person has', 'people have')} replied STOP before, so they were not {noun === 'email' ? 'emailed' : noun === 'call' ? 'called' : 'texted'}.</p></Notice>}
      {run.failed > 0 && (
        <Notice kind="error">
          <p className="font-bold">{plural(run.failed, `${noun} did not send`, `${nounPlural} did not send`)}.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {run.failures.slice(0, 5).map((f, i) => <li key={i}><span className="font-bold">{f.name}:</span> {f.reason}</li>)}
          </ul>
          {run.failures.length > 5 && <p className="mt-1">And {run.failures.length - 5} more.</p>}
        </Notice>
      )}
      {run.sent === 0 && run.failed === 0 && run.optedOut === 0 && !run.stopped && !run.halted && !quietEmpty && <Notice kind="info"><p>Nothing was sent.</p></Notice>}
      {skipped.length > 0 && <p className="text-[0.9375rem] text-text-secondary">Left out before sending: {summarizeSkips(skipped)}.</p>}
    </div>
  )
}
