'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'next/navigation'
import Icon from '@/components/Icon'
import { shortYmd, statusLampFor, stepStates } from '@/lib/jobflow'
import type { PublicStep } from '@/lib/jobflow'

interface Shop { name: string; phone: string; address: string; logo: string | null }
interface Loaded {
  shop: Shop
  car: string
  first: string
  step: PublicStep
  headline: string
  detail: string
  waiting: 'parts' | 'you' | null
  parts: { word: string; eta: string | null } | null
  promise: { text: string; late: boolean } | null
  note: string
  inspection: string | null
}

/** How often the page asks again while it is open and in front. */
const REFRESH_MS = 60_000

const telHref = (phone: string) => 'tel:' + phone.replace(/[^\d+]/g, '')
const clockText = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

/** The shop's own name, logo, address and phone across the top, so the customer knows who this is from. */
function Frame({ shop, children }: { shop: Shop | null; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg-base text-text-primary">
      <header className="border-b border-border bg-bg-chrome">
        <div className="mx-auto flex w-full max-w-xl items-center gap-3 px-4 py-3 sm:px-6">
          {shop?.logo && (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL the shop uploaded
            <img src={shop.logo} alt="" className="h-12 w-12 shrink-0 rounded-full object-contain" />
          )}
          <div className="min-w-0">
            <p className="display break-words text-[1.25rem] font-bold leading-tight">{shop?.name || 'Your shop'}</p>
            {shop && (shop.address || shop.phone) && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[0.9375rem] text-text-secondary">
                {shop.address && <span>{shop.address}</span>}
                {shop.phone && (
                  <a href={telHref(shop.phone)} className="inline-flex min-h-[44px] items-center gap-1.5 font-bold text-blue underline-offset-4 hover:underline sm:min-h-0">
                    <Icon name="phone" className="h-4 w-4" />{shop.phone}
                  </a>
                )}
              </p>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-5 sm:px-6">{children}</main>
    </div>
  )
}

/** Where the customer's car stands, in plain words. Opened from the link in the shop's text. */
export default function CustomerStatusPage() {
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === 'string' ? params.token : ''
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [canRetry, setCanRetry] = useState(true)
  const [data, setData] = useState<Loaded | null>(null)
  const [updatedAt, setUpdatedAt] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [stale, setStale] = useState(false)
  const loaded = useRef(false)

  const load = useCallback(async (quiet: boolean) => {
    if (!quiet) { setState('loading'); setError('') } else setRefreshing(true)
    try {
      const res = await fetch(`/api/status?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      const d = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!res.ok || d.ok !== true) {
        const msg = typeof d.error === 'string' ? d.error : 'This page did not load. Check your connection and try again.'
        // A bad link stays bad. If we already have a page, keep showing it and say it may be out of date.
        if (quiet && loaded.current && res.status !== 404) { setStale(true); return }
        loaded.current = false
        setData(null); setError(msg); setCanRetry(res.status !== 404); setState('error')
        return
      }
      const shop = (d.shop || {}) as Record<string, unknown>
      const promise = d.promise && typeof d.promise === 'object' ? d.promise as Record<string, unknown> : null
      const parts = d.parts && typeof d.parts === 'object' ? d.parts as Record<string, unknown> : null
      setData({
        shop: { name: String(shop.name || ''), phone: String(shop.phone || ''), address: String(shop.address || ''), logo: typeof shop.logo === 'string' ? shop.logo : null },
        car: String(d.car || ''),
        first: String(d.first || ''),
        step: (['in', 'approved', 'working', 'ready', 'done'].includes(String(d.step)) ? d.step : 'in') as PublicStep,
        headline: String(d.headline || ''),
        detail: String(d.detail || ''),
        waiting: d.waiting === 'parts' || d.waiting === 'you' ? d.waiting : null,
        parts: parts ? { word: String(parts.word || ''), eta: typeof parts.eta === 'string' ? parts.eta : null } : null,
        promise: promise && typeof promise.text === 'string' ? { text: promise.text, late: promise.late === true } : null,
        note: String(d.note || ''),
        inspection: typeof d.inspection === 'string' && d.inspection ? d.inspection : null,
      })
      loaded.current = true
      setStale(false)
      setUpdatedAt(Date.now())
      setState('ready')
    } catch {
      if (quiet && loaded.current) { setStale(true); return }
      setError('No connection. Check your internet and try again.'); setCanRetry(true); setState('error')
    } finally { setRefreshing(false) }
  }, [token])

  useEffect(() => { void load(false) }, [load])

  // Keep the page current while it is open, and ask again the moment the customer comes back to it.
  useEffect(() => {
    if (state !== 'ready') return
    const tick = setInterval(() => { if (document.visibilityState === 'visible') void load(true) }, REFRESH_MS)
    const back = () => { if (document.visibilityState === 'visible') void load(true) }
    document.addEventListener('visibilitychange', back)
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', back) }
  }, [state, load])

  if (state === 'loading') {
    return (
      <Frame shop={null}>
        <div className="space-y-3" aria-busy="true" aria-label="Loading your car's status">
          <div className="skeleton h-8 w-2/3" /><div className="skeleton h-28" /><div className="skeleton h-40" />
        </div>
      </Frame>
    )
  }

  if (state === 'error' || !data) {
    return (
      <Frame shop={null}>
        <div role="alert" className="card flex items-start gap-3">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">This page could not open</p>
            <p className="mt-0.5 text-text-secondary">{error}</p>
            {canRetry && <button type="button" className="btn btn-secondary mt-3" onClick={() => void load(false)}>Try again</button>}
          </div>
        </div>
      </Frame>
    )
  }

  const lamp = statusLampFor(data.step, data.waiting)
  const steps = stepStates(data.step)
  const eta = data.parts ? shortYmd(data.parts.eta) : ''
  const done = data.step === 'done'

  return (
    <Frame shop={data.shop}>
      {data.first && <p className="text-[1.0625rem] text-text-secondary">Hi {data.first},</p>}
      <h1 className="display mt-0.5 break-words text-[1.625rem] font-bold leading-tight">{data.car || 'Your car'}</h1>

      <section aria-label="Status" className={`rotag lamp-${lamp} mt-4 !pb-4`}>
        <p className="text-[1.25rem] font-bold leading-snug" aria-live="polite">{data.headline}</p>
        {data.detail && <p className="mt-1 text-text-secondary">{data.detail}</p>}
      </section>

      {!done && (
        <ol aria-label="Progress" className="mt-4 space-y-1">
          {steps.map(s => (
            <li key={s.key} className={`flex min-h-[44px] items-center gap-3 rounded-md px-3 ${s.state === 'now' ? 'border border-blue bg-blue/10 font-bold' : 'border border-transparent'} ${s.state === 'next' ? 'text-text-muted' : ''}`} aria-current={s.state === 'now' ? 'step' : undefined}>
              <span className="grid h-6 w-6 shrink-0 place-items-center" aria-hidden="true">
                {s.state === 'done' ? <Icon name="check" className="h-5 w-5 text-green" strokeWidth={2.4} />
                  : s.state === 'now' ? <span className="lamp lamp-blue" />
                  : <Icon name="circle" className="h-4 w-4" />}
              </span>
              <span className="min-w-0 flex-1">{s.word}</span>
              <span className="shrink-0 text-[0.875rem] font-normal text-text-secondary">{s.state === 'done' ? 'Done' : s.state === 'now' ? 'Now' : 'Next'}</span>
            </li>
          ))}
        </ol>
      )}

      {(data.parts || data.promise) && (
        <dl className="mt-4 divide-y divide-border rounded-md border border-border bg-bg-card px-3 text-[1rem]">
          {data.parts && (
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="shrink-0 text-text-secondary">Parts</dt>
              <dd className="min-w-0 break-words text-right font-bold">{data.parts.word}{eta && <span className="block text-[0.9375rem] font-normal text-text-secondary">Expected {eta}</span>}</dd>
            </div>
          )}
          {data.promise && (
            <div className={`flex py-2.5 ${data.promise.late ? 'flex-col gap-0.5' : 'items-baseline justify-between gap-4'}`}>
              <dt className="shrink-0 text-text-secondary">Timing</dt>
              <dd className={`min-w-0 break-words font-bold ${data.promise.late ? 'text-amber' : 'text-right'}`}>{data.promise.text}</dd>
            </div>
          )}
        </dl>
      )}

      {data.note && (
        <section aria-label="A note from the shop" className="mt-4 rounded-md border border-border bg-bg-card px-3 py-2.5">
          <p className="text-[0.875rem] font-bold text-text-secondary">A note from {data.shop.name || 'the shop'}</p>
          <p className="mt-0.5 break-words">{data.note}</p>
        </section>
      )}

      <div className="mt-5 space-y-2">
        {data.inspection && (
          <a href={`/inspection/${encodeURIComponent(data.inspection)}`} className="btn btn-secondary w-full no-underline">
            <Icon name="inspect" className="h-5 w-5" />See your inspection
          </a>
        )}
        {data.shop.phone && (
          <a href={telHref(data.shop.phone)} className={`btn w-full no-underline ${data.waiting === 'you' || data.promise?.late ? 'btn-primary' : 'btn-secondary'}`}>
            <Icon name="phone" className="h-5 w-5" />Call {data.shop.name || 'the shop'}
          </a>
        )}
      </div>

      <p className="mt-6 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[0.875rem] text-text-secondary">
        <span className="num" aria-live="polite">
          {stale ? `Could not refresh. Showing the page from ${clockText(updatedAt)}.` : `Updated ${clockText(updatedAt)}. This page refreshes by itself.`}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load(true)} disabled={refreshing}>
          <Icon name="refresh" className="h-4 w-4" />{refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </p>
    </Frame>
  )
}
