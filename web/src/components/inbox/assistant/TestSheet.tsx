'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Sheet from '@/components/Sheet'
import { api } from '../api'
import { firedLabels } from '../ai-types'

interface Line { who: 'customer' | 'assistant'; text: string; effects?: string[]; fired?: string[]; outcome?: string; ended?: boolean }
interface Turn {
  say: string; state: unknown; outcome: string; outcomeLabel: string; ended: boolean; effects: string[]; rulesFired: string[]
  usedModel: boolean; usedYourAiKey: boolean
}

const WHEN: Array<{ value: string; label: string }> = [
  { value: 'now', label: 'Right now' },
  { value: 'night', label: 'Tonight at 11 pm' },
  { value: 'morning', label: 'Tomorrow at 10 am' },
]

function pretendTime(value: string): string | undefined {
  if (value === 'now') return undefined
  const d = new Date()
  if (value === 'night') d.setHours(23, 0, 0, 0)
  else { d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0) }
  return d.toISOString()
}

/**
 * Try the assistant without a real customer. It runs the same decision rules as the real thing, with the rules on screen
 * (even if they are not saved yet). Nothing is saved, no text or email is sent, and no call is placed.
 */
export default function TestSheet({ open, onClose, rules }: { open: boolean; onClose: () => void; rules?: unknown }) {
  const [channel, setChannel] = useState<'sms' | 'call'>('sms')
  const [when, setWhen] = useState('now')
  const [lines, setLines] = useState<Line[]>([])
  const [state, setState] = useState<unknown>(undefined)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const history = useRef<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const end = useRef<HTMLDivElement>(null)

  const run = useCallback(async (ch: 'sms' | 'call', said: string, st: unknown, whenValue: string) => {
    setBusy(true); setError('')
    const r = await api<Turn>('/api/receptionist/test', {
      body: { channel: ch, text: said, rules, state: st, history: history.current, asOf: pretendTime(whenValue) },
    })
    setBusy(false)
    if (!r.ok || !r.data) { setError(r.error || 'The test did not run.'); return }
    const t = r.data
    setState(t.state)
    setNote(t.usedYourAiKey ? '' : 'No AI key is saved in Settings, so replies use the assistant’s plain built-in wording.')
    const added: Line[] = []
    if (said.trim()) added.push({ who: 'customer', text: said.trim() })
    if (t.say) added.push({ who: 'assistant', text: t.say, effects: t.effects, fired: t.rulesFired, outcome: t.outcomeLabel, ended: t.ended })
    else added.push({ who: 'assistant', text: '', effects: t.effects, fired: t.rulesFired, outcome: t.outcomeLabel, ended: t.ended })
    if (said.trim()) history.current.push({ role: 'user', content: said.trim() })
    if (t.say) history.current.push({ role: 'assistant', content: t.say })
    setLines(prev => [...prev, ...added])
  }, [rules])

  const restart = useCallback((ch: 'sms' | 'call', whenValue: string) => {
    history.current = []
    setLines([]); setState(undefined); setText(''); setError(''); setNote('')
    if (ch === 'call') void run('call', '', undefined, whenValue)
  }, [run])

  useEffect(() => { if (open) restart(channel, when) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }) }, [lines.length, busy])

  const last = lines[lines.length - 1]
  const finished = last?.who === 'assistant' && last.ended === true

  return (
    <Sheet open={open} onClose={onClose} title="Try the assistant" wide>
      <div className="space-y-4">
        <p className="rounded-lg border border-blue/30 bg-blue/[0.06] p-3 text-[0.9375rem]">
          This is a practice run. Nothing is saved, no text or email is sent and nobody is called. It uses the rules on your screen, even if you have not saved them yet.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="form-label">Practice</span>
            <select className="form-select" value={channel} onChange={e => { const v = e.target.value as 'sms' | 'call'; setChannel(v); restart(v, when) }}>
              <option value="sms">A customer texting</option>
              <option value="call">A customer calling</option>
            </select>
          </label>
          <label className="block">
            <span className="form-label">Pretend it is</span>
            <select className="form-select" value={when} onChange={e => { setWhen(e.target.value); restart(channel, e.target.value) }}>
              {WHEN.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </label>
        </div>

        <div className="max-h-[22rem] min-h-[10rem] space-y-3 overflow-y-auto rounded-lg border border-border bg-bg-base p-3" role="log" aria-live="polite" aria-label="Practice conversation">
          {lines.length === 0 && !busy && <p className="text-text-secondary">{channel === 'sms' ? 'Type what a customer might text, like “do you do brake jobs?”' : 'Starting the call...'}</p>}
          {lines.map((l, i) => (
            <div key={i} className={`flex flex-col ${l.who === 'customer' ? 'items-end' : 'items-start'}`}>
              {l.text ? (
                <div className={`max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[1rem] leading-snug ${l.who === 'customer' ? 'rounded-br-md bg-blue text-[rgb(var(--c-on-blue))]' : 'rounded-bl-md border border-border bg-bg-chrome text-text-primary'}`}>
                  <span className="sr-only">{l.who === 'customer' ? 'Customer: ' : 'Assistant: '}</span>{l.text}
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed border-border px-3.5 py-2 text-[0.9375rem] text-text-secondary">The assistant would not send anything here.</p>
              )}
              {l.who === 'assistant' && ((l.effects && l.effects.length > 0) || (l.fired && l.fired.length > 0)) && (
                <div className="mt-1.5 max-w-[90%] rounded-lg border border-border bg-bg-card p-3 text-[0.875rem]">
                  <p className="font-bold">If this were real{l.outcome ? ` (${l.outcome})` : ''}</p>
                  {l.effects && l.effects.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-5 text-text-secondary">{l.effects.map((e, j) => <li key={j}>{e}</li>)}</ul>}
                  {l.fired && firedLabels(l.fired).length > 0 && <p className="mt-1.5 text-text-secondary">Rules used: {firedLabels(l.fired).join(', ')}</p>}
                </div>
              )}
            </div>
          ))}
          {busy && <p role="status" className="text-[0.9375rem] text-text-secondary">The assistant is answering...</p>}
          <div ref={end} />
        </div>

        {note && <p className="text-[0.875rem] text-text-secondary">{note}</p>}
        {error && <p role="alert" className="font-bold text-red">{error}</p>}
        {finished && <p className="text-[0.9375rem] font-bold">The call ended here. Start over to try another.</p>}

        <form className="flex items-end gap-2" onSubmit={e => { e.preventDefault(); const t = text.trim(); if (!t || busy || finished) return; setText(''); void run(channel, t, state, when) }}>
          <label className="min-w-0 flex-1">
            <span className="sr-only">{channel === 'sms' ? 'What the customer texts' : 'What the caller says'}</span>
            <input className="form-input" value={text} maxLength={600} onChange={e => setText(e.target.value)} placeholder={channel === 'sms' ? 'What the customer texts' : 'What the caller says'} disabled={finished} />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy || !text.trim() || finished}>Send</button>
          <button type="button" className="btn btn-secondary" onClick={() => restart(channel, when)} disabled={busy}>Start over</button>
        </form>
      </div>
    </Sheet>
  )
}
