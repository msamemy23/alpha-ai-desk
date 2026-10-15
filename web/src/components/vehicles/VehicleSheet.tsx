'use client'
import Link from 'next/link'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { statusLamp, statusWord } from '@/components/jobs/types'
import { fmtDay } from '@/components/customers/types'
import { carName } from '@/lib/list-logic'
import type { Vehicle } from '@/lib/list-logic'

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-border py-2.5 last:border-b-0">
      <dt className="w-24 shrink-0 text-[0.9375rem] text-text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  )
}

const none = <span className="text-text-secondary">Not on file</span>

/** One car: who owns it, what it is, and every repair order written for it. */
export default function VehicleSheet({ vehicle, onClose }: { vehicle: Vehicle | null; onClose: () => void }) {
  const v = vehicle
  const owner = v?.ownerId ? encodeURIComponent(v.ownerId) : ''
  return (
    <Sheet open={!!v} onClose={onClose} title={v ? carName(v) : 'Vehicle'} wide>
      {v && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-2">
            {owner ? (
              <>
                <Link href={`/jobs?new=1&customer=${owner}`} className="btn btn-primary no-underline"><Icon name="plus" className="h-5 w-5" />New job</Link>
                <Link href={`/estimates?new=1&customer=${owner}`} className="btn btn-secondary no-underline"><Icon name="plus" className="h-5 w-5" />New estimate</Link>
              </>
            ) : (
              <p className="col-span-2 text-[0.9375rem] text-text-secondary">This car is not linked to a customer yet, so a new job or estimate cannot start from here. Add the owner on the Customers screen.</p>
            )}
          </div>

          <section aria-labelledby="vs-facts">
            <h3 id="vs-facts" className="section-title mb-2">Details</h3>
            <dl className="rounded-lg border border-border bg-bg-base px-4">
              <Fact label="Owner">
                {owner
                  ? <Link href={`/customers?customer=${owner}`} className="inline-flex min-h-[44px] items-center font-bold text-blue underline-offset-2 hover:underline sm:min-h-[32px]">{v.owner || 'Open customer'}</Link>
                  : v.owner || none}
              </Fact>
              <Fact label="Plate">{v.plate || none}</Fact>
              <Fact label="VIN">{v.vin ? <span className="num break-all">{v.vin}</span> : none}</Fact>
              <Fact label="Mileage">{v.mileage ? <span className="num">{v.mileage.toLocaleString('en-US')} miles</span> : none}</Fact>
              {v.color && <Fact label="Color">{v.color}</Fact>}
            </dl>
          </section>

          <section aria-labelledby="vs-history">
            <h3 id="vs-history" className="section-title mb-2">Repair history{v.jobs.length > 0 ? <span className="num ml-2 font-normal text-text-secondary">{v.jobs.length}</span> : null}</h3>
            {v.jobs.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">No repair orders for this car yet. Write one with New job and it shows here.</p>
            ) : (
              <ul className="ledger">
                {v.jobs.map(j => (
                  <li key={j.id}>
                    <Link href={`/jobs?job=${encodeURIComponent(j.id)}`} className="ledger-row !items-start no-underline">
                      <Icon name="wrench" className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
                      <span className="ledger-main">
                        <span className="ledger-title block !whitespace-normal">{j.concern || 'No concern noted'}</span>
                        <span className="ledger-sub block !whitespace-normal">{[j.ro && `RO ${j.ro}`, j.mileage && `${j.mileage.toLocaleString('en-US')} miles`].filter(Boolean).join(' · ') || 'No RO number'}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[0.9375rem] text-text-secondary"><span className={`lamp lamp-${statusLamp(j.status)}`} aria-hidden="true" />{statusWord(j.status)}</span>
                      </span>
                      <span className="shrink-0 text-[0.875rem] text-text-secondary">{fmtDay(j.created)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  )
}
