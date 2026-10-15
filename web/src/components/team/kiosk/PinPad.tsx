'use client'
import { useEffect, useRef } from 'react'
import Icon from '@/components/Icon'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

/** A big number pad for the shop tablet. Also takes a keyboard. The PIN is shown as dots and is never written anywhere. */
export default function PinPad({ value, onChange, onSubmit, busy, error, label }: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  busy: boolean
  error: string
  label: string
}) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { box.current?.focus() }, [])

  const add = (d: string) => { if (!busy && value.length < 8) onChange(value + d) }
  const keyClass = 'flex min-h-[64px] items-center justify-center rounded-lg border border-line bg-bg-card text-[1.5rem] font-bold hover:bg-bg-hover active:bg-bg-hover disabled:opacity-60'

  return (
    <div
      ref={box}
      tabIndex={-1}
      className="mx-auto w-full max-w-[20rem] outline-none"
      onKeyDown={e => {
        if (/^\d$/.test(e.key)) { e.preventDefault(); add(e.key) }
        else if (e.key === 'Backspace') { e.preventDefault(); if (!busy) onChange(value.slice(0, -1)) }
        else if (e.key === 'Enter' && value.length >= 4) { e.preventDefault(); onSubmit() }
      }}
    >
      <p className="text-center font-bold">{label}</p>
      <div className="my-3 flex min-h-[2.5rem] items-center justify-center gap-2" role="img" aria-label={`${value.length} ${value.length === 1 ? 'number' : 'numbers'} entered`}>
        {Array.from({ length: Math.max(4, value.length) }, (_, i) => (
          <span key={i} className={`h-4 w-4 rounded-full border-2 ${i < value.length ? 'border-blue bg-blue' : 'border-line'}`} />
        ))}
      </div>
      <p role="alert" className={`min-h-[1.5rem] text-center text-[0.9375rem] ${error ? 'font-bold text-red' : ''}`}>{error}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {KEYS.map(k => <button key={k} type="button" className={keyClass} disabled={busy} onClick={() => add(k)} aria-label={k}>{k}</button>)}
        <button type="button" className={`${keyClass} !text-[1rem]`} disabled={busy || value.length === 0} onClick={() => onChange('')}>Clear</button>
        <button type="button" className={keyClass} disabled={busy} onClick={() => add('0')} aria-label="0">0</button>
        <button type="button" className={keyClass} disabled={busy || value.length === 0} onClick={() => onChange(value.slice(0, -1))} aria-label="Delete the last number"><Icon name="back" className="h-6 w-6" /></button>
      </div>
      <button type="button" className="btn btn-primary mt-3 min-h-[56px] w-full text-[1.125rem]" disabled={busy || value.length < 4} onClick={onSubmit}>
        {busy ? 'Checking…' : 'Continue'}
      </button>
    </div>
  )
}
