// Resend email helper

export async function sendEmail({
  to, subject, html, from, replyTo, apiKey,
}: {
  to: string
  subject: string
  html: string
  from?: string
  replyTo?: string
  apiKey?: string
}) {
  const key = apiKey || process.env.RESEND_API_KEY
  if (!key) {
    throw new Error(
      'Email is not configured. To fix this: go to Settings → Integrations and add your Resend API key, ' +
      'or set RESEND_API_KEY in your Vercel environment variables. ' +
      'Get a free API key at resend.com.'
    )
  }

  const fromAddr = from || process.env.FROM_EMAIL || 'Alpha Auto <onboarding@resend.dev>'

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: fromAddr, to, subject, html, reply_to: replyTo }),
  })

  const data = await res.json()
  if (!res.ok) {
    // Surface Resend's error message clearly
    const msg = data.message || data.error || 'Email send failed'
    throw new Error(`Resend API error: ${msg}`)
  }
  return data
}

export function estimateEmailHtml(doc: Record<string, unknown>, settings: Record<string, unknown>): string {
  const parts = (doc.parts as Record<string,unknown>[]) || []
  const labors = (doc.labors as Record<string,unknown>[]) || []
  const taxRate = Number(doc.tax_rate) || 8.25
  const shopSupplies = Number(doc.shop_supplies) || 0
  const deposit = Number(doc.deposit) || 0
  const partsTotal = parts.reduce((s, p) => s + (Number(p.qty)||1) * (Number(p.unitPrice||p.unit_price)||0), 0)
  const laborTotal = labors.reduce((s, l) => s + (Number(l.hours)||0) * (Number(l.rate)||0), 0)
  const taxable = parts.filter(p => p.taxable !== false).reduce((s,p) => s+(Number(p.qty)||1)*(Number(p.unitPrice||p.unit_price)||0),0) + shopSupplies
  const tax = taxable * (taxRate / 100)
  const total = partsTotal + laborTotal + shopSupplies + tax
  const balanceDue = total - deposit - (Number(doc.amount_paid) || 0)

  const fmt = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fmtDate = (d: string) => d ? new Date(d+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—'

  const warrantyType = doc.warranty_type as string || ''
  const warrantyMonths = Number(doc.warranty_months) || 0
  const warrantyMileage = Number(doc.warranty_mileage) || 0
  const warrantyStart = doc.warranty_start as string || ''
  const warrantyExclusions = doc.warranty_exclusions as string || ''
  const hasWarranty = warrantyType && warrantyType !== 'No Warranty' && warrantyType !== 'State Inspection — No Warranty'

  let warrantyExpiry = ''
  if (hasWarranty && warrantyStart && warrantyMonths > 0) {
    const d = new Date(warrantyStart + 'T00:00:00')
    d.setMonth(d.getMonth() + warrantyMonths)
    warrantyExpiry = d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
  }

  const isPaid = doc.status === 'Paid'

  const customerFirstName = ((doc.customer_name as string) || '').split(' ')[0] || 'Valued Customer'
  const shopNameStr = (settings.shop_name as string) || 'Alpha International Auto Center'
  const docTypeStr = (doc.type as string) || 'document'

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;padding:40px 20px;color:#111;margin:0}
  .card{background:#fff;border-radius:8px;max-width:680px;margin:0 auto;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1)}
  .greeting{padding:24px 32px 0 32px;font-size:14px;color:#333;line-height:1.6}
  .header{background:#1a1a2e;padding:28px 32px;text-align:center;color:#fff}
  .header h1{margin:0;font-size:20px;font-weight:700;letter-spacing:0.5px}
  .header p{margin:4px 0 0;color:#9ca3af;font-size:12px}
  .badge{display:inline-block;background:#e67e22;color:#fff;padding:4px 18px;border-radius:999px;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.08em}
  .section{padding:20px 32px;border-bottom:1px solid #eee}
  .section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:10px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#f8f8f8;padding:7px 10px;text-align:left;font-weight:600;font-size:10px;text-transform:uppercase;color:#666}
  th:last-child,td:last-child{text-align:right}
  td{padding:7px 10px;border-bottom:1px solid #f0f0f0}
  tr:nth-child(even) td{background:#fafafa}
  .totals{padding:20px 32px;background:#f9f9f9}
  .total-row{display:flex;justify-content:space-between;padding:3px 0;font-size:13px;color:#555}
  .grand-total{font-size:17px;font-weight:700;color:#111;border-top:2px solid #111;margin-top:8px;padding-top:10px}
  .paid-stamp{text-align:center;margin-top:12px}
  .paid-stamp span{display:inline-block;border:3px solid #16a34a;color:#16a34a;padding:4px 24px;border-radius:4px;font-weight:800;font-size:18px;letter-spacing:0.1em}
  .balance-due{font-size:14px;font-weight:700;color:#dc2626;display:flex;justify-content:space-between;margin-top:6px}
  .warranty-box{margin:16px 32px;padding:14px 16px;border:1.5px solid #3b82f6;border-radius:8px;background:#eff6ff}
  .warranty-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#1e40af;margin-bottom:6px}
  .warranty-grid{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:11px;color:#555}
  .warranty-exclusions{margin-top:8px;font-size:10px;color:#666;line-height:1.4;border-top:1px solid #bfdbfe;padding-top:8px}
  .footer{padding:16px 32px;text-align:center;font-size:11px;color:#999;background:#fafafa;border-top:1px solid #eee}
</style></head><body>
<div class="card">
  <div class="header">
    <h1>${settings.shop_name || 'Alpha International Auto Center'}</h1>
    <p>${settings.shop_address || '10710 S Main St, Houston TX 77025'} &nbsp;·&nbsp; ${settings.shop_phone || '(713) 663-6979'}</p>
  </div>
  <div class="greeting">
    <p>Hi ${customerFirstName},</p>
    <p>Here is your ${docTypeStr.toLowerCase()} from ${shopNameStr}. Please review the details below. If you have any questions, don't hesitate to reach out to us.</p>
  </div>
  <div class="section" style="text-align:center;padding:16px 32px">
    <span class="badge">${doc.type}</span>
    <div style="font-size:13px;color:#666;margin-top:8px">#${doc.doc_number} &nbsp;·&nbsp; ${fmtDate(doc.doc_date as string || '')}</div>
  </div>
  <div class="section" style="display:flex;justify-content:space-between">
    <div>
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:2px">Customer</div>
      <div style="font-weight:600;font-size:14px">${doc.customer_name || '—'}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#999;margin-bottom:2px">Vehicle</div>
      <div style="font-weight:600;font-size:14px">${[doc.vehicle_year,doc.vehicle_make,doc.vehicle_model].filter(Boolean).join(' ') || '—'}</div>
      ${doc.vehicle_mileage ? `<div style="font-size:12px;color:#666">${Number(doc.vehicle_mileage).toLocaleString()} miles</div>` : ''}
    </div>
  </div>
  ${parts.length ? `<div class="section">
    <div class="section-title">Parts</div>
    <table><thead><tr><th>Description</th><th style="width:40px;text-align:center">Qty</th><th style="width:80px;text-align:right">Unit Price</th><th style="width:80px">Total</th></tr></thead><tbody>
    ${parts.map(p => `<tr><td>${p.name}${p.brand ? ` <span style="color:#999;font-size:11px">(${p.brand})</span>` : ''}</td><td style="text-align:center">${p.qty||1}</td><td style="text-align:right">${fmt(Number(p.unitPrice||p.unit_price)||0)}</td><td>${fmt((Number(p.qty)||1)*(Number(p.unitPrice||p.unit_price)||0))}</td></tr>`).join('')}
    </tbody></table>
  </div>` : ''}
  ${labors.length ? `<div class="section">
    <div class="section-title">Labor</div>
    <table><thead><tr><th>Operation</th><th style="width:50px;text-align:center">Hours</th><th style="width:80px;text-align:right">Rate</th><th style="width:80px">Total</th></tr></thead><tbody>
    ${labors.map(l => `<tr><td>${l.operation}</td><td style="text-align:center">${l.hours}</td><td style="text-align:right">${fmt(Number(l.rate)||0)}/hr</td><td>${fmt((Number(l.hours)||0)*(Number(l.rate)||0))}</td></tr>`).join('')}
    </tbody></table>
  </div>` : ''}
  <div class="totals">
    <div class="total-row"><span>Parts Subtotal</span><span>${fmt(partsTotal)}</span></div>
    <div class="total-row"><span>Labor Subtotal</span><span>${fmt(laborTotal)}</span></div>
    ${shopSupplies ? `<div class="total-row"><span>Shop Supplies</span><span>${fmt(shopSupplies)}</span></div>` : ''}
    <div class="total-row"><span>Tax (${taxRate}%)</span><span>${fmt(tax)}</span></div>
    <div class="total-row grand-total"><span>TOTAL</span><span>${fmt(total)}</span></div>
    ${deposit > 0 ? `<div class="total-row"><span>Deposit</span><span>-${fmt(deposit)}</span></div>` : ''}
    ${isPaid ? `<div class="paid-stamp"><span>PAID</span></div>` : `<div class="balance-due"><span>Balance Due</span><span>${fmt(balanceDue)}</span></div>`}
  </div>
  ${doc.notes ? `<div class="section"><div class="section-title">Notes</div><p style="font-size:13px;color:#555;margin:0">${doc.notes}</p></div>` : ''}
  ${hasWarranty ? `<div class="warranty-box">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="font-size:16px">&#128737;</span>
      <span class="warranty-title">Warranty Coverage</span>
    </div>
    <div style="font-size:13px;font-weight:600;color:#111;margin-bottom:4px">${warrantyType}</div>
    <div class="warranty-grid">
      ${warrantyMonths > 0 ? `<div>Duration: <strong>${warrantyMonths} months</strong></div>` : ''}
      ${warrantyMileage > 0 ? `<div>Mileage: <strong>${warrantyMileage.toLocaleString()} miles</strong></div>` : ''}
      ${warrantyStart ? `<div>Start: <strong>${fmtDate(warrantyStart)}</strong></div>` : ''}
      ${warrantyExpiry ? `<div>Expires: <strong>${warrantyExpiry}</strong></div>` : ''}
    </div>
    ${warrantyExclusions ? `<div class="warranty-exclusions"><strong>Exclusions:</strong> ${warrantyExclusions}</div>` : ''}
    <div style="margin-top:10px;font-size:9px;color:#888;line-height:1.4;border-top:1px solid #bfdbfe;padding-top:8px">All warranty claims must be submitted to ${shopNameStr} during normal business hours. Contact ${settings.shop_phone || '(713) 663-6979'} before beginning any warranty repair. Unauthorized repairs will void this warranty. This warranty is governed by the laws of the State of Texas.</div>
  </div>` : ''}
  <div class="footer">
    <div style="font-size:13px;color:#333;margin-bottom:10px">Thank you for choosing ${shopNameStr}! We appreciate your business.</div>
    <div>${settings.payment_terms || 'Payment Terms: Due on receipt'} &nbsp;|&nbsp; Accepted: ${settings.payment_methods || 'Cash, Card, Zelle, Cash App'}</div>
    <div style="margin-top:4px">${settings.shop_phone || '(713) 663-6979'} &nbsp;·&nbsp; ${settings.shop_email || ''}</div>
  </div>
</div>
</body></html>`
}
