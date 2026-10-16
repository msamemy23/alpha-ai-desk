'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { HONEYPOT, MAX_NOTES, checkBookingForm, hoursLines } from '@/lib/booking'
import { bookingIcs } from '@/lib/booking-calendar'
import { KIND_HELP, KIND_WORD, addDaysYmd, hoursText, time12 } from '@/lib/schedule-capacity'
import type { JobKind } from '@/lib/schedule-capacity'
import { callBook, useBookingInfo, useOpenTimes } from './useBooking'

type Field = 'service' | 'date' | 'time' | 'name' | 'phone' | 'vehicle' | 'notes'
type Errors = Partial<Record<Field, string>>
interface Done { status: 'booked' | 'requested'; message: string; date: string; time: string; service: string; minutes: number }

const telHref = (phone: string) => 'tel:' + phone.replace(/[^\d+]/g, '')
const ymdDate = (s: string) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
const weekday = (s: string) => ymdDate(s).toLocaleDateString('en-US', { weekday: 'short' })
const monthDay = (s: string) => ymdDate(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const longDay = (s: string) => ymdDate(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
const FIRST_DAYS = 9

const ORDER: Field[] = ['service', 'date', 'time', 'name', 'phone', 'vehicle', 'notes']
const IDS: Record<Field, string> = { service: 'bk-service', date: 'bk-date', time: 'bk-time', name: 'bk-name', phone: 'bk-phone', vehicle: 'bk-vehicle', notes: 'bk-notes' }

export function Frame({ name, phone, children, bar }: { name: string; phone: string; children: ReactNode; bar?: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg-base text-text-primary">
      <header className="border-b border-border bg-bg-chrome">
        <div className="mx-auto flex w-full max-w-xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 sm:px-6">
          <p className="display min-w-0 break-words text-[1.25rem] font-bold leading-tight">{name || 'Book an appointment'}</p>
          {phone && (
            <a href={telHref(phone)} className="inline-flex min-h-[44px] items-center gap-1.5 font-bold text-blue underline-offset-4 hover:underline">
              <Icon name="phone" className="h-4 w-4" />{phone}
            </a>
          )}
        </div>
      </header>
      <main className={`mx-auto w-full max-w-xl px-4 pt-5 sm:px-6 ${bar ? 'pb-36' : 'pb-12'}`}>{children}</main>
      {bar}
    </div>
  )
}

function Step({ n, title, hint, children, id }: { n: number; title: string; hint?: string; children: ReactNode; id: string }) {
  return (
    <section className="card mb-4" aria-labelledby={id}>
      <h2 id={id} className="display text-[1.125rem] font-bold leading-snug"><span className="num mr-2 text-text-secondary">{n}</span>{title}</h2>
      {hint && <p className="mt-0.5 text-[0.875rem] text-text-secondary">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

export const Problem = ({ id, text }: { id: string; text?: string }) => (text ? <p id={id} role="alert" className="form-error">{text}</p> : null)

/** The public booking page. One long, calm form that works with a thumb: service, day, time, who you are. */
export default function BookingView({ slug }: { slug: string }) {
  // The link may carry ?r=<inspection token>, which offers the car's open work as extra things to quote.
  const [r, setR] = useState<string | null>(null)
  useEffect(() => { setR(new URLSearchParams(window.location.search).get('r') || '') }, [])
  if (r === null) return <Frame name="" phone=""><div className="space-y-3" aria-busy="true" aria-label="Loading"><div className="skeleton h-24" /><div className="skeleton h-40" /></div></Frame>
  return <Booking slug={slug} r={r} />
}

function Booking({ slug, r }: { slug: string; r: string }) {
  const { info, phase, message, reload } = useBookingInfo(slug, r)
  const [service, setService] = useState('')
  const [kind, setKind] = useState<JobKind>('dropoff')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [notes, setNotes] = useState('')
  const [picks, setPicks] = useState<string[]>([])
  const [honey, setHoney] = useState('')
  const [allDays, setAllDays] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [banner, setBanner] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const sendingRef = useRef(false)

  const { days, times, reloadDays, reloadTimes } = useOpenTimes(slug, service, kind, date)
  const svc = info?.shop.services.find(s => s.key === service) || null

  // A time that is no longer on offer (the list refreshed) must not stay chosen.
  useEffect(() => { if (times.status === 'ready' && time && !times.data.includes(time)) setTime('') }, [times, time])

  const chooseService = (key: string) => {
    const s = info?.shop.services.find(x => x.key === key)
    if (!s) return
    setService(key); setKind(s.kind); setDate(''); setTime(''); setAllDays(false)
    setErrors(e => ({ ...e, service: undefined }))
  }
  const chooseKind = (k: JobKind) => { if (k === kind) return; setKind(k); setDate(''); setTime('') }
  const chooseDate = (d: string) => { setDate(d); setTime(''); setErrors(e => ({ ...e, date: undefined })) }

  const hours = useMemo(() => (info ? hoursLines(info.shop.hours) : []), [info])

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (sendingRef.current || !info) return
    const p = checkBookingForm({ service, date, time, name, phone, vehicle, notes })
    setErrors(p)
    const first = ORDER.find(f => p[f])
    if (first) {
      setBanner('Some answers need another look. They are marked below.')
      document.getElementById(IDS[first])?.focus({ preventScroll: false })
      document.getElementById(IDS[first])?.scrollIntoView({ block: 'center' })
      return
    }
    sendingRef.current = true
    setSending(true); setBanner('')
    const res = await callBook('/api/book/request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, token: info.token, service, kind, date, time, name, phone, vehicle, notes, r, suggested: picks, [HONEYPOT]: honey }),
    })
    sendingRef.current = false
    setSending(false)
    if (res.ok) {
      setDone({ status: res.data.status === 'booked' ? 'booked' : 'requested', message: String(res.data.message || ''), date, time, service: svc?.label || 'Appointment', minutes: svc?.minutes || 60 })
      window.scrollTo({ top: 0 })
      return
    }
    const text = typeof res.data.error === 'string' ? res.data.error : 'That did not send. Try again.'
    if (res.data.code === 'taken') { setBanner(text); setTime(''); void reloadTimes(); void reloadDays(); return }
    const field = typeof res.data.field === 'string' && (ORDER as string[]).includes(res.data.field) ? res.data.field as Field : null
    if (field) { setErrors({ [field]: text }); setBanner('Some answers need another look. They are marked below.'); return }
    // A page left open for hours has an expired form: fetch a fresh one so the next try works.
    if (res.status === 400) { await reload(true); setBanner(`${text} We refreshed the page, so press the button again.`); return }
    setBanner(text)
  }

  const addToCalendar = () => {
    if (!done || !info) return
    const ics = bookingIcs({ shop: info.shop.name, phone: info.shop.phone, service: done.service, date: done.date, time: done.time, minutes: done.minutes, uid: `${slug}-${done.date}-${done.time}` })
    if (!ics) return
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'appointment.ics'
    document.body.appendChild(a); a.click(); a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  if (phase === 'loading') {
    return <Frame name="" phone=""><div className="space-y-3" aria-busy="true" aria-label="Loading the booking page"><div className="skeleton h-20" /><div className="skeleton h-56" /><div className="skeleton h-40" /></div></Frame>
  }

  if (phase !== 'ready' || !info) {
    return (
      <Frame name="" phone="">
        <div role="alert" className="card flex items-start gap-3">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">{phase === 'gone' ? 'This booking page is not available' : 'This page could not open'}</p>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">{message}</p>
            {phase === 'error' && <button type="button" className="btn btn-secondary mt-3" onClick={() => void reload()}>Try again</button>}
          </div>
        </div>
      </Frame>
    )
  }

  const shop = info.shop

  if (done) {
    return (
      <Frame name={shop.name} phone={shop.phone}>
        <section className="card" aria-live="polite">
          <div className="flex items-start gap-3">
            <Icon name="check" className="mt-1 h-6 w-6 shrink-0 text-green" />
            <div className="min-w-0">
              <h1 className="display text-[1.375rem] font-bold leading-tight">{done.status === 'booked' ? 'You are booked' : 'Request sent'}</h1>
              <p className="num mt-1 text-[1.0625rem] font-bold">{longDay(done.date)} at {time12(done.time)}</p>
              <p className="mt-0.5 text-text-secondary">{done.service}</p>
            </div>
          </div>
          {done.message && <p className="mt-4 text-[0.9375rem]">{done.message}</p>}
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {done.status === 'booked' && <button type="button" className="btn btn-secondary" onClick={addToCalendar}><Icon name="calendar" className="h-5 w-5" />Add to my calendar</button>}
            {shop.phone && <a className="btn btn-secondary" href={telHref(shop.phone)}><Icon name="phone" className="h-5 w-5" />Call {shop.phone}</a>}
          </div>
          <p className="mt-4 text-[0.875rem] text-text-secondary">Need to change it? Call the shop and we will move it.</p>
        </section>
      </Frame>
    )
  }

  if (shop.services.length === 0) {
    return (
      <Frame name={shop.name} phone={shop.phone}>
        <section className="card">
          <h1 className="display text-[1.375rem] font-bold">Book by phone</h1>
          <p className="mt-2 text-text-secondary">Online booking is not set up for any service yet.{shop.phone ? ' Please call the shop and we will find you a time.' : ''}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {shop.phone && <a className="btn btn-primary" href={telHref(shop.phone)}><Icon name="phone" className="h-5 w-5" />Call {shop.phone}</a>}
            {shop.quotes && <Link className="btn btn-secondary" href={`/book/${slug}/quote`}>Ask for a price</Link>}
          </div>
        </section>
      </Frame>
    )
  }

  const summary = date && time ? `${monthDay(date)} at ${time12(time)}` : 'Choose a service, day and time'
  const shownDays = allDays ? days.data : days.data.slice(0, FIRST_DAYS)
  const bar = (
    <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="mx-auto flex w-full max-w-xl items-center gap-3">
        <p className="num min-w-0 flex-1 text-[0.9375rem] font-bold" aria-live="polite">{summary}</p>
        <button type="submit" form="bk-form" className="btn btn-primary shrink-0" disabled={sending}>{sending ? 'Sending…' : 'Request this time'}</button>
      </div>
    </div>
  )

  return (
    <Frame name={shop.name} phone={shop.phone} bar={bar}>
      <h1 className="display text-[1.5rem] font-bold leading-tight">Book an appointment</h1>
      {shop.intro && <p className="mt-1 text-[0.9375rem] text-text-secondary">{shop.intro}</p>}
      {shop.quotes && <p className="mt-2 text-[0.9375rem]">Not ready to pick a time? <Link href={`/book/${slug}/quote`} className="inline-flex min-h-[44px] items-center font-bold text-blue underline-offset-4 hover:underline">Ask for a price</Link></p>}
      <details className="mt-3 mb-5 text-[0.9375rem]">
        <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-bold text-blue">Shop hours</summary>
        <dl className="mt-1 divide-y divide-border rounded-md border border-border bg-bg-card px-3">
          {hours.map(h => (
            <div key={h.days} className="flex justify-between gap-3 py-2"><dt className="font-bold">{h.days}</dt><dd className="num text-right text-text-secondary">{h.text}</dd></div>
          ))}
        </dl>
      </details>

      {banner && (
        <div role="alert" className="mb-4 flex items-start gap-3 rounded-md border border-red/50 bg-red/[0.08] px-4 py-3 text-[0.9375rem]">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" /><p className="min-w-0 break-words">{banner}</p>
        </div>
      )}

      <form id="bk-form" onSubmit={e => void submit(e)} noValidate>
        <Step n={1} id="bk-h-service" title="What do you need?">
          <div id={IDS.service} tabIndex={-1} className="grid gap-2" role="group" aria-labelledby="bk-h-service">
            {shop.services.map(s => {
              const on = s.key === service
              return (
                <button key={s.key} type="button" aria-pressed={on} onClick={() => chooseService(s.key)}
                  className={`flex min-h-[56px] w-full items-center justify-between gap-3 rounded-md border px-4 py-3 text-left ${on ? 'border-blue bg-blue/10' : 'border-border bg-bg-card hover:bg-bg-hover'}`}>
                  <span className="min-w-0"><span className="block font-bold">{s.label}</span><span className="block text-[0.875rem] text-text-secondary">About {hoursText(s.minutes)}</span></span>
                  {on && <Icon name="check" className="h-5 w-5 shrink-0 text-blue" />}
                </button>
              )
            })}
          </div>
          <Problem id="bk-service-err" text={errors.service} />
          {svc && (
            <div className="mt-4">
              <p className="form-label">Will you wait or drop it off?</p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Wait or drop off">
                {(['dropoff', 'wait'] as JobKind[]).map(k => (
                  <button key={k} type="button" aria-pressed={kind === k} onClick={() => chooseKind(k)}
                    className={`min-h-[56px] rounded-md border px-3 py-2 text-left ${kind === k ? 'border-blue bg-blue/10' : 'border-border bg-bg-card hover:bg-bg-hover'}`}>
                    <span className="block font-bold">{k === 'dropoff' ? 'Drop it off' : 'I will wait'}</span>
                    <span className="block text-[0.8125rem] text-text-secondary">{KIND_HELP[k]}</span>
                    <span className="sr-only">{KIND_WORD[k]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </Step>

        <Step n={2} id="bk-h-day" title="Pick a day" hint={svc ? `Days with an opening for ${svc.label.toLowerCase()}.` : 'Choose what you need first.'}>
          <div id={IDS.date} tabIndex={-1}>
            {!svc ? <p className="text-[0.9375rem] text-text-secondary">Days appear here once you choose a service.</p>
              : days.status === 'loading' ? <div className="grid grid-cols-3 gap-2" aria-busy="true" aria-label="Loading days">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-16" />)}</div>
              : days.status === 'error' ? (
                <div role="alert"><p className="text-[0.9375rem] text-red">{days.message}</p><button type="button" className="btn btn-secondary mt-2" onClick={() => void reloadDays()}>Try again</button></div>
              ) : days.data.length === 0 ? (
                <div className="rounded-md border border-border bg-bg-base px-4 py-3 text-[0.9375rem]">
                  <p className="font-bold">No openings in the next {shop.daysAhead} days</p>
                  <p className="mt-1 text-text-secondary">{shop.phone ? 'Please call the shop and we will find you a time.' : 'Please check back soon.'}</p>
                  {shop.phone && <a className="btn btn-secondary mt-3" href={telHref(shop.phone)}><Icon name="phone" className="h-5 w-5" />Call {shop.phone}</a>}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="Days with openings">
                    {shownDays.map(d => {
                      const on = d.date === date
                      const sub = d.date === info.today ? 'Today' : d.date === addDaysYmd(info.today, 1) ? 'Tomorrow' : monthDay(d.date)
                      return (
                        <button key={d.date} type="button" aria-pressed={on} aria-label={`${longDay(d.date)}, ${d.times} ${d.times === 1 ? 'time' : 'times'} open`} onClick={() => chooseDate(d.date)}
                          className={`flex min-h-[64px] flex-col items-center justify-center rounded-md border px-1 py-2 ${on ? 'border-blue bg-blue/10 text-blue' : 'border-border bg-bg-card hover:bg-bg-hover'}`}>
                          <span className="font-bold">{weekday(d.date)}</span>
                          <span className="num text-[0.875rem] text-text-secondary">{sub}</span>
                        </button>
                      )
                    })}
                  </div>
                  {days.data.length > FIRST_DAYS && !allDays && <button type="button" className="btn btn-ghost mt-2" onClick={() => setAllDays(true)}>Show more days</button>}
                </>
              )}
            <Problem id="bk-date-err" text={errors.date} />
          </div>
        </Step>

        <Step n={3} id="bk-h-time" title="Pick a time" hint={date ? `Start times on ${longDay(date)}.` : undefined}>
          <div id={IDS.time} tabIndex={-1}>
            {!date ? <p className="text-[0.9375rem] text-text-secondary">Times appear here once you choose a day.</p>
              : times.status === 'loading' ? <div className="grid grid-cols-3 gap-2" aria-busy="true" aria-label="Loading times">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-12" />)}</div>
              : times.status === 'error' ? (
                <div role="alert"><p className="text-[0.9375rem] text-red">{times.message}</p><button type="button" className="btn btn-secondary mt-2" onClick={() => void reloadTimes()}>Try again</button></div>
              ) : times.data.length === 0 ? (
                <div className="text-[0.9375rem]"><p className="font-bold">That day just filled up</p><p className="mt-1 text-text-secondary">Please pick another day.</p></div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="group" aria-label="Open times">
                  {times.data.map(t => (
                    <button key={t} type="button" aria-pressed={t === time} onClick={() => { setTime(t); setErrors(e => ({ ...e, time: undefined })) }}
                      className={`num min-h-[48px] rounded-md border px-2 py-2 font-bold ${t === time ? 'border-blue bg-blue/10 text-blue' : 'border-border bg-bg-card hover:bg-bg-hover'}`}>{time12(t)}</button>
                  ))}
                </div>
              )}
            <Problem id="bk-time-err" text={errors.time} />
          </div>
        </Step>

        <Step n={4} id="bk-h-you" title="About you and your car">
          <div className="space-y-4">
            <div>
              <label className="form-label" htmlFor={IDS.name}>Your name</label>
              <input id={IDS.name} className="form-input" autoComplete="name" maxLength={60} value={name} aria-invalid={Boolean(errors.name) || undefined} aria-describedby={errors.name ? 'bk-name-err' : undefined}
                onChange={e => { setName(e.target.value); if (errors.name) setErrors(x => ({ ...x, name: undefined })) }} />
              <Problem id="bk-name-err" text={errors.name} />
            </div>
            <div>
              <label className="form-label" htmlFor={IDS.phone}>Mobile phone</label>
              <input id={IDS.phone} className="form-input" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} placeholder="(713) 555-0100" value={phone} aria-invalid={Boolean(errors.phone) || undefined} aria-describedby={errors.phone ? 'bk-phone-err' : 'bk-phone-help'}
                onChange={e => { setPhone(e.target.value); if (errors.phone) setErrors(x => ({ ...x, phone: undefined })) }} />
              <p id="bk-phone-help" className="mt-1 text-[0.8125rem] text-text-secondary">The shop uses this number to confirm your time.</p>
              <Problem id="bk-phone-err" text={errors.phone} />
            </div>
            <div>
              <label className="form-label" htmlFor={IDS.vehicle}>Year, make and model</label>
              <input id={IDS.vehicle} className="form-input" autoComplete="off" maxLength={80} placeholder="2018 Toyota Camry" value={vehicle} aria-invalid={Boolean(errors.vehicle) || undefined} aria-describedby={errors.vehicle ? 'bk-vehicle-err' : undefined}
                onChange={e => { setVehicle(e.target.value); if (errors.vehicle) setErrors(x => ({ ...x, vehicle: undefined })) }} />
              <Problem id="bk-vehicle-err" text={errors.vehicle} />
            </div>

            {info.suggested.length > 0 && (
              <div>
                <p className="form-label">Also get a price on</p>
                <p className="mb-2 text-[0.8125rem] text-text-secondary">From your last inspection. Tap any you want the shop to look at.</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Work from your inspection">
                  {info.suggested.map(s => {
                    const on = picks.includes(s.id)
                    return (
                      <button key={s.id} type="button" aria-pressed={on} onClick={() => setPicks(p => (p.includes(s.id) ? p.filter(x => x !== s.id) : [...p, s.id]))}
                        className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-2 text-[0.9375rem] ${on ? 'border-blue bg-blue/10 text-blue' : 'border-border bg-bg-card hover:bg-bg-hover'}`}>
                        {on && <Icon name="check" className="h-4 w-4" />}{s.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="form-label" htmlFor={IDS.notes}>Anything we should know? <span className="font-normal text-text-secondary">(optional)</span></label>
              <textarea id={IDS.notes} className="form-input" rows={3} maxLength={MAX_NOTES} value={notes} aria-invalid={Boolean(errors.notes) || undefined} aria-describedby={errors.notes ? 'bk-notes-err' : undefined}
                onChange={e => { setNotes(e.target.value); if (errors.notes) setErrors(x => ({ ...x, notes: undefined })) }} />
              <Problem id="bk-notes-err" text={errors.notes} />
            </div>

            {/* A field no person sees. A program that fills in every box fills in this one too, and is quietly ignored. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0">
              <label htmlFor="bk-company-site">Company website</label>
              <input id="bk-company-site" name={HONEYPOT} tabIndex={-1} autoComplete="off" value={honey} onChange={e => setHoney(e.target.value)} />
            </div>
          </div>
        </Step>

        <p className="px-1 text-[0.8125rem] text-text-secondary">Your details go only to {shop.name || 'the shop'}, to confirm this visit. {shop.phone ? 'For anything urgent, please call.' : ''}</p>
      </form>
    </Frame>
  )
}
