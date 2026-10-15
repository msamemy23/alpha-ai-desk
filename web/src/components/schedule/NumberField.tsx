'use client'
import { useEffect, useState } from 'react'

/**
 * A number the person types. What they type is kept as typed until they leave the box, so clearing it to type a new
 * number does not jump to 0. The number is passed up as soon as it is a valid one inside the limits.
 */
export default function NumberField({ id, label, help, value, min, max, step = 1, suffix, onChange }: {
  id: string
  label: string
  help?: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (n: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const parsed = Number(text)
  const bad = text.trim() === '' || !Number.isFinite(parsed) || parsed < min || parsed > max
  return (
    <div>
      <label className="form-label" htmlFor={id}>{label}</label>
      <div className="relative">
        <input
          id={id}
          className={`form-input num ${suffix ? 'pr-16' : ''}`}
          inputMode={step < 1 ? 'decimal' : 'numeric'}
          autoComplete="off"
          value={text}
          aria-invalid={bad || undefined}
          aria-describedby={help ? `${id}-help` : undefined}
          onChange={e => {
            setText(e.target.value)
            const n = Number(e.target.value)
            if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(step >= 1 ? Math.round(n) : Math.round(n * 4) / 4)
          }}
          onBlur={() => { if (bad) setText(String(value)) }}
        />
        {suffix && <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.875rem] text-text-secondary">{suffix}</span>}
      </div>
      {help && <p id={`${id}-help`} className="mt-1 text-[0.8125rem] text-text-secondary">{help}</p>}
      {bad && text.trim() !== '' && <p role="alert" className="form-error !mt-1">Use a number from {min} to {max}.</p>}
    </div>
  )
}
