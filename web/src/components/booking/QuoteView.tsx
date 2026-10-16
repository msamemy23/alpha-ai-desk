'use client'
import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { HONEYPOT } from '@/lib/booking'
import { QUOTE_MAX, QUOTE_FIELDS, checkQuoteForm } from '@/lib/quote'
import type { QuoteField } from '@/lib/quote'
import { callBook, useBookingInfo } from './useBooking'
import { Frame, Problem } from './BookingView'

type Errors = Partial<Record<QuoteField, string>>
const IDS: Record<QuoteField, string> = { name: 'qt-name', phone: 'qt-phone', vehicle: 'qt-vehicle', message: 'qt-message', email: 'qt-email' }
const telHref = (phone: string) => 'tel:' + phone.replace(/[^\d+]/g, '')

/**
 * "Ask for a price": the public page for a visitor who is not ready to pick a time. Four answers and a send button.
 * The shop answers from its Leads tab; nothing is texted or emailed to the visitor from here.
 */
export default function QuoteView({ slug }: { slug: string }) {
  const { info, phase, message, reload } = useBookingInfo(slug, '')
  const [f, setF] = useState<Record<QuoteField, string>>({ name: '', phone: '', vehicle: '', message: '', email: '' })
  const [honey, setHoney] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [banner, setBanner] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState('')
  const sendingRef = useRef(false)
  const set = (k: QuoteField, v: string) => { setF(p => ({ ...p, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: undefined })) }

  if (phase === 'loading') {
    return <Frame name="" phone=""><div className="space-y-3" aria-busy="true" aria-label="Loading the page"><div className="skeleton h-20" /><div className="skeleton h-56" /></div></Frame>
  }
  if (phase !== 'ready' || !info) {
    return (
      <Frame name="" phone="">
        <div role="alert" className="card flex items-start gap-3">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">{phase === 'gone' ? 'This page is not available' : 'This page could not open'}</p>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">{message}</p>
            {phase === 'error' && <button type="button" className="btn btn-secondary mt-3" onClick={() => void reload()}>Try again</button>}
          </div>
        </div>
      </Frame>
    )
  }

  const shop = info.shop
  const canBook = shop.services.length > 0

  if (!shop.quotes) {
    return (
      <Frame name={shop.name} phone={shop.phone}>
        <section className="card">
          <h1 className="display text-[1.375rem] font-bold">Asking for a price is not set up</h1>
          <p className="mt-2 text-text-secondary">{shop.phone ? 'Please call the shop and we will give you a price.' : 'Please check back soon.'}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {shop.phone && <a className="btn btn-primary" href={telHref(shop.phone)}><Icon name="phone" className="h-5 w-5" />Call {shop.phone}</a>}
            {canBook && <Link className="btn btn-secondary" href={`/book/${slug}`}>Book a time</Link>}
          </div>
        </section>
      </Frame>
    )
  }

  if (done) {
    return (
      <Frame name={shop.name} phone={shop.phone}>
        <section className="card" aria-live="polite">
          <div className="flex items-start gap-3">
            <Icon name="check" className="mt-1 h-6 w-6 shrink-0 text-green" />
            <div className="min-w-0">
              <h1 className="display text-[1.375rem] font-bold leading-tight">Request sent</h1>
              <p className="mt-2 text-[0.9375rem]">{done}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {shop.phone && <a className="btn btn-secondary" href={telHref(shop.phone)}><Icon name="phone" className="h-5 w-5" />Call {shop.phone}</a>}
            {canBook && <Link className="btn btn-secondary" href={`/book/${slug}`}><Icon name="calendar" className="h-5 w-5" />Book a time</Link>}
          </div>
        </section>
      </Frame>
    )
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    if (sendingRef.current) return
    const p = checkQuoteForm(f)
    setErrors(p)
    const first = QUOTE_FIELDS.find(k => p[k])
    if (first) {
      setBanner('Some answers need another look. They are marked below.')
      document.getElementById(IDS[first])?.focus()
      document.getElementById(IDS[first])?.scrollIntoView({ block: 'center' })
      return
    }
    sendingRef.current = true
    setSending(true); setBanner('')
    const res = await callBook('/api/book/lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, token: info.token, ...f, [HONEYPOT]: honey }),
    })
    sendingRef.current = false
    setSending(false)
    if (res.ok) { setDone(String(res.data.message || 'Thank you. The shop will be in touch.')); window.scrollTo({ top: 0 }); return }
    const text = typeof res.data.error === 'string' ? res.data.error : 'That did not send. Try again.'
    const field = typeof res.data.field === 'string' && (QUOTE_FIELDS as readonly string[]).includes(res.data.field) ? res.data.field as QuoteField : null
    if (field) { setErrors({ [field]: text }); setBanner('Some answers need another look. They are marked below.'); return }
    // A page left open for hours has an expired form: fetch a fresh one so the next try works.
    if (res.status === 400) { await reload(true); setBanner(`${text} We refreshed the page, so press the button again.`); return }
    setBanner(text)
  }

  return (
    <Frame name={shop.name} phone={shop.phone}>
      <h1 className="display text-[1.5rem] font-bold leading-tight">Ask for a price</h1>
      <p className="mt-1 text-[0.9375rem] text-text-secondary">Tell us about your car and what it needs. The shop will call or text you back with a price.</p>
      {canBook && <p className="mt-2 text-[0.9375rem]">Ready to pick a time? <Link href={`/book/${slug}`} className="inline-flex min-h-[44px] items-center font-bold text-blue underline-offset-4 hover:underline">Book an appointment</Link></p>}

      {banner && (
        <div role="alert" className="mt-4 flex items-start gap-3 rounded-md border border-red/50 bg-red/[0.08] px-4 py-3 text-[0.9375rem]">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" /><p className="min-w-0 break-words">{banner}</p>
        </div>
      )}

      <form onSubmit={e => void submit(e)} noValidate className="card mt-4 space-y-4">
        <div>
          <label className="form-label" htmlFor={IDS.name}>Your name</label>
          <input id={IDS.name} className="form-input" autoComplete="name" maxLength={60} value={f.name} aria-invalid={Boolean(errors.name) || undefined} aria-describedby={errors.name ? 'qt-name-err' : undefined} onChange={e => set('name', e.target.value)} />
          <Problem id="qt-name-err" text={errors.name} />
        </div>
        <div>
          <label className="form-label" htmlFor={IDS.phone}>Mobile phone</label>
          <input id={IDS.phone} className="form-input" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} placeholder="(713) 555-0100" value={f.phone} aria-invalid={Boolean(errors.phone) || undefined} aria-describedby={errors.phone ? 'qt-phone-err' : 'qt-phone-help'} onChange={e => set('phone', e.target.value)} />
          <p id="qt-phone-help" className="mt-1 text-[0.8125rem] text-text-secondary">The shop uses this number to get back to you.</p>
          <Problem id="qt-phone-err" text={errors.phone} />
        </div>
        <div>
          <label className="form-label" htmlFor={IDS.vehicle}>Year, make and model</label>
          <input id={IDS.vehicle} className="form-input" autoComplete="off" maxLength={80} placeholder="2018 Toyota Camry" value={f.vehicle} aria-invalid={Boolean(errors.vehicle) || undefined} aria-describedby={errors.vehicle ? 'qt-vehicle-err' : undefined} onChange={e => set('vehicle', e.target.value)} />
          <Problem id="qt-vehicle-err" text={errors.vehicle} />
        </div>
        <div>
          <label className="form-label" htmlFor={IDS.message}>What does it need?</label>
          <textarea id={IDS.message} className="form-input" rows={4} maxLength={QUOTE_MAX} placeholder="For example: squealing when I brake, or an oil change and tire rotation" value={f.message} aria-invalid={Boolean(errors.message) || undefined} aria-describedby={errors.message ? 'qt-message-err' : undefined} onChange={e => set('message', e.target.value)} />
          <Problem id="qt-message-err" text={errors.message} />
        </div>
        <div>
          <label className="form-label" htmlFor={IDS.email}>Email <span className="font-normal text-text-secondary">(optional)</span></label>
          <input id={IDS.email} className="form-input" type="email" inputMode="email" autoComplete="email" maxLength={120} value={f.email} aria-invalid={Boolean(errors.email) || undefined} aria-describedby={errors.email ? 'qt-email-err' : undefined} onChange={e => set('email', e.target.value)} />
          <Problem id="qt-email-err" text={errors.email} />
        </div>

        {/* A field no person sees. A program that fills in every box fills in this one too, and is quietly ignored. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden opacity-0">
          <label htmlFor="qt-company-site">Company website</label>
          <input id="qt-company-site" name={HONEYPOT} tabIndex={-1} autoComplete="off" value={honey} onChange={e => setHoney(e.target.value)} />
        </div>

        <button type="submit" className="btn btn-primary w-full" disabled={sending}>{sending ? 'Sending…' : 'Send my request'}</button>
        <p className="text-[0.8125rem] text-text-secondary">Your details go only to {shop.name || 'the shop'}, to answer this request. {shop.phone ? 'For anything urgent, please call.' : ''}</p>
      </form>
    </Frame>
  )
}
