import type { RangeSpec } from '@/lib/report-ranges'
import type { Range, ReportDoc, ReportPayment } from '@/lib/reports'
import type { DrillTarget } from './DrillSheet'
import type { ShopInfo } from './useReportData'

/** What every tab is given: the days being looked at, the days they are compared with, and the paperwork. */
export interface Ctx {
  todayKey: string
  spec: RangeSpec
  range: Range
  /** The days compared with, or null when the person chose no comparison. */
  previous: Range | null
  /** Reads after "from": "the 7 days before". Empty when nothing is compared. */
  vs: string
  /** "in the last 30 days", "last week". */
  phrase: string
  /** "Last 30 days" or "Oct 1 to Oct 14, 2026". */
  title: string
  /** Invoices and receipts, plus estimates that were sent for online approval (every sum ignores those). */
  docs: ReportDoc[]
  /** Money received, including paid invoices that have no payment record. */
  payments: ReportPayment[]
  /** False when this database lacks the advisor, car and approval columns, so reports that need them say so. */
  extended: boolean
  shop: ShopInfo
  /** Opens the list of paperwork behind a figure. */
  drill: (target: DrillTarget) => void
}
