'use client'
import { useState } from 'react'
import type { ReactNode } from 'react'
import Icon from '@/components/Icon'
import { DAY_KEYS, DAY_LABELS, defaultWeekHours } from '@/lib/voice/rules'
import type { DayKey, WeekHours } from '@/lib/voice/rules'

/** The small controls the AI receptionist rules screen is built from. Each one is labelled, 44px tall and works from the keyboard. */

export function Panel({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel p-4 sm:p-5" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="section-title">{title}</h3>
      {description && <div className="mt-1 text-[0.9375rem] text-text-secondary">{description}</div>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

/** An on/off row. The word On or Off is always shown beside the switch. */
export function Switch({ label, hint, on, onChange, disabled }: { label: string; hint?: ReactNode; on: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="flex min-h-[52px] w-full items-center gap-3 rounded-lg px-1 py-2 text-left disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{label}</span>
        {hint && <span className="block text-[0.9375rem] text-text-secondary">{hint}</span>}
      </span>
      <span className={`w-8 shrink-0 text-right text-[0.875rem] font-bold ${on ? 'text-blue' : 'text-text-secondary'}`}>{on ? 'On' : 'Off'}</span>
      <span aria-hidden="true" className={`relative inline-block h-7 w-12 shrink-0 rounded-full border ${on ? 'border-blue bg-blue' : 'border-line bg-bg-input'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full ${on ? 'left-[1.5rem] bg-[rgb(var(--c-on-blue))]' : 'left-0.5 bg-text-secondary'}`} />
      </span>
    </button>
  )
}

/** One choice out of a few, each with a short explanation. */
export function Choice<T extends string>({ legend, name, value, options, onChange, disabled }: {
  legend: string; name: string; value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void; disabled?: boolean
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="form-label">{legend}</legend>
      <div className="space-y-2">
        {options.map(o => {
          const picked = o.value === value
          return (
            <label key={o.value} className={`flex min-h-[52px] cursor-pointer items-start gap-3 rounded-lg border p-3 ${picked ? 'border-blue bg-blue/[0.06]' : 'border-border bg-bg-card'} ${disabled ? 'opacity-60' : ''}`}>
              <input type="radio" name={name} value={o.value} checked={picked} onChange={() => onChange(o.value)} className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" />
              <span className="min-w-0">
                <span className="block font-bold">{o.label}</span>
                {o.hint && <span className="block text-[0.9375rem] text-text-secondary">{o.hint}</span>}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** A short list the owner adds to and removes from. */
export function ListEditor({ id, label, hint, placeholder, items, max, length, onChange, disabled }: {
  id: string; label: string; hint: string; placeholder: string; items: string[]; max: number; length: number; onChange: (items: string[]) => void; disabled?: boolean
}) {
  const [text, setText] = useState('')
  const trimmed = text.replace(/\s+/g, ' ').trim()
  const full = items.length >= max
  const duplicate = items.some(item => item.toLowerCase() === trimmed.toLowerCase())
  const add = () => {
    if (!trimmed || full || duplicate) return
    onChange([...items, trimmed.slice(0, length)])
    setText('')
  }
  return (
    <div>
      <label htmlFor={`${id}-input`} className="form-label">{label}</label>
      <div className="flex items-start gap-2">
        <input
          id={`${id}-input`} className="form-input flex-1" maxLength={length} value={text} onChange={e => setText(e.target.value)} placeholder={placeholder}
          disabled={disabled || full} aria-describedby={`${id}-hint`} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <button type="button" className="btn btn-secondary shrink-0" onClick={add} disabled={disabled || !trimmed || full || duplicate}>Add</button>
      </div>
      <p id={`${id}-hint`} className="form-hint !text-text-secondary">{full ? `That is the most you can keep (${max}). Remove one to add another.` : duplicate ? 'That one is already on the list.' : hint}</p>
      {items.length > 0 && (
        <ul className="ledger mt-2" aria-label={label}>
          {items.map(item => (
            <li key={item} className="flex items-start gap-2 px-1 py-2">
              <span className="min-w-0 flex-1 break-words text-[0.9375rem]">{item}</span>
              <button type="button" className="btn-icon -my-1 shrink-0" onClick={() => onChange(items.filter(o => o !== item))} disabled={disabled} aria-label={`Remove: ${item}`} title="Remove">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Open days and times, one row per day. */
export function HoursGrid({ hours, onChange, disabled }: { hours: WeekHours; onChange: (next: WeekHours) => void; disabled?: boolean }) {
  const set = (day: DayKey, patch: Partial<WeekHours[DayKey]>) => onChange({ ...hours, [day]: { ...hours[day], ...patch } })
  const copyWeekdays = () => {
    const mon = hours.mon
    onChange({ ...hours, tue: { ...mon }, wed: { ...mon }, thu: { ...mon }, fri: { ...mon } })
  }
  return (
    <div>
      <ul className="ledger" aria-label="Opening hours">
        {DAY_KEYS.map(day => {
          const h = hours[day]
          const bad = h.open && h.from >= h.to
          return (
            <li key={day} className="px-1 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <label className="flex min-h-[44px] w-36 shrink-0 cursor-pointer items-center gap-3">
                  <input type="checkbox" className="h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={h.open} disabled={disabled} onChange={e => set(day, { open: e.target.checked })} />
                  <span className="font-bold">{DAY_LABELS[day]}</span>
                </label>
                {h.open ? (
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`hrs-${day}-from`}>{DAY_LABELS[day]} opens</label>
                    <input id={`hrs-${day}-from`} type="time" className="form-input w-[8.5rem]" value={h.from} disabled={disabled} onChange={e => set(day, { from: e.target.value })} aria-invalid={bad || undefined} />
                    <span className="text-text-secondary" aria-hidden="true">to</span>
                    <label className="sr-only" htmlFor={`hrs-${day}-to`}>{DAY_LABELS[day]} closes</label>
                    <input id={`hrs-${day}-to`} type="time" className="form-input w-[8.5rem]" value={h.to} disabled={disabled} onChange={e => set(day, { to: e.target.value })} aria-invalid={bad || undefined} />
                  </div>
                ) : (
                  <span className="text-text-secondary">Closed</span>
                )}
              </div>
              {bad && <p className="form-error mt-1">Closing time must be after opening time.</p>}
            </li>
          )
        })}
      </ul>
      <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={copyWeekdays} disabled={disabled}>Use Monday&apos;s times for Tuesday to Friday</button>
    </div>
  )
}

export { defaultWeekHours }

/** Days the shop is closed even though the weekly hours say open (holidays). */
export function ClosedDates({ dates, onChange, disabled }: { dates: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const [value, setValue] = useState('')
  const add = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || dates.includes(value) || dates.length >= 60) return
    onChange([...dates, value].sort())
    setValue('')
  }
  const pretty = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  }
  return (
    <div>
      <label htmlFor="closed-date" className="form-label">Days you are closed (holidays)</label>
      <div className="flex items-start gap-2">
        <input id="closed-date" type="date" className="form-input flex-1" value={value} onChange={e => setValue(e.target.value)} disabled={disabled} aria-describedby="closed-date-hint" />
        <button type="button" className="btn btn-secondary shrink-0" onClick={add} disabled={disabled || !value || dates.includes(value)}>Add</button>
      </div>
      <p id="closed-date-hint" className="form-hint !text-text-secondary">On these days the assistant says you are closed, even if the weekly hours say open.</p>
      {dates.length > 0 && (
        <ul className="ledger mt-2" aria-label="Closed days">
          {dates.map(d => (
            <li key={d} className="flex items-center gap-2 px-1 py-1.5">
              <span className="num min-w-0 flex-1">{pretty(d)}</span>
              <button type="button" className="btn-icon shrink-0" onClick={() => onChange(dates.filter(x => x !== d))} disabled={disabled} aria-label={`Remove ${pretty(d)}`} title="Remove"><Icon name="close" className="h-5 w-5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
