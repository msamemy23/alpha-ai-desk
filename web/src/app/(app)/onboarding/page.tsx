'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase, getShopProfile } from '@/lib/supabase'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'

// The stored value stays as it was so shops that already saved a list keep their choices.
const SERVICES = [
  { value: 'Oil Change', label: 'Oil change' },
  { value: 'Tire Rotation', label: 'Tire rotation' },
  { value: 'Brake Service', label: 'Brake service' },
  { value: 'Engine Repair', label: 'Engine repair' },
  { value: 'A/C Service', label: 'A/C service' },
  { value: 'Transmission Service', label: 'Transmission service' },
  { value: 'Alignment', label: 'Alignment' },
  { value: 'Body Work', label: 'Body work' },
  { value: 'State Inspection', label: 'State inspection' },
]

const STEPS = ['Shop info', 'Services', 'Finish']

type ProfileState = 'loading' | 'ready' | 'error'

function ButtonSpinner() {
  return <span aria-hidden="true" className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />
}

function Progress({ step, done }: { step: number; done: boolean }) {
  return (
    <ol className="mb-6 flex items-start" aria-label="Setup progress">
      {STEPS.map((label, i) => {
        const n = i + 1
        const status = done || n < step ? 'done' : n === step ? 'current' : 'todo'
        const circle =
          status === 'done'
            ? 'border-green bg-green text-[rgb(var(--c-card))]'
            : status === 'current'
              ? 'border-blue bg-blue text-[rgb(var(--c-on-blue))]'
              : 'border-line bg-bg-card text-text-secondary'
        return (
          <li key={label} aria-current={status === 'current' ? 'step' : undefined} className="relative flex flex-1 flex-col items-center gap-1.5 text-center">
            {i > 0 && (
              <span aria-hidden="true" className={`absolute left-[-50%] top-[1.0625rem] h-0.5 w-full ${n <= step || done ? 'bg-green' : 'bg-border'}`} />
            )}
            <span className={`display num relative z-10 grid h-9 w-9 place-items-center rounded-full border-2 text-[1rem] font-bold ${circle}`}>
              {status === 'done' ? <Icon name="check" className="h-5 w-5" strokeWidth={2.6} /> : n}
            </span>
            <span className={`text-[0.8125rem] font-bold leading-tight ${status === 'todo' ? 'text-text-secondary' : 'text-text-primary'}`}>
              {label}
              <span className="sr-only">{status === 'done' ? ', done' : status === 'current' ? ', current step' : ', not started'}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export default function OnboardingPage() {
  const [step, setStep] = useState(1)
  const [finished, setFinished] = useState(false)
  const [shopName, setShopName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [cityStateZip, setCityStateZip] = useState('')
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [customService, setCustomService] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const [profileState, setProfileState] = useState<ProfileState>('loading')
  const nameRef = useRef<HTMLInputElement>(null)
  const stepHeading = useRef<HTMLHeadingElement>(null)

  const loadProfile = useCallback(() => {
    setProfileState('loading')
    getShopProfile().then(profile => {
      if (profile) {
        setShopName(profile.shop_name || '')
        setPhone(profile.phone || '')
        setAddress(profile.address || '')
        setCityStateZip(profile.city_state_zip || '')
        if (profile.services?.length) setSelectedServices(profile.services)
      }
      setProfileState('ready')
    }).catch(() => setProfileState('error'))
  }, [])

  useEffect(() => { loadProfile() }, [loadProfile])

  // Move to the top of each step so the heading is the first thing read and seen.
  const go = (next: number) => {
    setStep(next)
    setError('')
    requestAnimationFrame(() => {
      stepHeading.current?.focus()
      stepHeading.current?.scrollIntoView({ block: 'start' })
    })
  }

  const toggleService = (svc: string) => {
    setSelectedServices(s =>
      s.includes(svc) ? s.filter(x => x !== svc) : [...s, svc]
    )
  }

  const next = () => {
    if (step === 1 && !shopName.trim()) {
      setNameError('Enter your shop name to continue.')
      nameRef.current?.focus()
      return
    }
    go(step + 1)
  }

  const handleComplete = async () => {
    setSaving(true)
    setError('')
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')
      const services = [
        ...selectedServices,
        ...(customService.trim() ? [customService.trim()] : []),
      ]
      const { error: err } = await supabase
        .from('shop_profiles')
        .upsert(
          { user_id: user.id, shop_name: shopName, phone, address, city_state_zip: cityStateZip, services },
          { onConflict: 'user_id' }
        )
      if (err) throw err
      setFinished(true)
      requestAnimationFrame(() => stepHeading.current?.focus())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Your setup could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  const extraServices = selectedServices.filter(s => !SERVICES.some(p => p.value === s))
  const allServices = [...selectedServices, ...(customService.trim() ? [customService.trim()] : [])]
  const serviceLabel = (value: string) => SERVICES.find(s => s.value === value)?.label ?? value
  const loading = profileState === 'loading'

  return (
    <div className="page-container animate-fade-in">
      <div className="mx-auto max-w-xl">
        <header className="mb-6">
          <h1 className="page-title">Set up your shop</h1>
          <p className="page-subtitle">Three short steps. You can change any of this later in Settings.</p>
        </header>

        <Progress step={step} done={finished} />

        {profileState === 'error' && !finished && (
          <Notice kind="warn" className="mb-4">
            <p>We could not load your saved shop details. You can still fill them in.</p>
            <button type="button" className="mt-1 font-bold text-blue underline underline-offset-4" onClick={loadProfile}>Try again</button>
          </Notice>
        )}

        {/* Step 1: shop info */}
        {!finished && step === 1 && (
          <section className="card" aria-labelledby="step-title">
            <h2 id="step-title" ref={stepHeading} tabIndex={-1} className="section-title outline-none"><span className="sr-only">Step 1 of 3: </span>Tell us about your shop</h2>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">Customers see this on estimates, invoices and texts.</p>

            {loading ? (
              <div className="mt-5 space-y-4" aria-busy="true" aria-label="Loading your shop details">
                {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div>
                  <label htmlFor="ob-name" className="form-label">Shop name</label>
                  <input
                    ref={nameRef}
                    id="ob-name"
                    className={`form-input ${nameError ? 'border-red' : ''}`}
                    value={shopName}
                    onChange={e => { setShopName(e.target.value); if (nameError) setNameError('') }}
                    placeholder="Main Street Auto Repair"
                    autoComplete="organization"
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? 'ob-name-error' : undefined}
                  />
                  {nameError && <p id="ob-name-error" className="form-error">{nameError}</p>}
                </div>
                <div>
                  <label htmlFor="ob-phone" className="form-label">Shop phone number</label>
                  <input
                    id="ob-phone"
                    className="form-input"
                    type="tel"
                    inputMode="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="(713) 555-0100"
                    autoComplete="off"
                  />
                  <p className="form-hint">The number customers call.</p>
                </div>
                <div>
                  <label htmlFor="ob-address" className="form-label">Street address</label>
                  <input
                    id="ob-address"
                    className="form-input"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="123 Main St"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label htmlFor="ob-city" className="form-label">City, state and ZIP</label>
                  <input
                    id="ob-city"
                    className="form-input"
                    value={cityStateZip}
                    onChange={e => setCityStateZip(e.target.value)}
                    placeholder="Houston, TX 77025"
                    autoComplete="off"
                  />
                </div>
              </div>
            )}

            <div className="mt-6 flex justify-end">
              <button type="button" className="btn btn-primary btn-lg w-full sm:w-auto" onClick={next} disabled={loading}>
                Next: services
                <Icon name="arrowRight" className="h-5 w-5" />
              </button>
            </div>
          </section>
        )}

        {/* Step 2: services */}
        {!finished && step === 2 && (
          <section className="card" aria-labelledby="step-title">
            <h2 id="step-title" ref={stepHeading} tabIndex={-1} className="section-title outline-none"><span className="sr-only">Step 2 of 3: </span>What does your shop do?</h2>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">Pick every service you offer. You can skip this.</p>

            <fieldset className="mt-5">
              <legend className="sr-only">Services your shop offers</legend>
              <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                {[...SERVICES, ...extraServices.map(v => ({ value: v, label: v }))].map(svc => {
                  const checked = selectedServices.includes(svc.value)
                  return (
                    <li key={svc.value}>
                      <label
                        className={`flex min-h-[52px] cursor-pointer items-center gap-3 rounded-md border px-3 transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue ${
                          checked ? 'border-blue bg-blue/10' : 'border-line bg-bg-card hover:bg-bg-hover'
                        }`}
                      >
                        <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggleService(svc.value)} />
                        <span
                          aria-hidden="true"
                          className={`grid h-6 w-6 shrink-0 place-items-center rounded border-2 ${checked ? 'border-blue bg-blue text-[rgb(var(--c-on-blue))]' : 'border-line bg-bg-input'}`}
                        >
                          {checked && <Icon name="check" className="h-4 w-4" strokeWidth={3} />}
                        </span>
                        <span className="min-w-0 break-words font-bold leading-tight">{svc.label}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-2 text-[0.875rem] text-text-secondary" aria-live="polite">
                {selectedServices.length === 0 ? 'None selected yet.' : `${selectedServices.length} selected.`}
              </p>
            </fieldset>

            <div className="mt-4">
              <label htmlFor="ob-custom" className="form-label">Another service (optional)</label>
              <input
                id="ob-custom"
                className="form-input"
                value={customService}
                onChange={e => setCustomService(e.target.value)}
                placeholder="Fleet maintenance"
              />
              <p className="form-hint">Add one more that is not in the list.</p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <button type="button" className="btn btn-secondary" onClick={() => go(1)}>
                <Icon name="chevronLeft" className="h-5 w-5" />
                Back
              </button>
              <button type="button" className="btn btn-primary btn-lg" onClick={next}>
                Next: finish
                <Icon name="arrowRight" className="h-5 w-5" />
              </button>
            </div>
          </section>
        )}

        {/* Step 3: review and finish */}
        {!finished && step === 3 && (
          <section className="card" aria-labelledby="step-title">
            <h2 id="step-title" ref={stepHeading} tabIndex={-1} className="section-title outline-none"><span className="sr-only">Step 3 of 3: </span>Check and finish</h2>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">This is what we will save for your shop.</p>

            <dl className="mt-4 divide-y divide-border border-y border-border">
              <div className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <dt className="text-[0.8125rem] font-bold text-text-secondary">Shop</dt>
                  <dd className="mt-0.5 break-words font-bold">{shopName || 'No name yet'}</dd>
                  <dd className="break-words text-[0.9375rem] text-text-secondary">
                    {[phone, address, cityStateZip].filter(Boolean).join(' · ') || 'No phone or address added'}
                  </dd>
                </div>
                <button type="button" className="btn btn-ghost btn-sm min-h-[44px] text-blue" onClick={() => go(1)}>Change<span className="sr-only"> shop info</span></button>
              </div>
              <div className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <dt className="text-[0.8125rem] font-bold text-text-secondary">Services</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {allServices.length === 0
                      ? <span className="text-[0.9375rem] text-text-secondary">None selected</span>
                      : allServices.map(s => <span key={s} className="tag tag-gray">{serviceLabel(s)}</span>)}
                  </dd>
                </div>
                <button type="button" className="btn btn-ghost btn-sm min-h-[44px] text-blue" onClick={() => go(2)}>Change<span className="sr-only"> services</span></button>
              </div>
            </dl>

            <details className="mt-4 rounded-md border border-border bg-bg-base">
              <summary className="flex min-h-[48px] cursor-pointer items-center gap-2 px-3 font-bold">
                <span className="lamp lamp-off" aria-hidden="true" />
                AI voicemail is coming soon
              </summary>
              <div className="space-y-2 px-3 pb-3 text-[0.9375rem] text-text-secondary">
                <p>Your dedicated AI line number is not ready yet. When it is, customers whose calls go unanswered for four rings will be greeted by your AI assistant.</p>
                <p>To forward unanswered calls, you will dial your carrier’s conditional call forwarding code from your shop phone. For AT&amp;T and T-Mobile it is <code className="num rounded bg-text-primary/[0.08] px-1.5 py-0.5 font-mono text-[0.875rem] text-text-primary">**61*[AI line number]#</code> and then Call.</p>
              </div>
            </details>

            {error && (
              <Notice kind="error" className="mt-4">
                <p className="font-bold">Your setup could not be saved.</p>
                <p>{error}</p>
                <p className="mt-1">Check your connection, then choose Finish setup again.</p>
              </Notice>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <button type="button" className="btn btn-secondary" onClick={() => go(2)} disabled={saving}>
                <Icon name="chevronLeft" className="h-5 w-5" />
                Back
              </button>
              <button type="button" className="btn btn-primary btn-lg" onClick={handleComplete} disabled={saving} aria-busy={saving}>
                {saving ? <><ButtonSpinner /> Saving…</> : 'Finish setup'}
              </button>
            </div>
          </section>
        )}

        {/* Done */}
        {finished && (
          <section className="card text-center sm:p-8" aria-labelledby="done-title">
            <h2 id="done-title" ref={stepHeading} tabIndex={-1} className="display inline-flex items-center gap-2.5 text-[1.5rem] font-bold leading-tight outline-none">
              <span className="lamp lamp-green" aria-hidden="true" />
              Your shop is set up
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-[0.9375rem] text-text-secondary">
              Your details are saved. Today is your home screen: it shows the calls, texts, estimates and unpaid invoices that need you.
            </p>
            <div className="mt-6 flex flex-col items-center gap-2">
              <Link href="/dashboard" className="btn btn-primary btn-lg w-full sm:w-auto">
                Go to Today
                <Icon name="arrowRight" className="h-5 w-5" />
              </Link>
              <Link href="/settings" className="btn btn-ghost">Open settings</Link>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
