import type { BundleInput } from '@/lib/report-bundles'
import { DEFAULT_SETTINGS } from '@/lib/books-store'
import type { ReportCall } from '@/lib/reports'
import { callStats } from '@/lib/reports'
import { dayOfStamp } from '@/lib/report-docs'
import type { BooksData } from './useBooks'
import type { Ctx } from './types'

const hourOf = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? -1 : d.getHours() }

/**
 * What the report files and emails are built from, assembled from what the screen already holds. When the books could not
 * be read (a role without access, or a database that has not been updated) the defaults are used and the bundle's notes say
 * what is left out.
 */
export function bundleInput(ctx: Ctx, books: BooksData | null, calls: ReportCall[] | null): BundleInput {
  const settings = books && books.settings.state === 'ok' ? books.settings.value : DEFAULT_SETTINGS
  const callsNow = calls ? callStats(calls, ctx.range, dayOfStamp, hourOf).inbound : null
  const callsBefore = calls && ctx.previous ? callStats(calls, ctx.previous, dayOfStamp, hourOf).inbound : null
  return {
    docs: ctx.docs, payments: ctx.payments, expenses: books && books.expenses.state === 'ok' ? books.expenses.value : [],
    range: ctx.range, previous: ctx.previous, phrase: ctx.phrase, vs: ctx.vs, periodTitle: ctx.title, todayKey: ctx.todayKey,
    shopName: ctx.shop.name, taxComponents: settings.taxComponents, laborCostPerHour: settings.laborCostPerHour, postedRate: ctx.shop.postedRate,
    basis: settings.basis, cogsMethod: settings.cogsMethod,
    calls: callsNow !== null && callsBefore !== null ? { now: callsNow, before: callsBefore } : null,
  }
}
