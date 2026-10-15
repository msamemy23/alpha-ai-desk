'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import Icon from '@/components/Icon'

/**
 * Small controls shared by the growth, automations, connected apps and
 * agents-and-tools screens: an on/off switch, a segmented control and a toast.
 */

/** An on/off switch. The word that says what it does goes in the label; the state is shown by position, colour and a tick. */
export function Switch({
  checked, onChange, label, disabled = false,
}: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-grid h-11 w-14 shrink-0 place-items-center rounded-md border-0 bg-transparent disabled:opacity-50"
    >
      <span className={`relative block h-7 w-12 rounded-full border transition-colors ${checked ? 'border-blue bg-blue' : 'border-[rgb(var(--c-line))] bg-bg-input'}`}>
        <span
          className={`absolute top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full transition-all ${checked ? 'left-[1.625rem] bg-[rgb(var(--c-on-blue))] text-blue' : 'left-1 bg-text-secondary'}`}
        >
          {checked && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} />}
        </span>
      </span>
    </button>
  )
}

export interface SegmentOption<T extends string> { key: T; label: string }

/**
 * A segmented control that switches between views of the same screen.
 * Arrow keys move between segments. Pair each panel with
 * id={`${idPrefix}-panel`} and aria-labelledby={`${idPrefix}-tab-${key}`}.
 */
export function Segmented<T extends string>({
  label, options, value, onChange, idPrefix, columns = 'grid-cols-3 sm:grid-cols-6',
}: { label: string; options: SegmentOption<T>[]; value: T; onChange: (key: T) => void; idPrefix: string; columns?: string }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    else return
    e.preventDefault()
    onChange(options[next].key)
    refs.current[options[next].key]?.focus()
  }
  return (
    <div role="tablist" aria-label={label} className={`grid ${columns} gap-1 rounded-lg border border-border bg-bg-chrome p-1`}>
      {options.map((o, i) => {
        const on = o.key === value
        return (
          <button
            key={o.key}
            ref={el => { refs.current[o.key] = el }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${o.key}`}
            aria-selected={on}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.key)}
            onKeyDown={e => move(e, i)}
            className={`flex min-h-[44px] items-center justify-center rounded-md border px-2 text-center text-[0.9375rem] font-bold leading-tight transition-colors ${on ? 'border-border bg-bg-card text-blue' : 'border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export type ToastKind = 'success' | 'error' | 'info'
export interface ToastState { id: number; message: string; kind: ToastKind }

/** Holds the current toast. `notify` replaces whatever is showing. */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)
  const seq = useRef(0)
  const notify = useCallback((message: string, kind: ToastKind = 'info') => {
    seq.current += 1
    setToast({ id: seq.current, message, kind })
  }, [])
  const dismiss = useCallback(() => setToast(null), [])
  return { toast, notify, dismiss }
}

/** A short message that floats above the phone tab bar. Errors stay longer. */
export function ScreenToast({ toast, onClose }: { toast: ToastState | null; onClose: () => void }) {
  const id = toast?.id
  const kind = toast?.kind
  useEffect(() => {
    if (id === undefined) return
    const t = setTimeout(onClose, kind === 'error' ? 9000 : 4500)
    return () => clearTimeout(t)
  }, [id, kind, onClose])
  if (!toast) return null
  const lamp = toast.kind === 'success' ? 'lamp-green' : toast.kind === 'error' ? 'lamp-red' : 'lamp-blue'
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4 lg:bottom-6"
      style={{ bottom: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 0.75rem)' }}
    >
      <div
        role={toast.kind === 'error' ? 'alert' : 'status'}
        className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border border-[rgb(var(--c-line))] bg-bg-card py-2 pl-4 pr-1 text-[0.9375rem] text-text-primary animate-fade-in"
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <span className={`lamp ${lamp} mt-[0.8rem]`} aria-hidden="true" />
        <p className="min-w-0 flex-1 break-words py-2">{toast.message}</p>
        <button type="button" className="btn-icon shrink-0" onClick={onClose} aria-label="Dismiss message">
          <Icon name="close" className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

/** A label + value line used in detail lists. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.8125rem] font-bold text-text-secondary">{label}</dt>
      <dd className="break-words text-[0.9375rem] text-text-primary">{children}</dd>
    </div>
  )
}

const KEEP_CASE = new Set(['Google', 'Facebook', 'Instagram', 'TikTok', 'Alpha', 'Chrome', 'Windows'])

/** Sentence-case version of a title that arrives in Title Case from the server. Keeps acronyms and brand names. */
export function sentenceCase(text: string): string {
  const words = text.trim().split(/\s+/)
  return words
    .map((w, i) => {
      if (w.length === 1 && i > 0) return w
      if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w
      if (i > 0 && KEEP_CASE.has(w.replace(/[^A-Za-z]/g, ''))) return w
      const lower = w.toLowerCase()
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}
