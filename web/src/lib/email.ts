// Resend email helper

export async function sendEmail({
  to, subject, html, from, replyTo,
}: {
  to: string
  subject: string
  html: string
  from?: string
  replyTo?: string
}) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) throw new Error('RESEND_API_KEY not configured')

  const fromAddr = from || process.env.FROM_EMAIL || 'Alpha Auto <noreply@alphainternationalauto.com>'

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: fromAddr, to, subject, html, reply_to: replyTo }),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.message || 'Email send failed')
  return data
}

export function estimateEmailHtml(doc: Record<string, unknown>, settings: Record<string, unknown>): string {
  const parts = (doc.parts as Record<string,unknown>[]) || []
  const labors = (doc.labors as Record<string,unknown>[]) || []
  const taxRate = Number(doc.tax_rate) || 8.25
  const shopSupplies = Number(doc.shop_supplies) || 0
  const partsTotal = parts.reduce((s, p) => s + (Number(p.qty)||1) * (Number(p.unitPrice||p.unit_price)||0), 0)
  const laborTotal = labors.reduce((s, l) => s + (Number(l.hours)||0) * (Number(l.rate)||0), 0)
  const taxable = parts.filter(p => p.taxable !== false).reduce((s,p) => s+(Number(p.qty)||1)*(Number(p.unitPrice||p.unit_price)||0),0) + shopSupplies
  const tax = taxable * (taxRate / 100)
  const total = partsTotal + laborTotal + shopSupplies + tax

  const fmt = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:Inter,Arial,sans-serif;background:#f5f5f5;padding:40px 20px;color:#111}
  .card{background:#fff;border-radius:8px;max-width:680px;margin:0 auto;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1)}
  .header{background:#111;padding:32px;text-align:center;color:#fff}
  .header h1{margin:0;font-size:22px}
  .header p{margin:4px 0 0;color:#aaa;font-size:13px}
  .badge{display:inline-block;background:#4a9eff;color:#fff;padding:4px 16px;border-radius:999px;font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin:20px auto;display:block;width:fit-content}
  .section{padding:24px 32px;border-bottom:1px solid #eee}
  .section-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:12px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#f9f9f9;padding:8px 12px;text-align:left;font-weight:600;font-size:11px;text-transform:uppercase;color:#666}
  td{padding:8px 12px;border-bottom:1px solid #f0f0f0}
  .totals{padding:24px 32px;background:#f9f9f9}
  .total-row{display:flex;justify-content:space-between;padding:4px 0;font-size:13px;color:#555}
  .grand-total{font-size:18px;font-weight:700;color:#111;border-top:2px solid #111;margin-top:8px;padding-top:12px}
  .footer{padding:20px 32px;text-align:center;font-size:12px;color:#888;background:#fff}
  .cta{display:inline-block;background:#4a9eff;color:#fff;padding:12px 32px;border-radius:6px;text-decoration:none;font-weight:700;margin:16px 0}
</style></head><body>
<div class="card">
  <div class="header">
    <h1>${settings.shop_name || 'Alpha International Auto Center'}</h1>
    <p>${settings.shop_address || ''} | ${settings.shop_phone || ''}</p>
  </div>
  <div class="section" style="text-align:center">
    <span class="badge">${doc.type}</span>
    <div style="font-size:14px;color:#555">#${doc.doc_number} &nbsp;·&nbsp; ${doc.doc_date}</div>
    <div style="font-size:15px;font-weight:600;margin-top:8px">${doc.customer_name || ''}</div>
    ${doc.vehicle_year ? `<div style="font-size:13px;color:#777;margin-top:4px">${[doc.vehicle_year,doc.vehicle_make,doc.vehicle_model].filter(Boolean).join(' ')}</div>` : ''}
  </div>
  ${parts.length ? `<div class="section">
    <div class="section-title">Parts</div>
    <table><thead><tr><th>Part</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead><tbody>
    ${parts.map(p => `<tr><td>${p.name}</td><td>${p.qty||1}</td><td>${fmt(Number(p.unitPrice||p.unit_price)||0)}</td><td>${fmt((Number(p.qty)||1)*(Number(p.unitPrice||p.unit_price)||0))}</td></tr>`).join('')}
    </tbody></table>
  </div>` : ''}
  ${labors.length ? `<div class="section">
    <div class="section-title">Labor</div>
    <table><thead><tr><th>Operation</th><th>Hours</th><th>Rate</th><th>Total</th></tr></thead><tbody>
    ${labors.map(l => `<tr><td>${l.operation}</td><td>${l.hours}</td><td>${fmt(Number(l.rate)||0)}</td><td>${fmt((Number(l.hours)||0)*(Number(l.rate)||0))}</td></tr>`).join('')}
    </tbody></table>
  </div>` : ''}
  <div class="totals">
    <div class="total-row"><span>Parts</span><span>${fmt(partsTotal)}</span></div>
    <div class="total-row"><span>Labor</span><span>${fmt(laborTotal)}</span></div>
    ${shopSupplies ? `<div class="total-row"><span>Shop Supplies</span><span>${fmt(shopSupplies)}</span></div>` : ''}
    <div class="total-row"><span>Tax (${taxRate}%)</span><span>${fmt(tax)}</span></div>
    <div class="total-row grand-total"><span>TOTAL</span><span>${fmt(total)}</span></div>
  </div>
  ${doc.notes ? `<div class="section"><div class="section-title">Notes</div><p style="font-size:13px;color:#555;margin:0">${doc.notes}</p></div>` : ''}
  <div class="footer">
    <p>${settings.payment_terms || 'Due on receipt'} | Accepted: ${settings.payment_methods || 'Cash, Card, Zelle, Cash App'}</p>
    <p style="margin-top:8px">${settings.shop_phone || ''} | ${settings.shop_email || ''}</p>
  </div>
</div>
</body></html>`
}
