'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton } from '@/components/ListKit'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { call, load } from '@/components/automations/api'
import { agoWords, money } from '@/components/automations/model'
import { Section } from './parts'

interface Redemption {
  id: string
  code: string
  referrer_name: string | null
  referred_name: string | null
  document_id: string | null
  reward_given: boolean
  reward_note: string | null
  created_at: string
  paid: number
  invoice_total: number
}
interface Stats { codes: number; redeemed: number; revenue: number; rewards_owed: number; rewards_given: number; top: Array<{ referrer: string; code: string; redeemed: number; revenue: number }> }
interface Invoice { id: string; number: string; customer: string; status: string; date: string; total: number }

interface Props {
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

/** What referral codes brought in: who referred whom, what the new customer paid, and whether the thank-you was given. */
export default function ReferralResults({ notify }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [rows, setRows] = useState<Redemption[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [needsDb, setNeedsDb] = useState(false)
  const [crediting, setCrediting] = useState(false)
  const [marking, setMarking] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const r = await load('/api/growth/referrals', d => ({ rows: (Array.isArray(d.redemptions) ? d.redemptions : []) as Redemption[], stats: (d.stats ?? null) as Stats | null, needs: d.needs_database_update === true }))
    if (r.ok) { setRows(r.value.rows); setStats(r.value.stats); setNeedsDb(r.value.needs); setState('ready'); setError('') }
    else { setError(r.error); setState(s => (s === 'ready' ? 'ready' : 'error')) }
  }, [])
  useEffect(() => { void reload() }, [reload])

  const reward = async (row: Redemption) => {
    if (marking) return
    setMarking(row.id)
    const r = await call('/api/growth/referrals', { action: 'reward', id: row.id, given: !row.reward_given })
    setMarking(null)
    if (!r.ok) { notify(r.error, 'error'); return }
    setRows(list => list.map(x => (x.id === row.id ? { ...x, reward_given: !row.reward_given } : x)))
    setStats(s => (s ? { ...s, rewards_owed: s.rewards_owed + (row.reward_given ? 1 : -1), rewards_given: s.rewards_given + (row.reward_given ? -1 : 1) } : s))
    notify(row.reward_given ? 'Marked as not given yet.' : `Marked. ${row.referrer_name || 'The customer'} has their thank-you.`, 'success')
  }

  return (
    <Section
      title="What referrals brought in"
      hint="When a new customer pays an invoice using a code, credit it here. Alpha checks the customer is new and the invoice is only counted once."
      action={!needsDb && state !== 'error' ? <button type="button" className="btn btn-secondary" onClick={() => setCrediting(true)}><Icon name="plus" className="h-5 w-5" />Credit a referral</button> : undefined}
    >
      {needsDb ? <Notice kind="info">Tracking referrals needs a database update. Ask your developer to apply it. Codes keep working in the meantime.</Notice>
        : state === 'loading' ? <RowsSkeleton rows={3} label="Loading referrals" />
        : state === 'error' ? <ErrorCard title="Referral results did not load" message={error || 'Check your connection and try again.'} onRetry={() => { setState('loading'); void reload() }} />
        : (
          <>
            {stats && (
              <dl className="panel mb-4 grid grid-cols-2 sm:grid-cols-4">
                {[
                  { label: 'Codes given', value: stats.codes.toLocaleString('en-US') },
                  { label: 'Referrals credited', value: stats.redeemed.toLocaleString('en-US') },
                  { label: 'Paid by new customers', value: money(stats.revenue) },
                  { label: 'Thank-yous still owed', value: stats.rewards_owed.toLocaleString('en-US') },
                ].map((s, i) => (
                  <div key={s.label} className={`px-4 py-3 ${i < 2 ? 'border-b border-border sm:border-b-0' : ''} ${i % 2 === 0 ? 'border-r border-border sm:border-r-0' : ''} ${i > 0 ? 'sm:border-l sm:border-border' : ''}`}>
                    <dt className="text-[0.875rem] font-bold text-text-secondary">{s.label}</dt>
                    <dd className="display num text-[1.5rem] font-bold leading-tight">{s.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {rows.length === 0 ? (
              <EmptyBlock icon="customers" title="No referrals credited yet" action={<button type="button" className="btn btn-primary" onClick={() => setCrediting(true)}><Icon name="plus" className="h-5 w-5" />Credit a referral</button>}>
                When someone new pays you and gives a customer’s code, credit it here to see what it brought in and to remember to thank the person who referred them.
              </EmptyBlock>
            ) : (
              <ul className="ledger" aria-label="Credited referrals">
                {rows.map(r => (
                  <li key={r.id}>
                    <div className="ledger-row !items-start">
                      <span className={`lamp mt-1.5 ${r.reward_given ? 'lamp-green' : 'lamp-amber'}`} aria-hidden="true" />
                      <span className="ledger-main">
                        <span className="ledger-title block">{r.referred_name || 'New customer'}</span>
                        <span className="ledger-sub !whitespace-normal block">Referred by {r.referrer_name || 'a customer'} · code {r.code} · {agoWords(r.created_at)}</span>
                        <span className="ledger-sub !whitespace-normal block">{r.reward_given ? 'Thank-you given' : 'Thank-you still owed'}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className="ledger-amt" aria-label={`${money(r.paid)} paid`}>{money(r.paid)}</span>
                        <button type="button" className="btn btn-secondary" onClick={() => void reward(r)} disabled={marking !== null} aria-busy={marking === r.id} aria-label={r.reward_given ? `Mark thank-you for ${r.referrer_name || 'the customer'} as not given` : `Mark thank-you given to ${r.referrer_name || 'the customer'}`}>
                          {r.reward_given ? 'Undo' : 'Mark thanked'}
                        </button>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      {crediting && <CreditSheet onClose={() => setCrediting(false)} onDone={() => { setCrediting(false); void reload() }} notify={notify} />}
    </Section>
  )
}

function CreditSheet({ onClose, onDone, notify }: { onClose: () => void; onDone: () => void; notify: Props['notify'] }) {
  const base = useId()
  const [code, setCode] = useState('')
  const [term, setTerm] = useState('')
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)
  const [loadingInv, setLoadingInv] = useState(true)
  const [invError, setInvError] = useState('')
  const [pick, setPick] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)

  useEffect(() => {
    let stale = false
    setLoadingInv(true)
    const t = setTimeout(async () => {
      const r = await load(`/api/growth/referrals?invoices=${encodeURIComponent(term.trim())}`, d => (Array.isArray(d.invoices) ? d.invoices : []) as Invoice[])
      if (stale) return
      setLoadingInv(false)
      if (r.ok) { setInvoices(r.value); setInvError('') } else setInvError(r.error)
    }, term ? 350 : 0)
    return () => { stale = true; clearTimeout(t) }
  }, [term])

  const submit = async () => {
    if (busy.current) return
    if (!code.trim()) { setError('Enter the referral code the new customer gave you.'); return }
    if (!pick) { setError('Choose the invoice the new customer paid for.'); return }
    busy.current = true; setWorking(true); setError('')
    const r = await call('/api/growth/referrals', { action: 'redeem', code, document_id: pick })
    busy.current = false; setWorking(false)
    if (!r.ok) { setError(r.error); return }
    notify(String(r.data.message || 'Credited.'), 'success')
    onDone()
  }

  return (
    <Sheet open onClose={() => { if (!working) onClose() }} title="Credit a referral" wide dirty={Boolean(code.trim() || pick)}>
      <form onSubmit={e => { e.preventDefault(); void submit() }} className="space-y-4 text-[0.9375rem]" noValidate>
        <div>
          <label htmlFor={`${base}-code`} className="form-label">Referral code</label>
          <input id={`${base}-code`} className="form-input" value={code} maxLength={30} onChange={e => { setCode(e.target.value); setError('') }} placeholder="The code the new customer gave you" autoComplete="off" autoCapitalize="characters" />
        </div>
        <div>
          <label htmlFor={`${base}-find`} className="form-label">Invoice the new customer paid</label>
          <input id={`${base}-find`} className="form-input" value={term} onChange={e => setTerm(e.target.value)} placeholder="Search by customer name or invoice number" autoComplete="off" />
          <p className="form-hint">Only invoices that are not already credited to a referral are shown. The code owner and an existing customer cannot be credited.</p>
        </div>
        {loadingInv && !invoices ? <div className="skeleton h-24" role="status" aria-busy="true" aria-label="Loading invoices" />
          : invError ? <Notice kind="error">{invError}</Notice>
          : invoices && invoices.length === 0 ? <p className="text-text-secondary">No invoices match. Try a different name or number.</p>
          : invoices ? (
            <fieldset className={loadingInv ? 'opacity-60' : ''}>
              <legend className="sr-only">Invoices</legend>
              <ul className="ledger">
                {invoices.map(i => (
                  <li key={i.id}>
                    <label className="ledger-row cursor-pointer">
                      <input type="radio" name={`${base}-inv`} className="h-5 w-5 shrink-0 accent-blue" checked={pick === i.id} onChange={() => { setPick(i.id); setError('') }} />
                      <span className="ledger-main">
                        <span className="ledger-title block">{i.customer}{i.number ? ` · ${i.number}` : ''}</span>
                        <span className="ledger-sub block">{i.status || 'Invoice'} · {agoWords(i.date)}</span>
                      </span>
                      <span className="ledger-amt shrink-0">{money(i.total)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          ) : null}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={working}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={working} aria-busy={working}><Icon name="check" className="h-5 w-5" />{working ? 'Crediting…' : 'Credit this referral'}</button>
        </div>
      </form>
    </Sheet>
  )
}
