'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'next/navigation'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { RATING_CUSTOMER_WORD, decisionSummary, firstNameOf, fmtMoney } from '@/lib/dvi'
import type { Decision, Decisions, Finding } from '@/lib/dvi'

interface Shop { name: string; phone: string; address: string; logo: string | null }
interface Loaded {
  shop: Shop
  customer: string
  vehicle: string
  date: string
  note: string
  findings: Finding[]
  good: string[]
  checked: number
  decisions: Decisions
  decidedAt: string | null
}

const telHref = (phone: string) => 'tel:' + phone.replace(/[^\d+]/g, '')
const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/** The shop's own name, logo, address and phone across the top, so the customer knows who is asking. */
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
      <main className="mx-auto w-full max-w-xl px-4 pb-32 pt-5 sm:px-6">{children}</main>
    </div>
  )
}

export default function CustomerInspectionPage() {
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === 'string' ? params.token : ''
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [data, setData] = useState<Loaded | null>(null)
  const [choice, setChoice] = useState<Decisions>({})
  const [view, setView] = useState<'choose' | 'thanks'>('choose')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [showGood, setShowGood] = useState(false)

  const load = useCallback(async () => {
    setState('loading'); setError('')
    try {
      const res = await fetch(`/api/inspection/public?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok !== true) { setError(typeof d.error === 'string' ? d.error : 'This page did not load. Check your connection and try again.'); setState('error'); return }
      const i = d.inspection
      const loaded: Loaded = {
        shop: { name: String(d.shop?.name || ''), phone: String(d.shop?.phone || ''), address: String(d.shop?.address || ''), logo: typeof d.shop?.logo === 'string' ? d.shop.logo : null },
        customer: String(i.customer || ''), vehicle: String(i.vehicle || ''), date: String(i.date || ''), note: String(i.note || ''),
        findings: Array.isArray(i.findings) ? i.findings : [], good: Array.isArray(i.good) ? i.good : [], checked: Number(i.checked) || 0,
        decisions: i.decisions && typeof i.decisions === 'object' ? i.decisions : {}, decidedAt: typeof i.decidedAt === 'string' ? i.decidedAt : null,
      }
      setData(loaded)
      setChoice(loaded.decisions)
      setView(Object.keys(loaded.decisions).length > 0 ? 'thanks' : 'choose')
      setState('ready')
    } catch {
      setError('No connection. Check your internet and try again.'); setState('error')
    }
  }, [token])

  useEffect(() => { void load() }, [load])

  const list = useMemo(() => data?.findings ?? [], [data])
  const sum = useMemo(() => decisionSummary(list, choice), [list, choice])
  const chosen = sum.approved + sum.declined
  const unpriced = list.filter(f => choice[f.id] === 'approved' && f.price === null).length

  const pick = (id: string, d: Decision) => setChoice(c => (c[id] === d ? Object.fromEntries(Object.entries(c).filter(([k]) => k !== id)) : { ...c, [id]: d }))

  const submit = async () => {
    setSending(true); setSendError('')
    try {
      const res = await fetch('/api/inspection/public', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, decisions: choice }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok !== true) { setSendError(typeof d.error === 'string' ? d.error : 'Your answers did not send. Check your connection and try again.'); return }
      setData(x => (x ? { ...x, decisions: choice, decidedAt: new Date().toISOString() } : x))
      setView('thanks')
      window.scrollTo({ top: 0 })
    } catch {
      setSendError('No connection. Check your internet and try again.')
    } finally { setSending(false) }
  }

  if (state === 'loading') {
    return (
      <Frame shop={null}>
        <div className="space-y-3" aria-busy="true" aria-label="Loading your inspection">
          <div className="skeleton h-16" /><div className="skeleton h-40" /><div className="skeleton h-40" />
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
            <button type="button" className="btn btn-secondary mt-3" onClick={() => void load()}>Try again</button>
          </div>
        </div>
      </Frame>
    )
  }

  const { shop } = data
  const first = firstNameOf(data.customer)
  const needs = list.filter(f => f.status === 'red').length
  const watch = list.filter(f => f.status === 'yellow').length
  const callLine = shop.phone ? <a href={telHref(shop.phone)} className="font-bold text-blue underline underline-offset-4">{shop.phone}</a> : null

  /* ---------- after they answered ---------- */
  if (view === 'thanks') {
    const done = decisionSummary(list, data.decisions)
    const approvedList = list.filter(f => data.decisions[f.id] === 'approved')
    const declinedList = list.filter(f => data.decisions[f.id] === 'declined')
    return (
      <Frame shop={shop}>
        <div className="panel">
          <div className="panel-body">
            <p className="flex items-center gap-2 text-[1.125rem] font-bold"><span className="lamp lamp-green shrink-0" aria-hidden="true" />Thank you{first ? `, ${first}` : ''}. We have your answers.</p>
            <p className="mt-2 text-[0.9375rem] text-text-secondary">
              {shop.name || 'The shop'} will follow up{approvedList.length > 0 ? ' to schedule the work you approved' : ''}.{callLine && <> Questions? Call {callLine}.</>}
            </p>
          </div>
        </div>

        {approvedList.length > 0 && (
          <section className="mt-5" aria-label="Approved">
            <h2 className="section-title">You approved</h2>
            <ul className="ledger mt-1">
              {approvedList.map(f => (
                <li key={f.id} className="ledger-row">
                  <span className="ledger-main"><span className="ledger-title block !whitespace-normal">{f.name}</span><span className="ledger-sub block">{f.section}</span></span>
                  <span className="num shrink-0 font-bold">{f.price !== null ? fmtMoney(f.price) : 'Price to follow'}</span>
                </li>
              ))}
            </ul>
            <p className="num mt-2 flex justify-between text-[0.9375rem] font-bold"><span>Estimated total, before tax</span><span>{fmtMoney(done.approvedTotal)}</span></p>
          </section>
        )}
        {declinedList.length > 0 && (
          <section className="mt-5" aria-label="Skipped">
            <h2 className="section-title">You skipped</h2>
            <ul className="ledger mt-1">
              {declinedList.map(f => (
                <li key={f.id} className="ledger-row"><span className="ledger-main"><span className="ledger-title block !whitespace-normal">{f.name}</span><span className="ledger-sub block">{f.section}</span></span></li>
              ))}
            </ul>
          </section>
        )}
        <button type="button" className="btn btn-secondary mt-6 w-full" onClick={() => { setChoice(data.decisions); setView('choose') }}>Change my answers</button>
      </Frame>
    )
  }

  /* ---------- the inspection ---------- */
  return (
    <Frame shop={shop}>
      <h1 className="display text-[1.5rem] font-bold leading-tight">{first ? `${first}, here is what we found` : 'Here is what we found'}</h1>
      <p className="mt-1 text-text-secondary">{data.vehicle || 'Your vehicle'}{data.date ? ` · ${fmtDate(data.date)}` : ''}</p>

      <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.9375rem]">
        <span className="num font-bold">{data.checked} checked</span>
        {needs > 0 && <span className="flex items-center gap-1.5"><span className="lamp lamp-red !h-2.5 !w-2.5" aria-hidden="true" />{needs} {needs === 1 ? 'needs' : 'need'} attention</span>}
        {watch > 0 && <span className="flex items-center gap-1.5"><span className="lamp lamp-amber !h-2.5 !w-2.5" aria-hidden="true" />{watch} worth watching</span>}
        {data.good.length > 0 && <span className="flex items-center gap-1.5"><span className="lamp lamp-green !h-2.5 !w-2.5" aria-hidden="true" />{data.good.length} look good</span>}
      </p>

      {data.note && <p className="mt-4 rounded-md border border-border bg-bg-card px-4 py-3 text-[0.9375rem]">{data.note}</p>}

      {list.length === 0 ? (
        <div className="panel mt-5">
          <div className="panel-body">
            <p className="flex items-center gap-2 font-bold"><span className="lamp lamp-green shrink-0" aria-hidden="true" />Nothing needs attention right now.</p>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">Everything we checked looks good.{callLine && <> Questions? Call {callLine}.</>}</p>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-5 text-[0.9375rem] text-text-secondary">Choose <b className="text-text-primary">Approve</b> for the work you want done and <b className="text-text-primary">Skip</b> for anything you do not. Then send your answers. Prices are estimates, before tax.</p>
          <ul className="mt-3 space-y-3" aria-label="What we found">
            {list.map(f => {
              const c = choice[f.id]
              const red = f.status === 'red'
              return (
                <li key={f.id} className={`rotag lamp-${red ? 'red' : 'amber'} !pb-3`}>
                  <p className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words text-[1.0625rem] font-bold leading-snug">{f.name}</span>
                    <span className="num shrink-0 font-bold">{f.price !== null ? fmtMoney(f.price) : ''}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[0.875rem] text-text-secondary">
                    <span className="flex items-center gap-1.5"><span className={`lamp ${red ? 'lamp-red' : 'lamp-amber'} !h-2.5 !w-2.5`} aria-hidden="true" />{RATING_CUSTOMER_WORD[f.status]}</span>
                    <span>{f.section}</span>
                    {f.price === null && <span>Price to follow</span>}
                  </p>
                  {f.note && <p className="mt-2 break-words text-[0.9375rem]">{f.note}</p>}
                  {f.photos.length > 0 && (
                    <ul className="mt-2.5 flex flex-wrap gap-2" aria-label={`Photos of ${f.name}`}>
                      {f.photos.map((src, i) => (
                        <li key={i}>
                          <button type="button" className="block h-20 w-20 overflow-hidden rounded-md border border-border" onClick={() => setPhoto(src)} aria-label={`Open photo ${i + 1} of ${f.photos.length} for ${f.name}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, so next/image has nothing to optimize */}
                            <img src={src} alt="" className="h-full w-full object-cover" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div role="group" aria-label={`Your answer for ${f.name}`} className="mt-3 grid grid-cols-2 gap-2">
                    <button type="button" aria-pressed={c === 'approved'} onClick={() => pick(f.id, 'approved')}
                      className={`inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-md border px-3 font-bold ${c === 'approved' ? 'border-green bg-green/10 text-green' : 'border-[rgb(var(--c-line))] bg-bg-card hover:bg-bg-hover'}`}>
                      {c === 'approved' && <Icon name="check" className="h-5 w-5" strokeWidth={2.4} />}Approve
                    </button>
                    <button type="button" aria-pressed={c === 'declined'} onClick={() => pick(f.id, 'declined')}
                      className={`inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-md border px-3 font-bold ${c === 'declined' ? 'border-text-secondary bg-bg-hover' : 'border-[rgb(var(--c-line))] bg-bg-card hover:bg-bg-hover'}`}>
                      {c === 'declined' && <Icon name="check" className="h-5 w-5" strokeWidth={2.4} />}Skip
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {data.good.length > 0 && (
        <section className="mt-6">
          <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-3 text-left font-bold" aria-expanded={showGood} onClick={() => setShowGood(v => !v)}>
            <span className="flex items-center gap-2"><span className="lamp lamp-green shrink-0" aria-hidden="true" />{data.good.length} {data.good.length === 1 ? 'item looks' : 'items look'} good</span>
            <Icon name="chevronDown" className={`h-5 w-5 text-text-secondary transition-transform ${showGood ? '' : '-rotate-90'}`} />
          </button>
          {showGood && <ul className="mt-1 columns-1 gap-6 text-[0.9375rem] text-text-secondary sm:columns-2">{data.good.map((g, i) => <li key={`${g}-${i}`} className="break-inside-avoid py-0.5">{g}</li>)}</ul>}
        </section>
      )}

      {list.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-bg-chrome pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto w-full max-w-xl px-4 py-3 sm:px-6">
            {sendError && <p role="alert" className="mb-2 text-[0.9375rem] font-bold text-red">{sendError}</p>}
            <div className="flex items-center justify-between gap-3">
              <p className="num min-w-0 text-[0.9375rem]" aria-live="polite">
                {chosen === 0 ? <span className="text-text-secondary">Choose Approve or Skip</span> : (
                  <>
                    <span className="block font-bold">{sum.approved} approved{sum.declined > 0 ? `, ${sum.declined} skipped` : ''}</span>
                    {sum.approved > 0 && <span className="block text-text-secondary">About {fmtMoney(sum.approvedTotal)}{unpriced > 0 ? `, plus ${unpriced} to price` : ''}</span>}
                  </>
                )}
              </p>
              <button type="button" className="btn btn-primary shrink-0" disabled={chosen === 0 || sending} onClick={() => void submit()}>{sending ? 'Sending…' : 'Send my answers'}</button>
            </div>
          </div>
        </div>
      )}

      <Sheet open={!!photo} onClose={() => setPhoto(null)} title="Photo" wide>
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL, so next/image has nothing to optimize
          <img src={photo} alt="Inspection photo, full size" className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md" />
        )}
      </Sheet>
    </Frame>
  )
}
