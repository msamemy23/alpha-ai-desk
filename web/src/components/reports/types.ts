import type { PeriodKey, Range, ReportDoc, ReportPayment } from '@/lib/reports'

/** What every tab is given: the days being looked at, the days they are compared with, and the paperwork. */
export interface Ctx {
  todayKey: string
  period: PeriodKey
  range: Range
  previous: Range
  /** Invoices and receipts. */
  docs: ReportDoc[]
  /** Money received, including paid invoices that have no payment record. */
  payments: ReportPayment[]
}
