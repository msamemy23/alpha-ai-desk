'use client'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import type { PublicDocument, PublicPage, PublicSigned } from '@/lib/doc-public'
import SignPad, { PAD_PAPER } from './SignPad'
import type { SignPadHandle } from './SignPad'
import { ButtonSpinner, Frame, JobCard, OptionPicker, PaySlot, StatusCard, TotalsBlock, accentButton, fmtDateTime, fmtDay, money, telHref } from './parts'
import type { Decision, TotalRow } from './parts'

// The customer's page for a private link: read the work, answer each job, sign, and keep a signed copy.
// The server decides everything that matters (who may answer, what the totals are); this page only asks and shows.

type Totals = { total: number; subtotal: number; tax: number }
type Method = 'drawn' | 'typed'
type Errors = { name?: string; sign?: string; agree?: string }

const post = async (body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> => {
  try {
    const res = await fetch('/api/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server. Check your connection and try again.' } }
  }
}

const kindWord = (d: PublicDocument): string => d.kind

function totalRows(d: PublicDocument): TotalRow[] {
  const t = d.totals
  const rows: TotalRow[] = []
  if (t.partsTotal > 0) rows.push({ label: 'Parts', amount: t.partsTotal })
  if (t.laborTotal > 0) rows.push({ label: 'Labor', amount: t.laborTotal })
  if (t.coreTotal > 0) rows.push({ label: 'Core charges (refundable)', amount: t.coreTotal })
  if (t.shopSupplies > 0) rows.push({ label: 'Shop supplies', amount: t.shopSupplies })
  if (t.sublet > 0) rows.push({ label: 'Outside work', amount: t.sublet })
  if (t.discount > 0) rows.push({ label: 'Discount', amount: t.discount, tone: 'save' })
  if (t.applyTax && t.taxAmount > 0) rows.push({ label: `Tax${t.taxRate ? ` (${t.taxRate}%)` : ''}`, amount: t.taxAmount })
  return rows
}

/** The shop's notes, warranty and terms, the same on every version of the page. */
function Fineprint({ doc }: { doc: PublicDocument }) {
  return (
    <>
      {doc.notes && (
        <section aria-labelledby="notes-h" className="mt-8">
          <h2 id="notes-h" className="section-title mb-1">Notes from the shop</h2>
          <p className="whitespace-pre-wrap break-words leading-relaxed text-text-secondary">{doc.notes}</p>
        </section>
      )}
      {doc.warranty.headline && (
        <section aria-labelledby="warranty-h" className="panel mt-8 p-4">
          <h2 id="warranty-h" className="flex items-center gap-2 font-bold">
            <Icon name="shield" className="h-5 w-5 shrink-0 text-text-secondary" />
            Warranty: {doc.warranty.headline}
          </h2>
          {doc.warranty.text && (
            <details className="mt-2">
              <summary className="inline-flex min-h-[44px] cursor-pointer items-center font-bold text-blue">Read the full warranty terms</summary>
              <p className="mt-1 whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed text-text-secondary">{doc.warranty.text}</p>
            </details>
          )}
        </section>
      )}
      {doc.terms && (
        <section aria-labelledby="terms-h" className="mt-8">
          <details>
            <summary id="terms-h" className="inline-flex min-h-[44px] cursor-pointer items-center font-bold text-blue">Terms</summary>
            <p className="mt-1 whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed text-text-secondary">{doc.terms}</p>
          </details>
        </section>
      )}
    </>
  )
}

/** The tag at the top: which document, whose car, how much, and what state it is in. */
function Tag({ doc, total, lamp, lampText, right }: { doc: PublicDocument; total: number; lamp: 'green' | 'amber' | 'red'; lampText: string; right?: ReactNode }) {
  return (
    <div className={`rotag lamp-${lamp} mt-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.875rem] font-bold text-text-secondary">{doc.docType} {doc.docNumber ? `#${doc.docNumber}` : ''}</p>
          <p className="mt-0.5 break-words text-[1.125rem] font-bold leading-snug">{doc.customerName}</p>
          {doc.vehicle && (
            <p className="mt-1 flex items-center gap-1.5 text-[0.9375rem] text-text-secondary">
              <Icon name="vehicle" className="h-4 w-4 shrink-0" />
              <span className="min-w-0 break-words">{doc.vehicle}{doc.mileage ? ` · ${Number(doc.mileage).toLocaleString('en-US')} mi` : ''}</span>
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[0.875rem] font-bold text-text-secondary">{doc.kind === 'invoice' && doc.totals.balanceDue !== doc.totals.total ? 'Balance due' : 'Total'}</p>
          <p className="display num text-[1.75rem] font-bold leading-none" data-testid="headline-total">{money(total)}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5 border-t border-border pt-2.5 text-[0.9375rem]">
        <p className="flex items-center gap-2"><span className={`lamp lamp-${lamp}`} aria-hidden="true" /><span className="font-bold">{lampText}</span></p>
        {right ?? (doc.docDate ? <p className="text-text-secondary">{fmtDay(doc.docDate)}</p> : null)}
      </div>
    </div>
  )
}

/** A question for the shop without answering. */
function AskShop({ token, defaultName }: { token: string; defaultName: string }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const send = async () => {
    if (busy) return
    if (text.trim().length < 2) { setError('Type your question first.'); return }
    setBusy(true); setError('')
    const r = await post({ action: 'message', token, message: text.trim(), name: defaultName.trim() })
    setBusy(false)
    if (r.ok) { setSent(true); setText('') } else setError(String(r.data.error || 'Your message did not send. Try again.'))
  }
  return (
    <details className="mt-8 rounded-md border border-border bg-bg-card px-4">
      <summary className="flex min-h-[48px] cursor-pointer items-center gap-2 font-bold"><Icon name="inbox" className="h-5 w-5 text-text-secondary" />Have a question first?</summary>
      <div className="pb-4">
        {sent ? (
          <Notice kind="success">Your question went to the shop. They will get back to you.</Notice>
        ) : (
          <>
            <label htmlFor="ask-text" className="form-label">Your question</label>
            <textarea id="ask-text" className="form-input min-h-[96px]" maxLength={1000} value={text} onChange={e => setText(e.target.value)} />
            {error && <p className="form-error">{error}</p>}
            <button type="button" className="btn btn-secondary mt-3" onClick={send} disabled={busy}>{busy ? <><ButtonSpinner /> Sending…</> : 'Send question to the shop'}</button>
          </>
        )}
      </div>
    </details>
  )
}

/* ───────────────────────── The signed copy ───────────────────────── */

function SignedCopy({ page, token }: { page: PublicPage; token: string }) {
  const doc = page.doc
  const signed = page.signed as PublicSigned
  const outcome = signed.outcome
  const lamp = outcome === 'declined' ? 'amber' : 'green'
  const title = outcome === 'approved' ? `You approved this ${kindWord(doc)}`
    : outcome === 'partial' ? `You approved part of this ${kindWord(doc)}`
      : outcome === 'declined' ? `You declined this ${kindWord(doc)}`
        : `You signed this ${kindWord(doc)}`
  return (
    <Frame shop={page.shop} accent={doc.accent} logoSrc={page.shop.hasLogo ? `/api/sign/logo?t=${encodeURIComponent(token)}` : null} fallbackName="Your auto shop">
      <StatusCard lamp={lamp} title={title}>
        <p>
          {outcome === 'declined'
            ? <>Thank you, <strong className="text-text-primary">{signed.name}</strong>. The shop knows you are not going ahead.</>
            : <>Thank you, <strong className="text-text-primary">{signed.name}</strong>. The shop has your answer and will take it from here.</>}
        </p>
        {page.shop.phone && <p>Questions? Call <a href={telHref(page.shop.phone)} className="font-bold text-blue underline underline-offset-4">{page.shop.phone}</a>.</p>}
      </StatusCard>

      <section aria-labelledby="record-h" className="panel mt-6 p-4 sm:p-5">
        <h2 id="record-h" className="section-title">Your signed copy</h2>
        <dl className="mt-3 space-y-2 text-[0.9375rem]">
          <div className="flex justify-between gap-4"><dt className="text-text-secondary">Signed by</dt><dd className="min-w-0 break-words text-right font-bold">{signed.name}</dd></div>
          <div className="flex justify-between gap-4"><dt className="text-text-secondary">When</dt><dd className="text-right">{fmtDateTime(signed.at)}</dd></div>
          {signed.device && <div className="flex justify-between gap-4"><dt className="text-text-secondary">From</dt><dd className="text-right">{signed.device}</dd></div>}
          {signed.recordId && <div className="flex justify-between gap-4"><dt className="text-text-secondary">Record number</dt><dd className="num text-right">{signed.recordId}</dd></div>}
        </dl>
        {signed.signatureData && (
          <div className="mt-4 rounded-md border border-line p-2" style={{ background: PAD_PAPER }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={signed.signatureData} alt={`Signature of ${signed.name}`} className="mx-auto block max-h-32 w-auto" />
          </div>
        )}
        {signed.note && <p className="mt-4 whitespace-pre-wrap break-words text-[0.9375rem] text-text-secondary"><span className="font-bold text-text-primary">Your note: </span>{signed.note}</p>}
      </section>

      {signed.declined.length > 0 && (
        <section aria-labelledby="declined-h" className="panel mt-6 p-4 sm:p-5">
          <h2 id="declined-h" className="section-title">Work you declined</h2>
          <ul className="mt-2 divide-y divide-border">
            {signed.declined.map((d, i) => (
              <li key={i} className="flex items-start justify-between gap-4 py-2.5"><span className="min-w-0 break-words">{d.job}</span><span className="num shrink-0 font-bold">{money(d.amount)}</span></li>
            ))}
          </ul>
          <p className="mt-2 text-[0.875rem] text-text-secondary">The shop keeps this on file in case you change your mind.</p>
        </section>
      )}

      <section aria-labelledby="work-h" className="mt-8 space-y-4">
        <h2 id="work-h" className="section-title">{outcome === 'declined' ? 'The work you were offered' : 'The work you approved'}</h2>
        {doc.groups.map(g => <JobCard key={g.key} group={g} interactive={false} />)}
        {outcome === 'declined' && signed.declined.length === 0 && <p className="text-text-secondary">You did not approve any of the work.</p>}
        <TotalsBlock rows={[]} total={signed.totalAfter} totalLabel={outcome === 'declined' ? 'Estimate total' : 'Your total'} />
      </section>

      <Fineprint doc={doc} />
      <button type="button" className="btn btn-secondary mt-8" onClick={() => window.print()}><Icon name="print" className="h-5 w-5" />Print or save a copy</button>
    </Frame>
  )
}

/* ───────────────────────── The page ───────────────────────── */

export default function LinkView({ token, page, onReload }: { token: string; page: PublicPage; onReload: () => void }) {
  const doc = page.doc
  const signedView = page.link.state === 'done' && page.signed
  const interactive = !signedView && page.canDecideByJob
  const pending = doc.groups.filter(g => !g.approved)
  const openOptions = doc.options.filter(o => o.status === 'open')

  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => Object.fromEntries(pending.map(g => [g.key, 'approve' as Decision])))
  const [choices, setChoices] = useState<Record<string, string>>(() => Object.fromEntries(openOptions.map(o => [o.id, (o.choices.find(c => c.recommended) ?? o.choices[0]).id])))
  const [preview, setPreview] = useState<Totals | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [name, setName] = useState('')
  const [method, setMethod] = useState<Method>('drawn')
  const [agree, setAgree] = useState(false)
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [stale, setStale] = useState(false)
  const padRef = useRef<SignPadHandle>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const agreeRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  const viewed = useRef(false)

  // The page counts its own view, once it has drawn, so a mail program opening the link does not count as the customer.
  useEffect(() => {
    if (viewed.current || page.link.state !== 'active') return
    viewed.current = true
    const t = window.setTimeout(() => { void post({ action: 'view', token }) }, 800)
    return () => window.clearTimeout(t)
  }, [page.link.state, token])

  // The total if they confirmed right now, worked out by the server so it can never disagree with what is saved.
  useEffect(() => {
    if (!interactive) return
    const mine = ++seq.current
    const t = window.setTimeout(async () => {
      const r = await post({ action: 'preview', token, decisions, options: choices })
      if (mine !== seq.current) return
      const p = r.ok ? (r.data.preview as Totals | null | undefined) : null
      if (p && typeof p.total === 'number') { setPreview(p); setPreviewFailed(false) } else setPreviewFailed(true)
    }, 150)
    return () => window.clearTimeout(t)
  }, [interactive, token, decisions, choices])

  if (signedView) return <SignedCopy page={page} token={token} />

  const approvedJobs = pending.filter(g => decisions[g.key] === 'approve').length
  const declinedJobs = pending.length - approvedJobs
  const takenOptions = openOptions.filter(o => choices[o.id] && choices[o.id] !== 'none').length
  const skippedOptions = openOptions.length - takenOptions
  const acceptsAny = approvedJobs + takenOptions > 0
  const shownTotal = interactive && preview ? preview.total : doc.kind === 'invoice' ? doc.totals.balanceDue : doc.totals.total
  const accent = accentButton(doc.accent)
  const noun = doc.kind

  const lampInfo: { lamp: 'green' | 'amber' | 'red'; text: string } = !doc.canRespond && doc.kind === 'estimate'
    ? { lamp: doc.status === 'Void' ? 'red' : 'amber', text: doc.status === 'Void' ? 'Cancelled' : doc.status === 'Declined' ? 'Declined' : 'Expired' }
    : interactive ? { lamp: 'amber', text: 'Waiting for your answer' }
      : doc.kind === 'invoice' ? { lamp: doc.totals.balanceDue > 0 ? 'amber' : 'green', text: doc.totals.balanceDue > 0 ? 'Balance due' : 'Paid in full' }
        : doc.kind === 'receipt' ? { lamp: 'green', text: 'Paid' }
          : { lamp: 'green', text: 'Approved' }

  const expiryRight = doc.kind === 'estimate' && doc.expiry.words ? <p className={doc.expiry.state === 'expired' || doc.expiry.state === 'today' ? 'font-bold text-red' : 'text-text-secondary'}>{doc.expiry.words}</p> : undefined

  const submit = async () => {
    if (busy) return
    setSubmitError('')
    const found: Errors = {}
    let signatureData = ''
    let finalMethod: 'drawn' | 'typed' | 'click' = method
    if (acceptsAny) {
      if (name.trim().length < 2) found.name = 'Type your full name.'
      if (method === 'drawn') {
        signatureData = padRef.current?.toDataUrl() || ''
        if (!signatureData) {
          if (doc.requireSignature) found.sign = 'Draw your signature in the box, or choose Type my name.'
          else finalMethod = 'click'
        }
      }
      if (!agree) found.agree = 'Check the box to agree before you continue.'
    }
    if (found.name || found.sign || found.agree) {
      setErrors(found)
      if (found.name) nameRef.current?.focus()
      else if (found.sign) padRef.current?.focus()
      else agreeRef.current?.focus()
      return
    }
    setErrors({})
    setBusy(true)
    const r = await post({
      action: 'respond', token, viewHash: doc.contentHash, decisions, options: choices, signerName: name.trim(), method: finalMethod,
      ...(signatureData ? { signatureData } : {}), agree: acceptsAny ? agree : false, note: note.trim(),
    })
    setBusy(false)
    if (r.ok) { onReload(); return }
    const code = String(r.data.code || '')
    if (code === 'done' || code === 'revoked' || code === 'expired' || code === 'closed' || code === 'reload') { onReload(); return }
    if (code === 'changed') setStale(true)
    setSubmitError(String(r.data.error || 'Your answer did not save. Try again.'))
  }

  const buttonText = busy ? 'Saving your answer…'
    : !acceptsAny ? `Decline this ${noun}`
      : declinedJobs + skippedOptions === 0 ? `Approve and sign · ${money(shownTotal)}`
        : `Approve ${approvedJobs + takenOptions} of ${pending.length + openOptions.length} and sign · ${money(shownTotal)}`

  return (
    <Frame shop={page.shop} accent={doc.accent} logoSrc={page.shop.hasLogo ? `/api/sign/logo?t=${encodeURIComponent(token)}` : null} fallbackName="Your auto shop">
      <h1 className="display text-[1.625rem] font-bold leading-tight">{interactive ? `Review your ${noun}` : doc.kind === 'estimate' ? 'Your estimate' : doc.kind === 'invoice' ? 'Your invoice' : 'Your receipt'}</h1>
      <p className="mt-1 text-[0.9375rem] text-text-secondary">
        {interactive
          ? 'Look over each job and its price. Everything starts as approved. Tap Decline on anything you do not want done.'
          : doc.kind === 'invoice' ? 'Here is what was done and what is owed.' : doc.kind === 'receipt' ? 'Here is what you paid for.' : 'Here is the work and the price.'}
      </p>

      <Tag doc={doc} total={shownTotal} lamp={lampInfo.lamp} lampText={lampInfo.text} right={expiryRight} />

      {doc.intro && <p className="mt-5 whitespace-pre-wrap break-words leading-relaxed text-text-secondary">{doc.intro}</p>}
      {!doc.canRespond && doc.closedReason && <Notice kind="warn" className="mt-5">{doc.closedReason} {page.shop.phone && <a href={telHref(page.shop.phone)} className="font-bold text-blue underline underline-offset-4">Call {page.shop.phone}</a>}</Notice>}
      {stale && <Notice kind="warn" className="mt-5">The shop updated this while you were looking. <button type="button" className="font-bold text-blue underline underline-offset-4" onClick={onReload}>Reload to see the latest</button>.</Notice>}

      <section aria-labelledby="work-h" className="mt-8 space-y-4">
        <h2 id="work-h" className="section-title">{interactive ? 'Your jobs' : 'Work and parts'}</h2>
        {doc.groups.map(g => (
          <JobCard
            key={g.key}
            group={g}
            interactive={interactive && !g.approved}
            decision={decisions[g.key]}
            onDecide={v => setDecisions(d => ({ ...d, [g.key]: v }))}
            disabled={busy}
          />
        ))}
        {doc.groups.length === 0 && openOptions.length === 0 && <p className="text-text-secondary">There are no lines on this {noun} yet.</p>}
      </section>

      {openOptions.length > 0 && (
        <section aria-labelledby="options-h" className="mt-8 space-y-4">
          <h2 id="options-h" className="section-title">Your choices</h2>
          {openOptions.map(o => (
            <OptionPicker key={o.id} option={o} value={choices[o.id]} onChange={v => setChoices(c => ({ ...c, [o.id]: v }))} disabled={busy || !interactive} />
          ))}
        </section>
      )}

      <section aria-labelledby="totals-h" className="mt-8">
        <h2 id="totals-h" className="section-title mb-2">{interactive ? 'Your total' : 'Totals'}</h2>
        {interactive && preview ? (
          <TotalsBlock rows={[{ label: 'Before tax', amount: preview.subtotal }, ...(preview.tax > 0 ? [{ label: 'Tax', amount: preview.tax }] : [])]} total={preview.total} totalLabel="Your total" />
        ) : (
          <TotalsBlock
            rows={[...totalRows(doc), ...(doc.totals.amountPaid > 0 ? [{ label: 'Paid so far', amount: doc.totals.amountPaid }] : [])]}
            total={doc.kind === 'invoice' ? doc.totals.balanceDue : doc.totals.total}
            totalLabel={doc.kind === 'invoice' ? 'Balance due' : 'Total'}
          />
        )}
        {interactive && previewFailed && <p className="mt-2 text-right text-[0.8125rem] text-text-secondary">The total could not be updated just now. The shop checks it when you confirm.</p>}
        {doc.kind === 'invoice' && <PaySlot balanceDue={doc.totals.balanceDue} deposit={doc.totals.deposit} token={token} />}
      </section>

      <Fineprint doc={doc} />

      {interactive && (
        <section aria-labelledby="sign-h" className="panel mt-8 p-4 sm:p-5">
          <h2 id="sign-h" className="section-title">{acceptsAny ? 'Sign to confirm' : 'Confirm your answer'}</h2>
          <p className="mt-1 text-[0.9375rem] text-text-secondary">
            {acceptsAny
              ? declinedJobs + skippedOptions === 0
                ? `You are approving all of the work, for ${money(shownTotal)}.`
                : `You are approving ${approvedJobs + takenOptions} and declining ${declinedJobs + skippedOptions}. Your total is ${money(shownTotal)}.`
              : `You are declining everything. Nothing will be done and nothing is owed.`}
          </p>

          {acceptsAny && (
            <>
              <div className="mt-4">
                <label htmlFor="sign-name" className="form-label">Your full name</label>
                <input
                  ref={nameRef} id="sign-name" type="text" autoComplete="name" placeholder="First and last name"
                  className={`form-input ${errors.name ? 'border-red' : ''}`} value={name}
                  onChange={e => { setName(e.target.value); if (errors.name) setErrors(p => ({ ...p, name: undefined })) }}
                  aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? 'sign-name-error' : undefined}
                />
                {errors.name && <p id="sign-name-error" className="form-error">{errors.name}</p>}
              </div>

              <div className="mt-5" role="group" aria-label="How you want to sign">
                <div className="flex gap-2">
                  {(['drawn', 'typed'] as Method[]).map(m => (
                    <button key={m} type="button" aria-pressed={method === m} onClick={() => { setMethod(m); setErrors(p => ({ ...p, sign: undefined })) }} disabled={busy}
                      className={`flex min-h-[44px] flex-1 items-center justify-center rounded-md border-2 px-3 text-[0.9375rem] font-bold ${method === m ? 'border-blue bg-blue/10 text-blue' : 'border-line bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>
                      {m === 'drawn' ? 'Draw my signature' : 'Type my name'}
                    </button>
                  ))}
                </div>
                {method === 'drawn' ? (
                  <div className="mt-3">
                    <SignPad ref={padRef} invalid={!!errors.sign} disabled={busy} describedBy={errors.sign ? 'pad-error' : 'pad-hint'} onInk={() => setErrors(p => ({ ...p, sign: undefined }))} />
                    {errors.sign ? <p id="pad-error" className="form-error">{errors.sign}</p> : <p id="pad-hint" className="form-hint">Use your finger or your mouse. Tap Clear to start over.</p>}
                  </div>
                ) : (
                  <p className="mt-3 rounded-md border border-border bg-bg-card px-3 py-3 text-[0.9375rem] text-text-secondary">Your typed name above counts as your signature.</p>
                )}
              </div>

              <div className="mt-5">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    ref={agreeRef} type="checkbox" checked={agree} disabled={busy}
                    onChange={e => { setAgree(e.target.checked); if (errors.agree) setErrors(p => ({ ...p, agree: undefined })) }}
                    className="mt-0.5 h-6 w-6 shrink-0 cursor-pointer accent-blue" aria-invalid={errors.agree ? true : undefined} aria-describedby={errors.agree ? 'agree-error' : undefined}
                  />
                  <span className="text-[0.9375rem] leading-relaxed">
                    I, <strong>{name.trim() || 'the person signing'}</strong>, agree that this electronic signature is the legal equivalent of my handwritten signature. I approve the work and prices I left selected above.
                  </span>
                </label>
                {errors.agree && <p id="agree-error" className="form-error">{errors.agree}</p>}
              </div>
            </>
          )}

          <div className="mt-5">
            <label htmlFor="sign-note" className="form-label">Anything the shop should know? <span className="font-normal text-text-secondary">(optional)</span></label>
            <textarea id="sign-note" className="form-input min-h-[72px]" maxLength={2000} value={note} onChange={e => setNote(e.target.value)} disabled={busy} />
          </div>

          {submitError && <Notice kind="error" className="mt-5">{submitError}</Notice>}

          <button
            type="button" onClick={submit} disabled={busy} aria-busy={busy}
            className={`${acceptsAny ? accent.className : 'btn btn-secondary btn-lg w-full'} mt-5`} style={acceptsAny ? accent.style : undefined}
          >
            {busy ? <><ButtonSpinner /> {buttonText}</> : buttonText}
          </button>
          <p className="mt-3 text-center text-[0.875rem] text-text-muted">You can see and keep your signed copy right after.</p>
        </section>
      )}

      <AskShop token={token} defaultName={name} />
      <p className="mt-6 text-center text-[0.875rem] text-text-muted">{page.shop.name ? `${page.shop.name} · ` : ''}Private link made for {doc.customerName || 'you'}</p>
    </Frame>
  )
}
