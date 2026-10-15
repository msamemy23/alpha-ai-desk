'use client'
import { useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { calculateDocumentTotals } from '@/lib/document-money'
import Icon from '@/components/Icon'
import { Field } from './LineCards'
import { ErrorMsg } from './Dialogs'
import type { Template } from './api'

const actions = 'mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'

const beforeTax = (t: Template) => calculateDocumentTotals({ parts: t.parts, labors: t.labors, shop_supplies: t.shop_supplies ?? 0, tax_rate: 0, apply_tax: false }).total

/** Pick a saved template to start from. Nothing about a customer is stored in a template, only the work. */
export function TemplatePicker({ templates, available, kindFilter, busy, error, onUse, onDelete, onClose }: {
  templates: Template[]
  available: boolean
  kindFilter: 'estimate' | 'invoice'
  busy: boolean
  error: string
  onUse: (t: Template) => void
  onDelete: (t: Template) => void
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return templates
      .filter(t => t.kind === 'any' || t.kind === kindFilter)
      .filter(t => words.every(w => `${t.name} ${t.description || ''}`.toLowerCase().includes(w)))
  }, [templates, q, kindFilter])

  if (!available) {
    return (
      <div>
        <p className="py-4 text-[0.9375rem] text-text-secondary">Templates need a database update first. Ask whoever manages your account to apply it.</p>
        <div className={actions}><button type="button" className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    )
  }
  if (templates.length === 0) {
    return (
      <div>
        <div className="empty-state">
          <p className="font-bold text-text-primary">No templates yet</p>
          <p className="mx-auto mt-1 max-w-md">Write an estimate you will quote again, like a brake job or a 60,000 mile service, then choose More, Save as a template. Next time, start from it in one tap.</p>
        </div>
        <div className={actions}><button type="button" className="btn btn-secondary" onClick={onClose}>Close</button></div>
      </div>
    )
  }
  return (
    <div>
      <input type="search" className="form-input" placeholder="Search templates" aria-label="Search templates" value={q} onChange={e => setQ(e.target.value)} />
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      {list.length === 0 ? (
        <p className="py-6 text-center text-[0.9375rem] text-text-secondary">No template matches “{q.trim()}”.</p>
      ) : (
        <ul className="ledger mt-3 max-h-[52dvh] overflow-y-auto overscroll-contain">
          {list.map(t => (
            <li key={t.id}>
              <div className="flex items-center">
                <button type="button" className="ledger-row min-w-0 flex-1" disabled={busy} onClick={() => onUse(t)}>
                  <span className="ledger-main">
                    <span className="ledger-title block">{t.name}</span>
                    <span className="ledger-sub block">{[t.description, `${t.labors.length} labor, ${t.parts.length} parts`].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="ledger-amt">{formatCurrency(beforeTax(t))}</span>
                </button>
                {confirm === t.id ? (
                  <span className="flex shrink-0 items-center gap-1 pr-2">
                    <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => { setConfirm(null); onDelete(t) }}>Delete</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirm(null)}>Keep</button>
                  </span>
                ) : (
                  <button type="button" className="btn-icon shrink-0" onClick={() => setConfirm(t.id)} aria-label={`Delete template ${t.name}`}>
                    <Icon name="trash" className="h-5 w-5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={actions}><button type="button" className="btn btn-secondary" onClick={onClose}>Close</button></div>
    </div>
  )
}

/** Save the lines on the open document as a template. */
export function SaveTemplateForm({ defaultName, partCount, laborCount, docKind, busy, error, onSave, onClose }: {
  defaultName: string
  partCount: number
  laborCount: number
  docKind: 'estimate' | 'invoice'
  busy: boolean
  error: string
  onSave: (v: { name: string; description: string; kind: 'estimate' | 'invoice' | 'any' }) => void
  onClose: () => void
}) {
  const [name, setName] = useState(defaultName)
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<'estimate' | 'invoice' | 'any'>('any')
  const ok = name.trim().length > 0 && name.trim().length <= 80
  return (
    <form onSubmit={e => { e.preventDefault(); if (ok && !busy) onSave({ name, description, kind }) }}>
      <p className="text-[0.9375rem] text-text-secondary">Saves {laborCount} labor and {partCount} parts lines, the shop supplies, notes and warranty. The customer and car are not saved.</p>
      <div className="mt-4 space-y-3">
        <Field id="tpl-name" label="Template name">
          <input id="tpl-name" className="form-input" value={name} maxLength={80} autoFocus onChange={e => setName(e.target.value)} placeholder="Front brake job" />
        </Field>
        <Field id="tpl-desc" label="Short description (optional)">
          <input id="tpl-desc" className="form-input" value={description} maxLength={400} onChange={e => setDescription(e.target.value)} placeholder="Pads, rotors and a brake fluid check" />
        </Field>
        <Field id="tpl-kind" label="Where it shows up">
          <select id="tpl-kind" className="form-select" value={kind} onChange={e => setKind(e.target.value as 'estimate' | 'invoice' | 'any')}>
            <option value="any">Estimates and invoices</option>
            <option value="estimate">Estimates only</option>
            <option value="invoice">Invoices only</option>
          </select>
          {docKind === 'estimate' && kind === 'invoice' && <p className="form-hint">You are saving from an estimate, but it will only be offered on invoices.</p>}
        </Field>
      </div>
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!ok || busy}>{busy ? 'Saving…' : 'Save template'}</button>
      </div>
    </form>
  )
}
