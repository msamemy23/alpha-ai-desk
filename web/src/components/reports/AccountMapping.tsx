'use client'
import { useEffect, useMemo, useState } from 'react'
import FormError from '@/components/forms/FormError'
import Notice from '@/components/Notice'
import { ACCOUNT_DEFS, EXPENSE_CATEGORIES, allAccountDefs, resolveAccounts } from '@/lib/accounting'
import type { AccountDef, AccountGroup } from '@/lib/accounting'
import type { ApiResult } from '@/lib/client-api'
import { ResourceNotice } from './BooksNotice'
import { NO_ACCOUNTS } from './useBooks'
import type { BooksData } from './useBooks'

const GROUPS: { key: AccountGroup | 'cogs-expense'; label: string; help: string }[] = [
  { key: 'income', label: 'Income', help: 'Where each kind of sale is recorded.' },
  { key: 'liability', label: 'Money you owe', help: 'Sales tax and bills.' },
  { key: 'asset', label: 'Money owed to you and stock', help: 'Unpaid invoices and parts on the shelf.' },
  { key: 'deposit', label: 'Where payments land', help: 'The account each way of paying goes into.' },
  { key: 'cogs', label: 'Cost of goods sold', help: 'What parts and outside work cost you.' },
  { key: 'expense', label: 'Expenses', help: 'Rent, utilities and the rest.' },
]

/**
 * Tells Alpha Desk what your accountant calls each account, so the files import without renaming anything.
 * An account left empty uses the suggested name. Names must match accounts that exist in QuickBooks, or QuickBooks creates them.
 */
export default function AccountMapping({ books, reload, act }: { books: BooksData; reload: () => void; act: (body: Record<string, unknown>) => Promise<ApiResult<Record<string, unknown>>> }) {
  const saved = books.mappings.state === 'ok' ? books.mappings.value : NO_ACCOUNTS
  const book = useMemo(() => resolveAccounts(saved), [saved])
  const defs = useMemo(() => allAccountDefs(), [])
  const [names, setNames] = useState<Record<string, { name: string; number: string }>>({})
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  useEffect(() => {
    if (dirty) return
    const next: Record<string, { name: string; number: string }> = {}
    for (const d of defs) next[d.key] = { name: book[d.key].saved ? book[d.key].name : '', number: book[d.key].number }
    setNames(next)
  }, [book, defs, dirty])

  const set = (key: string, patch: Partial<{ name: string; number: string }>) => { setNames(n => ({ ...n, [key]: { ...n[key], ...patch } })); setDirty(true); setDone('') }
  const unavailable = books.mappings.state !== 'ok'
  const named = Object.values(names).filter(n => n.name.trim()).length

  const save = async () => {
    setBusy(true); setError(''); setDone('')
    const r = await act({ action: 'mappings', mappings: defs.map(d => ({ key: d.key, account_name: names[d.key]?.name ?? '', account_number: names[d.key]?.number ?? '' })) })
    setBusy(false)
    if (r.ok) { setDirty(false); setDone('Saved. The next file you download uses these names.'); return }
    setError(r.needsUpdate ? 'This needs a one-time update to your Alpha Desk database before account names can be saved.' : r.message)
  }

  const row = (d: AccountDef) => {
    const n = names[d.key] || { name: '', number: '' }
    return (
      <li key={d.key} className="grid grid-cols-[1fr_5.5rem] gap-2 py-3">
        <div className="col-span-2 min-w-0">
          <label htmlFor={`acct-${d.key}`} className="font-bold text-text-primary">{d.label}</label>
          {d.help && <p className="text-[0.875rem] text-text-secondary">{d.help}</p>}
        </div>
        <input id={`acct-${d.key}`} className="form-input" value={n.name} placeholder={d.defaultName} maxLength={100} onChange={e => set(d.key, { name: e.target.value })} aria-label={`${d.label}: account name`} />
        <input className="form-input" value={n.number} placeholder="No." maxLength={20} onChange={e => set(d.key, { number: e.target.value })} aria-label={`${d.label}: account number`} />
      </li>
    )
  }

  return (
    <div className="space-y-4">
      <ResourceNotice r={books.mappings} what="Your account names" onRetry={reload} />
      <Notice kind="info">Type the name your accountant uses for each account. Leave one empty and the suggested name in grey is used. {named === 0 ? 'None are named yet, so every file uses the suggested names.' : `${named} ${named === 1 ? 'is' : 'are'} named.`}</Notice>
      {GROUPS.map(g => {
        const list = defs.filter(d => d.group === g.key)
        if (!list.length) return null
        return (
          <section key={g.key} className="panel">
            <div className="panel-header"><div><h2 className="section-title">{g.label}</h2><p className="text-[0.875rem] text-text-secondary">{g.help}</p></div></div>
            <ul className="panel-body divide-y divide-border !py-0">{list.map(row)}</ul>
          </section>
        )
      })}
      {error && <FormError>{error}</FormError>}
      {done && <Notice kind="success">{done}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || unavailable || !dirty}>{busy ? 'Saving' : 'Save account names'}</button>
        {dirty && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setDirty(false)}>Discard changes</button>}
      </div>
      <p className="text-[0.875rem] text-text-secondary">{ACCOUNT_DEFS.length + EXPENSE_CATEGORIES.length} accounts in all. Only the ones your invoices and bills actually use appear in the account list file.</p>
    </div>
  )
}
