'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { supabase, getShopId, calcTotals, formatCurrency } from '@/lib/supabase'
import { docLamp, docStatusLabel, docTypeLabel } from '@/lib/doc-status'
import { ageLabel, phonePretty } from '@/lib/today'
import { callKind, CALL_KIND_LABEL, CALL_KIND_LAMP, formatDuration } from '@/components/inbox/utils'
import SentimentMark from './SentimentMark'
import { cleanFilterText, digits10, fmtDay, fmtDayTime, fmtMonthYear, text } from './types'
import type { Customer } from './types'

interface DocRow { id: string; type: string; doc_number: string; status: string; total: number; balance: number; created_at: string }
interface JobRow { id: string; ro_number: string; concern: string; status: string; created_at: string }
interface Touch { id: string; kind: 'text' | 'call'; direction: string; body: string; duration: number; status: string; at: string }
interface CarRow { key: string; label: string; vin: string; plate: string; mileage: string; primary: boolean }

type Row = Record<string, unknown>
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export function dialCustomer(c: Pick<Customer, 'phone' | 'name'>) {
  if (!c.phone) return
  window.dispatchEvent(new CustomEvent('phone:call', { detail: { number: c.phone, name: c.name } }))
}

function Section({ id, title, count, action, children }: { id: string; title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <div className="mb-2 flex items-end justify-between gap-3">
        <h3 id={id} className="section-title">{title}{typeof count === 'number' && count > 0 ? <span className="num ml-2 font-normal text-text-secondary">{count}</span> : null}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 border-b border-border py-2.5 last:border-b-0">
      <dt className="w-24 shrink-0 text-[0.9375rem] text-text-secondary">{label}</dt>
      <dd className="min-w-0 flex-1 break-words">{children}</dd>
    </div>
  )
}

/** Everything about one customer: how to reach them, their cars, paperwork, recent texts and calls. */
export default function CustomerDetail({ customer, onEdit, onText, onEmail }: {
  customer: Customer
  onEdit: () => void
  onText: () => void
  onEmail: () => void
}) {
  const [docs, setDocs] = useState<DocRow[]>([])
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [touches, setTouches] = useState<Touch[]>([])
  const [cars, setCars] = useState<CarRow[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [showAllDocs, setShowAllDocs] = useState(false)

  const phone10 = digits10(customer.phone)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop')
      const name = cleanFilterText(text(customer.name))
      const jobFilter = `customer_id.eq.${customer.id}` + (name ? `,customer_name.ilike.%${name}%` : '')
      const [docsRes, jobsRes, msgsRes, callsRes] = await Promise.all([
        supabase.from('documents').select('*').eq('shop_id', shopId).eq('customer_id', customer.id).order('created_at', { ascending: false }).limit(50),
        supabase.from('jobs').select('*').eq('shop_id', shopId).or(jobFilter).order('created_at', { ascending: false }).limit(20),
        phone10.length >= 7
          ? supabase.from('messages').select('id,body,direction,created_at').eq('shop_id', shopId).or(`from_address.ilike.%${phone10}%,to_address.ilike.%${phone10}%`).order('created_at', { ascending: false }).limit(8)
          : Promise.resolve({ data: [] as Row[], error: null }),
        phone10.length >= 7
          ? supabase.from('call_history').select('id,direction,duration_secs,start_time,status').eq('shop_id', shopId).or(`from_number.ilike.%${phone10}%,to_number.ilike.%${phone10}%`).order('start_time', { ascending: false }).limit(8)
          : Promise.resolve({ data: [] as Row[], error: null }),
      ])
      if (docsRes.error && jobsRes.error && msgsRes.error && callsRes.error) throw docsRes.error

      const docRows: DocRow[] = ((docsRes.data || []) as Row[]).map(d => {
        const t = calcTotals(d)
        return { id: str(d.id), type: str(d.type), doc_number: str(d.doc_number), status: str(d.status), total: t.total, balance: t.balanceDue, created_at: str(d.created_at) }
      })
      const jobRows: JobRow[] = ((jobsRes.data || []) as Row[]).map(j => ({ id: str(j.id), ro_number: str(j.ro_number), concern: str(j.concern), status: str(j.status), created_at: str(j.created_at) }))
      const all: Touch[] = [
        ...((msgsRes.data || []) as Row[]).map(m => ({ id: 'm' + str(m.id), kind: 'text' as const, direction: str(m.direction), body: str(m.body), duration: 0, status: '', at: str(m.created_at) })),
        ...((callsRes.data || []) as Row[]).map(c => ({ id: 'c' + str(c.id), kind: 'call' as const, direction: str(c.direction), body: '', duration: Number(c.duration_secs) || 0, status: str(c.status), at: str(c.start_time) })),
      ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8)

      // The car on file first, then any other car this customer has brought in.
      const seen = new Set<string>()
      const carList: CarRow[] = []
      const addCar = (r: Row, primary: boolean) => {
        const label = [str(r.vehicle_year), str(r.vehicle_make), str(r.vehicle_model)].filter(Boolean).join(' ')
        if (!label) return
        const key = label.toLowerCase() + '|' + str(r.vehicle_vin).toLowerCase()
        if (seen.has(key)) return
        seen.add(key)
        carList.push({ key, label, vin: str(r.vehicle_vin), plate: str(r.vehicle_plate), mileage: str(r.vehicle_mileage), primary })
      }
      addCar(customer as unknown as Row, true)
      ;((jobsRes.data || []) as Row[]).forEach(j => { if (str(j.customer_id) === customer.id) addCar(j, false) })
      ;((docsRes.data || []) as Row[]).forEach(d => addCar(d, false))

      setDocs(docRows); setJobs(jobRows); setTouches(all); setCars(carList)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [customer, phone10])

  useEffect(() => { load() }, [load])

  const lastVisit = useMemo(() => {
    const dates = [...docs.filter(d => d.type !== 'Estimate').map(d => d.created_at), ...jobs.map(j => j.created_at)].filter(Boolean).sort()
    return dates.length ? dates[dates.length - 1] : ''
  }, [docs, jobs])

  const shownDocs = showAllDocs ? docs : docs.slice(0, 5)

  return (
    <div className="space-y-7">
      {/* Who and how long */}
      <div className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem] text-text-secondary">
        <SentimentMark sentiment={customer.sentiment} />
        {customer.created_at && <span>Customer since {fmtMonthYear(customer.created_at)}</span>}
        {lastVisit && <span>Last visit {ageLabel(lastVisit)}</span>}
      </div>

      {/* One-tap actions */}
      <div className="space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => dialCustomer(customer)} disabled={!customer.phone}>
            <Icon name="phone" className="h-5 w-5" />Call
          </button>
          <button type="button" className="btn btn-secondary" onClick={onText} disabled={!customer.phone}>
            <Icon name="inbox" className="h-5 w-5" />Text
          </button>
          <button type="button" className="btn btn-secondary" onClick={onEmail} disabled={!customer.email}>
            <Icon name="mail" className="h-5 w-5" />Email
          </button>
        </div>
        {(!customer.phone || !customer.email) && (
          <p className="text-[0.8125rem] text-text-secondary">
            {!customer.phone && !customer.email ? 'No phone or email on file. ' : !customer.phone ? 'No phone number on file. ' : 'No email on file. '}
            <button type="button" className="font-bold text-blue underline underline-offset-2" onClick={onEdit}>Add it</button>
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Link href={`/estimates?new=1&customer=${encodeURIComponent(customer.id)}`} className="btn btn-primary no-underline">
            <Icon name="plus" className="h-5 w-5" />New estimate
          </Link>
          <Link href={`/jobs?new=1&customer=${encodeURIComponent(customer.id)}`} className="btn btn-secondary no-underline">
            <Icon name="plus" className="h-5 w-5" />New job
          </Link>
        </div>
      </div>

      {state === 'error' && (
        <div role="alert" className="rounded-lg border border-red/40 bg-red/[0.08] p-4">
          <p className="font-bold text-red">This customer&apos;s history could not be loaded.</p>
          <p className="mt-1 text-[0.9375rem] text-text-secondary">What you see below may be incomplete. Check your connection and try again.</p>
          <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={load}>Try again</button>
        </div>
      )}

      <Section id="cd-contact" title="Contact" action={<button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}><Icon name="edit" className="h-4 w-4" />Edit details</button>}>
        <dl className="rounded-lg border border-border bg-bg-base px-4">
          <Fact label="Phone">
            {customer.phone
              ? <button type="button" className="font-bold text-blue underline-offset-2 hover:underline" onClick={() => dialCustomer(customer)}>{phonePretty(customer.phone)}</button>
              : <span className="text-text-secondary">Not on file</span>}
          </Fact>
          <Fact label="Email">{customer.email ? <a className="font-bold text-blue underline-offset-2 hover:underline" href={`mailto:${customer.email}`}>{customer.email}</a> : <span className="text-text-secondary">Not on file</span>}</Fact>
          <Fact label="Address">{customer.address || <span className="text-text-secondary">Not on file</span>}</Fact>
          <Fact label="Prefers">{customer.preferred_contact || 'Call'}</Fact>
        </dl>
      </Section>

      <Section id="cd-vehicles" title="Vehicles" count={cars.length > 1 ? cars.length : undefined}>
        {cars.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">
            No vehicle on file. <button type="button" className="font-bold text-blue underline underline-offset-2" onClick={onEdit}>Add one</button>
          </p>
        ) : (
          <ul className="ledger">
            {cars.map(c => (
              <li key={c.key} className="flex items-start gap-3 px-3 py-3">
                <Icon name="vehicle" className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{c.label}{c.primary && cars.length > 1 ? <span className="ml-2 tag tag-gray align-middle">On file</span> : null}</p>
                  <p className="text-[0.9375rem] text-text-secondary">
                    {[c.plate && `Plate ${c.plate}`, c.mileage && `${c.mileage} miles`, c.vin && `VIN ${c.vin}`].filter(Boolean).join(' · ') || 'No plate, mileage or VIN yet'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="cd-docs" title="Estimates and invoices" count={docs.length}>
        {state === 'loading' ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading paperwork">{[0, 1].map(i => <div key={i} className="skeleton h-14" />)}</div>
        ) : docs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">
            No estimates or invoices for this customer yet.
          </p>
        ) : (
          <>
            <ul className="ledger">
              {shownDocs.map(d => {
                const lamp = docLamp(d.type, d.status)
                const href = `${d.type === 'Estimate' ? '/estimates' : '/invoices'}?document=${encodeURIComponent(d.id)}`
                const owes = d.type !== 'Estimate' && d.balance > 0.005 && d.status !== 'Draft'
                return (
                  <li key={d.id}>
                    <Link href={href} className="ledger-row no-underline">
                      <Icon name={d.type === 'Estimate' ? 'doc' : 'invoice'} className="h-5 w-5 shrink-0 text-text-secondary" />
                      <span className="ledger-main">
                        <span className="ledger-title block">{docTypeLabel(d.type)} {d.doc_number}</span>
                        <span className="ledger-sub flex items-center gap-1.5">
                          <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
                          {docStatusLabel(d.type, d.status)} · {ageLabel(d.created_at) || fmtDay(d.created_at)}
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="ledger-amt block">{formatCurrency(d.total)}</span>
                        {owes && <span className="block text-[0.8125rem] font-bold text-red">{formatCurrency(d.balance)} due</span>}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
            {docs.length > 5 && (
              <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => setShowAllDocs(v => !v)}>
                {showAllDocs ? 'Show fewer' : `Show all ${docs.length}`}
              </button>
            )}
          </>
        )}
      </Section>

      <Section
        id="cd-touch" title="Recent texts and calls"
        action={phone10.length >= 7 ? <Link href={`/messages?thread=${phone10}`} className="text-[0.9375rem] font-bold text-blue underline-offset-4 hover:underline">Open conversation</Link> : undefined}
      >
        {phone10.length < 7 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">Add a phone number to see this customer&apos;s texts and calls.</p>
        ) : state === 'loading' ? (
          <div className="space-y-2" aria-busy="true" aria-label="Loading texts and calls">{[0, 1].map(i => <div key={i} className="skeleton h-14" />)}</div>
        ) : touches.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">No texts or calls with this number yet.</p>
        ) : (
          <ul className="ledger">
            {touches.map(t => {
              if (t.kind === 'text') {
                const inbound = t.direction === 'inbound'
                return (
                  <li key={t.id} className="flex items-start gap-3 px-3 py-3">
                    <Icon name="inbox" className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{inbound ? 'Text from customer' : 'Text to customer'}</p>
                      <p className="line-clamp-2 text-[0.9375rem] text-text-secondary">{t.body || 'No text'}</p>
                    </div>
                    <span className="shrink-0 text-[0.8125rem] text-text-muted">{fmtDayTime(t.at)}</span>
                  </li>
                )
              }
              const kind = callKind(t.direction, t.status, t.duration)
              return (
                <li key={t.id} className="flex items-start gap-3 px-3 py-3">
                  <Icon name="phone" className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-bold"><span className={`lamp ${CALL_KIND_LAMP[kind]}`} aria-hidden="true" />{CALL_KIND_LABEL[kind]} call</p>
                    <p className="text-[0.9375rem] text-text-secondary">{kind === 'missed' ? 'Nobody picked up' : `${formatDuration(t.duration)} long`}</p>
                  </div>
                  <span className="shrink-0 text-[0.8125rem] text-text-muted">{fmtDayTime(t.at)}</span>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {(state !== 'loading' && jobs.length > 0) && (
        <Section id="cd-jobs" title="Jobs" count={jobs.length}>
          <ul className="ledger">
            {jobs.slice(0, 6).map(j => (
              <li key={j.id} className="flex items-start gap-3 px-3 py-3">
                <Icon name="wrench" className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{j.concern || 'No concern noted'}</p>
                  <p className="text-[0.9375rem] text-text-secondary">{[j.ro_number && `RO ${j.ro_number}`, j.status].filter(Boolean).join(' · ')}</p>
                </div>
                <span className="shrink-0 text-[0.8125rem] text-text-muted">{fmtDay(j.created_at)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="cd-notes" title="Notes">
        {customer.notes
          ? <p className="whitespace-pre-wrap rounded-lg border border-border bg-bg-base p-4">{customer.notes}</p>
          : <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">No notes. <button type="button" className="font-bold text-blue underline underline-offset-2" onClick={onEdit}>Add a note</button></p>}
      </Section>

    </div>
  )
}
