'use client'
import { useEffect, useMemo, useState } from 'react'
import ConfirmSheet from '@/components/forms/ConfirmSheet'
import type { Flash } from '@/components/forms/FlashNotice'
import { Field } from '@/components/forms/Field'
import Icon from '@/components/Icon'
import { EmptyBlock, sentenceCase } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { previewReprice } from '@/lib/inventory-logic'
import type { RoundTo, StockPart } from '@/lib/inventory-logic'
import { checkDraft, draftFrom, EXAMPLE_TIERS, repriceSummary, ROUND_CHOICES, sameRules, tierKey, usd } from '@/lib/inventory-view'
import type { RulesDraft, TierDraft } from '@/lib/inventory-view'
import StockNotice, { LookOnly } from './StockNotice'
import type { StockAct, StockData } from './useStock'

const MAX_RANGES = 20

/**
 * How retail prices follow cost. The person writes price ranges (cost from, up to, markup or margin), picks how to round and the lowest
 * price they charge, and saves the rules. Then this screen lists what every price WOULD become, part by part, and changes nothing until
 * they tick the ones they want and confirm. Every price changed is written to that part's history with the old and the new price.
 */
export default function PricingPanel({ stock, parts, categories, act, flash, reload, onChanged }: {
  stock: StockData
  parts: StockPart[]
  categories: string[]
  act: StockAct
  flash: (f: Flash) => void
  reload: () => void
  /** Prices were changed, so the parts list must be read again. */
  onChanged: () => void
}) {
  const saved = stock.rules.value
  const canEdit = stock.canBuy
  const [draft, setDraft] = useState<RulesDraft>(() => draftFrom(saved))
  const [savedKey, setSavedKey] = useState(() => JSON.stringify(saved))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [onlyRaise, setOnlyRaise] = useState(false)
  const [catFilter, setCatFilter] = useState('All')
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set())
  const [confirming, setConfirming] = useState(false)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState('')

  // What the database holds changed (after a save, or another person's save): show it, unless the person is in the middle of typing.
  const check = useMemo(() => checkDraft(draft), [draft])
  const dirty = !sameRules(check.rules, saved) || check.problems.length > 0 || !!check.minimumProblem
  useEffect(() => {
    const now = JSON.stringify(saved)
    if (now === savedKey) return
    setSavedKey(now)
    if (!dirty) setDraft(draftFrom(saved))
  }, [saved, savedKey, dirty])

  const problems = [...check.problems.map(p => p.text), ...(check.minimumProblem ? [check.minimumProblem] : [])]
  const valid = problems.length === 0

  const change = (key: string, patch: Partial<TierDraft>) => setDraft(d => ({ ...d, tiers: d.tiers.map(t => (t.key === key ? { ...t, ...patch } : t)) }))
  const addRange = () => setDraft(d => {
    if (d.tiers.length >= MAX_RANGES) return d
    const last = d.tiers[d.tiers.length - 1]
    const start = last && last.max.trim() !== '' ? last.max : ''
    return { ...d, tiers: [...d.tiers, { key: tierKey(), min: start, max: '', method: 'markup', pct: '', category: '' }] }
  })
  const removeRange = (key: string) => setDraft(d => ({ ...d, tiers: d.tiers.filter(t => t.key !== key) }))
  const useExample = () => setDraft(d => ({ ...d, tiers: EXAMPLE_TIERS.map(t => ({ ...t, key: tierKey() })) }))
  const revert = () => setDraft(draftFrom(saved))

  const saveRules = async () => {
    if (!valid || saving) return
    setSaving(true); setSaveError('')
    const r = await act({ action: 'rules-save', rules: check.rules })
    setSaving(false)
    if (r.ok) { flash({ kind: 'success', text: 'Price rules saved. No prices were changed yet.' }); return }
    setSaveError(r.needsUpdate ? 'Price rules need a one-time update to your Alpha Desk database first.' : r.message)
  }

  // What the rules WOULD do. It follows what is typed, but nothing can be applied until the rules are saved.
  const rules = valid ? check.rules : saved
  const all = useMemo(() => previewReprice(parts, rules, { onlyRaise }), [parts, rules, onlyRaise])
  const shown = useMemo(() => all.filter(r => catFilter === 'All' || r.part.category.trim().toLowerCase() === catFilter.trim().toLowerCase()), [all, catFilter])
  const chosen = shown.filter(r => !skipped.has(r.part.id))
  const summary = useMemo(() => repriceSummary(parts, rules, all), [parts, rules, all])
  const tooMany = chosen.length > 2000
  const canApply = canEdit && !dirty && chosen.length > 0 && !tooMany
  const toggle = (id: string) => setSkipped(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const apply = async () => {
    if (!canApply || applying) return
    setApplying(true); setApplyError('')
    const r = await act<{ changed: number; skipped: number }>({ action: 'prices-apply', changes: chosen.map(c => ({ part_id: c.part.id, from: c.from, to: c.to })) })
    setApplying(false)
    if (r.ok) {
      setConfirming(false); setSkipped(new Set())
      onChanged()
      const left = r.data.skipped
      flash({ kind: 'success', text: `${r.data.changed} ${r.data.changed === 1 ? 'price was' : 'prices were'} changed.${left > 0 ? ` ${left} ${left === 1 ? 'was' : 'were'} left alone because the price changed after this list was made.` : ''}` })
      return
    }
    setApplyError(r.needsUpdate ? 'Changing prices needs a one-time update to your Alpha Desk database first.' : r.message)
  }

  const inputId = (k: string, f: string) => `pr-${k}-${f}`
  const ups = chosen.filter(c => c.from === null || c.from === 0 || c.to > c.from).length

  if (stock.rules.state !== 'ok') return <StockNotice r={stock.rules} what="Price rules" onRetry={reload} />

  return (
    <div>
      {!canEdit && <LookOnly what="Price rules" />}
      <p className="mb-4 max-w-2xl text-[0.9375rem] text-text-secondary">
        Say how much to add to your cost for each price range. Below, Alpha lists what every retail price would become. Nothing changes until you pick the parts and confirm.
      </p>

      <section className="panel mb-5" aria-label="Price ranges">
        <div className="panel-header">
          <div className="min-w-0">
            <h3 className="section-title !text-[1.0625rem]">Price ranges</h3>
            <p className="text-[0.875rem] text-text-secondary">A markup of 50% on a $10.00 cost is $15.00. A margin of 50% on a $10.00 cost is $20.00.</p>
          </div>
          {canEdit && draft.tiers.length === 0 && <button type="button" className="btn btn-secondary shrink-0" onClick={useExample}>Start from an example</button>}
        </div>

        {draft.tiers.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5">
            <EmptyBlock icon="tag" title="No price ranges yet" action={canEdit ? <button type="button" className="btn btn-primary" onClick={addRange}><Icon name="plus" className="h-5 w-5" />Add a range</button> : undefined}>
              A range says: parts that cost between these two amounts get this markup or margin. Without any, no price is ever suggested.
            </EmptyBlock>
          </div>
        ) : (
          <ul className="space-y-3 px-4 pb-4 sm:px-5" aria-label="Your ranges">
            {draft.tiers.map((t, i) => {
              const bad = check.problems.find(p => p.key === t.key)
              return (
                <li key={t.key} className="rounded-md border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="font-bold">Range {i + 1}</p>
                    {canEdit && <button type="button" className="btn-icon" onClick={() => removeRange(t.key)} aria-label={`Remove range ${i + 1}`}><Icon name="trash" className="h-5 w-5" /></button>}
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Field id={inputId(t.key, 'min')} label="Cost from">
                      <input id={inputId(t.key, 'min')} className="form-input num" inputMode="decimal" autoComplete="off" disabled={!canEdit} value={t.min} onChange={e => change(t.key, { min: e.target.value })} placeholder="0.00" />
                    </Field>
                    <Field id={inputId(t.key, 'max')} label="Up to">
                      <input id={inputId(t.key, 'max')} className="form-input num" inputMode="decimal" autoComplete="off" disabled={!canEdit} value={t.max} onChange={e => change(t.key, { max: e.target.value })} placeholder="No limit" />
                    </Field>
                    <Field id={inputId(t.key, 'method')} label="Add as">
                      <select id={inputId(t.key, 'method')} className="form-select" disabled={!canEdit} value={t.method} onChange={e => change(t.key, { method: e.target.value === 'margin' ? 'margin' : 'markup' })}>
                        <option value="markup">Markup on cost</option>
                        <option value="margin">Margin on price</option>
                      </select>
                    </Field>
                    <Field id={inputId(t.key, 'pct')} label={t.method === 'margin' ? 'Margin percent' : 'Markup percent'}>
                      <input id={inputId(t.key, 'pct')} className="form-input num" inputMode="decimal" autoComplete="off" disabled={!canEdit} value={t.pct} onChange={e => change(t.key, { pct: e.target.value })} placeholder="50" />
                    </Field>
                    <Field id={inputId(t.key, 'cat')} label="Only for this category (optional)" className="col-span-2 sm:col-span-4">
                      <select id={inputId(t.key, 'cat')} className="form-select sm:max-w-xs" disabled={!canEdit} value={t.category} onChange={e => change(t.key, { category: e.target.value })}>
                        <option value="">Every category</option>
                        {categories.map(c => <option key={c} value={c}>{sentenceCase(c)}</option>)}
                      </select>
                    </Field>
                  </div>
                  {bad && <p role="alert" className="form-error">{bad.text}</p>}
                </li>
              )
            })}
          </ul>
        )}

        {draft.tiers.length > 0 && canEdit && (
          <div className="px-4 pb-4 sm:px-5">
            <button type="button" className="btn btn-secondary" onClick={addRange} disabled={draft.tiers.length >= MAX_RANGES}><Icon name="plus" className="h-5 w-5" />Add a range</button>
            {draft.tiers.length >= MAX_RANGES && <span className="ml-3 text-[0.875rem] text-text-secondary">That is the most ranges you can have ({MAX_RANGES}).</span>}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 border-t border-border px-4 py-4 sm:grid-cols-2 sm:px-5">
          <Field id="pr-round" label="Rounding">
            <select id="pr-round" className="form-select" disabled={!canEdit} value={draft.round_to} onChange={e => setDraft(d => ({ ...d, round_to: e.target.value as RoundTo }))}>
              {ROUND_CHOICES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </Field>
          <Field id="pr-min" label="Lowest price you charge" hint="No part is priced below this, or below its cost." error={check.minimumProblem || undefined}>
            <input id="pr-min" className="form-input num" inputMode="decimal" autoComplete="off" disabled={!canEdit} value={draft.minimum_price} onChange={e => setDraft(d => ({ ...d, minimum_price: e.target.value }))} placeholder="0.00" />
          </Field>
        </div>

        {check.overlaps.length > 0 && (
          <div className="px-4 pb-4 sm:px-5">
            <Notice kind="warn"><ul className="list-disc pl-5">{check.overlaps.map(o => <li key={o}>{o}</li>)}</ul></Notice>
          </div>
        )}
        {saveError && <div className="px-4 pb-4 sm:px-5"><Notice kind="error">{saveError}</Notice></div>}
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-4 sm:px-5">
            <button type="button" className="btn btn-primary" onClick={() => void saveRules()} disabled={!dirty || !valid || saving}>{saving ? 'Saving…' : 'Save price rules'}</button>
            {dirty && <button type="button" className="btn btn-secondary" onClick={revert} disabled={saving}>Undo my changes</button>}
            <p className="text-[0.875rem] text-text-secondary" role="status">{!valid ? 'Fix the ranges above to save.' : dirty ? 'You have changes that are not saved.' : draft.tiers.length ? 'These rules are saved.' : ''}</p>
          </div>
        )}
      </section>

      <section aria-label="What would change">
        <h3 className="display mb-1 text-[1.125rem] font-bold">What would change</h3>
        {saved.tiers.length === 0 && check.rules.tiers.length === 0 ? (
          <p className="text-[0.9375rem] text-text-secondary">Add a price range above and the parts it would reprice show up here.</p>
        ) : parts.length === 0 ? (
          <p className="text-[0.9375rem] text-text-secondary">You have no parts in inventory yet, so there is nothing to price.</p>
        ) : (
          <>
            <p className="num mb-3 text-[0.9375rem] text-text-secondary" aria-live="polite">
              <span className="font-bold text-text-primary">{all.length}</span> {all.length === 1 ? 'price' : 'prices'} would change
              {all.length > 0 ? <>, <span className="font-bold text-text-primary">{summary.up}</span> up and <span className="font-bold text-text-primary">{summary.down}</span> down</> : null}.{' '}
              {summary.unchanged} already {summary.unchanged === 1 ? 'matches' : 'match'}
              {summary.noRange > 0 ? `, ${summary.noRange} ${summary.noRange === 1 ? 'is' : 'are'} left alone because no range covers ${summary.noRange === 1 ? 'its' : 'their'} cost` : ''}
              {summary.noCost > 0 ? `, ${summary.noCost} ${summary.noCost === 1 ? 'has' : 'have'} no cost written down` : ''}.
            </p>
            {!valid && <Notice kind="warn" className="mb-3">The ranges above need fixing, so this list still shows your saved rules.</Notice>}
            {dirty && valid && canEdit && <Notice kind="info" className="mb-3">This list follows what you typed. Save the price rules to be able to change prices from it.</Notice>}

            <div className="mb-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={onlyRaise} onChange={e => setOnlyRaise(e.target.checked)} /><span>Only raise prices, never lower them</span></label>
              <div>
                <label htmlFor="pr-cat" className="sr-only">Show one category</label>
                <select id="pr-cat" className="form-select sm:w-52" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                  <option value="All">All categories</option>
                  {categories.map(c => <option key={c} value={c}>{sentenceCase(c)}</option>)}
                </select>
              </div>
            </div>

            {shown.length === 0 ? (
              <EmptyBlock icon="check" title={all.length === 0 ? 'Every price already follows your rules' : 'Nothing to change in this category'}>
                {all.length === 0 ? 'No part needs a new price right now.' : 'Pick another category, or show all categories.'}
              </EmptyBlock>
            ) : (
              <>
                <ul className="ledger" aria-label="Prices that would change">
                  {shown.map(r => {
                    const off = skipped.has(r.part.id)
                    const noPrice = r.from === null || r.from === 0
                    return (
                      <li key={r.part.id}>
                        <label className="flex min-h-[56px] cursor-pointer items-start gap-3 px-1 py-3">
                          <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={!off} onChange={() => toggle(r.part.id)} disabled={!canEdit} aria-label={`Change the price of ${r.part.name}`} />
                          <span className="min-w-0 flex-1">
                            <span className="block break-words font-bold">{r.part.name}</span>
                            <span className="num block text-[0.875rem] text-text-secondary">{[r.part.part_number, `cost ${usd(r.part.cost)}`, r.part.category ? sentenceCase(r.part.category) : ''].filter(Boolean).join(' · ')}</span>
                          </span>
                          <span className="num shrink-0 text-right">
                            <span className="block font-bold">{noPrice ? `no price → ${usd(r.to)}` : `${usd(r.from)} → ${usd(r.to)}`}</span>
                            <span className={`block text-[0.875rem] ${!noPrice && r.to < (r.from ?? 0) ? 'text-amber' : 'text-text-secondary'}`}>
                              {noPrice ? `margin ${r.marginTo}%` : `margin ${r.marginFrom === null ? '—' : `${r.marginFrom}%`} → ${r.marginTo}%`}
                            </span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
                {canEdit && (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <button type="button" className="btn btn-primary" disabled={!canApply} onClick={() => { setApplyError(''); setConfirming(true) }}>
                      <Icon name="check" className="h-5 w-5" />Change {chosen.length} {chosen.length === 1 ? 'price' : 'prices'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setSkipped(skipped.size ? new Set() : new Set(shown.map(r => r.part.id)))}>{skipped.size ? 'Pick them all' : 'Pick none'}</button>
                    <p className="text-[0.875rem] text-text-secondary">{dirty ? 'Save the price rules first.' : tooMany ? 'That is too many at once. Pick one category at a time.' : ''}</p>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>

      <ConfirmSheet
        open={confirming} title={`Change ${chosen.length} ${chosen.length === 1 ? 'price' : 'prices'}?`} confirmLabel={`Change ${chosen.length} ${chosen.length === 1 ? 'price' : 'prices'}`} busyLabel="Changing…"
        cancelLabel="Not now" danger={false} busy={applying} error={applyError} onConfirm={() => void apply()} onCancel={() => setConfirming(false)}
      >
        <p>
          {ups} will go up and {chosen.length - ups} will go down. Only the retail price of the parts you ticked changes; your costs, counts, invoices and estimates are not touched.
          Any part whose price was changed by someone else since this list was made is left alone.
        </p>
        <p className="mt-2">Each change is written to the part&apos;s history with the old price and the new one, so you can put a price back.</p>
      </ConfirmSheet>
    </div>
  )
}
