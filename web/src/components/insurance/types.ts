import { statusLamp, statusWord } from '@/components/jobs/types'
import type { Lamp } from '@/components/jobs/types'

export type Job = Record<string, any>

export interface NoteEntry { id: string; date: string; type: string; text: string }
export interface ClaimMsg { role: 'user' | 'assistant'; content: string; failed?: boolean }

/**
 * The claim status is the repair order's status, so these are the words the Jobs board uses, plus the ones this screen
 * has always offered. "Supplement" is kept because shops already use it, but the Jobs board files it under New;
 * the Supplement section tracks the request itself.
 */
export const STATUSES = ['New', 'Estimate Sent', 'Approved', 'In Progress', 'In Repair', 'Waiting on Parts', 'Supplement', 'Waiting on Customer', 'Completed', 'Ready for Pickup', 'Paid', 'Closed']

/** The choices to offer for a claim, always including whatever it is set to now. */
export const statusChoices = (current: string | undefined): string[] => (current && !STATUSES.includes(current) ? [...STATUSES, current] : STATUSES)

export const lampOf = (status: string | undefined): Lamp => (status === 'Supplement' ? 'amber' : statusLamp(status || 'New'))
export const statusLabel = (status: string | undefined): string => (status === 'Supplement' ? 'Supplement' : statusWord(status || 'New'))

export const SUPPLEMENT_STATUSES = ['None', 'Requested', 'Submitted', 'Under Review', 'Approved', 'Denied']
export const PAY_METHODS = ['Cash', 'Card', 'Zelle', 'Cash App', 'Check']
export const NOTE_TYPES = ['Call', 'Email', 'Fax', 'Note', 'Text']

export const carOf = (j: Job): string => [j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')

export const money = (n: unknown): string => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmtDate = (d: unknown): string => {
  const s = String(d || '').slice(0, 10)
  const t = new Date(s + 'T00:00:00')
  return s && Number.isFinite(t.getTime()) ? t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}
export const stamp = (iso: unknown): string => {
  const d = new Date(String(iso || ''))
  return Number.isFinite(d.getTime())
    ? `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : 'Date not recorded'
}
// Dollar text used inside the Alpha prompt. "N/A" tells the AI the value is missing.
export const fmtForAi = (n: unknown): string => (n ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A')

export const amountText = (v: unknown): string => (v === null || v === undefined || v === '' || Number(v) === 0 ? '' : String(v))
