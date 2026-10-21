'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { call } from './api'
import { Fact } from './parts'
import { cannotKeepCadence, checkedWords, looksLikePhone, plural, quietWords, scheduleWords, whenWords } from './model'
import type { Card, Preview, Rules } from './model'

export type PreviewMode = 'view' | 'enable' | 'run'

interface Props {
  card: Card
  mode: PreviewMode
  rules: Rules
  timezone: string
  /** Minutes between the checks Alpha really makes. */
  checkEvery: number
  canTest: boolean
  onClose: () => void
  /** Switches the automation on. Returns the reason it did not work, or an empty string. */
  onEnable: () => Promise<string>
  /** Runs it now. */
  onRun: () => Promise<{ ok: boolean; message: string }>
  onNote: (message: string, kind: 'success' | 'error' | 'info') => void
  /** Opens the settings, for a problem that is fixed there (no message written, no review link). */
  onEdit?: () => void
}

const PHONE_KEY = 'alpha_test_phone'
const readPhone = (): string => { try { return window.localStorage.getItem(PHONE_KEY) || '' } catch { return '' } }
const savePhone = (v: string) => { try { window.localStorage.setItem(PHONE_KEY, v) } catch { /* the number just is not remembered */ } }

/** What an automation would do right now: the exact words, who gets them, who is left out and why. Nothing is sent from here except a test to yourself. */
export default function PreviewSheet({ card, mode, rules, timezone, checkEvery, canTest, onClose, onEnable, onRun, onNote, onEdit }: Props) {
  const [data, setData] = useState<Preview | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [working, setWorking] = useState<'' | 'enable' | 'run' | 'test'>('')
  const [actionError, setActionError] = useState('')
  const [phone, setPhone] = useState('')
  const [tested, setTested] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [showLeft, setShowLeft] = useState(false)
  const busy = useRef(false)
  const id = useId()
  const engine = card.kind === 'engine'

  const loadPreview = useCallback(async () => {
    setState('loading'); setError('')
    const r = await call('/api/system-automations', { action: 'preview', id: card.id })
    if (r.ok) { setData(r.data as unknown as Preview); setState('ready') } else { setError(r.error); setState('error') }
  }, [card.id])
  useEffect(() => { void loadPreview() }, [loadPreview])
  useEffect(() => { setPhone(readPhone()) }, [])

  const runStep = async (kind: 'enable' | 'run') => {
    if (busy.current) return
    busy.current = true; setWorking(kind); setActionError('')
    try {
      if (kind === 'enable') {
        const reason = await onEnable()
        if (reason) setActionError(reason); else onClose()
      } else {
        const out = await onRun()
        if (out.ok) { onNote(out.message, 'success'); onClose() } else setActionError(out.message)
      }
    } finally { busy.current = false; setWorking('') }
  }

  const sendTest = async () => {
    if (busy.current) return
    if (!looksLikePhone(phone)) { setActionError('Enter your own mobile number with the area code.'); return }
    busy.current = true; setWorking('test'); setActionError(''); setTested('')
    try {
      savePhone(phone)
      const r = await call('/api/system-automations', { action: 'test_send', id: card.id, to: phone })
      if (r.ok) setTested(String(r.data.message || 'Test text sent to your phone.')); else setActionError(r.error)
    } finally { busy.current = false; setWorking('') }
  }

  const title = mode === 'enable' ? `Switch on ${card.name}` : mode === 'run' ? `Run ${card.name} now` : card.name
  const c = data?.counts
  const recipients = data?.recipients || []
  const shown = showAll ? recipients : recipients.slice(0, 3)
  const nothing = state === 'ready' && engine && c && c.send === 0
  const blocked = (data?.problems?.length || 0) > 0

  return (
    <Sheet open onClose={() => { if (!working) onClose() }} title={title} wide>
      <div className="space-y-4 text-[0.9375rem]">
        <p className="text-text-secondary">{card.blurb}</p>

        {!engine ? (
          <>
            <ul className="space-y-2">
              {card.detail.map(line => <li key={line} className="flex items-start gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-green" />{line}</li>)}
            </ul>
            {card.setup && <Notice kind="warn">{card.setup}</Notice>}
          </>
        ) : state === 'loading' ? (
          <div className="space-y-3" role="status" aria-busy="true" aria-label="Working out who would get this">
            <div className="skeleton h-16" /><div className="skeleton h-24" /><div className="skeleton h-24" />
          </div>
        ) : state === 'error' ? (
          <Notice kind="error">
            <p className="font-bold">The preview did not load.</p>
            <p>{error}</p>
            <button type="button" className="btn btn-secondary mt-2" onClick={() => void loadPreview()}>Try again</button>
          </Notice>
        ) : data && c ? (
          <>
            {data.problems.map(p => <Notice key={p} kind="warn">{p}</Notice>)}

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
              <Count label="Will be messaged" value={c.send} strong />
              <Count label="Right now" value={c.send_now} />
              <Count label="Held until morning" value={c.held_for_quiet_hours} />
              <Count label="Left out" value={c.skipped} />
            </div>
            {c.later > 0 && <p className="text-text-secondary">{plural(c.later, 'more person', 'more people')} not due yet. They are checked again on every run.</p>}

            <div className="space-y-1">
              <Fact icon="clock">{scheduleWords(card.schedule, checkEvery)} · {quietWords(rules)}</Fact>
              <Fact icon="shield">Anyone who replied STOP is left out, checked again right before each message goes. {card.klass === 'marketing' ? 'Marketing texts end with an opt-out line.' : ''}</Fact>
            </div>

            <section aria-labelledby={`${id}-who`}>
              <h3 id={`${id}-who`} className="section-title mb-2">{nothing ? 'Nobody to message right now' : 'The exact messages'}</h3>
              {nothing ? (
                <p className="rounded-md bg-bg-hover px-3 py-3 text-text-secondary">
                  No one matches today. The message below is what the next person who qualifies will get.
                  <span className="mt-2 block whitespace-pre-wrap break-words rounded-md border border-border bg-bg-card p-3 text-text-primary">{data.message || card.template || 'No message written yet.'}</span>
                </p>
              ) : (
                <ul className="space-y-3">
                  {shown.map((r, i) => (
                    <li key={`${r.to}-${i}`} className="rounded-md border border-border bg-bg-card p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="min-w-0 break-words font-bold">{r.name} <span className="font-normal text-text-secondary">· {r.to}</span></p>
                        <p className="text-[0.8125rem] text-text-secondary">{r.held ? 'Held until ' : 'Goes out '}{r.send_at}</p>
                      </div>
                      {r.subject && <p className="mt-1 break-words text-text-secondary">Subject: {r.subject}</p>}
                      <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-bg-hover px-3 py-2">{r.text}</p>
                      <p className="mt-1.5 text-[0.8125rem] text-text-secondary">
                        {r.why}{r.channel === 'sms' ? ` · ${plural(r.parts, 'text part')}` : ' · Email'}
                        {r.notes?.length ? ` · ${r.notes.join(' ')}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {recipients.length > 3 && (
                <button type="button" className="btn btn-secondary mt-3" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
                  {showAll ? 'Show fewer' : `Show all ${recipients.length}${c.send > recipients.length ? ` of ${c.send}` : ''}`}
                </button>
              )}
            </section>

            {(data.skipped_by.length > 0 || c.skipped > 0) && (
              <section aria-labelledby={`${id}-left`}>
                <h3 id={`${id}-left`} className="section-title mb-2">Left out, and why</h3>
                <ul className="space-y-1">
                  {data.skipped_by.map(s => <li key={s.reason} className="flex justify-between gap-3"><span>{s.label}</span><span className="num font-bold">{s.count.toLocaleString('en-US')}</span></li>)}
                </ul>
                {data.skipped.length > 0 && (
                  <>
                    <button type="button" className="btn btn-ghost mt-2" onClick={() => setShowLeft(v => !v)} aria-expanded={showLeft}>{showLeft ? 'Hide names' : 'Show names'}</button>
                    {showLeft && (
                      <ul className="mt-1 divide-y divide-border rounded-md border border-border">
                        {data.skipped.map((s, i) => <li key={`${s.name}-${i}`} className="flex flex-wrap justify-between gap-x-3 px-3 py-2"><span className="break-words font-bold">{s.name}</span><span className="text-text-secondary">{s.label}</span></li>)}
                      </ul>
                    )}
                  </>
                )}
              </section>
            )}

            {canTest && card.channel === 'sms' && (
              <section aria-labelledby={`${id}-test`} className="rounded-md border border-border p-3">
                <h3 id={`${id}-test`} className="font-bold">Send a test to yourself</h3>
                <p className="mt-0.5 text-text-secondary">Texts the message to your own phone only. Marked [Test]. No customer is contacted.</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <label className="sr-only" htmlFor={`${id}-phone`}>Your mobile number</label>
                  <input id={`${id}-phone`} className="form-input sm:max-w-[16rem]" type="tel" inputMode="tel" autoComplete="tel" placeholder="Your mobile number" value={phone} onChange={e => { setPhone(e.target.value); setTested(''); setActionError('') }} />
                  <button type="button" className="btn btn-secondary" onClick={() => void sendTest()} disabled={working !== ''} aria-busy={working === 'test'}>
                    <Icon name="send" className="h-5 w-5" />{working === 'test' ? 'Sending…' : 'Send test'}
                  </button>
                </div>
                {tested && <p role="status" className="mt-2 font-bold text-green">{tested}</p>}
              </section>
            )}
          </>
        ) : null}

        {actionError && <Notice kind="error">{actionError}</Notice>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={working === 'enable' || working === 'run'}>{mode === 'view' ? 'Close' : 'Cancel'}</button>
          {onEdit && (blocked || nothing) && <button type="button" className="btn btn-secondary" onClick={onEdit}><Icon name="settings" className="h-5 w-5" />Open settings</button>}
          {mode === 'enable' && (
            <button type="button" className="btn btn-primary" onClick={() => void runStep('enable')} disabled={working !== '' || (engine && state !== 'ready') || blocked} aria-busy={working === 'enable'}>
              {working === 'enable' ? 'Switching on…' : 'Switch on'}
            </button>
          )}
          {mode === 'run' && (
            <button type="button" className="btn btn-primary" onClick={() => void runStep('run')} disabled={working !== '' || (engine && state !== 'ready') || blocked || nothing === true} aria-busy={working === 'run'}>
              {working === 'run' ? 'Running…' : c ? `Run now for ${plural(c.send, 'person', 'people')}` : 'Run now'}
            </button>
          )}
        </div>
        {mode === 'enable' && engine && state === 'ready' && !blocked && (
          <p className="text-[0.8125rem] text-text-secondary">
            After you switch it on, it runs at the times above and checks this list again each time. Pausing it cancels anything still waiting to go out. {cannotKeepCadence(card.schedule, checkEvery) ? `It is checked ${checkedWords(checkEvery)}.` : `Next check: ${card.next_run ? whenWords(card.next_run, timezone) : 'at its next scheduled time'}.`}
          </p>
        )}
      </div>
    </Sheet>
  )
}

function Count({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="bg-bg-card px-3 py-2.5">
      <p className="text-[0.8125rem] font-bold text-text-secondary">{label}</p>
      <p className={`display num text-[1.5rem] leading-none ${strong ? 'font-bold' : ''}`}>{value.toLocaleString('en-US')}</p>
    </div>
  )
}
