'use client'
import { useMemo, useState } from 'react'
import { Field } from '@/components/forms/Field'
import type { Flash } from '@/components/forms/FlashNotice'
import FormActions from '@/components/forms/FormActions'
import FormError from '@/components/forms/FormError'
import ConfirmSheet from '@/components/forms/ConfirmSheet'
import Icon from '@/components/Icon'
import { EmptyBlock, FilterChips, Pill, SearchField } from '@/components/ListKit'
import Sheet from '@/components/Sheet'
import { RETURN_KINDS, RETURN_STATUS, returnsSummary } from '@/lib/inventory-logic'
import type { PartReturn, ReturnKind, ReturnStatus, StockPart } from '@/lib/inventory-logic'
import { normPart, parseCount, parseMoney } from '@/lib/list-logic'
import StockNotice from './StockNotice'
import type { StockAct, StockData } from './useStock'
import { dayWords, daysBetween, needsBanner, usd } from '@/lib/inventory-view'

type Show = 'active' | 'credited' | 'cancelled' | 'all'
const kindLabel = (k: ReturnKind) => RETURN_KINDS.find(x => x.key === k)?.label || k
const statusLabel = (s: ReturnStatus) => RETURN_STATUS.find(x => x.key === s)?.label || s
const LAMP: Record<ReturnStatus, 'amber' | 'blue' | 'green' | 'off'> = { open: 'amber', shipped: 'blue', credited: 'green', cancelled: 'off' }

interface RForm { description: string; kind: ReturnKind; qty: string; amount: string; vendor_id: string; part_id: string; status: ReturnStatus; reference: string; note: string; opened_on: string; credited_on: string }
const blank = (today: string): RForm => ({ description: '', kind: 'core', qty: '1', amount: '', vendor_id: '', part_id: '', status: 'open', reference: '', note: '', opened_on: today, credited_on: '' })
const formOf = (r: PartReturn): RForm => ({ description: r.description, kind: r.kind, qty: String(r.qty), amount: r.amount > 0 ? r.amount.toFixed(2) : '', vendor_id: r.vendor_id || '', part_id: r.part_id || '', status: r.status, reference: r.reference, note: r.note, opened_on: r.opened_on, credited_on: r.credited_on || '' })

/** Parts going back to a vendor: old cores, warranty returns, wrong parts. Tracks what is owed in credit so none of it is forgotten. */
export default function ReturnsPanel({ stock, parts, act, flash, reload }: { stock: StockData; parts: StockPart[]; act: StockAct; flash: (f: Flash) => void; reload: () => void }) {
  const [show, setShow] = useState<Show>('active')
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const list = stock.returns.value
  const today = stock.today
  const vendors = stock.vendors.value
  const summary = useMemo(() => returnsSummary(list, today), [list, today])
  const shown = useMemo(() => list.filter(r => (show === 'all' ? true : show === 'active' ? r.status === 'open' || r.status === 'shipped' : r.status === show)), [list, show])
  const counts = useMemo(() => ({ active: list.filter(r => r.status === 'open' || r.status === 'shipped').length, credited: list.filter(r => r.status === 'credited').length, cancelled: list.filter(r => r.status === 'cancelled').length }), [list])

  if (stock.returns.state !== 'ok') return <StockNotice r={stock.returns} what="Returns and cores" onRetry={reload} />
  const open = editing && editing !== 'new' ? list.find(r => r.id === editing) || null : null
  const vendorName = (id: string | null) => (id ? vendors.find(v => v.id === id)?.name || '' : '')

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips label="Show returns" scroll value={show} onChange={setShow} options={[{ key: 'active', label: 'Still open', count: counts.active }, { key: 'credited', label: 'Credit received', count: counts.credited }, { key: 'cancelled', label: 'Cancelled', count: counts.cancelled }, { key: 'all', label: 'All', count: list.length }]} />
        {stock.canAdjust && <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => setEditing('new')}><Icon name="plus" className="h-5 w-5" />Add a return</button>}
      </div>

      {summary.open + summary.shipped > 0 && (
        <p className="num mb-3 text-[0.9375rem] text-text-secondary" aria-live="polite">
          <span className="font-bold text-text-primary">{summary.open}</span> to send back · <span className="font-bold text-text-primary">{summary.shipped}</span> waiting for credit · <span className="font-bold text-text-primary">{usd(summary.waitingCredit)}</span> owed to you
          {summary.overdue > 0 && <> · <span className="font-bold text-red">{summary.overdue} open over 30 days ({usd(summary.overdueCredit)})</span></>}
        </p>
      )}

      {list.length === 0 ? (
        <EmptyBlock icon="repeat" title="No returns or cores yet" action={stock.canAdjust ? <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Icon name="plus" className="h-5 w-5" />Add your first return</button> : undefined}>
          Write down an old part you owe a vendor for a core credit, a warranty swap or a wrong part. You will see what is still out and how much credit is owed.
        </EmptyBlock>
      ) : shown.length === 0 ? (
        <EmptyBlock icon="search" title="Nothing here" action={<button type="button" className="btn btn-secondary" onClick={() => setShow('all')}>Show all returns</button>}>Nothing matches this view.</EmptyBlock>
      ) : (
        <ul className="ledger" aria-label="Returns and cores">
          {shown.map(r => {
            const age = r.status === 'open' || r.status === 'shipped' ? daysBetween(r.opened_on, today) : 0
            return (
              <li key={r.id}>
                <button type="button" className="ledger-row w-full items-start py-3 text-left" onClick={() => setEditing(r.id)}>
                  <span className="ledger-main">
                    <span className="ledger-title block !whitespace-normal">{r.qty > 1 ? `${r.qty} × ` : ''}{r.description}</span>
                    <span className="ledger-sub num block !whitespace-normal">{[kindLabel(r.kind), vendorName(r.vendor_id), r.reference, `opened ${dayWords(r.opened_on, today)}`].filter(Boolean).join(' · ')}</span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Pill lamp={LAMP[r.status]}>{statusLabel(r.status)}</Pill>
                      {age > 30 && <Pill lamp="red">{age} days open</Pill>}
                    </span>
                  </span>
                  <span className="ledger-amt">{r.amount > 0 ? usd(r.amount) : ''}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {editing && (editing === 'new' || open) && (
        <ReturnSheet key={editing} ret={open} stock={stock} parts={parts} act={act} flash={flash} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}

function ReturnSheet({ ret, stock, parts, act, flash, onClose }: { ret: PartReturn | null; stock: StockData; parts: StockPart[]; act: StockAct; flash: (f: Flash) => void; onClose: () => void }) {
  const today = stock.today
  const start = useMemo(() => (ret ? formOf(ret) : blank(today)), [ret, today])
  const [formNow, setForm] = useState<RForm>(start)
  const form = formNow
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState(false)
  const [find, setFind] = useState('')
  const dirty = JSON.stringify(form) !== JSON.stringify(start)
  const set = (k: keyof RForm) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))
  const part = parts.find(p => p.id === form.part_id) || null
  const vendors = stock.vendors.value.filter(v => v.active || v.id === form.vendor_id)

  const query = find.trim().toLowerCase()
  const matches = useMemo(() => {
    const words = query.split(/\s+/).filter(Boolean)
    return !words.length ? [] : parts.filter(p => { const hay = [p.name, p.part_number, p.brand].join(' ').toLowerCase(); return words.every(w => hay.includes(w) || normPart(hay).includes(normPart(w))) }).slice(0, 5)
  }, [parts, query])

  const choosePart = (p: StockPart) => { setForm(f => ({ ...f, part_id: p.id, description: f.description.trim() ? f.description : p.name })); setFind('') }

  const save = async (patch: Partial<RForm> = {}) => {
    if (saving) return
    const form = { ...formNow, ...patch }
    const found: Record<string, string> = {}
    if (!form.description.trim()) found.description = 'Describe what is going back.'
    const qty = parseCount(form.qty)
    if (qty === null || qty < 1) found.qty = 'How many: a whole number, 1 or more.'
    if (form.amount.trim() !== '' && (parseMoney(form.amount) === null || (parseMoney(form.amount) ?? 0) < 0)) found.amount = 'Enter the credit as a number, like 25.00.'
    setErrors(found)
    if (Object.keys(found).length) { setError(''); return }
    setSaving(true); setError('')
    const r = await act({
      action: 'return-save', id: ret?.id,
      ret: { description: form.description, kind: form.kind, qty, amount: form.amount.trim() === '' ? 0 : parseMoney(form.amount), vendor_id: form.vendor_id, part_id: form.part_id, status: form.status, reference: form.reference, note: form.note, opened_on: form.opened_on, credited_on: form.status === 'credited' ? form.credited_on : '' },
    })
    setSaving(false)
    if (r.ok) { flash({ kind: 'success', text: ret ? 'The return was saved.' : 'The return was added.' }); onClose(); return }
    setErrors(r.fields)
    setError(r.needsUpdate ? 'Returns need a one-time update to your Alpha Desk database first.' : needsBanner(r.fields, ['description', 'qty', 'amount', 'opened_on', 'credited_on']) ? r.message : '')
  }

  const requestClose = () => { if (dirty) setAsking(true); else onClose() }
  const readOnly = !stock.canAdjust

  return (
    <>
      <Sheet open={!asking} onClose={requestClose} title={ret ? 'Return' : 'Add a return'} wide dirty={dirty}>
        <form className="space-y-5" noValidate onSubmit={e => { e.preventDefault(); void save() }}>
          <fieldset disabled={readOnly || saving} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              {part ? (
                <p className="flex flex-wrap items-center gap-2 text-[0.9375rem]">
                  <span className="font-bold">From your stock:</span> {part.name}
                  <button type="button" className="font-bold text-blue underline-offset-4 hover:underline" onClick={() => setForm(f => ({ ...f, part_id: '' }))}>Not this part</button>
                </p>
              ) : (
                <>
                  <SearchField label="Search your stock (optional)" placeholder="Pick it from your stock (optional)" value={find} onChange={setFind} />
                  {query && matches.length > 0 && (
                    <ul className="ledger mt-2" aria-label="Parts that match">
                      {matches.map(p => <li key={p.id}><button type="button" className="ledger-row w-full text-left" onClick={() => choosePart(p)}><span className="ledger-main"><span className="ledger-title block !whitespace-normal">{p.name}</span><span className="ledger-sub block">{[p.part_number, p.brand].filter(Boolean).join(' · ')}</span></span></button></li>)}
                    </ul>
                  )}
                </>
              )}
            </div>
            <Field id="rt-desc" label="What is going back (required)" error={errors.description} className="sm:col-span-2"><input id="rt-desc" className="form-input" autoComplete="off" value={form.description} onChange={set('description')} placeholder="Old alternator core, wrong brake pads" /></Field>
            <Field id="rt-kind" label="Why"><select id="rt-kind" className="form-select" value={form.kind} onChange={set('kind')}>{RETURN_KINDS.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</select></Field>
            <Field id="rt-vendor" label="Going back to"><select id="rt-vendor" className="form-select" value={form.vendor_id} onChange={set('vendor_id')}><option value="">Choose a vendor</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
            <Field id="rt-qty" label="How many" error={errors.qty}><input id="rt-qty" className="form-input num" inputMode="numeric" autoComplete="off" value={form.qty} onChange={set('qty')} /></Field>
            <Field id="rt-amount" label="Credit you expect" error={errors.amount} hint="What the vendor will take off your bill."><input id="rt-amount" className="form-input num" inputMode="decimal" autoComplete="off" value={form.amount} onChange={set('amount')} placeholder="0.00" /></Field>
            <Field id="rt-ref" label="Return or RMA number"><input id="rt-ref" className="form-input" autoComplete="off" value={form.reference} onChange={set('reference')} /></Field>
            <Field id="rt-status" label="Where it stands"><select id="rt-status" className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ReturnStatus, credited_on: e.target.value === 'credited' && !f.credited_on ? today : f.credited_on }))}>{RETURN_STATUS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></Field>
            <Field id="rt-opened" label="Opened on" error={errors.opened_on}><input id="rt-opened" type="date" className="form-input" value={form.opened_on} onChange={set('opened_on')} /></Field>
            {form.status === 'credited' && <Field id="rt-credited" label="Credit received on" error={errors.credited_on}><input id="rt-credited" type="date" className="form-input" value={form.credited_on} onChange={set('credited_on')} /></Field>}
            <Field id="rt-note" label="Notes" className="sm:col-span-2"><textarea id="rt-note" className="form-textarea" rows={2} value={form.note} onChange={set('note')} /></Field>
          </fieldset>
          {error && <FormError>{error}</FormError>}
          <FormActions>
            {!readOnly && <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save return'}</button>}
            <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={saving}>{readOnly ? 'Close' : 'Cancel'}</button>
            {ret && !readOnly && ret.status === 'open' && <button type="button" className="btn btn-ghost sm:ml-auto" onClick={() => void save({ status: 'shipped' })} disabled={saving}>Mark as sent back</button>}
            {ret && !readOnly && ret.status === 'shipped' && <button type="button" className="btn btn-ghost sm:ml-auto" onClick={() => void save({ status: 'credited', credited_on: form.credited_on || today })} disabled={saving}>Credit received</button>}
          </FormActions>
        </form>
      </Sheet>
      <ConfirmSheet open={asking} title="Discard your changes?" confirmLabel="Discard changes" cancelLabel="Keep editing" onConfirm={onClose} onCancel={() => setAsking(false)}>
        <p>You typed changes to this return that are not saved yet. If you leave now they are lost.</p>
      </ConfirmSheet>
    </>
  )
}
