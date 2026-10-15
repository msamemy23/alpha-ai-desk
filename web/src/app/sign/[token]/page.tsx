'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'next/navigation'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'

interface LineItem {
  description: string
  qty?: number
  unit_price?: number
  unitPrice?: number
  total?: number
  taxable?: boolean
}

interface Doc {
  id: string
  type: string
  doc_number: string
  customer_name: string
  vehicle_year?: string
  vehicle_make?: string
  vehicle_model?: string
  vehicle_vin?: string
  doc_date?: string
  total?: number
  parts_total?: number
  labor_total?: number
  core_total?: number
  shop_supplies?: number
  sublet_total?: number
  tax_amount?: number
  notes?: string
  line_items?: LineItem[]
  warranty_type?: string
  warranty_months?: number
  warranty_mileage?: number
  warranty_exclusions?: string
  warranty_start?: string
}

type Shop = { name: string; address: string; phone: string }
type PageState = 'loading' | 'ready' | 'already_signed' | 'expired' | 'error' | 'signing' | 'done'
type FormErrors = { name?: string; signature?: string; agreed?: string }

// The signature pad is a sheet of paper with dark ink in every theme, so the
// saved image looks the same in the confirmation email as it did on the phone.
const PAD_INK = '#1a1a2e'
const PAD_PAPER = '#fffffd'
const PAD_RULE = '#a3a8a1'
const PAD_HINT = '#5a6169'
const PAD_WIDTH = 600
const PAD_HEIGHT = 240

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const fmtDate = (value?: string) => {
  if (!value) return ''
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

const fmtDateTime = (value?: string) => {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
}

const telHref = (phone: string) => 'tel:' + phone.replace(/[^\d+]/g, '')

function ButtonSpinner() {
  return <span aria-hidden="true" className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />
}

/** The shop's own name, address and phone across the top, so the customer knows who is asking. */
function Frame({ shop, fallbackName, children }: { shop: Shop; fallbackName: string; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg-base text-text-primary">
      <header className="border-b border-border bg-bg-chrome">
        <div className="mx-auto w-full max-w-xl px-4 py-3 sm:px-6">
          <p className="display text-[1.25rem] font-bold leading-tight">{shop.name || fallbackName}</p>
          {(shop.address || shop.phone) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[0.9375rem] text-text-secondary">
              {shop.address && <span>{shop.address}</span>}
              {shop.phone && (
                <a href={telHref(shop.phone)} className="inline-flex min-h-[44px] items-center gap-1.5 font-bold text-blue underline-offset-4 hover:underline sm:min-h-0">
                  <Icon name="phone" className="h-4 w-4" />
                  {shop.phone}
                </a>
              )}
            </p>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-5 sm:px-6">{children}</main>
    </div>
  )
}

/** One calm message: a lamp, a plain title and what to do next. */
function StatusCard({ lamp, title, children }: { lamp: 'green' | 'amber' | 'red'; title: string; children: ReactNode }) {
  return (
    <section className="panel mt-4 p-5 sm:p-7" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
        <h1 className="display text-[1.5rem] font-bold leading-tight">{title}</h1>
      </div>
      <div className="mt-3 space-y-2 text-[1rem] leading-relaxed text-text-secondary">{children}</div>
    </section>
  )
}

export default function SignPage() {
  const params = useParams()
  const token = params?.token as string

  const [state, setState] = useState<PageState>('loading')
  const [doc, setDoc] = useState<Doc | null>(null)
  const [shop, setShop] = useState<Shop>({ name: '', address: '', phone: '' })
  const [signerName, setSignerName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [networkFailed, setNetworkFailed] = useState(false)
  const [signedAt, setSignedAt] = useState('')
  const [hasSignature, setHasSignature] = useState(false)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [submitError, setSubmitError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const padRef = useRef<HTMLDivElement>(null)
  const agreeRef = useRef<HTMLInputElement>(null)
  const drawing = useRef(false)
  const lastPos = useRef<{ x: number; y: number } | null>(null)

  const load = useCallback(() => {
    setState('loading')
    setNetworkFailed(false)
    fetch('/api/sign?token=' + token)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          if (data.error.includes('expired')) setState('expired')
          else setState('error')
          setErrorMsg(data.error)
        } else if (data.already_signed) {
          setState('already_signed')
          setSignedAt(data.signed_at)
        } else {
          setDoc(data.doc)
          if (data.shop && typeof data.shop === 'object') setShop({ name: String(data.shop.name || ''), address: String(data.shop.address || ''), phone: String(data.shop.phone || '') })
          setState('ready')
        }
      })
      .catch(() => { setState('error'); setErrorMsg('Failed to load document'); setNetworkFailed(true) })
  }, [token])

  useEffect(() => { load() }, [load])

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()
    try { canvas.setPointerCapture(e.pointerId) } catch { /* older browsers: drawing still works inside the pad */ }
    drawing.current = true
    lastPos.current = getPos(e, canvas)
  }

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const pos = getPos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(lastPos.current?.x ?? pos.x, lastPos.current?.y ?? pos.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.strokeStyle = PAD_INK
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    lastPos.current = pos
    if (!hasSignature) {
      setHasSignature(true)
      setFormErrors(prev => (prev.signature ? { ...prev, signature: undefined } : prev))
    }
  }

  const endDraw = () => {
    drawing.current = false
    lastPos.current = null
  }

  const clearSig = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasSignature(false)
  }

  const handleSubmit = async () => {
    setSubmitError('')
    const problems: FormErrors = {}
    if (!signerName.trim()) problems.name = 'Type your full name.'
    if (!hasSignature) problems.signature = 'Draw your signature in the box.'
    if (!agreed) problems.agreed = 'Check the box to agree before you sign.'
    if (problems.name || problems.signature || problems.agreed) {
      setFormErrors(problems)
      if (problems.name) nameRef.current?.focus()
      else if (problems.signature) padRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      else agreeRef.current?.focus()
      return
    }
    setFormErrors({})
    const canvas = canvasRef.current
    const signatureData = canvas?.toDataURL('image/png') || ''
    setState('signing')
    try {
      const res = await fetch('/api/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', token, signatureData, signerName: signerName.trim() }),
      })
      const data = await res.json()
      if (data.success) { setState('done'); setSignedAt(data.signed_at) }
      else { setState('ready'); setSubmitError(data.error || 'Your signature could not be saved. Try again.') }
    } catch { setState('ready'); setSubmitError('Your signature could not be saved. Check your connection and try again.') }
  }

  const vehicle = doc ? [doc.vehicle_year, doc.vehicle_make, doc.vehicle_model].filter(Boolean).join(' ') : ''
  const lineItems = doc?.line_items || []
  const total = Number(doc?.total || 0)
  const typeLabel = (doc?.type || 'document').toLowerCase()
  const typeTitle = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1)

  // ---------- Loading ----------
  if (state === 'loading') {
    return (
      <Frame shop={shop} fallbackName="Electronic signature">
        <div aria-busy="true" aria-label="Loading your document" role="status" className="space-y-3">
          <div className="skeleton h-8 w-2/3" />
          <div className="skeleton h-28" />
          <div className="skeleton h-16" />
          <div className="skeleton h-16" />
          <div className="skeleton h-40" />
        </div>
      </Frame>
    )
  }

  // ---------- Finished and error states ----------
  if (state === 'already_signed') {
    return (
      <Frame shop={shop} fallbackName="Electronic signature">
        <StatusCard lamp="green" title="Already signed">
          <p>This document was signed on {fmtDateTime(signedAt) || 'an earlier date'}. There is nothing more to do.</p>
          <p>Check your email for your signed confirmation.</p>
        </StatusCard>
      </Frame>
    )
  }

  if (state === 'expired' || state === 'error') {
    const expired = state === 'expired'
    return (
      <Frame shop={shop} fallbackName="Electronic signature">
        <StatusCard lamp={expired ? 'amber' : 'red'} title={expired ? 'This link has expired' : networkFailed ? 'This page did not load' : 'We could not open this link'}>
          {networkFailed ? (
            <p>Check your connection and try again.</p>
          ) : (
            <>
              {expired
                ? <p>Signing links stop working after a while. Contact the shop and they can send you a new one.</p>
                : (
                  <>
                    <p>{errorMsg || 'This signing link is no longer valid.'}</p>
                    <p>Make sure you opened the whole link from the text or email, or contact the shop for a new one.</p>
                  </>
                )}
            </>
          )}
          {networkFailed && <button type="button" className="btn btn-primary mt-2" onClick={load}>Try again</button>}
        </StatusCard>
      </Frame>
    )
  }

  if (state === 'done') {
    return (
      <Frame shop={shop} fallbackName="Electronic signature">
        <StatusCard lamp="green" title="Your signature is saved">
          <p>Thank you, <strong className="text-text-primary">{signerName}</strong>. The shop has your signed {typeLabel}{doc?.doc_number ? ` ${doc.doc_number}` : ''}.</p>
          {signedAt && <p>Signed {fmtDateTime(signedAt)}.</p>}
          <p>A confirmation has been emailed to you.</p>
          {shop.phone && (
            <p>
              Questions? Call{' '}
              <a href={telHref(shop.phone)} className="font-bold text-blue underline underline-offset-4">{shop.phone}</a>.
            </p>
          )}
        </StatusCard>
      </Frame>
    )
  }

  // ---------- Review and sign ----------
  const signing = state === 'signing'
  const breakdown: [string, number][] = [
    ['Parts', Number(doc?.parts_total || 0)],
    ['Labor', Number(doc?.labor_total || 0)],
    ['Core charges (refundable)', Number(doc?.core_total || 0)],
    ['Shop supplies', Number(doc?.shop_supplies || 0)],
    ['Sublet', Number(doc?.sublet_total || 0)],
    ['Tax', Number(doc?.tax_amount || 0)],
  ]
  const shownBreakdown = breakdown.filter(([, amount]) => amount > 0)

  return (
    <Frame shop={shop} fallbackName="Your auto shop">
      <h1 className="display text-[1.625rem] font-bold leading-tight">Review your {typeLabel}</h1>
      <p className="mt-1 text-[0.9375rem] text-text-secondary">Look over the work and the price. When you are ready, sign at the bottom to approve.</p>

      {/* The repair-order tag: who, which car, how much. */}
      <div className="rotag lamp-amber mt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.875rem] font-bold text-text-secondary">{typeTitle} {doc?.doc_number ? `#${doc.doc_number}` : ''}</p>
            <p className="mt-0.5 break-words text-[1.125rem] font-bold leading-snug">{doc?.customer_name}</p>
            {vehicle && (
              <p className="mt-1 flex items-center gap-1.5 text-[0.9375rem] text-text-secondary">
                <Icon name="vehicle" className="h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">{vehicle}</span>
              </p>
            )}
            {doc?.vehicle_vin && <p className="num mt-0.5 break-all text-[0.8125rem] text-text-muted">VIN {doc.vehicle_vin}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[0.875rem] font-bold text-text-secondary">Total</p>
            <p className="display num text-[1.75rem] font-bold leading-none">{money(total)}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-t border-border pt-2.5 text-[0.9375rem]">
          <p className="flex items-center gap-2">
            <span className="lamp lamp-amber" aria-hidden="true" />
            <span className="font-bold">Waiting for your approval</span>
          </p>
          {doc?.doc_date && <p className="text-text-secondary">{fmtDate(doc.doc_date)}</p>}
        </div>
      </div>

      {lineItems.length > 0 && (
        <section aria-labelledby="work-h" className="mt-8">
          <h2 id="work-h" className="section-title mb-1">Work and parts</h2>
          <ul className="border-t border-border">
            {lineItems.map((item, i) => {
              const qty = Number(item.qty || 1)
              const unit = Number(item.unitPrice || item.unit_price || 0)
              const amount = item.total || (qty * unit)
              return (
                <li key={i} className="flex items-start justify-between gap-4 border-b border-border py-3">
                  <span className="min-w-0">
                    <span className="block break-words leading-snug">{item.description}</span>
                    {qty !== 1 && unit > 0 && !item.description.includes(' @ ') && <span className="num block text-[0.875rem] text-text-secondary">{qty} × {money(unit)}</span>}
                  </span>
                  <span className="num shrink-0 font-bold">{money(amount)}</span>
                </li>
              )
            })}
          </ul>
          <dl className="ml-auto mt-3 w-full max-w-xs space-y-1.5 text-[0.9375rem]">
            {shownBreakdown.map(([label, amount]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-text-secondary">{label}</dt>
                <dd className="num">{money(amount)}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-4 border-t border-line pt-2">
              <dt className="font-bold">Total</dt>
              <dd className="display num text-[1.375rem] font-bold">{money(total)}</dd>
            </div>
          </dl>
        </section>
      )}

      {doc?.notes && (
        <section aria-labelledby="notes-h" className="mt-8">
          <h2 id="notes-h" className="section-title mb-1">Notes from the shop</h2>
          <p className="whitespace-pre-wrap break-words leading-relaxed text-text-secondary">{doc.notes}</p>
        </section>
      )}

      {doc?.warranty_type && doc.warranty_type !== 'No Warranty' && (
        <section aria-labelledby="warranty-h" className="panel mt-8 p-4">
          <h2 id="warranty-h" className="flex items-center gap-2 font-bold">
            <Icon name="shield" className="h-5 w-5 shrink-0 text-text-secondary" />
            Warranty: {doc.warranty_type}
          </h2>
          <p className="num mt-1 text-[0.9375rem] text-text-secondary">
            {doc.warranty_months ? doc.warranty_months + ' months' : ''}
            {doc.warranty_months && doc.warranty_mileage ? ' / ' : ''}
            {doc.warranty_mileage ? doc.warranty_mileage.toLocaleString() + ' miles' : ''}
            {doc.warranty_start ? ' from ' + doc.warranty_start : ''}
          </p>
          {doc.warranty_exclusions && (
            <details className="mt-2">
              <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-bold text-blue">Read the full warranty terms</summary>
              <p className="mt-1 whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed text-text-secondary">{doc.warranty_exclusions}</p>
            </details>
          )}
        </section>
      )}

      {/* ---------- Sign ---------- */}
      <section aria-labelledby="sign-h" className="panel mt-8 p-4 sm:p-5">
        <h2 id="sign-h" className="section-title">Sign to approve</h2>

        <div className="mt-4">
          <label htmlFor="sign-name" className="form-label">Your full name</label>
          <input
            ref={nameRef}
            id="sign-name"
            type="text"
            className={`form-input ${formErrors.name ? 'border-red' : ''}`}
            value={signerName}
            onChange={e => { setSignerName(e.target.value); if (formErrors.name) setFormErrors(prev => ({ ...prev, name: undefined })) }}
            placeholder="First and last name"
            autoComplete="name"
            aria-invalid={formErrors.name ? true : undefined}
            aria-describedby={formErrors.name ? 'sign-name-error' : undefined}
          />
          {formErrors.name && <p id="sign-name-error" className="form-error">{formErrors.name}</p>}
        </div>

        <div className="mt-5" ref={padRef}>
          <div className="mb-1 flex items-center justify-between gap-3">
            <span id="pad-label" className="text-[0.8125rem] font-bold text-text-secondary">Your signature</span>
            <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={clearSig} disabled={!hasSignature || signing}>Clear</button>
          </div>
          <div className={`relative overflow-hidden rounded-md border-2 ${formErrors.signature ? 'border-red' : 'border-line'}`} style={{ background: PAD_PAPER }}>
            <canvas
              ref={canvasRef}
              width={PAD_WIDTH}
              height={PAD_HEIGHT}
              role="img"
              aria-labelledby="pad-label"
              aria-describedby={formErrors.signature ? 'pad-error' : 'pad-hint'}
              onPointerDown={startDraw}
              onPointerMove={draw}
              onPointerUp={endDraw}
              onPointerCancel={endDraw}
              className="relative z-10 block w-full cursor-crosshair"
              style={{ aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}`, touchAction: 'none' }}
            />
            {/* The signing line, drawn behind the ink. */}
            <div className="pointer-events-none absolute inset-x-5 bottom-8 border-b-2 border-dashed" style={{ borderColor: PAD_RULE }} aria-hidden="true" />
            {!hasSignature && (
              <span className="pointer-events-none absolute inset-x-0 bottom-10 text-center text-[0.9375rem]" aria-hidden="true" style={{ color: PAD_HINT }}>
                Sign here
              </span>
            )}
          </div>
          {formErrors.signature
            ? <p id="pad-error" className="form-error">{formErrors.signature}</p>
            : <p id="pad-hint" className="form-hint">Use your finger or your mouse. Tap Clear to start over.</p>}
        </div>

        <div className="mt-5">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              ref={agreeRef}
              type="checkbox"
              checked={agreed}
              onChange={e => { setAgreed(e.target.checked); if (formErrors.agreed) setFormErrors(prev => ({ ...prev, agreed: undefined })) }}
              className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-blue"
              aria-invalid={formErrors.agreed ? true : undefined}
              aria-describedby={formErrors.agreed ? 'agree-error' : undefined}
            />
            <span className="text-[0.9375rem] leading-relaxed">
              I, <strong>{signerName.trim() || 'the person signing'}</strong>, agree that this electronic signature is the legal equivalent of my handwritten signature. I accept the services, charges, and warranty terms on this {typeLabel}.
            </span>
          </label>
          {formErrors.agreed && <p id="agree-error" className="form-error">{formErrors.agreed}</p>}
        </div>

        {submitError && <Notice kind="error" className="mt-5">{submitError}</Notice>}

        <button type="button" className="btn btn-primary btn-lg mt-5 w-full" onClick={handleSubmit} disabled={signing} aria-busy={signing}>
          {signing ? <><ButtonSpinner /> Saving your signature…</> : 'Approve and sign'}
        </button>
        <p className="mt-3 text-center text-[0.875rem] text-text-muted">A confirmation will be emailed to you.</p>
      </section>

      <p className="mt-6 text-center text-[0.875rem] text-text-muted">
        {shop.name ? `${shop.name} · ` : ''}Electronic {typeLabel}
      </p>
    </Frame>
  )
}
