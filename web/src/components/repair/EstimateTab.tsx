'use client'
import Link from 'next/link'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { formatCurrency } from '@/lib/supabase'
import { BulletList } from './parts'
import type { Repair } from './useRepair'

const money = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? formatCurrency(n) : 'Needs price')

/** Turns the lookup into a draft estimate: who it is for, one total, and the work items it will be spread across. */
export default function EstimateTab({ r }: { r: Repair }) {
  const { result, draft } = r
  if (!result || !draft) return null

  const drafted = (draft.labors || []) as Array<Record<string, unknown>>
  // Before a total is typed, show the lines it will be spread across, the same way the estimate will choose them.
  const labor = result.operationLines.filter(l => l.kind === 'labor')
  const willSpread = labor.length ? labor : result.operationLines.filter(l => l.kind !== 'parts')
  const lines: Array<{ label: string; amount: unknown }> = drafted.length
    ? drafted.map(l => ({ label: String(l.operation), amount: l.amount }))
    : willSpread.map(l => ({ label: l.label, amount: null }))
  const priced = lines.length > 0 && lines.every(l => typeof l.amount === 'number')
  const sum = priced ? lines.reduce((acc, l) => acc + (l.amount as number), 0) : null
  const badTotal = r.lockedTotal.trim() !== '' && r.total === null
  const pinCount = r.pinned.length

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <form className="card space-y-5" onSubmit={e => { e.preventDefault(); void r.createEstimate() }} aria-labelledby="est-title">
        <div>
          <h3 id="est-title" className="section-title text-[1.25rem]">
            {result.estimateDraft.totalLocked && result.estimateDraft.targetTotal ? `Total ${formatCurrency(result.estimateDraft.targetTotal)}` : 'Draft estimate'}
          </h3>
          <p className="mt-1 text-text-secondary">Enter one total. Alpha spreads it across the work items below and saves a draft you can review before anything is sent.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="est-name" className="form-label">Customer name</label>
            <input id="est-name" className="form-input" autoComplete="off" list="est-customers" placeholder="Maria Lopez" value={r.customerName} onChange={e => r.pickCustomer(e.target.value)} aria-describedby="est-name-hint" />
            <datalist id="est-customers">
              {r.customers.slice(0, 200).map(c => <option key={c.name} value={c.name} />)}
            </datalist>
            <p id="est-name-hint" className="form-hint">Pick a customer on file, or type a new one. Left blank, it saves as “Customer”.</p>
          </div>
          <div>
            <label htmlFor="est-total" className="form-label">Total ($)</label>
            <input id="est-total" className="form-input num" inputMode="decimal" autoComplete="off" placeholder="430" value={r.lockedTotal} onChange={e => r.setLockedTotal(e.target.value)} aria-invalid={badTotal} aria-describedby="est-total-hint" />
            {badTotal
              ? <p id="est-total-hint" className="form-error">Enter a number above 0, like 430.</p>
              : <p id="est-total-hint" className="form-hint">Use a diagnostic total for trouble code work.</p>}
          </div>
          <div>
            <label htmlFor="est-phone" className="form-label">Customer phone</label>
            <input id="est-phone" className="form-input" type="tel" autoComplete="off" placeholder="(713) 555-0142" value={r.customerPhone} onChange={e => r.setCustomerPhone(e.target.value)} />
          </div>
          <div>
            <label htmlFor="est-email" className="form-label">Customer email</label>
            <input id="est-email" className="form-input" type="email" autoComplete="off" placeholder="maria@example.com" value={r.customerEmail} onChange={e => r.setCustomerEmail(e.target.value)} />
          </div>
        </div>

        <section aria-labelledby="est-items">
          <h4 id="est-items" className="mb-2 font-bold">Work items</h4>
          {lines.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-5 text-center text-text-secondary">No work items were found. Enter a total and Alpha adds one labor line for it.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border bg-bg-base">
              {lines.map((line, index) => (
                <li key={`${line.label}-${index}`} className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <span className="min-w-0 break-words">{line.label}</span>
                  <span className="num shrink-0 font-bold">{typeof line.amount === 'number' ? money(line.amount) : <span className="font-normal text-text-secondary">Set by the total</span>}</span>
                </li>
              ))}
              {sum !== null && (
                <li className="flex items-baseline justify-between gap-4 px-4 py-3">
                  <span className="font-bold">Total</span>
                  <span className="display num shrink-0 text-[1.125rem] font-bold">{formatCurrency(sum)}</span>
                </li>
              )}
            </ul>
          )}
          <p className="form-hint">{pinCount > 0 ? `${pinCount} pinned ${pinCount === 1 ? 'source is' : 'sources are'} added to the estimate notes, along with the top source links.` : 'The top source links are added to the estimate notes. Pin more on the Sources tab.'}</p>
        </section>

        {r.estimateSay && (
          <Notice kind={r.estimateSay.kind === 'success' ? 'success' : r.estimateSay.kind === 'warn' ? 'warn' : 'error'}>
            <p>{r.estimateSay.text}</p>
            {r.created && r.estimateSay.kind === 'success' && <Link href="/estimates" className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 font-bold text-blue hover:underline sm:min-h-[32px]">Open estimates to review and send<Icon name="arrowRight" className="h-4 w-4" /></Link>}
          </Notice>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="submit" className="btn btn-primary sm:min-w-44" disabled={r.creating || r.total === null}>
            {r.creating ? 'Creating…' : r.created ? 'Create another estimate' : 'Create estimate'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={r.sendToAlpha}><Icon name="alpha" className="h-5 w-5" />Have Alpha draft it instead</button>
        </div>
      </form>

      <aside className="min-w-0" aria-label="Before you create the estimate">
        <section className="rounded-lg border border-amber/60 bg-amber/[0.1] p-4" aria-labelledby="est-before">
          <h3 id="est-before" className="section-title flex items-center gap-2"><Icon name="alert" className="h-5 w-5 text-amber" />Before you create it</h3>
          <BulletList className="mt-3" items={[
            'Check the vehicle and the source links.',
            'Use a diagnostic total for trouble code work unless the failed part is proven.',
            'An estimate with a total of $0 is never saved.',
            'The estimate is saved as a draft. Nothing goes to the customer until you send it.',
          ]} />
        </section>
      </aside>
    </div>
  )
}
