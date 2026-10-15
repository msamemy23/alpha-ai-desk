'use client'
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

export type Settings = Record<string, unknown>
export type SetSetting = (key: string, value: unknown) => void

const SettingsContext = createContext<{ settings: Settings; set: SetSetting; errors: Record<string, string> }>({ settings: {}, set: () => {}, errors: {} })
export const SettingsProvider = SettingsContext.Provider
export const useSettings = () => useContext(SettingsContext)

/** A titled group of fields on a panel. */
export function Group({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel p-4 sm:p-5">
      <h3 className="section-title">{title}</h3>
      {description && <div className="mt-1 text-[0.9375rem] text-text-secondary">{description}</div>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

type FieldBase = {
  k: string
  label: string
  hint?: ReactNode
}

const HINT = 'form-hint !text-text-secondary'

/** A text, number or secret input bound to one setting. */
export function TextField({
  k, label, hint, type = 'text', placeholder, mono, fallback, secret, autoComplete, inputMode, step, normalize,
}: FieldBase & {
  type?: 'text' | 'email' | 'number' | 'password' | 'url'
  placeholder?: string
  mono?: boolean
  /** What the field shows (and has always shown) when nothing is saved yet. */
  fallback?: string | number
  /** A credential: the server never sends it back, only whether one is saved. */
  secret?: boolean
  autoComplete?: string
  inputMode?: 'text' | 'decimal' | 'numeric' | 'tel' | 'email' | 'url'
  step?: string
  /** Tidies what was typed when the person leaves the field (for example a phone number). */
  normalize?: (value: string) => string
}) {
  const { settings, set, errors } = useSettings()
  const id = `set-${k}`
  const configured = Boolean(secret && settings[`${k}_configured`] === true)
  const raw = settings[k]
  const value = (raw as string | number | undefined | null) ?? fallback ?? ''
  const error = errors[k]
  const hintId = hint || configured ? `${id}-hint` : undefined
  const describedBy = [hintId, error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-[0.8125rem] font-bold text-text-secondary">{label}</label>
        {configured && <span className="tag tag-green"><span className="lamp lamp-green" aria-hidden="true" />Saved</span>}
      </div>
      <input
        id={id}
        className={`form-input ${mono ? 'font-mono' : ''} ${error ? 'border-red' : ''}`}
        type={type}
        value={value}
        onChange={e => set(k, e.target.value)}
        onBlur={normalize ? e => { const next = normalize(e.target.value); if (next !== e.target.value) set(k, next) } : undefined}
        // A mouse wheel over a focused number box would otherwise change the rate without anyone noticing.
        onWheel={type === 'number' ? e => e.currentTarget.blur() : undefined}
        placeholder={configured ? 'Saved. Type to replace it' : placeholder}
        autoComplete={secret ? 'new-password' : autoComplete ?? 'off'}
        autoCapitalize="none"
        spellCheck={false}
        inputMode={inputMode}
        step={step}
        min={type === 'number' ? 0 : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {error && <p id={`${id}-error`} className="form-error">{error}</p>}
      {(hint || configured) && (
        <p id={hintId} className={HINT}>
          {configured ? 'A value is saved and is never shown here. Leave this blank to keep it.' : hint}
          {configured && hint ? <> {hint}</> : null}
        </p>
      )}
    </div>
  )
}

export function TextAreaField({ k, label, hint, rows = 3, placeholder }: FieldBase & { rows?: number; placeholder?: string }) {
  const { settings, set } = useSettings()
  const id = `set-${k}`
  return (
    <div>
      <label htmlFor={id} className="form-label">{label}</label>
      <textarea
        id={id}
        className="form-textarea"
        rows={rows}
        value={(settings[k] as string) || ''}
        onChange={e => set(k, e.target.value)}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint && <p id={`${id}-hint`} className={HINT}>{hint}</p>}
    </div>
  )
}

export function SelectField({
  k, label, hint, options, fallback = '', onPick,
}: FieldBase & {
  options: { value: string; label: string }[]
  fallback?: string
  /** Runs after a new choice is stored, for choices that change other settings. */
  onPick?: (value: string) => void
}) {
  const { settings, set } = useSettings()
  const id = `set-${k}`
  const current = (settings[k] as string) || fallback
  // A saved value that is not on the list must still show as the current choice, never as the first option.
  const list = !current || options.some(o => o.value === current) ? options : [...options, { value: current, label: `${current} (saved)` }]
  return (
    <div>
      <label htmlFor={id} className="form-label">{label}</label>
      <select
        id={id}
        className="form-select"
        value={current}
        onChange={e => { set(k, e.target.value); onPick?.(e.target.value) }}
        aria-describedby={hint ? `${id}-hint` : undefined}
      >
        {list.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p id={`${id}-hint`} className={HINT}>{hint}</p>}
    </div>
  )
}
