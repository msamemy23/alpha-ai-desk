// Referral rules: who can be credited for sending a new customer, and what a referral was worth.
// Pure, so the server checks and the tests use the exact same code. The route does the reading and writing.

import { phoneKey, hasUsablePhone } from './automation-rules.ts'

export const normalizeCode = (value: unknown): string => String(value ?? '').trim().toUpperCase().replace(/\s+/g, '')

/** A code looks right if it is letters and numbers with an optional dash, 3 to 24 characters. */
export const looksLikeCode = (value: unknown): boolean => /^[A-Z0-9]+(?:-[A-Z0-9]+)?$/.test(normalizeCode(value)) && normalizeCode(value).length >= 3 && normalizeCode(value).length <= 24

export interface ReferrerInfo { id: string | null; name: string; phone?: string | null; email?: string | null }
export interface ReferredInfo { id: string | null; name: string; phone?: string | null; email?: string | null }

export interface RedemptionCheckInput {
  /** The code row from the referrals table. */
  referral: { id: string; code: string; customer_id: string | null; customer_name: string; active?: boolean | null } | null
  referrer: ReferrerInfo | null
  /** The customer on the invoice: the person who was referred. */
  referred: ReferredInfo | null
  /** The invoice being credited. */
  document: { id: string; type: string; customer_id: string | null } | null
  /** How many invoices or receipts this customer already had before this one. */
  earlierInvoices: number
  /** Is this invoice already credited to a referral? */
  documentAlreadyCredited: boolean
  /** Has this customer already been credited as referred by someone? */
  customerAlreadyReferred: boolean
}

export type RedemptionCode = 'no_code' | 'inactive' | 'no_invoice' | 'no_customer' | 'self' | 'not_new' | 'doc_credited' | 'already_referred'

export type RedemptionCheck = { ok: true } | { ok: false; code: RedemptionCode; error: string }

const no = (code: RedemptionCode, error: string): RedemptionCheck => ({ ok: false, code, error })

const sameEmail = (a: unknown, b: unknown): boolean => {
  const x = String(a ?? '').trim().toLowerCase()
  const y = String(b ?? '').trim().toLowerCase()
  return Boolean(x) && x === y
}

/** Can this invoice be credited to this referral code? Plain-words reasons when not. */
export function checkRedemption(input: RedemptionCheckInput): RedemptionCheck {
  const { referral, referrer, referred, document: doc } = input
  if (!referral) return no('no_code', 'That code was not found. Check the spelling, or look it up under Referrals.')
  if (referral.active === false) return no('inactive', 'That code is switched off, so it cannot be used.')
  if (!doc || !['Invoice', 'Receipt'].includes(doc.type)) return no('no_invoice', 'Choose the invoice the new customer paid for.')
  if (!referred || (!referred.id && !referred.name)) return no('no_customer', 'That invoice has no customer on it. Add the customer first.')
  const selfById = Boolean(referred.id && referral.customer_id && referred.id === referral.customer_id)
  const selfByPhone = Boolean(referrer && hasUsablePhone(referrer.phone) && hasUsablePhone(referred.phone) && phoneKey(referrer.phone) === phoneKey(referred.phone))
  const selfByEmail = Boolean(referrer && sameEmail(referrer.email, referred.email))
  if (selfById || selfByPhone || selfByEmail) return no('self', 'People cannot refer themselves. This customer is the one who owns the code.')
  if (input.documentAlreadyCredited) return no('doc_credited', 'This invoice has already been credited to a referral.')
  if (input.customerAlreadyReferred) return no('already_referred', 'This customer was already credited as referred, and a customer can only be referred once.')
  if (input.earlierInvoices > 0) return no('not_new', 'This customer has paid for work here before, so they are not a new customer. A referral only counts for someone new.')
  return { ok: true }
}

/** What an invoice has actually brought in: what was paid, or the whole total once it is marked paid. */
export function paidAmount(totals: { total: number; amountPaid: number }, status: string): number {
  const paid = totals.amountPaid > 0 ? Math.min(totals.amountPaid, totals.total || totals.amountPaid) : status === 'Paid' ? totals.total : 0
  return Math.round(paid * 100) / 100
}

export interface RedemptionRow {
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

export interface ReferralStats {
  codes: number
  redeemed: number
  /** What the referred customers have actually paid. */
  revenue: number
  rewards_owed: number
  rewards_given: number
  top: Array<{ referrer: string; code: string; redeemed: number; revenue: number }>
}

export function summarize(codes: ReadonlyArray<{ code: string }>, redemptions: readonly RedemptionRow[]): ReferralStats {
  const byCode = new Map<string, { referrer: string; code: string; redeemed: number; revenue: number }>()
  for (const r of redemptions) {
    const k = r.code
    const row = byCode.get(k) || { referrer: r.referrer_name || 'Unknown', code: k, redeemed: 0, revenue: 0 }
    row.redeemed += 1
    row.revenue = Math.round((row.revenue + r.paid) * 100) / 100
    byCode.set(k, row)
  }
  return {
    codes: codes.length,
    redeemed: redemptions.length,
    revenue: Math.round(redemptions.reduce((a, r) => a + r.paid, 0) * 100) / 100,
    rewards_owed: redemptions.filter(r => !r.reward_given).length,
    rewards_given: redemptions.filter(r => r.reward_given).length,
    top: [...byCode.values()].sort((a, b) => b.redeemed - a.redeemed || b.revenue - a.revenue).slice(0, 5),
  }
}
