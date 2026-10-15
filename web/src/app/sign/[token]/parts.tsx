'use client'
import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import Icon from '@/components/Icon'
import { isHexColor, readableOn } from '@/lib/doc-prefs'
import type { DisplayLine } from '@/lib/doc-lines'
import type { PublicChoice, PublicGroup, PublicOption, PublicShop } from '@/lib/doc-public'

// The pieces of the customer page: the frame with the shop's name and logo, status cards, job cards with an
// approve / decline choice, the good / better / best picker, and the totals. Everything is plain words, 44px
// targets and design tokens. The shop's accent colour is the one inline colour, applied only to the top line
// and the main button.

export const money = (n: number): string => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function fmtDay(value?: string): string {
  if (!value) return ''
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export function fmtDateTime(value?: string): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
}

export const telHref = (phone: string): string => 'tel:' + phone.replace(/[^\d+]/g, '')

/** The main button in the shop's colour when it has one, otherwise the app's own. */
export function accentButton(accent: string): { className: string; style?: CSSProperties } {
  if (isHexColor(accent)) return { className: 'btn btn-lg w-full', style: { backgroundColor: accent, color: readableOn(accent) } }
  return { className: 'btn btn-primary btn-lg w-full' }
}

export function ButtonSpinner() {
  return <span aria-hidden="true" className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />
}

/** The shop's name, logo, address and phone across the top, so the customer knows who is asking. */
export function Frame({ shop, accent, logoSrc, fallbackName, children }: { shop: Partial<PublicShop>; accent?: string; logoSrc?: string | null; fallbackName: string; children: ReactNode }) {
  const [logoOk, setLogoOk] = useState(true)
  const line = isHexColor(accent || '') ? { borderTopColor: accent, borderTopWidth: 4, borderTopStyle: 'solid' as const } : undefined
  return (
    <div className="min-h-dvh bg-bg-base text-text-primary">
      <header className="border-b border-border bg-bg-chrome print:bg-transparent" style={line}>
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3 sm:px-6">
          {logoSrc && logoOk && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoSrc} alt="" className="h-12 w-auto max-w-[140px] shrink-0 rounded object-contain" onError={() => setLogoOk(false)} />
          )}
          <div className="min-w-0">
            <p className="display break-words text-[1.25rem] font-bold leading-tight">{shop.name || fallbackName}</p>
            {(shop.address || shop.phone) && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[0.9375rem] text-text-secondary">
                {shop.address && <span className="break-words">{shop.address}</span>}
                {shop.phone && (
                  <a href={telHref(shop.phone)} className="inline-flex min-h-[44px] items-center gap-1.5 font-bold text-blue underline-offset-4 hover:underline sm:min-h-0">
                    <Icon name="phone" className="h-4 w-4" />
                    {shop.phone}
                  </a>
                )}
              </p>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-5 sm:px-6">{children}</main>
    </div>
  )
}

/** One calm message: a lamp, a plain title and what to do next. */
export function StatusCard({ lamp, title, children }: { lamp: 'green' | 'amber' | 'red'; title: string; children: ReactNode }) {
  return (
    <section className="panel mt-4 p-5 sm:p-7" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
        <h1 className="display text-[1.5rem] font-bold leading-tight">{title}</h1>
      </div>
      <div className="mt-3 space-y-2 text-[1rem] leading-relaxed text-text-secondary">{children}</div>
    </section>
  )
}

/* ───────────────────────── Lines ───────────────────────── */

export function LinesList({ lines }: { lines: DisplayLine[] }) {
  return (
    <ul className="divide-y divide-border">
      {lines.map((l, i) => {
        const qtyText = l.kind === 'labor' || l.kind === 'core' || l.qty === 1 ? '' : `${l.qty} × ${money(l.unit)}`
        const sub = [l.detail, qtyText].filter(Boolean).join(' · ')
        return (
          <li key={i} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="break-words leading-snug">
                {l.description}
                {l.kind === 'fee' && <span className="tag tag-gray ml-2 align-middle">Fee</span>}
                {l.kind === 'sublet' && <span className="tag tag-gray ml-2 align-middle">Outside work</span>}
              </p>
              {sub && <p className="num mt-0.5 break-words text-[0.875rem] text-text-secondary">{sub}</p>}
              {l.note && <p className="mt-0.5 break-words text-[0.875rem] text-text-secondary">{l.note}</p>}
            </div>
            <div className="shrink-0 text-right">
              {l.listTotal > l.total && (
                <span className="num block text-[0.8125rem] text-text-muted line-through">
                  <span className="sr-only">Was </span>{money(l.listTotal)}
                </span>
              )}
              <span className="num font-bold">{money(l.total)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ───────────────────────── Approve or decline a job ───────────────────────── */

export type Decision = 'approve' | 'decline'

export function DecisionToggle({ id, value, onChange, disabled }: { id: string; value: Decision; onChange: (v: Decision) => void; disabled?: boolean }) {
  const item = (v: Decision, label: string, tone: string) => (
    <label
      className={`flex min-h-[48px] flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border-2 px-3 text-[0.9375rem] font-bold has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue/40 ${
        value === v ? tone : 'border-line bg-bg-card text-text-secondary hover:bg-bg-hover'
      } ${disabled ? 'opacity-60' : ''}`}
    >
      <input type="radio" name={id} value={v} checked={value === v} disabled={disabled} onChange={() => onChange(v)} className="sr-only" />
      {value === v && <Icon name={v === 'approve' ? 'check' : 'close'} className="h-5 w-5" />}
      {label}
    </label>
  )
  return (
    <div role="radiogroup" aria-label="Your answer for this job" className="flex gap-2">
      {item('approve', 'Approve', 'border-green bg-green/[0.14] text-text-primary')}
      {item('decline', 'Decline', 'border-red bg-red/[0.12] text-text-primary')}
    </div>
  )
}

export function JobCard({ group, decision, onDecide, interactive, disabled }: {
  group: PublicGroup
  decision?: Decision
  onDecide?: (v: Decision) => void
  interactive: boolean
  disabled?: boolean
}) {
  const declining = interactive && decision === 'decline'
  return (
    <section aria-labelledby={`job-${group.key}`} className="panel overflow-hidden" data-job={group.key}>
      <div className="panel-header">
        <h3 id={`job-${group.key}`} className="section-title min-w-0 break-words">{group.name}</h3>
        <span className="num shrink-0 font-bold">{money(group.total)}</span>
      </div>
      <div className="px-4 sm:px-5"><LinesList lines={group.lines} /></div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-[0.875rem] text-text-secondary sm:px-5">
        <span>Before tax <span className="num">{money(group.subtotal)}</span></span>
        {group.tax > 0 && <span>Tax <span className="num">{money(group.tax)}</span></span>}
      </div>
      {interactive && onDecide ? (
        <div className="border-t border-border p-4 sm:px-5">
          <DecisionToggle id={`decision-${group.key}`} value={decision || 'approve'} onChange={onDecide} disabled={disabled} />
          {declining && <p className="mt-2 flex items-center gap-2 text-[0.875rem] font-bold text-red"><span className="lamp lamp-red" aria-hidden="true" />You are declining this job. It will not be done and is not in your total.</p>}
        </div>
      ) : group.approved ? (
        <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-[0.9375rem] font-bold sm:px-5">
          <span className="lamp lamp-green" aria-hidden="true" />Approved
        </div>
      ) : null}
    </section>
  )
}

/* ───────────────────────── Good, better, best ───────────────────────── */

export function OptionPicker({ option, value, onChange, disabled }: {
  option: PublicOption
  value: string | undefined
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const card = (selected: boolean) =>
    `flex cursor-pointer items-start gap-3 rounded-md border-2 p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-blue/40 ${selected ? 'border-blue bg-blue/10' : 'border-line bg-bg-card hover:bg-bg-hover'} ${disabled ? 'opacity-60' : ''}`
  return (
    <fieldset className="panel p-4 sm:p-5" data-option={option.id}>
      <legend className="section-title px-1">{option.name}</legend>
      <p className="form-hint mt-0">Pick one. Only the one you pick is added to your total.</p>
      <div role="radiogroup" aria-label={option.name} className="mt-3 space-y-2.5">
        {option.choices.map((c: PublicChoice) => (
          <label key={c.id} className={card(value === c.id)}>
            <input type="radio" name={`option-${option.id}`} value={c.id} checked={value === c.id} disabled={disabled} onChange={() => onChange(c.id)} className="mt-1 h-5 w-5 shrink-0 accent-blue" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="font-bold">{c.label}{c.recommended && <span className="tag tag-blue ml-2 align-middle">Recommended</span>}</span>
                <span className="num font-bold">{money(c.total)}</span>
              </span>
              {c.description && <span className="mt-1 block text-[0.9375rem] text-text-secondary">{c.description}</span>}
              <details className="mt-1">
                <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[0.875rem] font-bold text-blue sm:min-h-0">What is included</summary>
                <div className="mt-1"><LinesList lines={c.lines} /></div>
                <p className="num mt-1 text-[0.8125rem] text-text-secondary">Before tax {money(c.subtotal)}{c.tax > 0 ? `, tax ${money(c.tax)}` : ''}</p>
              </details>
            </span>
          </label>
        ))}
        <label className={card(value === 'none')}>
          <input type="radio" name={`option-${option.id}`} value="none" checked={value === 'none'} disabled={disabled} onChange={() => onChange('none')} className="mt-1 h-5 w-5 shrink-0 accent-blue" />
          <span className="min-w-0 flex-1">
            <span className="font-bold">No thanks</span>
            <span className="mt-0.5 block text-[0.9375rem] text-text-secondary">Skip this one. The shop will keep it on file in case you change your mind.</span>
          </span>
        </label>
      </div>
    </fieldset>
  )
}

/* ───────────────────────── Totals ───────────────────────── */

export interface TotalRow { label: string; amount: number; tone?: 'save' }

export function TotalsBlock({ rows, total, totalLabel = 'Total' }: { rows: TotalRow[]; total: number; totalLabel?: string }) {
  return (
    <dl className="ml-auto w-full max-w-xs space-y-1.5 text-[0.9375rem]" data-testid="totals">
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between gap-4">
          <dt className="text-text-secondary">{r.label}</dt>
          <dd className={`num ${r.tone === 'save' ? 'font-bold text-green' : ''}`}>{r.tone === 'save' ? '−' : ''}{money(r.amount)}</dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
        <dt className="font-bold">{totalLabel}</dt>
        <dd className="display num text-[1.375rem] font-bold">{money(total)}</dd>
      </div>
    </dl>
  )
}

/**
 * Where paying online will go. It shows nothing today. A later feature fills it in when the shop can take payments
 * through the link; the page already passes it what it needs (the amount due, the deposit and the link's secret).
 */
export function PaySlot(_props: { balanceDue: number; deposit: number; token: string }) {
  void _props
  return null
}
