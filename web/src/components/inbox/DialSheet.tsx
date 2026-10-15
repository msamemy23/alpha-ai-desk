'use client'
import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

/** A number box with a dial pad. Tapping Call hands the number to the softphone. */
export default function DialSheet({ onClose, onDial }: { onClose: () => void; onDial: (number: string) => void }) {
  const [num, setNum] = useState('')
  const box = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Skip on phones: the keyboard would cover the dial pad.
    if (window.matchMedia('(pointer: coarse)').matches) return
    const id = requestAnimationFrame(() => box.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [])

  const digits = num.replace(/\D/g, '')
  const ready = digits.length >= 10

  return (
    <Sheet open onClose={onClose} title="Call a number">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (ready) { onDial(num.trim()); onClose() } }}>
        <div>
          <label className="form-label" htmlFor="dial-num">Phone number</label>
          <input
            ref={box} id="dial-num" type="tel" inputMode="tel" autoComplete="off"
            className="form-input display num text-center text-[1.5rem] font-bold" placeholder="(713) 000-0000"
            value={num} onChange={e => setNum(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Dial pad">
          {KEYS.map(k => (
            <button key={k} type="button" className="btn btn-secondary display num h-14 text-[1.5rem]" onClick={() => setNum(n => n + k)} aria-label={k === '*' ? 'Star' : k === '#' ? 'Pound' : k}>{k}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary h-14 w-16 shrink-0 px-0" onClick={() => setNum(n => n.slice(0, -1))} disabled={!num} aria-label="Delete last digit">
            <Icon name="back" className="h-6 w-6" />
          </button>
          <button type="submit" className="btn btn-primary btn-lg flex-1" disabled={!ready}>
            <Icon name="phone" className="h-5 w-5" />Call
          </button>
        </div>
        {!ready && num && <p className="form-hint">Enter all 10 digits to call.</p>}
      </form>
    </Sheet>
  )
}
