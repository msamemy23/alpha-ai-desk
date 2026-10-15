'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { contactProblems, parseMoney } from '@/lib/list-logic'

/** Saves one change to the claim. Resolves to a sentence about what went wrong, or null when it saved. */
export type SaveFn = (patch: Record<string, unknown>) => Promise<string | null>

type Phase = 'idle' | 'saving' | 'saved' | 'error'

/** Tracks one box: saving, saved for a moment, or failed with a reason and a way to try again. */
function useSaver(save: SaveFn) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState('')
  const [retryable, setRetryable] = useState(false)
  const last = useRef<Record<string, unknown> | null>(null)
  const turn = useRef(0)
  const run = useCallback(async (patch: Record<string, unknown>) => {
    const mine = ++turn.current
    last.current = patch
    setPhase('saving'); setError(''); setRetryable(false)
    const problem = await save(patch)
    if (mine !== turn.current) return
    if (problem) { setPhase('error'); setError(problem); setRetryable(true) } else { setPhase('saved') }
  }, [save])
  useEffect(() => {
    if (phase !== 'saved') return
    const t = setTimeout(() => setPhase('idle'), 2500)
    return () => clearTimeout(t)
  }, [phase])
  const fail = (message: string) => { turn.current++; setPhase('error'); setError(message); setRetryable(false) }
  const clear = () => { turn.current++; setPhase('idle'); setError('') }
  return { phase, error, retryable, run, retry: () => { if (last.current) void run(last.current) }, fail, clear }
}

function Status({ phase }: { phase: Phase }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[0.875rem] text-text-secondary" role="status" aria-live="polite">
      {phase === 'saving' ? 'Saving…' : phase === 'saved' ? <><span className="lamp lamp-green" aria-hidden="true" />Saved</> : null}
    </span>
  )
}

function Problem({ id, error, onRetry, retryLabel = 'Try again' }: { id: string; error: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <p id={`${id}-err`} role="alert" className="form-error !text-[0.875rem]">
      {error}
      {onRetry && <button type="button" className="ml-2 inline-flex min-h-[44px] items-center font-bold underline underline-offset-2" onClick={onRetry}>{retryLabel}</button>}
    </p>
  )
}

export type FieldKind = 'text' | 'tel' | 'email' | 'date' | 'money' | 'textarea'

/** A box that saves itself when you leave it, tells you right under it if that failed, and offers to try again. */
export function SaveField({ id, label, kind = 'text', field, value, save, placeholder, hint, hideLabel = false, rows = 4, className = '' }: {
  id: string; label: string; kind?: FieldKind; field: string; value: string; save: SaveFn
  placeholder?: string; hint?: string; hideLabel?: boolean; rows?: number; className?: string
}) {
  const [text, setText] = useState(value)
  const focused = useRef(false)
  const s = useSaver(save)

  useEffect(() => { if (!focused.current && s.phase !== 'error') setText(value) }, [value, s.phase])

  const commit = (raw: string) => {
    const t = raw.trim()
    if (kind === 'money') {
      if (t !== '' && parseMoney(t) === null) return s.fail('Not saved. Enter an amount as a number, like 450.00.')
      if ((parseMoney(t) ?? 0) < 0) return s.fail('Not saved. An amount cannot be below zero.')
      if ((parseMoney(t) ?? null) === (parseMoney(value) ?? null)) { s.clear(); return }
      return void s.run({ [field]: parseMoney(t) })
    }
    if (t === value.trim()) { if (s.phase === 'error') s.clear(); return }
    if (kind === 'tel' && t) { const p = contactProblems(t, '').phone; if (p) return s.fail(`Not saved. ${p}`) }
    if (kind === 'email' && t) { const p = contactProblems('', t).email; if (p) return s.fail(`Not saved. ${p}`) }
    void s.run({ [field]: t })
  }

  const common = {
    id, value: text, placeholder, 'aria-invalid': s.phase === 'error' ? true : undefined, 'aria-describedby': s.phase === 'error' ? `${id}-err` : undefined,
    onFocus: () => { focused.current = true },
    onBlur: (e: { target: { value: string } }) => { focused.current = false; if (kind !== 'date') commit(e.target.value) },
  }

  return (
    <div className={className}>
      <div className="flex items-end justify-between gap-2">
        <label className={hideLabel ? 'sr-only' : 'form-label !text-[0.875rem]'} htmlFor={id}>{label}</label>
        {!hideLabel && <span className="mb-1.5"><Status phase={s.phase} /></span>}
      </div>
      {kind === 'textarea' ? (
        <textarea className="form-textarea" rows={rows} {...common} onChange={e => setText(e.target.value)} />
      ) : (
        <input
          className={`form-input ${kind === 'money' ? 'num' : ''}`}
          type={kind === 'date' ? 'date' : kind === 'tel' ? 'tel' : kind === 'email' ? 'email' : 'text'}
          inputMode={kind === 'money' ? 'decimal' : undefined}
          autoComplete="off"
          {...common}
          onChange={e => { setText(e.target.value); if (kind === 'date') commit(e.target.value) }}
        />
      )}
      {hideLabel && <div className="mt-1"><Status phase={s.phase} /></div>}
      {s.phase === 'error' ? <Problem id={id} error={s.error} onRetry={s.retryable ? s.retry : undefined} /> : hint ? <p className="form-hint !text-[0.875rem] !text-text-secondary">{hint}</p> : null}
    </div>
  )
}

/** A choice that saves the moment it is picked. If that fails the pick stays, so one tap on Try again repeats it. */
export function SaveSelect({ id, label, field, value, options, save, placeholder, className = '' }: {
  id: string; label: string; field: string; value: string; options: { value: string; label: string }[]; save: SaveFn; placeholder?: string; className?: string
}) {
  const [pick, setPick] = useState(value)
  const s = useSaver(save)
  useEffect(() => { if (s.phase !== 'error') setPick(value) }, [value, s.phase])
  return (
    <div className={className}>
      <div className="flex items-end justify-between gap-2">
        <label className="form-label !text-[0.875rem]" htmlFor={id}>{label}</label>
        <span className="mb-1.5"><Status phase={s.phase} /></span>
      </div>
      <select
        id={id} className="form-select" value={pick}
        aria-invalid={s.phase === 'error' ? true : undefined} aria-describedby={s.phase === 'error' ? `${id}-err` : undefined}
        onChange={e => { setPick(e.target.value); void s.run({ [field]: e.target.value }) }}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {s.phase === 'error' && <Problem id={id} error={s.error} onRetry={s.retryable ? s.retry : undefined} />}
    </div>
  )
}

/** A tick box that saves when you tap it. */
export function SaveCheck({ id, label, field, value, save, className = '' }: { id: string; label: string; field: string; value: boolean; save: SaveFn; className?: string }) {
  const [on, setOn] = useState(value)
  const s = useSaver(save)
  useEffect(() => { if (s.phase !== 'error') setOn(value) }, [value, s.phase])
  return (
    <div className={className}>
      <label htmlFor={id} className="flex min-h-[44px] cursor-pointer items-center gap-3">
        <input id={id} type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-blue))]" checked={on} onChange={e => { setOn(e.target.checked); void s.run({ [field]: e.target.checked }) }} aria-describedby={s.phase === 'error' ? `${id}-err` : undefined} />
        <span className="font-bold">{label}</span>
        <Status phase={s.phase} />
      </label>
      {s.phase === 'error' && <Problem id={id} error={s.error} onRetry={s.retryable ? s.retry : undefined} />}
    </div>
  )
}
