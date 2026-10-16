'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { matrixPrice, tierFor, tierSummary } from '@/lib/doc-pricing'
import type { RoundTo } from '@/lib/doc-pricing'
import { MAX_RULES, draftToMatrix, matrixToDraft, sameDraft, topIsCapped } from '@/lib/markup-editor'
import type { RuleDraft, RuleRow } from '@/lib/markup-editor'
import { getPrefs, savePrefs } from '@/components/documents/api'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { ErrorCard } from '@/components/ListKit'
import { Group } from './fields'
import { ButtonSpinner, StatusLine } from './shared'

type Load = 'loading' | 'ready' | 'error' | 'unavailable'
type Save = 'idle' | 'saving' | 'saved' | 'error'

const ROUND_OPTIONS: { value: RoundTo; label: string }[] = [
  { value: 'cent', label: 'The cent (no rounding up)' },
  { value: 'quarter', label: 'The next quarter dollar' },
  { value: 'dollar', label: 'The next whole dollar' },
]
const EXAMPLE_COSTS = [5, 25, 100, 400]

/**
 * Rules for pricing a part from its cost. The shop writes them here, sees what a sample part would sell for (worked out by the
 * same function the estimate uses), and chooses whether the editor may suggest prices from them. Saving changes only these
 * rules. Estimates and invoices that already exist are never read or changed here.
 */
export default function MarkupSection() {
  const [load, setLoad] = useState<Load>('loading')
  const [loadError, setLoadError] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const [saved, setSaved] = useState<RuleDraft | null>(null)
  const [save, setSave] = useState<Save>('idle')
  const [saveError, setSaveError] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [sample, setSample] = useState('40')
  const nextKey = useRef(0)

  const read = useCallback(async () => {
    setLoad('loading'); setLoadError('')
    const r = await getPrefs()
    if (!r.ok || !r.data.prefs) { setLoadError(r.error || 'The markup rules did not load.'); setLoad('error'); return }
    if (r.data.available === false) { setLoad('unavailable'); return }
    const d = matrixToDraft(r.data.prefs.matrix)
    setCanEdit(r.data.canEdit === true)
    setDraft(d); setSaved(d); setSave('idle'); setShowErrors(false)
    setLoad('ready')
  }, [])

  useEffect(() => { void read() }, [read])

  const dirty = !!draft && !!saved && !sameDraft(draft, saved)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const result = useMemo(() => (draft ? draftToMatrix(draft) : null), [draft])
  const change = (patch: Partial<RuleDraft>) => { setDraft(d => (d ? { ...d, ...patch } : d)); setSave(s => (s === 'saved' ? 'idle' : s)) }
  const changeRow = (key: string, patch: Partial<RuleRow>) => change({ rows: (draft?.rows || []).map(r => (r.key === key ? { ...r, ...patch } : r)) })
  const addRule = () => change({ rows: [...(draft?.rows || []), { key: `new${nextKey.current++}`, upTo: '', pct: '' }] })
  const removeRule = (key: string) => change({ rows: (draft?.rows || []).filter(r => r.key !== key) })

  const doSave = async () => {
    if (!draft || !result) return
    if (Object.keys(result.rowErrors).length > 0 || result.problem) { setShowErrors(true); return }
    setSave('saving'); setSaveError('')
    // Read the settings again just before saving. Saving writes the whole settings object, so it must start from what is
    // stored now, and a read that fails stops the save instead of writing over anything.
    const fresh = await getPrefs()
    if (!fresh.ok || !fresh.data.prefs || fresh.data.available === false) {
      setSave('error'); setSaveError('Your current settings could not be checked, so nothing was saved. Try again.')
      return
    }
    const r = await savePrefs({ ...fresh.data.prefs, matrix: result.matrix })
    if (!r.ok) { setSave('error'); setSaveError(r.needsUpdate ? 'Settings need a database update first. Ask whoever manages your account to apply it.' : r.error); return }
    const d = matrixToDraft(r.data.prefs?.matrix ?? result.matrix)
    setDraft(d); setSaved(d); setSave('saved'); setShowErrors(false)
  }

  if (load === 'loading') {
    return <div className="space-y-2 lg:max-w-2xl" aria-busy="true" aria-label="Loading markup rules">{[0, 1, 2].map(i => <div key={i} className="skeleton h-[3.75rem]" />)}</div>
  }
  if (load === 'error') return <ErrorCard title="Markup rules did not load" message={loadError || 'Check your connection and try again. Nothing was changed.'} onRetry={() => void read()} className="max-w-xl" />
  if (load === 'unavailable') {
    return <Notice kind="info"><p className="font-bold">Markup rules need a database update first.</p><p>Ask whoever manages your account to apply it. Nothing else is affected.</p></Notice>
  }
  if (!draft || !result || !saved) return null

  const matrix = result.matrix
  const readOnly = !canEdit
  const cost = Number(sample)
  const sampleOk = Number.isFinite(cost) && cost > 0
  const samplePrice = sampleOk ? matrixPrice(matrix, cost) : null
  const sampleRule = sampleOk ? tierFor(matrix, cost) : null
  const cap = topIsCapped(matrix)
  const rowError = (key: string) => (showErrors ? result.rowErrors[key] : undefined)

  return (
    <div className="space-y-4">
      {readOnly && <Notice kind="info">Only the owner, an admin or a manager can change these rules. You can still try the preview.</Notice>}

      <Group title="Suggest part prices" description="Add your usual markup to a part's cost. On an estimate or invoice, a part with a cost shows a suggested price and a Use it button. Nothing is priced for you, and estimates and invoices already written are never changed.">
        <StatusLine lamp={saved.enabled ? 'green' : 'off'}>{saved.enabled ? 'Suggestions are on' : 'Suggestions are off'}</StatusLine>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[0.9375rem]">
          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-blue))]" checked={draft.enabled} disabled={readOnly} onChange={e => change({ enabled: e.target.checked })} />
          Suggest prices from these rules
        </label>
        {showErrors && result.problem && <p className="form-error">{result.problem}</p>}
        <div>
          <label htmlFor="mk-mode" className="form-label">How the percent works</label>
          <select id="mk-mode" className="form-select" value={draft.mode} disabled={readOnly} onChange={e => change({ mode: e.target.value === 'margin' ? 'margin' : 'markup' })}>
            <option value="markup">Markup: add a percent to the cost</option>
            <option value="margin">Margin: the percent of the price you keep</option>
          </select>
          <p className="form-hint !text-text-secondary">{draft.mode === 'markup' ? 'A 50% markup on a $20 part sells it for $30.' : 'A 50% margin on a $20 part sells it for $40.'}</p>
        </div>
        <div>
          <label htmlFor="mk-round" className="form-label">Round the price up to</label>
          <select id="mk-round" className="form-select" value={draft.roundTo} disabled={readOnly} onChange={e => change({ roundTo: e.target.value as RoundTo })}>
            {ROUND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </Group>

      <Group title="Rules by part cost" description="The first rule whose limit is at or above the part's cost is used. Leave the limit empty on the last rule to cover everything above.">
        {draft.rows.length === 0 && <p className="rounded-md border border-dashed border-border px-4 py-5 text-center text-[0.9375rem] text-text-secondary">No rules yet. Add one, like a 100% markup on parts up to $10.</p>}
        <ul className="space-y-3">
          {draft.rows.map((row, i) => {
            const err = rowError(row.key)
            return (
              <li key={row.key} className="rounded-md border border-border p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor={`mk-up-${row.key}`} className="form-label">Cost up to</label>
                    <input id={`mk-up-${row.key}`} className="form-input num" inputMode="decimal" placeholder="No limit" value={row.upTo} disabled={readOnly} onChange={e => changeRow(row.key, { upTo: e.target.value })} aria-invalid={err ? true : undefined} />
                  </div>
                  <div>
                    <label htmlFor={`mk-pct-${row.key}`} className="form-label">{draft.mode === 'markup' ? 'Markup percent' : 'Margin percent'}</label>
                    <input id={`mk-pct-${row.key}`} className="form-input num" inputMode="decimal" placeholder="30" value={row.pct} disabled={readOnly} onChange={e => changeRow(row.key, { pct: e.target.value })} aria-invalid={err ? true : undefined} />
                  </div>
                </div>
                {err && <p className="form-error">{err}</p>}
                {!readOnly && (
                  <div className="mt-2 flex justify-end">
                    <button type="button" className="btn btn-ghost btn-sm !text-red" onClick={() => removeRule(row.key)} aria-label={`Remove rule ${i + 1}`}>
                      <Icon name="trash" className="h-4 w-4" />
                      Remove
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {!readOnly && draft.rows.length < MAX_RULES && (
          <button type="button" className="btn btn-secondary w-full justify-center sm:w-auto" onClick={addRule}>
            <Icon name="plus" className="h-5 w-5" />
            Add a rule
          </button>
        )}
        {matrix.tiers.length > 0 && (
          <div>
            <h4 className="text-[0.9375rem] font-bold">How your rules read</h4>
            <ul className="mt-1 space-y-0.5 text-[0.9375rem] text-text-secondary">
              {matrix.tiers.map((t, i) => <li key={i} className="num">{tierSummary(matrix, t, i)}</li>)}
            </ul>
            {cap !== null && <p className="form-hint !text-amber">Parts that cost more than {formatCurrency(cap)} get no suggestion. Add a rule with no limit to cover them.</p>}
          </div>
        )}
      </Group>

      <Group title="Try it" description="See what these rules sell a part for. This is only a preview.">
        <div>
          <label htmlFor="mk-sample" className="form-label">A part that costs</label>
          <input id="mk-sample" className="form-input num" inputMode="decimal" value={sample} onChange={e => setSample(e.target.value)} />
        </div>
        <div aria-live="polite" className="rounded-md border border-border bg-bg-card px-3 py-2.5 text-[0.9375rem]">
          {!sampleOk ? (
            <p className="text-text-secondary">Enter a part cost to see the price.</p>
          ) : samplePrice === null ? (
            <p className="text-text-secondary">No rule covers {formatCurrency(cost)} yet, so no price is suggested.</p>
          ) : (
            <p className="flex items-baseline justify-between gap-3">
              <span>Sells for{sampleRule ? ` (${sampleRule.pct}% ${matrix.mode})` : ''}</span>
              <span className="num font-bold">{formatCurrency(samplePrice)}</span>
            </p>
          )}
        </div>
        <ul className="grid grid-cols-2 gap-2 text-[0.875rem] sm:grid-cols-4">
          {EXAMPLE_COSTS.map(c => {
            const p = matrixPrice(matrix, c)
            return (
              <li key={c} className="rounded-md border border-border px-3 py-2">
                <span className="block text-text-secondary">Costs {formatCurrency(c)}</span>
                <span className="num block font-bold">{p === null ? 'No rule' : formatCurrency(p)}</span>
              </li>
            )
          })}
        </ul>
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
              <p className="flex items-center gap-2"><span className="lamp lamp-green" aria-hidden="true" />Rules saved</p>
            ) : (
              <p className="flex items-center gap-2 text-text-secondary"><span className="lamp lamp-off" aria-hidden="true" />No changes to save</p>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {dirty && save !== 'saving' && <button type="button" className="btn btn-secondary" onClick={() => { setDraft(saved); setSave('idle'); setShowErrors(false) }}>Undo changes</button>}
            <button type="button" className="btn btn-primary" onClick={() => void doSave()} disabled={save === 'saving' || (!dirty && save !== 'error')} aria-busy={save === 'saving'}>
              {save === 'saving' && <ButtonSpinner />}
              Save rules
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
