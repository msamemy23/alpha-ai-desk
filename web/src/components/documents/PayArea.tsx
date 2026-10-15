'use client'
import { formatCurrency } from '@/lib/supabase'
import { docLamp, docStatusLabel } from '@/lib/doc-status'
import Icon from '@/components/Icon'
import { fmtDate } from './types'
import type { PaymentPlan } from './types'

export interface PayAreaProps {
  documentId: string | null
  docType: string
  docNumber: string
  customerName: string
  status: string
  total: number
  paid: number
  owed: number
  paymentMethod: string
  isNew: boolean
  locked: boolean
  plan: PaymentPlan | undefined
  canPlan: boolean
  onRecordManual: () => void
  onPlan: () => void
  onTogglePlanPayment: (index: number, paid: boolean) => void
}

/**
 * Where online payment will plug in. A card or bank payment area (pay now, deposit, payment link) mounts here,
 * beside the manual "Record payment" button, without touching anything else on the page. Until one exists the
 * slot renders nothing. Recording money that was already received works as it always has.
 */
export interface PaySlotProps {
  documentId: string
  docType: string
  docNumber: string
  customerName: string
  total: number
  owed: number
  status: string
}
export function PayOnlineSlot(props: PaySlotProps) {
  void props
  return null
}

export default function PayArea(p: PayAreaProps) {
  const lamp = docLamp(p.docType, p.status)
  const plan = p.plan
  const noun = p.docType.toLowerCase()
  return (
    <section aria-labelledby="sec-payment" className="card" data-pay-area>
      <h2 id="sec-payment" className="section-title mb-2">Payment</h2>
      {p.isNew || !p.documentId ? (
        <p className="text-text-secondary">Save the {noun} first. Then you can record payments and set up a payment plan.</p>
      ) : (
        <>
          <p className="flex items-center gap-2 font-bold"><span className={`lamp lamp-${lamp}`} aria-hidden="true" />{docStatusLabel(p.docType, p.status)}</p>
          <p className="mt-0.5 text-[0.9375rem] text-text-secondary num">
            {p.status === 'Paid' ? `${formatCurrency(p.paid || p.total)} received${p.paymentMethod ? ` by ${p.paymentMethod}` : ''}.` : p.paid > 0 ? `${formatCurrency(p.paid)} received. ${formatCurrency(p.owed)} still due.` : `${formatCurrency(p.owed)} due.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {p.owed > 0 && p.status !== 'Paid' && p.status !== 'Void' && (
              <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={p.onRecordManual}>
                <Icon name="dollar" className="h-5 w-5" />
                Record payment
              </button>
            )}
            {p.canPlan && !p.locked && (
              <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={p.onPlan}>
                <Icon name="calendar" className="h-5 w-5" />
                {plan?.enabled ? 'Change payment plan' : 'Set up payment plan'}
              </button>
            )}
          </div>
          <PayOnlineSlot documentId={p.documentId} docType={p.docType} docNumber={p.docNumber} customerName={p.customerName} total={p.total} owed={p.owed} status={p.status} />
        </>
      )}
      {plan?.enabled && (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-[0.9375rem] font-bold">Payment plan</h3>
          <p className="text-[0.9375rem] text-text-secondary num">Down payment {formatCurrency(plan.down_payment)}, then {plan.installments} {plan.frequency === 'biweekly' ? 'every two weeks' : plan.frequency} payments</p>
          <ul className="mt-2">
            {plan.payments.map((pay, i) => (
              <li key={i}>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[0.9375rem]">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[rgb(var(--c-blue))]"
                    checked={pay.paid}
                    disabled={p.locked}
                    onChange={e => p.onTogglePlanPayment(i, e.target.checked)}
                  />
                  <span className={`num ${pay.paid ? 'text-text-muted line-through' : ''}`}>{fmtDate(pay.date)}</span>
                  <span className={`num ml-auto ${pay.paid ? 'text-text-muted line-through' : 'font-bold'}`}>{formatCurrency(pay.amount)}</span>
                  <span className="sr-only">{pay.paid ? 'paid' : 'not paid'}</span>
                </label>
              </li>
            ))}
          </ul>
          {(() => {
            const paidN = plan.payments.filter(x => x.paid).length
            const totalN = plan.payments.length
            const pct = totalN > 0 ? (paidN / totalN) * 100 : 0
            return (
              <div className="mt-2">
                <div className="h-2 overflow-hidden rounded-full bg-bg-hover"><div className="h-full rounded-full bg-green transition-all" style={{ width: `${pct}%` }} /></div>
                <p className="mt-1 text-[0.8125rem] text-text-secondary num">{paidN} of {totalN} plan payments marked paid</p>
              </div>
            )
          })()}
        </div>
      )}
    </section>
  )
}
