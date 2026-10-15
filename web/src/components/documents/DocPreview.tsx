'use client'
/* The signature is a data URL image, so a plain img tag is correct here. */
/* eslint-disable @next/next/no-img-element */
import { Fragment } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { phonePretty } from '@/lib/today'
import { getLaborFlatAmount, laborLineTotal, partLineTotal, quantityFromUnknown, nonNegativeMoney } from '@/lib/document-money'
import { GENERAL_JOB_KEY, displayLines, groupJobs, lineSavings, partKind } from '@/lib/doc-lines'
import type { DisplayLine } from '@/lib/doc-lines'
import { discountSummary } from '@/lib/doc-pricing'
import { isHexColor, readableOn } from '@/lib/doc-prefs'
import { warrantyHeadline } from '@/lib/doc-warranty'
import { expiryWords } from '@/lib/doc-approval'
import { fmtDate } from './types'
import type { Doc, Line, Totals } from './types'

const escapeTitle = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || c)

/* Print the preview on a single letter page. */
export function printPreview(title: string) {
  // Print the preview, forced onto a SINGLE letter page.
  const el = document.getElementById('doc-preview-panel')
  if (!el) return
  const w = window.open('', '_blank', 'width=850,height=1100')
  if (!w) { window.print(); return }
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeTitle(title)}</title><style>
@page { size: letter portrait; margin: 0.35in; }
* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Arial, Helvetica, sans-serif; color: #111; }
table { border-collapse: collapse; }
tr, td, th, thead, table { break-inside: avoid; }
#print-root { margin: 0 auto; }
#print-wrap { width: 7.8in; }
</style></head><body><div id="print-root"><div id="print-wrap">${el.innerHTML}</div></div><script>
(function(){
  var printed = false;
  function fit(){
    var root = document.getElementById('print-root');
    var wrap = document.getElementById('print-wrap');
    var maxH = 10.2 * 96, maxW = 7.8 * 96;
    var h = wrap.scrollHeight, ww = wrap.scrollWidth;
    // Shrink long docs to fit; also grow short receipts (up to 1.5x) so they
    // fill the page instead of sitting tiny in the corner.
    var scale = Math.min(1.5, maxH / h, maxW / ww);
    wrap.style.transformOrigin = 'top left';
    wrap.style.transform = 'scale(' + scale + ')';
    root.style.height = Math.ceil(h * scale) + 'px';
    root.style.width = Math.ceil(ww * scale) + 'px';
  }
  function go(){ if (printed) return; printed = true; fit(); setTimeout(function(){ window.focus(); window.print(); window.close(); }, 200); }
  var imgs = document.images, n = imgs.length, done = 0;
  if (!n) { go(); } else {
    for (var i = 0; i < n; i++) {
if (imgs[i].complete) { if (++done === n) go(); }
else { imgs[i].onload = imgs[i].onerror = function(){ if (++done === n) go(); }; }
    }
  }
  setTimeout(go, 1500);
})();
<\/script></body></html>`
  w.document.write(doc)
  w.document.close()
}

// Paper is always white with dark ink, so these colours are fixed on purpose and do not follow dark mode.
const INK = '#111111'
const MUTED = '#555555'
const FAINT = '#777777'
const RULE = '#e5e5e5'
const WASH = '#f8f8f8'
const DEFAULT_BAND = '#1a1a2e'

const label = { fontSize: '11px', fontWeight: 700, color: FAINT, marginBottom: '2px' } as const
const th = { padding: '6px 8px', fontWeight: 700, fontSize: '11px', color: MUTED } as const

export interface PaperPrefs { intro?: string; terms?: string; footer?: string; accent?: string }

/**
 * The paper version of the document: what gets printed, saved as a PDF and shown on screen as a preview.
 * Lines grouped into jobs print as one section per job; a document with no jobs prints parts and labor
 * as it always has.
 */
export function DocPreview({ form, type, totals, shopName, shopAddress, shopPhone, shopEmail, paymentMethods, logo, signatureImg, signedLine, formatWarrantyText, prefs, todayIso }: {
  form: Partial<Doc>; type: string; totals: Totals
  shopName: string; shopAddress: string; shopPhone: string; shopEmail: string
  /** Shown in the footer when the document does not carry its own list. */
  paymentMethods?: string
  /** The shop's logo as a data URL; the header is text only without one. */
  logo?: string | null
  signatureImg: string | null
  /** For example "Signed by Pat Doe on Oct 12, 2026 at 3:41 PM · record 3fa81c20d4be". */
  signedLine?: string
  formatWarrantyText: (v: unknown) => string
  prefs?: PaperPrefs
  todayIso?: string
}) {
  const fmt = (d: string) => fmtDate(d)
  const rec = form as Record<string, unknown>
  const band = prefs?.accent && isHexColor(prefs.accent) ? prefs.accent : DEFAULT_BAND
  const onBand = readableOn(band)
  const bandMuted = onBand === '#ffffff' ? '#d4d4d8' : '#3f3f46'
  const parts = (form.parts || []) as Line[]
  const labors = (form.labors || []) as Line[]
  const doc = { ...rec, parts, labors }
  const groups = groupJobs(doc)
  const grouped = groups.some(g => g.key !== GENERAL_JOB_KEY)
  const saved = discountSummary(doc)
  const isEstimate = type === 'Estimate'
  const status = String(form.status || '')
  const dateWords = isEstimate
    ? (form.expires_date ? (todayIso ? expiryWords(form.expires_date, todayIso) : `Good through ${fmt(String(form.expires_date).slice(0, 10))}`) : '')
    : (form.due_date ? `Due ${fmt(String(form.due_date).slice(0, 10))}` : '')

  const isFlatLabor = (line: Line) => getLaborFlatAmount(line) !== null
  const noteRow = (note: unknown, cols: number) => (String(note || '').trim()
    ? <tr><td colSpan={cols} style={{ padding: '0 8px 6px', color: MUTED, fontSize: '11px', whiteSpace: 'pre-wrap' }}>{String(note)}</td></tr> : null)
  const money = (n: number) => formatCurrency(n)

  const renderGroupRow = (l: DisplayLine, i: number) => (
    <Fragment key={`g${i}`}>
      <tr style={{ background: i % 2 === 1 ? '#fafafa' : 'transparent' }}>
        <td style={{ padding: '6px 8px', color: INK }}>
          {l.description}
          {l.kind === 'fee' && <span style={{ color: FAINT, fontSize: '11px', marginLeft: '4px' }}>(fee)</span>}
          {l.kind === 'sublet' && <span style={{ color: FAINT, fontSize: '11px', marginLeft: '4px' }}>(outside work)</span>}
          {l.detail && <span style={{ color: FAINT, fontSize: '11px', display: 'block' }}>{l.detail}</span>}
          {l.warranty && <span style={{ color: '#2563eb', fontSize: '11px', display: 'block', fontWeight: 600 }}>Warranty: {l.warranty}</span>}
        </td>
        <td style={{ padding: '6px 8px', textAlign: 'right', color: INK, fontWeight: 600, whiteSpace: 'nowrap' }}>
          {l.listTotal > l.total && <span style={{ display: 'block', color: FAINT, fontWeight: 400, textDecoration: 'line-through', fontSize: '11px' }}>{money(l.listTotal)}</span>}
          {money(l.total)}
        </td>
      </tr>
      {noteRow(l.note, 2)}
    </Fragment>
  )

  return (
    <div id="doc-preview-panel" className="relative overflow-hidden rounded-lg border border-border" style={{ fontFamily: 'Arial,Helvetica,sans-serif', background: '#fff', color: INK }}>
      {status === 'Void' && (
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 2 }}>
          <span style={{ transform: 'rotate(-24deg)', fontSize: '84px', fontWeight: 800, color: 'rgba(185,28,28,0.18)', letterSpacing: '0.08em' }}>VOID</span>
        </div>
      )}

      {/* Header */}
      <div style={{ background: band, padding: '20px 28px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
        {logo && <img src={logo} alt="" width={68} height={68} style={{ width: '68px', height: '68px', flex: 'none', objectFit: 'contain', background: '#fff', borderRadius: '12px', padding: '3px' }} />}
        <div style={{ textAlign: logo ? 'left' : 'center' }}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: onBand }}>{shopName || 'Your shop'}</h2>
          {(shopAddress || shopPhone) && <p style={{ margin: '4px 0 0', fontSize: '11px', color: bandMuted }}>{[shopAddress, shopPhone && phonePretty(shopPhone)].filter(Boolean).join('  ·  ')}</p>}
        </div>
      </div>

      {/* Doc type + number */}
      <div style={{ textAlign: 'center', padding: '16px 28px 12px' }}>
        <span style={{ display: 'inline-block', border: `2px solid ${band}`, color: INK, padding: '3px 18px', borderRadius: '999px', fontWeight: 700, fontSize: '13px' }}>{type}</span>
        <div style={{ fontSize: '12px', color: MUTED, marginTop: '6px' }}>#{form.doc_number} &nbsp;·&nbsp; {fmt(form.doc_date || '')}{dateWords ? <> &nbsp;·&nbsp; {dateWords}</> : null}</div>
      </div>

      {/* Customer / Vehicle info */}
      <div style={{ padding: '0 28px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px', borderBottom: `1px solid ${RULE}` }}>
        <div>
          <div style={label}>Customer</div>
          <div style={{ fontWeight: 600, color: INK }}>{form.customer_name || '—'}</div>
          {form.customer_phone && <div style={{ color: MUTED, fontSize: '11px' }}>{phonePretty(form.customer_phone)}</div>}
          {form.customer_email && <div style={{ color: MUTED, fontSize: '11px' }}>{form.customer_email}</div>}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={label}>Vehicle</div>
          <div style={{ fontWeight: 600, color: INK }}>{[form.vehicle_year, form.vehicle_make, form.vehicle_model].filter(Boolean).join(' ') || '—'}</div>
          {form.vehicle_mileage && <div style={{ color: MUTED, fontSize: '11px' }}>{Number(form.vehicle_mileage).toLocaleString()} miles</div>}
          {form.vehicle_vin && <div style={{ color: MUTED, fontSize: '11px' }}>VIN: {form.vehicle_vin}</div>}
          {form.vehicle_plate && <div style={{ color: MUTED, fontSize: '11px' }}>Plate: {form.vehicle_plate}</div>}
        </div>
      </div>

      {prefs?.intro?.trim() && (
        <div style={{ padding: '12px 28px 0' }}>
          <p style={{ margin: 0, fontSize: '12px', color: MUTED, whiteSpace: 'pre-wrap' }}>{prefs.intro}</p>
        </div>
      )}

      {grouped ? (
        /* One section per job, each with its own subtotal */
        <div style={{ padding: '8px 28px 8px' }}>
          {groups.map(g => {
            const rows = displayLines(doc).filter(l => l.jobKey === g.key)
            if (rows.length === 0) return null
            return (
              <div key={g.key} style={{ marginTop: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: `2px solid ${band}`, padding: '4px 8px', fontSize: '13px', fontWeight: 700 }}>
                  <span>{g.name}</span><span>{money(g.subtotal)}</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <tbody>{rows.map((l, i) => renderGroupRow(l, i))}</tbody>
                </table>
              </div>
            )
          })}
        </div>
      ) : (
        <>
          {parts.length > 0 && (
            <div style={{ padding: '16px 28px 8px' }}>
              <div style={{ ...label, marginBottom: '8px' }}>Parts</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: WASH }}>
                    <th style={{ ...th, textAlign: 'left' }}>Description</th>
                    <th style={{ ...th, textAlign: 'center', width: '40px' }}>Qty</th>
                    <th style={{ ...th, textAlign: 'right', width: '80px' }}>Unit price</th>
                    <th style={{ ...th, textAlign: 'right', width: '80px' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {parts.map((p, i) => {
                    const kind = partKind(p)
                    const savedHere = lineSavings(p, 'part')
                    return (
                      <Fragment key={i}>
                        <tr style={{ background: i % 2 === 1 ? '#fafafa' : 'transparent' }}>
                          <td style={{ padding: '6px 8px', color: INK }}>
                            {(p.name as string) || '—'}
                            {kind === 'fee' && <span style={{ color: FAINT, fontSize: '11px', marginLeft: '4px' }}>(fee)</span>}
                            {kind === 'sublet' && <span style={{ color: FAINT, fontSize: '11px', marginLeft: '4px' }}>(outside work)</span>}
                            {p.brand ? <span style={{ color: FAINT, fontSize: '11px', marginLeft: '4px' }}>({p.brand as string})</span> : ''}
                            {p.warranty ? <span style={{ color: '#2563eb', fontSize: '11px', display: 'block', fontWeight: 600 }}>Warranty: {p.warranty as string}</span> : ''}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: MUTED }}>{quantityFromUnknown(p.qty)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: MUTED }}>
                            {savedHere > 0 && <span style={{ display: 'block', color: FAINT, textDecoration: 'line-through', fontSize: '11px' }}>{money(nonNegativeMoney(p.listPrice))}</span>}
                            {money(nonNegativeMoney(p.unitPrice))}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: INK }}>{money(partLineTotal(p))}</td>
                        </tr>
                        {noteRow(p.note, 4)}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {labors.length > 0 && (
            <div style={{ padding: '12px 28px 8px' }}>
              <div style={{ ...label, marginBottom: '8px' }}>Labor</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr style={{ background: WASH }}>
                    <th style={{ ...th, textAlign: 'left' }}>Operation</th>
                    <th style={{ ...th, textAlign: 'center', width: '50px' }}>Hours</th>
                    <th style={{ ...th, textAlign: 'right', width: '80px' }}>Rate</th>
                    <th style={{ ...th, textAlign: 'right', width: '80px' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {labors.map((l, i) => {
                    const savedHere = lineSavings(l, 'labor')
                    return (
                      <Fragment key={i}>
                        <tr style={{ background: i % 2 === 1 ? '#fafafa' : 'transparent' }}>
                          <td style={{ padding: '6px 8px', color: INK }}>{(l.operation as string) || '—'}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', color: MUTED }}>{isFlatLabor(l) ? 'Flat' : ((l.hours as number) || 0)}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', color: MUTED }}>
                            {savedHere > 0 && !isFlatLabor(l) && <span style={{ display: 'block', color: FAINT, textDecoration: 'line-through', fontSize: '11px' }}>{money(nonNegativeMoney(l.listRate))}/hr</span>}
                            {isFlatLabor(l) ? 'Flat' : `${money(Number(l.rate) || 0)}/hr`}
                          </td>
                          <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: INK }}>
                            {savedHere > 0 && <span style={{ display: 'block', color: FAINT, textDecoration: 'line-through', fontSize: '11px', fontWeight: 400 }}>{money(laborLineTotal(l) + savedHere)}</span>}
                            {money(laborLineTotal(l))}
                          </td>
                        </tr>
                        {noteRow(l.note, 4)}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Totals */}
      {totals && (
        <div style={{ padding: '16px 28px', background: '#f9f9f9', borderTop: `1px solid ${RULE}` }}>
          {[
            ['Parts subtotal', totals.partsTotal, true],
            ['Labor subtotal', totals.laborTotal, true],
            ['Core charges (refundable)', totals.coreTotal, totals.coreTotal > 0],
            ['Shop supplies', Number(form.shop_supplies) || 0, Number(form.shop_supplies) > 0],
            ['Sublet', totals.sublet, totals.sublet > 0],
          ].filter(r => r[2]).map(r => (
            <div key={String(r[0])} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '12px', color: MUTED }}>
              <span>{String(r[0])}</span><span>{money(Number(r[1]))}</span>
            </div>
          ))}
          {saved.total > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '12px', color: '#15803d' }}>
              <span>Discounts included above</span><span>{money(saved.total)} saved</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '12px', color: MUTED }}>
            <span>{totals.applyTax ? `Tax (${totals.taxRate}%)` : 'Tax (not charged)'}</span><span>{money(totals.taxAmount)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 4px', fontSize: '16px', fontWeight: 700, color: INK, borderTop: `2px solid ${INK}`, marginTop: '6px' }}>
            <span>Total</span><span>{money(totals.total)}</span>
          </div>
          {Number(form.deposit) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: '12px', color: MUTED }}>
              <span>Deposit recorded</span><span>{money(Number(form.deposit))}</span>
            </div>
          )}
          {!isEstimate && (status === 'Paid' ? (
            <div style={{ textAlign: 'center', marginTop: '12px' }}>
              <span style={{ display: 'inline-block', border: '3px solid #16a34a', color: '#16a34a', padding: '4px 24px', borderRadius: '4px', fontWeight: 800, fontSize: '18px', transform: 'rotate(-3deg)', opacity: 0.85 }}>PAID</span>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0 0', fontSize: '14px', fontWeight: 700, color: '#b91c1c' }}>
              <span>Balance due</span><span>{money(totals.balanceDue)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      {form.notes && (
        <div style={{ padding: '12px 28px', borderTop: `1px solid ${RULE}` }}>
          <div style={{ ...label, marginBottom: '4px' }}>Notes</div>
          <p style={{ fontSize: '11px', color: MUTED, margin: 0, whiteSpace: 'pre-wrap' }}>{form.notes}</p>
        </div>
      )}

      {/* Warranty box */}
      {form.warranty_type && form.warranty_type !== 'No Warranty' && form.warranty_type !== 'State Inspection — No Warranty' && (
        <div style={{ margin: '0 28px 16px', padding: '14px 16px', border: '1.5px solid #3b82f6', borderRadius: '8px', background: '#eff6ff' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e40af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21.5s8-3.8 8-10v-6l-8-3-8 3v6c0 6.2 8 10 8 10z" /></svg>
            <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e40af' }}>Warranty coverage</span>
          </div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: INK, marginBottom: '4px' }}>{form.warranty_type}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '11px', color: MUTED }}>
            {(Number(form.warranty_months) > 0 || Number(form.warranty_mileage) > 0) && <div>Covers: <strong>{warrantyHeadline(form.warranty_months, form.warranty_mileage)}</strong></div>}
            {form.warranty_start && <div>Starts: <strong>{fmt(form.warranty_start)}</strong></div>}
            {form.warranty_start && Number(form.warranty_months) > 0 && (() => {
              const start = new Date(form.warranty_start + 'T00:00:00')
              start.setMonth(start.getMonth() + Number(form.warranty_months))
              return <div>Ends: <strong>{start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</strong></div>
            })()}
          </div>
          {form.warranty_exclusions && (
            <div style={{ marginTop: '8px', fontSize: '10px', color: '#444', lineHeight: '1.45', borderTop: '1px solid #bfdbfe', paddingTop: '8px', whiteSpace: 'pre-wrap' }}>
              {formatWarrantyText(form.warranty_exclusions)}
            </div>
          )}
          <div style={{ marginTop: '10px', fontSize: '10px', color: '#666', lineHeight: '1.4', borderTop: '1px solid #bfdbfe', paddingTop: '8px' }}>
            Warranty claims go to {shopName || 'the shop'}{shopAddress ? ` at ${shopAddress}` : ''}. {shopPhone ? `Call ${phonePretty(shopPhone)} before any warranty repair is started.` : 'Contact the shop before any warranty repair is started.'}
          </div>
        </div>
      )}

      {prefs?.terms?.trim() && (
        <div style={{ padding: '12px 28px', borderTop: `1px solid ${RULE}` }}>
          <div style={{ ...label, marginBottom: '4px' }}>Terms</div>
          <p style={{ fontSize: '10px', color: MUTED, margin: 0, whiteSpace: 'pre-wrap', lineHeight: '1.45' }}>{prefs.terms}</p>
        </div>
      )}

      {signatureImg && (
        <div style={{ padding: '16px 28px', borderTop: `1px solid ${RULE}`, textAlign: 'center' }}>
          <div style={{ ...label, marginBottom: '8px' }}>Customer signature</div>
          <img src={signatureImg} alt="Signature" style={{ maxWidth: 220, maxHeight: 80, margin: '0 auto' }} />
          {form.signature_signer_name && <div style={{ fontSize: '11px', color: MUTED, marginTop: '4px' }}>{form.signature_signer_name}</div>}
          {signedLine ? <div style={{ fontSize: '10px', color: FAINT }}>{signedLine}</div> : form.signature_signed_at ? <div style={{ fontSize: '10px', color: FAINT }}>{new Date(form.signature_signed_at).toLocaleString()}</div> : null}
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '12px 28px', textAlign: 'center', fontSize: '10px', color: FAINT, borderTop: `1px solid ${RULE}`, background: '#fafafa' }}>
        <div>Payment terms: {form.payment_terms || 'Due on receipt'}{(form.payment_methods || paymentMethods) ? <> &nbsp;|&nbsp; Accepted: {form.payment_methods || paymentMethods}</> : null}</div>
        <div style={{ marginTop: '4px' }}>{[shopPhone && phonePretty(shopPhone), shopEmail].filter(Boolean).join('  ·  ')}</div>
        {prefs?.footer?.trim() && <div style={{ marginTop: '4px', whiteSpace: 'pre-wrap' }}>{prefs.footer}</div>}
      </div>
    </div>
  )
}
