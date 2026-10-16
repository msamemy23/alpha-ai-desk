'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Field, Section } from '@/components/forms/Field'
import type { Flash } from '@/components/forms/FlashNotice'
import FormActions from '@/components/forms/FormActions'
import FormError from '@/components/forms/FormError'
import ConfirmSheet from '@/components/forms/ConfirmSheet'
import Icon from '@/components/Icon'
import { EmptyBlock, FilterChips, SearchField } from '@/components/ListKit'
import Sheet from '@/components/Sheet'
import type { StockPart, Vendor } from '@/lib/inventory-logic'
import StockNotice, { LookOnly } from './StockNotice'
import VendorPrices from './VendorPrices'
import { needsBanner } from '@/lib/inventory-view'
import type { StockAct, StockData } from './useStock'

interface VForm { name: string; contact: string; email: string; phone: string; account_number: string; terms: string; lead_days: string; address: string; notes: string }
const blank = (): VForm => ({ name: '', contact: '', email: '', phone: '', account_number: '', terms: '', lead_days: '', address: '', notes: '' })
const formOf = (v: Vendor): VForm => ({ name: v.name, contact: v.contact, email: v.email, phone: v.phone, account_number: v.account_number, terms: v.terms, lead_days: v.lead_days === null ? '' : String(v.lead_days), address: v.address, notes: v.notes })

/** The shops and distributors you buy from: how to reach them, how they bill, how long they take, and what they charge. */
export default function VendorsPanel({ stock, parts, act, flash, reload, focusId, onFocused }: {
  stock: StockData
  parts: StockPart[]
  act: StockAct
  flash: (f: Flash) => void
  reload: () => void
  /** Open this vendor straight away (for example from an order that has no email to send to). */
  focusId: string | null
  onFocused: () => void
}) {
  const [show, setShow] = useState<'active' | 'archived'>('active')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const vendors = stock.vendors.value

  const focused = useRef<string | null>(null)
  useEffect(() => {
    if (focusId && focused.current !== focusId && vendors.some(v => v.id === focusId)) { focused.current = focusId; setEditing(focusId); onFocused() }
  }, [focusId, vendors, onFocused])

  const query = search.trim().toLowerCase()
  const list = useMemo(() => {
    const words = query.split(/\s+/).filter(Boolean)
    return vendors.filter(v => (show === 'active' ? v.active : !v.active) && (!words.length || words.every(w => [v.name, v.contact, v.email, v.phone, v.account_number].join(' ').toLowerCase().includes(w))))
  }, [vendors, show, query])
  const counts = useMemo(() => ({ active: vendors.filter(v => v.active).length, archived: vendors.filter(v => !v.active).length }), [vendors])
  const priced = (id: string) => stock.prices.value.filter(p => p.vendor_id === id).length

  if (stock.vendors.state !== 'ok') return <StockNotice r={stock.vendors} what="Your vendors" onRetry={reload} />
  const open = editing && editing !== 'new' ? vendors.find(v => v.id === editing) || null : null

  return (
    <div>
      {!stock.canBuy && <LookOnly what="Vendors" />}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:flex sm:items-center">
        <SearchField className="sm:min-w-0 sm:flex-1 sm:max-w-md" label="Search vendors" placeholder="Search vendors" value={search} onChange={setSearch} />
        <FilterChips label="Show vendors" value={show} onChange={setShow} options={[{ key: 'active', label: 'Active', count: counts.active }, { key: 'archived', label: 'Archived', count: counts.archived }]} />
        {stock.canBuy && <button type="button" className="btn btn-primary w-full sm:ml-auto sm:w-auto" onClick={() => setEditing('new')}><Icon name="plus" className="h-5 w-5" />Add vendor</button>}
      </div>

      {vendors.length === 0 ? (
        <EmptyBlock icon="box" title="No vendors yet" action={stock.canBuy ? <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Icon name="plus" className="h-5 w-5" />Add your first vendor</button> : undefined}>
          Add the shops and distributors you buy parts from. With an email address on file, an order can go straight to them. With prices saved, Alpha Desk suggests the cheapest.
        </EmptyBlock>
      ) : list.length === 0 ? (
        <EmptyBlock icon="search" title={query ? `No vendors match “${search.trim()}”` : show === 'archived' ? 'No archived vendors' : 'No active vendors'}>
          {show === 'archived' ? 'A vendor you stop using can be archived. It stays on old orders.' : 'Try a different search.'}
        </EmptyBlock>
      ) : (
        <ul className="ledger" aria-label="Vendors">
          {list.map(v => (
            <li key={v.id}>
              <button type="button" className="ledger-row w-full items-start py-3 text-left" onClick={() => setEditing(v.id)}>
                <span className="ledger-main">
                  <span className="ledger-title block !whitespace-normal">{v.name}</span>
                  <span className="ledger-sub num block !whitespace-normal">{[v.contact, v.phone, v.email].filter(Boolean).join(' · ') || 'No contact details yet'}</span>
                  <span className="ledger-sub block !whitespace-normal">{[v.terms, v.lead_days !== null ? `${v.lead_days} ${v.lead_days === 1 ? 'day' : 'days'} to deliver` : '', priced(v.id) ? `${priced(v.id)} ${priced(v.id) === 1 ? 'price' : 'prices'} saved` : ''].filter(Boolean).join(' · ')}</span>
                  {v.active && !v.email && <span className="mt-0.5 inline-flex items-center gap-1.5 text-[0.875rem] font-bold text-amber"><span className="lamp lamp-amber" aria-hidden="true" />No email, orders cannot be emailed</span>}
                </span>
                <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (editing === 'new' || open) && (
        <VendorSheet key={editing} vendor={open} stock={stock} parts={parts} act={act} flash={flash} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function VendorSheet({ vendor, stock, parts, act, flash, onClose }: { vendor: Vendor | null; stock: StockData; parts: StockPart[]; act: StockAct; flash: (f: Flash) => void; onClose: () => void }) {
  const canEdit = stock.canBuy
  const start = useMemo(() => (vendor ? formOf(vendor) : blank()), [vendor])
  const [form, setForm] = useState<VForm>(start)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState<'discard' | 'archive' | null>(null)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(start)
  const set = (k: keyof VForm) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))
  const err = (k: keyof VForm) => (errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `vn-${k}-err` } : {})

  const requestClose = () => { if (dirty) setAsking('discard'); else onClose() }

  const save = async () => {
    if (saving || !canEdit) return
    if (!form.name.trim()) { setErrors({ name: 'Type the vendor\'s name.' }); setError(''); document.getElementById('vn-name')?.focus(); return }
    setSaving(true); setErrors({}); setError('')
    const r = await act<{ vendor: Vendor }>({ action: 'vendor-save', id: vendor?.id, vendor: { ...form, lead_days: form.lead_days.trim() === '' ? null : form.lead_days } })
    setSaving(false)
    if (r.ok) { flash({ kind: 'success', text: vendor ? `${form.name.trim()} was saved.` : `${form.name.trim()} was added to your vendors.` }); onClose(); return }
    setErrors(r.fields)
    setError(r.needsUpdate ? 'Vendors need a one-time update to your Alpha Desk database first.' : needsBanner(r.fields, ['name', 'email', 'phone', 'lead_days']) ? r.message : '')
  }

  const setActive = async (active: boolean) => {
    if (!vendor) return
    setBusy(true); setError('')
    const r = await act({ action: 'vendor-active', id: vendor.id, active })
    setBusy(false)
    if (r.ok) {
      flash(active ? { kind: 'success', text: `${vendor.name} is active again.` } : { kind: 'success', text: `${vendor.name} was archived. It stays on old orders and its prices stay saved.`, action: { label: 'Undo', run: () => { void act({ action: 'vendor-active', id: vendor.id, active: true }) } } })
      onClose(); return
    }
    setAsking(null); setError(r.message)
  }

  return (
    <>
      <Sheet open={asking === null} onClose={requestClose} title={vendor ? vendor.name : 'Add vendor'} wide dirty={dirty}>
        <form className="space-y-5" noValidate onSubmit={e => { e.preventDefault(); void save() }}>
          <fieldset disabled={!canEdit || saving} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="vn-name" label="Vendor name (required)" error={errors.name} className="sm:col-span-2"><input id="vn-name" className="form-input" autoFocus={!vendor} autoComplete="off" {...err('name')} value={form.name} onChange={set('name')} placeholder="Keystone, O'Reilly commercial, the local machine shop" /></Field>
            <Field id="vn-contact" label="Person you deal with"><input id="vn-contact" className="form-input" autoComplete="off" value={form.contact} onChange={set('contact')} /></Field>
            <Field id="vn-email" label="Email for orders" error={errors.email} hint="Orders are emailed here after you review them."><input id="vn-email" className="form-input" type="email" inputMode="email" autoComplete="off" {...err('email')} value={form.email} onChange={set('email')} /></Field>
            <Field id="vn-phone" label="Phone" error={errors.phone}><input id="vn-phone" className="form-input num" inputMode="tel" autoComplete="off" {...err('phone')} value={form.phone} onChange={set('phone')} /></Field>
            <Field id="vn-account" label="Your account number"><input id="vn-account" className="form-input" autoComplete="off" value={form.account_number} onChange={set('account_number')} /></Field>
            <Field id="vn-terms" label="Payment terms"><input id="vn-terms" className="form-input" autoComplete="off" value={form.terms} onChange={set('terms')} placeholder="Net 30, pay at pickup" /></Field>
            <Field id="vn-lead" label="Days to deliver" error={errors.lead_days}><input id="vn-lead" className="form-input num" inputMode="numeric" autoComplete="off" {...err('lead_days')} value={form.lead_days} onChange={set('lead_days')} placeholder="2" /></Field>
            <Field id="vn-address" label="Address" className="sm:col-span-2"><input id="vn-address" className="form-input" autoComplete="off" value={form.address} onChange={set('address')} /></Field>
            <Field id="vn-notes" label="Notes" className="sm:col-span-2"><textarea id="vn-notes" className="form-textarea" rows={2} value={form.notes} onChange={set('notes')} placeholder="Cutoff for same-day delivery is 2 pm" /></Field>
          </fieldset>

          {vendor && (
            <Section title="Prices from this vendor">
              <VendorPrices vendor={vendor} parts={parts} prices={stock.prices.value} today={stock.today} canEdit={canEdit} act={act} />
            </Section>
          )}

          {error && <FormError>{error}</FormError>}
          <FormActions>
            {canEdit && <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save vendor'}</button>}
            <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={saving}>{canEdit ? 'Cancel' : 'Close'}</button>
            {canEdit && vendor && (vendor.active
              ? <button type="button" className="btn btn-ghost sm:ml-auto" onClick={() => setAsking('archive')} disabled={saving}>Archive vendor</button>
              : <button type="button" className="btn btn-secondary sm:ml-auto" onClick={() => void setActive(true)} disabled={saving || busy}>Make active again</button>)}
          </FormActions>
        </form>
      </Sheet>
      <ConfirmSheet open={asking === 'discard'} title="Discard your changes?" confirmLabel="Discard changes" cancelLabel="Keep editing" onConfirm={onClose} onCancel={() => setAsking(null)}>
        <p>You typed changes to this vendor that are not saved yet. If you leave now they are lost.</p>
      </ConfirmSheet>
      <ConfirmSheet open={asking === 'archive'} title={`Archive ${vendor?.name || 'this vendor'}?`} confirmLabel="Archive vendor" busyLabel="Archiving…" cancelLabel="Keep active" danger={false} busy={busy} error={error} onConfirm={() => void setActive(false)} onCancel={() => setAsking(null)}>
        <p>It no longer appears when you write a new order. Old orders keep its name, its saved prices stay, and you can make it active again any time. Nothing is deleted.</p>
      </ConfirmSheet>
    </>
  )
}
