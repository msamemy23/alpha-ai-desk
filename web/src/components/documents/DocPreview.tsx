'use client'
/* The signature is a data URL image, so a plain img tag is correct here. */
/* eslint-disable @next/next/no-img-element */
import { formatCurrency } from '@/lib/supabase'
import { phonePretty } from '@/lib/today'
import { getLaborFlatAmount, laborLineTotal, partLineTotal, quantityFromUnknown, nonNegativeMoney } from '@/lib/document-money'
import { fmtDate } from './types'
import type { Doc, Line, Totals } from './types'

/* Print the preview on a single letter page. */
export function printPreview(title: string) {
  // Print the preview, forced onto a SINGLE letter page.
  const el = document.getElementById('doc-preview-panel')
  if (!el) return
  const w = window.open('', '_blank', 'width=850,height=1100')
  if (!w) { window.print(); return }
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
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

/**
 * The paper version of the document: what gets printed, saved as a PDF and shown on screen as a preview.
 * Paper is always white with dark ink, so its colours are fixed on purpose and do not follow dark mode.
 */
export function DocPreview({ form, type, totals, shopName, shopAddress, shopPhone, shopEmail, paymentMethods, signatureImg, formatWarrantyText }: {
  form: Partial<Doc>; type: string; totals: Totals
  shopName: string; shopAddress: string; shopPhone: string; shopEmail: string
  /** Shown in the footer when the document does not carry its own list. */
  paymentMethods?: string
  signatureImg: string | null
  formatWarrantyText: (v: unknown) => string
}) {
  const fmt = (d: string) => fmtDate(d)
  const isFlatLabor = (line: Line) => getLaborFlatAmount(line) !== null
  return (
    <div id="doc-preview-panel" className="overflow-hidden rounded-lg border border-border" style={{fontFamily:'Arial,Helvetica,sans-serif',background:'#fff',color:'#111'}}>
      {/* Header */}
      <div style={{background:'#1a1a2e',padding:'24px 28px',textAlign:'center'}}>
        <h2 style={{margin:0,fontSize:'18px',fontWeight:700,color:'#fff',letterSpacing:'0.5px'}}>{shopName || 'Your shop'}</h2>
        {(shopAddress || shopPhone) && <p style={{margin:'4px 0 0',fontSize:'11px',color:'#9ca3af'}}>{[shopAddress, shopPhone].filter(Boolean).join('  ·  ')}</p>}
      </div>

      {/* Doc type badge + info */}
      <div style={{textAlign:'center',padding:'16px 28px 12px'}}>
        <span style={{display:'inline-block',background:'#e67e22',color:'#fff',padding:'4px 18px',borderRadius:'999px',fontWeight:700,fontSize:'11px',textTransform:'uppercase',letterSpacing:'0.08em'}}>{type}</span>
        <div style={{fontSize:'12px',color:'#666',marginTop:'6px'}}>#{form.doc_number} &nbsp;·&nbsp; {fmt(form.doc_date || '')}</div>
      </div>

      {/* Customer / Vehicle info */}
      <div style={{padding:'0 28px 16px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px',fontSize:'12px',borderBottom:'1px solid #eee'}}>
        <div>
          <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#999',marginBottom:'2px'}}>Customer</div>
          <div style={{fontWeight:600,color:'#111'}}>{form.customer_name || '—'}</div>
                          {(form as Record<string,string>).customer_phone && <div style={{color:'#666',fontSize:'11px'}}>{phonePretty((form as Record<string,string>).customer_phone)}</div>}
        {(form as Record<string,string>).customer_email && <div style={{color:'#666',fontSize:'11px'}}>{(form as Record<string,string>).customer_email}</div>}
        </div>
        <div style={{textAlign:'right'}}>
          <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#999',marginBottom:'2px'}}>Vehicle</div>
          <div style={{fontWeight:600,color:'#111'}}>{[form.vehicle_year,form.vehicle_make,form.vehicle_model].filter(Boolean).join(' ') || '—'}</div>
          {form.vehicle_mileage && <div style={{color:'#666',fontSize:'11px'}}>{Number(form.vehicle_mileage).toLocaleString()} miles</div>}
          {(form as Record<string,string>).vehicle_vin && <div style={{color:'#666',fontSize:'11px'}}>VIN: {(form as Record<string,string>).vehicle_vin}</div>}
          {(form as Record<string,string>).vehicle_plate && <div style={{color:'#666',fontSize:'11px'}}>Plate: {(form as Record<string,string>).vehicle_plate}</div>}
        </div>
      </div>

      {/* Parts table */}
      {((form.parts||[]) as Record<string,unknown>[]).length > 0 && (
        <div style={{padding:'16px 28px 8px'}}>
          <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#999',marginBottom:'8px'}}>Parts</div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
            <thead>
              <tr style={{background:'#f8f8f8'}}>
                <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666'}}>Description</th>
                <th style={{padding:'6px 8px',textAlign:'center',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'40px'}}>Qty</th>
                <th style={{padding:'6px 8px',textAlign:'right',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'80px'}}>Unit Price</th>
                <th style={{padding:'6px 8px',textAlign:'right',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'80px'}}>Total</th>
              </tr>
            </thead>
            <tbody>
              {((form.parts||[]) as Record<string,unknown>[]).map((p,i) => (
                <tr key={i} style={{background:i%2===1?'#fafafa':'transparent'}}>
                  <td style={{padding:'6px 8px',color:'#111'}}>{(p.name as string) || '—'}{p.brand ? <span style={{color:'#999',fontSize:'10px',marginLeft:'4px'}}>({p.brand as string})</span> : ''}{p.warranty ? <span style={{color:'#2563eb',fontSize:'9px',display:'block',fontWeight:600}}>Warranty: {p.warranty as string}</span> : ''}</td>
                  <td style={{padding:'6px 8px',textAlign:'center',color:'#666'}}>{quantityFromUnknown(p.qty)}</td>
                  <td style={{padding:'6px 8px',textAlign:'right',color:'#666'}}>{formatCurrency(nonNegativeMoney(p.unitPrice))}</td>
                  <td style={{padding:'6px 8px',textAlign:'right',fontWeight:600,color:'#111'}}>{formatCurrency(partLineTotal(p))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Labor table */}
      {((form.labors||[]) as Record<string,unknown>[]).length > 0 && (
        <div style={{padding:'12px 28px 8px'}}>
          <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#999',marginBottom:'8px'}}>Labor</div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
            <thead>
              <tr style={{background:'#f8f8f8'}}>
                <th style={{padding:'6px 8px',textAlign:'left',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666'}}>Operation</th>
                <th style={{padding:'6px 8px',textAlign:'center',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'50px'}}>Hours</th>
                <th style={{padding:'6px 8px',textAlign:'right',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'80px'}}>Rate</th>
                <th style={{padding:'6px 8px',textAlign:'right',fontWeight:600,fontSize:'10px',textTransform:'uppercase',color:'#666',width:'80px'}}>Total</th>
              </tr>
            </thead>
            <tbody>
              {((form.labors||[]) as Record<string,unknown>[]).map((l,i) => (
                <tr key={i} style={{background:i%2===1?'#fafafa':'transparent'}}>
                  <td style={{padding:'6px 8px',color:'#111'}}>{(l.operation as string) || '—'}</td>
                  <td style={{padding:'6px 8px',textAlign:'center',color:'#666'}}>{isFlatLabor(l) ? 'Flat' : ((l.hours as number)||0)}</td>
                  <td style={{padding:'6px 8px',textAlign:'right',color:'#666'}}>{isFlatLabor(l) ? 'Flat' : `${formatCurrency(Number(l.rate)||0)}/hr`}</td>
                  <td style={{padding:'6px 8px',textAlign:'right',fontWeight:600,color:'#111'}}>{formatCurrency(laborLineTotal(l))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Totals */}
      {totals && (
        <div style={{padding:'16px 28px',background:'#f9f9f9',borderTop:'1px solid #eee'}}>
          <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
            <span>Parts Subtotal</span><span>{formatCurrency(totals.partsTotal)}</span>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
            <span>Labor Subtotal</span><span>{formatCurrency(totals.laborTotal)}</span>
          </div>
          {totals.coreTotal > 0 && (
            <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
              <span>Core Charges (refundable)</span><span>{formatCurrency(totals.coreTotal)}</span>
            </div>
          )}
          {Number(form.shop_supplies) > 0 && (
            <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
              <span>Shop Supplies</span><span>{formatCurrency(Number(form.shop_supplies))}</span>
            </div>
          )}
          {totals.sublet > 0 && (
            <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
              <span>Sublet</span><span>{formatCurrency(totals.sublet)}</span>
            </div>
          )}
          <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
            <span>Tax ({totals.taxRate}%)</span><span>{formatCurrency(totals.taxAmount)}</span>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0 4px',fontSize:'16px',fontWeight:700,color:'#111',borderTop:'2px solid #111',marginTop:'6px'}}>
            <span>TOTAL</span><span>{formatCurrency(totals.total)}</span>
          </div>
          {Number(form.deposit) > 0 && (
            <div style={{display:'flex',justifyContent:'space-between',padding:'3px 0',fontSize:'12px',color:'#555'}}>
              <span>Deposit recorded</span><span>{formatCurrency(Number(form.deposit))}</span>
            </div>
          )}
          {form.status === 'Paid' ? (
            <div style={{textAlign:'center',marginTop:'12px'}}>
              <span style={{display:'inline-block',border:'3px solid #16a34a',color:'#16a34a',padding:'4px 24px',borderRadius:'4px',fontWeight:800,fontSize:'18px',letterSpacing:'0.1em',transform:'rotate(-3deg)',opacity:0.85}}>PAID</span>
            </div>
          ) : (
            <div style={{display:'flex',justifyContent:'space-between',padding:'6px 0 0',fontSize:'14px',fontWeight:700,color:'#dc2626'}}>
              <span>Balance Due</span><span>{formatCurrency(totals.balanceDue)}</span>
            </div>
          )}
        </div>
      )}

      {/* Notes */}
      {form.notes && (
        <div style={{padding:'12px 28px',borderTop:'1px solid #eee'}}>
          <div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#999',marginBottom:'4px'}}>Notes</div>
          <p style={{fontSize:'11px',color:'#555',margin:0,whiteSpace:'pre-wrap'}}>{form.notes}</p>
        </div>
      )}

      {/* Warranty box */}
      {form.warranty_type && form.warranty_type !== 'No Warranty' && form.warranty_type !== 'State Inspection — No Warranty' && (
        <div style={{margin:'0 28px 16px',padding:'14px 16px',border:'1.5px solid #3b82f6',borderRadius:'8px',background:'#eff6ff'}}>
          <div style={{display:'flex',alignItems:'center',gap:'6px',marginBottom:'8px'}}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1e40af" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 21.5s8-3.8 8-10v-6l-8-3-8 3v6c0 6.2 8 10 8 10z" /></svg>
            <span style={{fontSize:'12px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.05em',color:'#1e40af'}}>Warranty Coverage</span>
          </div>
          <div style={{fontSize:'12px',fontWeight:600,color:'#111',marginBottom:'4px'}}>{form.warranty_type}</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px',fontSize:'11px',color:'#555'}}>
            {Number(form.warranty_months) > 0 && <div>Duration: <strong>{form.warranty_months} months</strong></div>}
            {Number(form.warranty_mileage) > 0 && <div>Mileage: <strong>{Number(form.warranty_mileage).toLocaleString()} miles</strong></div>}
            {form.warranty_start && <div>Start: <strong>{fmt(form.warranty_start)}</strong></div>}
            {form.warranty_start && Number(form.warranty_months) > 0 && (() => {
              const start = new Date(form.warranty_start + 'T00:00:00')
              start.setMonth(start.getMonth() + Number(form.warranty_months))
              return <div>Expires: <strong>{start.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</strong></div>
            })()}
          </div>
          {form.warranty_exclusions && (
            <div style={{marginTop:'8px',fontSize:'10px',color:'#666',lineHeight:'1.4',borderTop:'1px solid #bfdbfe',paddingTop:'8px'}}>
              <strong>Exclusions:</strong> {formatWarrantyText(form.warranty_exclusions)}
            </div>
          )}
          <div style={{marginTop:'10px',fontSize:'9px',color:'#888',lineHeight:'1.4',borderTop:'1px solid #bfdbfe',paddingTop:'8px'}}>
            All warranty claims must be submitted to {shopName || 'the shop'}{shopAddress ? ` at ${shopAddress}` : ''} during normal business hours. {shopPhone ? `Contact ${shopPhone} before beginning any warranty repair.` : 'Contact the shop before beginning any warranty repair.'} Unauthorized repairs will void this warranty. This warranty is governed by the laws of the State of Texas.
          </div>
        </div>
      )}

      {signatureImg && (<div style={{padding:'16px 28px',borderTop:'1px solid #eee',textAlign:'center'}}><div style={{fontSize:'10px',fontWeight:700,textTransform:'uppercase',letterSpacing:'0.08em',color:'#999',marginBottom:'8px'}}>Customer Signature</div>{/* a signature is a data URL, so a plain img is right */}<img src={signatureImg} alt="Signature" style={{maxWidth:220,maxHeight:80,margin:'0 auto'}} />{form.signature_signer_name && <div style={{fontSize:'11px',color:'#555',marginTop:'4px'}}>{form.signature_signer_name}</div>}{form.signature_signed_at && <div style={{fontSize:'10px',color:'#999'}}>{new Date(form.signature_signed_at).toLocaleString()}</div>}</div>)}
      {/* Footer */}
      <div style={{padding:'12px 28px',textAlign:'center',fontSize:'10px',color:'#999',borderTop:'1px solid #eee',background:'#fafafa'}}>
        <div>Payment terms: {form.payment_terms || 'Due on receipt'}{(form.payment_methods || paymentMethods) ? <> &nbsp;|&nbsp; Accepted: {form.payment_methods || paymentMethods}</> : null}</div>
        <div style={{marginTop:'4px'}}>{[shopPhone, shopEmail].filter(Boolean).join('  ·  ')}</div>
      </div>
    </div>
  )
}
