'use client'
import { FilterChips } from '@/components/ListKit'
import type { ApiResult } from '@/lib/client-api'
import type { Person } from '@/lib/timeclock'
import AccountMapping from './AccountMapping'
import AccountantPackage from './AccountantPackage'
import AccountingSettings from './AccountingSettings'
import BillsPanel from './BillsPanel'
import { BooksGate } from './BooksNotice'
import MonthClosePanel from './MonthClosePanel'
import PayrollPanel from './PayrollPanel'
import QuickBooksPanel from './QuickBooksPanel'
import type { Ctx } from './types'
import type { BooksState } from './useBooks'

export type AccountingSection = 'package' | 'accounts' | 'bills' | 'close' | 'payroll' | 'quickbooks' | 'settings'
export const ACCOUNTING_SECTIONS: { key: AccountingSection; label: string }[] = [
  { key: 'package', label: 'Accountant package' },
  { key: 'accounts', label: 'Accounts' },
  { key: 'bills', label: 'Bills and expenses' },
  { key: 'close', label: 'Month-end' },
  { key: 'payroll', label: 'Payroll hours' },
  { key: 'quickbooks', label: 'QuickBooks' },
  { key: 'settings', label: 'Settings' },
]
export const isAccountingSection = (v: string | null): v is AccountingSection => ACCOUNTING_SECTIONS.some(s => s.key === v)

interface Props {
  ctx: Ctx
  books: { state: BooksState; reload: () => void; act: (body: Record<string, unknown>) => Promise<ApiResult<Record<string, unknown>>> }
  people: Person[]
  peopleError: string
  retryPeople: () => void
  section: AccountingSection
  onSection: (s: AccountingSection) => void
}

/** The shop's books: the files an accountant asks for, account names, bills, month-end, payroll hours and the QuickBooks link. */
export default function AccountingTab({ ctx, books, people, peopleError, retryPeople, section, onSection }: Props) {
  const nav = (
    <div className="mb-4">
      <FilterChips<AccountingSection> label="Accounting" options={ACCOUNTING_SECTIONS} value={section} onChange={onSection} scroll />
    </div>
  )
  if (books.state.status === 'loading') return <div>{nav}<div className="space-y-3" role="status" aria-label="Loading your books"><div className="skeleton h-24" /><div className="skeleton h-48" /></div></div>
  // Payroll hours come from the time clock, not the books, so they need no access to the books tables.
  if (books.state.status !== 'ready' && section !== 'payroll') return <div>{nav}<BooksGate state={books.state} what="Accounting" onRetry={books.reload} /></div>
  const data = books.state.status === 'ready' ? books.state.books : null

  return (
    <div>
      {nav}
      {section === 'payroll' && <PayrollPanel ctx={ctx} people={people} peopleError={peopleError} retryPeople={retryPeople} />}
      {data && section === 'package' && <AccountantPackage ctx={ctx} books={data} reload={books.reload} goAccounts={() => onSection('accounts')} />}
      {data && section === 'accounts' && <AccountMapping books={data} reload={books.reload} act={books.act} />}
      {data && section === 'bills' && <BillsPanel ctx={ctx} books={data} reload={books.reload} act={books.act} />}
      {data && section === 'close' && <MonthClosePanel ctx={ctx} books={data} reload={books.reload} act={books.act} />}
      {data && section === 'quickbooks' && <QuickBooksPanel ctx={ctx} books={data} goPackage={() => onSection('package')} goAccounts={() => onSection('accounts')} />}
      {data && section === 'settings' && <AccountingSettings books={data} reload={books.reload} act={books.act} />}
      {!data && section === 'payroll' && <div className="mt-4"><BooksGate state={books.state} what="The rest of Accounting" onRetry={books.reload} /></div>}
    </div>
  )
}
