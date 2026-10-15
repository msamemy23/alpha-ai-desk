/**
 * Who to remind about an unpaid invoice, and wording the shop can use. This only reads invoices and writes sentences.
 * It sends nothing: the screen copies the wording, and another part of the app (or a person) decides whether to send.
 * Wording is honest and plain. It states what is owed and how to pay, and never threatens or mentions legal action.
 */
import { aging } from './reports.ts'
import type { ReportDoc } from './reports.ts'
import { owedByCustomer } from './report-metrics.ts'

export type ReminderStage = 'friendly' | 'second' | 'final'

export interface ReminderCandidate {
  key: string
  name: string
  customerId: string | null
  amount: number
  count: number
  oldestDays: number
  phone: string
  email: string
  invoiceNumbers: string[]
  docIds: string[]
  stage: ReminderStage
  /** What could be used to reach them. Empty means the shop has nothing on file. */
  reach: ('text' | 'email')[]
}

export const stageFor = (oldestDays: number): ReminderStage => (oldestDays >= 60 ? 'final' : oldestDays >= 30 ? 'second' : 'friendly')

export interface ReminderOptions { minDays?: number; minAmount?: number }

/** Customers with an open balance old enough to follow up on, oldest and biggest first. */
export function reminderCandidates(docs: ReportDoc[], todayKey: string, opts: ReminderOptions = {}): ReminderCandidate[] {
  const minDays = opts.minDays ?? 7
  const minAmount = opts.minAmount ?? 1
  const byId = new Map(docs.map(d => [d.id, d]))
  const open = aging(docs, todayKey).open
  const ages = new Map(open.map(o => [o.doc.id, o.days]))
  return owedByCustomer(docs, todayKey)
    .map(c => {
      // Only invoices that are themselves old enough count toward "oldest"; the customer is a candidate when any one is.
      const invoiceNumbers = c.ids.map(id => byId.get(id)?.number || '').filter(Boolean)
      const oldest = Math.max(0, ...c.ids.map(id => ages.get(id) || 0))
      return {
        key: c.key, name: c.name, customerId: c.customerId, amount: c.amount, count: c.count, oldestDays: oldest,
        phone: c.phone, email: c.email, invoiceNumbers, docIds: c.ids, stage: stageFor(oldest),
        reach: ([...(c.phone ? ['text'] : []), ...(c.email ? ['email'] : [])]) as ('text' | 'email')[],
      }
    })
    .filter(c => c.oldestDays >= minDays && c.amount >= minAmount)
    .sort((a, b) => b.oldestDays - a.oldestDays || b.amount - a.amount)
}

const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const first = (name: string) => {
  const w = name.trim().split(/\s+/)[0] || ''
  return /^(walk-?in|no customer name)$/i.test(w) ? '' : w
}

export interface ReminderWording { sms: string; emailSubject: string; emailBody: string }

/** Suggested words. `shopName` and `shopPhone` come from the shop's settings; the wording stays correct without a phone number. */
export function reminderWording(c: Pick<ReminderCandidate, 'name' | 'amount' | 'count' | 'invoiceNumbers' | 'stage'>, shop: { name: string; phone?: string }): ReminderWording {
  const who = first(c.name)
  const hi = who ? `Hi ${who}` : 'Hello'
  const shopName = shop.name.trim() || 'our shop'
  const nums = c.invoiceNumbers.length ? (c.invoiceNumbers.length > 3 ? `${c.invoiceNumbers.slice(0, 3).join(', ')} and ${c.invoiceNumbers.length - 3} more` : c.invoiceNumbers.join(', ')) : ''
  const what = c.count === 1 ? `invoice${nums ? ` ${nums}` : ''}` : `${c.count} invoices${nums ? ` (${nums})` : ''}`
  const call = shop.phone ? ` Call us at ${shop.phone} if anything looks off.` : ' Reply if anything looks off.'
  const lead = c.stage === 'friendly' ? `this is a quick reminder from ${shopName}.` : c.stage === 'second' ? `following up from ${shopName}.` : `this is ${shopName} about a balance that is now more than two months old.`
  const sms = `${hi}, ${lead} Your ${what} still has ${usd(c.amount)} open.${call} Thank you.`
  const emailBody = [
    `${hi},`, '',
    `${c.stage === 'friendly' ? 'A friendly reminder' : 'A follow-up'} from ${shopName}: your ${what} still has ${usd(c.amount)} open.`,
    c.stage === 'final' ? 'It has been open for more than two months. If there is a problem with the invoice or you would like to set up a payment plan, please let us know and we will work with you.' : 'If you have already paid, thank you, and please let us know so we can fix our records.',
    shop.phone ? `You can reach us at ${shop.phone}.` : 'You can reply to this email with any questions.', '',
    `Thank you,`, shopName,
  ].join('\n')
  return { sms, emailSubject: `${what.charAt(0).toUpperCase()}${what.slice(1)} from ${shopName}: ${usd(c.amount)} open`, emailBody }
}
