'use client'
import { useMemo } from 'react'
import { buildJournal, resolveAccounts, runChecks, totalDebits, unmappedKeys, accountsUsed } from '@/lib/accounting'
import { DEFAULT_SETTINGS } from '@/lib/books-store'
import { money2, rangeLabel } from '@/lib/reports'
import { Block } from './parts'
import type { Ctx } from './types'
import { NO_ACCOUNTS, NO_EXPENSES } from './useBooks'
import type { BooksData } from './useBooks'

/**
 * The QuickBooks Online connection, up to the sign-in step. A live connection needs an Intuit developer app that only the owner
 * can create, so the sign-in button stays off and this page says exactly what is needed. Until then the import files work today.
 */
export default function QuickBooksPanel({ ctx, books, goPackage, goAccounts }: { ctx: Ctx; books: BooksData; goPackage: () => void; goAccounts: () => void }) {
  const settings = books.settings.state === 'ok' ? books.settings.value : DEFAULT_SETTINGS
  const book = useMemo(() => resolveAccounts(books.mappings.state === 'ok' ? books.mappings.value : NO_ACCOUNTS), [books.mappings])
  const expenses = books.expenses.state === 'ok' ? books.expenses.value : NO_EXPENSES
  const journal = useMemo(() => buildJournal(ctx.docs, ctx.payments, ctx.range, book, { mode: settings.journalMode, includeCost: settings.includeCost, dailyCustomer: settings.dailyCustomer, expenses }), [ctx.docs, ctx.payments, ctx.range, book, settings, expenses])
  const checks = useMemo(() => runChecks(ctx.docs, ctx.payments, ctx.range, journal), [ctx.docs, ctx.payments, ctx.range, journal])
  const unmapped = unmappedKeys(book).filter(k => accountsUsed(journal.entries).has(k)).length
  const attention = checks.filter(c => c.state === 'attention').length

  return (
    <div className="space-y-4">
      <section className="card flex items-start gap-3">
        <span className="lamp lamp-off mt-[0.4rem] shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-text-primary">Not connected to QuickBooks</p>
          <p className="mt-0.5 text-text-secondary">Alpha Desk cannot sign in to QuickBooks Online yet. It needs an app registered with Intuit, which only you can set up. Nothing is sent to QuickBooks today.</p>
          <button type="button" className="btn btn-primary mt-3" disabled aria-describedby="qb-why">Connect to QuickBooks Online</button>
          <p id="qb-why" className="mt-2 text-[0.875rem] text-text-secondary">This turns on after step 3 below.</p>
        </div>
      </section>

      <Block title="What works today">
        <p className="text-text-primary">You can move your books into QuickBooks without a connection. Download the journal entries file and import it, or give your accountant the whole package.</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-text-secondary">
          <li>QuickBooks Online: import the journal entries file (Settings, Import data).</li>
          <li>QuickBooks Desktop: import the IIF file (File, Utilities, Import).</li>
          <li>Account names come from the Accounts screen, so they match your chart of accounts.</li>
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-primary" onClick={goPackage}>Open the accountant package</button>
          <button type="button" className="btn btn-secondary" onClick={goAccounts}>Name your accounts</button>
        </div>
      </Block>

      <Block title="What you need to do to connect">
        <ol className="space-y-3">
          {[
            ['Create a free Intuit developer account', 'Go to developer.intuit.com and sign in with the Intuit login you use for QuickBooks.'],
            ['Create an app for QuickBooks Online Accounting', 'Choose the accounting scope. Intuit then shows a Client ID and a Client secret for the app.'],
            ['Give the Client ID and Client secret to whoever looks after your Alpha Desk setup', 'They are kept on the server and never shown in the browser. Ask them to also add the sign-in return address Intuit asks for, which they will know. After that the Connect button here turns on.'],
            ['Sign in to QuickBooks and pick your company', 'You will see exactly what Alpha Desk may read and write before you allow it. You can disconnect at any time.'],
          ].map(([title, body], i) => (
            <li key={title} className="flex items-start gap-3">
              <span className="num mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border border-line font-bold" aria-hidden="true">{i + 1}</span>
              <div className="min-w-0"><p className="font-bold text-text-primary"><span className="sr-only">Step {i + 1}: </span>{title}</p><p className="text-[0.9375rem] text-text-secondary">{body}</p></div>
            </li>
          ))}
        </ol>
      </Block>

      <Block title="What would be sent">
        <p className="text-text-secondary">If you were connected today, for {rangeLabel(ctx.range)}, Alpha Desk would show you this and wait for your approval before sending anything:</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <div><dt className="text-[0.875rem] text-text-secondary">Journal entries</dt><dd className="num text-[1.25rem] font-bold">{journal.entries.length}</dd></div>
          <div><dt className="text-[0.875rem] text-text-secondary">Total posted</dt><dd className="num text-[1.25rem] font-bold">{money2(totalDebits(journal.entries))}</dd></div>
          <div><dt className="text-[0.875rem] text-text-secondary">Accounts with a suggested name</dt><dd className="num text-[1.25rem] font-bold">{unmapped}</dd></div>
          <div><dt className="text-[0.875rem] text-text-secondary">Checks to look at</dt><dd className="num text-[1.25rem] font-bold">{attention}</dd></div>
        </dl>
        <p className="mt-3 text-[0.875rem] text-text-secondary">Every entry would carry its invoice number so it can never be sent twice. Invoices and payments in Alpha Desk are never changed by a sync.</p>
      </Block>
    </div>
  )
}
