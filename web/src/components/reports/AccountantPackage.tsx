'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import {
  accountListCsv, accountsUsed, buildJournal, dailyTotals, dailyTotalsCsv, ledgerCsv, quickbooksIif, quickbooksOnlineCsv, resolveAccounts, runChecks, totalCredits, totalDebits, unmappedKeys,
} from '@/lib/accounting'
import { DEFAULT_SETTINGS } from '@/lib/books-store'
import { fileName } from '@/lib/report-files'
import { docsById } from '@/lib/report-metrics'
import { money2, rangeLabel } from '@/lib/reports'
import { ResourceNotice } from './BooksNotice'
import { saveText } from './files'
import { Block } from './parts'
import type { Ctx } from './types'
import { NO_ACCOUNTS, NO_EXPENSES } from './useBooks'
import type { BooksData } from './useBooks'

/**
 * The files an accountant asks for, made from your invoices and payments for the dates chosen at the top. Everything here reads
 * and writes a file; nothing in Alpha Desk changes when you download.
 */
export default function AccountantPackage({ ctx, books, reload, goAccounts }: { ctx: Ctx; books: BooksData; reload: () => void; goAccounts: () => void }) {
  const { docs, payments, range } = ctx
  const settings = books.settings.state === 'ok' ? books.settings.value : DEFAULT_SETTINGS
  const saved = books.mappings.state === 'ok' ? books.mappings.value : NO_ACCOUNTS
  const expenses = books.expenses.state === 'ok' ? books.expenses.value : NO_EXPENSES
  const book = useMemo(() => resolveAccounts(saved), [saved])
  const journal = useMemo(
    () => buildJournal(docs, payments, range, book, { mode: settings.journalMode, includeCost: settings.includeCost, dailyCustomer: settings.dailyCustomer, expenses }),
    [docs, payments, range, book, settings.journalMode, settings.includeCost, settings.dailyCustomer, expenses],
  )
  const checks = useMemo(() => runChecks(docs, payments, range, journal), [docs, payments, range, journal])
  const days = useMemo(() => dailyTotals(docs, payments, range), [docs, payments, range])
  const used = useMemo(() => accountsUsed(journal.entries), [journal.entries])
  const unmapped = useMemo(() => unmappedKeys(book).filter(k => used.has(k)), [book, used])
  const [problem, setProblem] = useState('')
  const [made, setMade] = useState('')
  const debits = totalDebits(journal.entries), credits = totalCredits(journal.entries)
  const attention = checks.filter(c => c.state === 'attention').length
  const empty = journal.entries.length === 0

  const make = (label: string, name: string, build: () => string, kind: 'csv' | 'iif') => {
    try { saveText(name, build(), kind); setProblem(''); setMade(`${label} downloaded: ${name}`) }
    catch { setMade(''); setProblem(`${label} could not be made. Try a shorter period.`) }
  }

  const files = [
    { key: 'qbo', label: 'QuickBooks Online journal entries', help: 'In QuickBooks Online: Settings, Import data, Journal entries.', run: () => make('QuickBooks Online file', fileName('quickbooks-online', range, 'csv'), () => quickbooksOnlineCsv(journal.entries), 'csv') },
    { key: 'iif', label: 'QuickBooks Desktop (IIF)', help: 'In QuickBooks Desktop: File, Utilities, Import, IIF files. Create the accounts first.', run: () => make('QuickBooks Desktop file', fileName('quickbooks-desktop', range, 'iif'), () => quickbooksIif(journal.entries), 'iif') },
    { key: 'ledger', label: 'Ledger for any accountant', help: 'One row per debit or credit. Opens in Excel and Google Sheets.', run: () => make('Ledger', fileName('ledger', range, 'csv'), () => ledgerCsv(journal.entries), 'csv') },
    { key: 'accounts', label: 'List of accounts used', help: 'The accounts the files post to, so your accountant can create any that are missing first.', run: () => make('Account list', fileName('accounts-used', range, 'csv'), () => accountListCsv(book, used), 'csv') },
    { key: 'daily', label: 'Daily totals', help: 'Each day\'s sales, tax and money received, by how it was paid. Hold it against your deposits.', run: () => make('Daily totals', fileName('daily-totals', range, 'csv'), () => dailyTotalsCsv(days), 'csv') },
  ]

  return (
    <div className="space-y-4">
      <ResourceNotice r={books.settings} what="Your accounting settings" onRetry={reload} />
      <ResourceNotice r={books.mappings} what="Your account names" onRetry={reload} />
      <ResourceNotice r={books.expenses} what="Your bills and expenses" onRetry={reload} />
      <p className="text-text-secondary">For {rangeLabel(range)}. Change the dates at the top of the page. These files only read your invoices and payments, so downloading changes nothing.</p>

      {unmapped.length > 0 && (
        <Notice kind="warn">
          <p className="font-bold">{unmapped.length} {unmapped.length === 1 ? 'account uses' : 'accounts use'} a suggested name</p>
          <p className="mt-0.5 text-text-secondary">If your accountant calls them something else, QuickBooks will create new accounts when you import. Tell Alpha Desk the names you use.</p>
          <button type="button" className="btn btn-secondary mt-2" onClick={goAccounts}>Name your accounts</button>
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card !p-4"><p className="text-[0.9375rem] font-bold text-text-secondary">Entries</p><p className="display num mt-1 text-[1.75rem] font-bold">{journal.entries.length}</p><p className="text-[0.875rem] text-text-secondary">{settings.journalMode === 'daily' ? 'One per day' : 'One per invoice or payment'}</p></div>
        <div className="card !p-4"><p className="text-[0.9375rem] font-bold text-text-secondary">Debits</p><p className="display num mt-1 text-[1.75rem] font-bold">{money2(debits)}</p></div>
        <div className="card !p-4"><p className="text-[0.9375rem] font-bold text-text-secondary">Credits</p><p className="display num mt-1 text-[1.75rem] font-bold">{money2(credits)}</p></div>
        <div className="card !p-4"><p className="text-[0.9375rem] font-bold text-text-secondary">Checks</p><p className="display num mt-1 text-[1.75rem] font-bold">{attention ? `${attention} to look at` : 'All clear'}</p></div>
      </div>

      <Block title="Checks before you send it">
        <ul className="divide-y divide-border">
          {checks.map(c => (
            <li key={c.key} className="flex items-start gap-3 py-3">
              <span className={`lamp lamp-${c.state === 'ok' ? 'green' : 'amber'} mt-[0.4rem] shrink-0`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-text-primary">{c.label}<span className="sr-only">{c.state === 'ok' ? ': passed' : ': needs a look'}</span></p>
                <p className="text-[0.9375rem] text-text-secondary">{c.detail}</p>
                {c.state === 'attention' && c.ids.length > 0 && docsById(docs, c.ids).length > 0 && (
                  <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => ctx.drill({ title: c.label, sub: c.detail, docs: docsById(docs, c.ids) })}>See the invoices</button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {journal.problems.filter(p => !['unbalanced', 'total-differs'].includes(p.key)).length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="font-bold text-text-primary">Other things the files could not include</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[0.9375rem] text-text-secondary">
              {journal.problems.filter(p => !['unbalanced', 'total-differs'].includes(p.key)).slice(0, 10).map((p, i) => <li key={i}>{p.message}</li>)}
            </ul>
          </div>
        )}
      </Block>

      <Block title="Download">
        {empty ? <p className="text-text-secondary">There is nothing to post for these dates. Pick a period that has invoices.</p> : (
          <ul className="divide-y divide-border">
            {files.map(f => (
              <li key={f.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1 basis-56"><p className="font-bold text-text-primary">{f.label}</p><p className="text-[0.875rem] text-text-secondary">{f.help}</p></div>
                <button type="button" className="btn btn-secondary" onClick={f.run}><Icon name="download" className="h-5 w-5" />Download</button>
              </li>
            ))}
          </ul>
        )}
        {problem && <Notice kind="error" className="mt-3">{problem}</Notice>}
        {made && <p role="status" className="mt-3 text-[0.9375rem] font-bold text-text-primary">{made}</p>}
      </Block>

      <Block title="Day by day">
        {days.length === 0 ? <p className="text-text-secondary">No invoices or payments on these dates.</p> : (
          <div className="overflow-x-auto">
            <table className="data-table w-full min-w-[34rem] text-left">
              <caption className="sr-only">Daily totals</caption>
              <thead><tr><th scope="col">Date</th><th scope="col" className="text-right">Invoices</th><th scope="col" className="text-right">Billed</th><th scope="col" className="text-right">Tax</th><th scope="col" className="text-right">Collected</th></tr></thead>
              <tbody>{days.map(d => <tr key={d.date}><th scope="row">{d.date}</th><td className="num text-right">{d.invoices}</td><td className="num text-right">{money2(d.billed)}</td><td className="num text-right">{money2(d.tax)}</td><td className="num text-right font-bold">{money2(d.collected)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Block>
    </div>
  )
}
