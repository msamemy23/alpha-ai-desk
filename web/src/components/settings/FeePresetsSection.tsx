'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { MAX_FEES, feesToRows, newFeeRow, rowIsBlank, rowsToFees, sameRows } from '@/lib/fee-presets-editor'
import type { FeeRow } from '@/lib/fee-presets-editor'
import { getPrefs, savePrefs } from '@/components/documents/api'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { ErrorCard } from '@/components/ListKit'
import { Group } from './fields'
import { ButtonSpinner, StatusLine } from './shared'

type Load = 'loading' | 'ready' | 'error' | 'unavailable'
type Save = 'idle' | 'saving' | 'saved' | 'error'

/**
 * The shop's usual charges (tire disposal, environmental fee, towing). Each one shows as a one-tap button in the Add a fee sheet on
 * an estimate or invoice. Saving changes only this list: it reads the settings again, replaces `fees`, and saves through the same
 * document-settings route as the parts markup rules. Estimates and invoices that already exist are never read or changed here.
 */
export default function FeePresetsSection() {
  const [load, setLoad] = useState<Load>('loading')
  const [loadError, setLoadError] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [rows, setRows] = useState<FeeRow[]>([])
  const [saved, setSaved] = useState<FeeRow[]>([])
  const [save, setSave] = useState<Save>('idle')
  const [saveError, setSaveError] = useState('')
  const [showErrors, setShowErrors] = useState(false)

  const read = useCallback(async () => {
    setLoad('loading'); setLoadError('')
    const r = await getPrefs()
    if (!r.ok || !r.data.prefs) { setLoadError(r.error || 'Your usual charges did not load.'); setLoad('error'); return }
    if (r.data.available === false) { setLoad('unavailable'); return }
    const list = feesToRows(r.data.prefs.fees || [])
    setCanEdit(r.data.canEdit === true)
    setRows(list); setSaved(list); setSave('idle'); setShowErrors(false)
    setLoad('ready')
  }, [])

  useEffect(() => { void read() }, [read])

  const dirty = !sameRows(rows, saved)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const result = useMemo(() => rowsToFees(rows), [rows])
  const touched = () => setSave(s => (s === 'saved' ? 'idle' : s))
  const changeRow = (id: string, patch: Partial<FeeRow>) => { setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r))); touched() }
  const addCharge = () => {
    const row = newFeeRow(rows.map(r => r.id))
    setRows(rs => [...rs, row]); touched()
    requestAnimationFrame(() => document.getElementById(`fee-name-${row.id}`)?.focus())
  }
  const removeCharge = (id: string) => { setRows(rs => rs.filter(r => r.id !== id)); touched() }

  const doSave = async () => {
    if (save === 'saving') return
    if (Object.keys(result.errors).length > 0 || result.problem) {
      setShowErrors(true)
      const first = rows.find(r => result.errors[r.id])
      if (first) requestAnimationFrame(() => document.getElementById(result.errors[first.id].name ? `fee-name-${first.id}` : `fee-amount-${first.id}`)?.focus())
      return
    }
    setSave('saving'); setSaveError('')
    // Read the settings again just before saving. Saving writes the whole settings object, so it must start from what is
    // stored now, and a read that fails stops the save instead of writing over anything.
    const fresh = await getPrefs()
    if (!fresh.ok || !fresh.data.prefs || fresh.data.available === false) {
      setSave('error'); setSaveError('Your current settings could not be checked, so nothing was saved. Try again.')
      return
    }
    const r = await savePrefs({ ...fresh.data.prefs, fees: result.fees })
    if (!r.ok) { setSave('error'); setSaveError(r.needsUpdate ? 'Settings need a database update first. Ask whoever manages your account to apply it.' : r.error); return }
    const stored = r.data.prefs?.fees ?? result.fees
    if (stored.length !== result.fees.length) {
      setSave('error'); setSaveError(`Only ${stored.length} of ${result.fees.length} charges were kept. Check each name and amount, then save again.`)
      return
    }
    const list = feesToRows(stored)
    setRows(list); setSaved(list); setSave('saved'); setShowErrors(false)
  }

  if (load === 'loading') {
    return <div className="space-y-2 lg:max-w-2xl" aria-busy="true" aria-label="Loading usual charges">{[0, 1, 2].map(i => <div key={i} className="skeleton h-[3.75rem]" />)}</div>
  }
  if (load === 'error') return <ErrorCard title="Usual charges did not load" message={loadError || 'Check your connection and try again. Nothing was changed.'} onRetry={() => void read()} className="max-w-xl" />
  if (load === 'unavailable') {
    return <Notice kind="info"><p className="font-bold">Usual charges need a database update first.</p><p>Ask whoever manages your account to apply it. Nothing else is affected.</p></Notice>
  }

  const readOnly = !canEdit
  const counted = rows.filter(r => !rowIsBlank(r)).length
  const err = (id: string) => (showErrors ? result.errors[id] : undefined)

  return (
    <div className="space-y-4">
      {readOnly && <Notice kind="info">Only the owner, an admin or a manager can change these charges. You can still look at them.</Notice>}

      <Group title="Your usual charges" description="Charges you add to bills again and again, like tire disposal or an environmental fee. On an estimate or invoice, choose Add a fee and tap one to fill it in. You can still change it there. Estimates and invoices already written are never changed.">
        <StatusLine lamp={saved.length > 0 ? 'green' : 'off'}>{saved.length === 0 ? 'No usual charges saved' : `${saved.length} saved`}</StatusLine>
        {showErrors && result.problem && <p role="alert" className="form-error">{result.problem}</p>}
        {rows.length === 0 && <p className="rounded-md border border-dashed border-border px-4 py-5 text-center text-[0.9375rem] text-text-secondary">No usual charges yet. Add one, like Tire disposal for $5.00.</p>}
        <ul className="space-y-3">
          {rows.map((row, i) => {
            const e = err(row.id)
            return (
              <li key={row.id} className="rounded-md border border-border p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <label htmlFor={`fee-name-${row.id}`} className="form-label">What it is for</label>
                    <input id={`fee-name-${row.id}`} className="form-input" autoComplete="off" maxLength={120} placeholder="Tire disposal" value={row.name} disabled={readOnly}
                      onChange={ev => changeRow(row.id, { name: ev.target.value })} aria-invalid={e?.name ? true : undefined} aria-describedby={e?.name ? `fee-name-${row.id}-err` : undefined} />
                    {e?.name && <p id={`fee-name-${row.id}-err`} className="form-error">{e.name}</p>}
                  </div>
                  <div>
                    <label htmlFor={`fee-amount-${row.id}`} className="form-label">Amount ($)</label>
                    <input id={`fee-amount-${row.id}`} className="form-input num" inputMode="decimal" autoComplete="off" placeholder="0.00" value={row.amount} disabled={readOnly}
                      onChange={ev => changeRow(row.id, { amount: ev.target.value })} aria-invalid={e?.amount ? true : undefined} aria-describedby={e?.amount ? `fee-amount-${row.id}-err` : undefined} />
                    {e?.amount && <p id={`fee-amount-${row.id}-err`} className="form-error">{e.amount}</p>}
                  </div>
                  <div>
                    <label htmlFor={`fee-kind-${row.id}`} className="form-label">Kind of charge</label>
                    <select id={`fee-kind-${row.id}`} className="form-select" value={row.kind} disabled={readOnly} onChange={ev => changeRow(row.id, { kind: ev.target.value === 'sublet' ? 'sublet' : 'fee' })}>
                      <option value="fee">Shop fee</option>
                      <option value="sublet">Outside work</option>
                    </select>
                  </div>
                  <label className="col-span-2 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[0.9375rem]">
                    <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-blue))]" checked={row.taxable} disabled={readOnly} onChange={ev => changeRow(row.id, { taxable: ev.target.checked })} />
                    Charge sales tax on this
                  </label>
                </div>
                {!readOnly && (
                  <div className="mt-2 flex justify-end">
                    <button type="button" className="btn btn-ghost btn-sm !text-red" onClick={() => removeCharge(row.id)} aria-label={`Remove charge ${row.name.trim() || i + 1}`}>
                      <Icon name="trash" className="h-4 w-4" />
                      Remove
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {!readOnly && counted < MAX_FEES && (
          <button type="button" className="btn btn-secondary w-full justify-center sm:w-auto" onClick={addCharge}>
            <Icon name="plus" className="h-5 w-5" />
            Add a usual charge
          </button>
        )}
        {!readOnly && counted >= MAX_FEES && <p className="form-hint !text-text-secondary">That is the most you can keep ({MAX_FEES}). Remove one to add another.</p>}
      </Group>

      {!readOnly && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-live="polite">
          <div className="min-w-0 text-[0.9375rem]">
            {save === 'error' ? (
              <p role="alert" className="flex items-start gap-2"><span className="lamp lamp-red mt-1" aria-hidden="true" /><span><strong>Not saved.</strong> {saveError}</span></p>
            ) : save === 'saving' ? (
              <p className="flex items-center gap-2"><span className="lamp lamp-blue" aria-hidden="true" />Saving…</p>
            ) : dirty ? (
              <p className="flex items-center gap-2"><span className="lamp lamp-amber" aria-hidden="true" /><strong>Unsaved changes</strong></p>
            ) : save === 'saved' ? (
              <p className="flex items-center gap-2"><span className="lamp lamp-green" aria-hidden="true" />Charges saved</p>
            ) : (
              <p className="flex items-center gap-2 text-text-secondary"><span className="lamp lamp-off" aria-hidden="true" />No changes to save</p>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {dirty && save !== 'saving' && <button type="button" className="btn btn-secondary" onClick={() => { setRows(saved); setSave('idle'); setShowErrors(false) }}>Undo changes</button>}
            <button type="button" className="btn btn-primary" onClick={() => void doSave()} disabled={save === 'saving' || (!dirty && save !== 'error')} aria-busy={save === 'saving'}>
              {save === 'saving' && <ButtonSpinner />}
              Save charges
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
