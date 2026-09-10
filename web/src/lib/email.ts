// Gmail SMTP email helper using nodemailer
import nodemailer from 'nodemailer'
import { calculateDocumentTotals, getLaborFlatAmount, laborLineTotal, partLineTotal } from '@/lib/document-money'

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || process.env.FROM_EMAIL,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

export async function sendEmail({
  to,
  subject,
  html,
  body,
  from,
  replyTo,
  apiKey,
  idempotencyKey,
}: {
  to: string
  subject: string
  html?: string
  body?: string
  from?: string
  replyTo?: string
  apiKey?: string
  idempotencyKey?: string
}): Promise<void> {
  const content = html || body || ''
  const fromAddress = from || process.env.GMAIL_USER || process.env.FROM_EMAIL || 'onboarding@resend.dev'
  if (apiKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: fromAddress, to: [to], subject, html: content, reply_to: replyTo || undefined }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.message || data?.error || `Email provider returned ${response.status}`)
    return
  }
  await transporter.sendMail({
    from: fromAddress,
    to,
    subject,
    html: content,
    replyTo: replyTo || fromAddress,
  })
}

export function estimateEmailHtml(
  doc: Record<string, unknown>,
  settings: Record<string, unknown>
): string {
  const shopName = (settings?.shop_name as string) || 'Your Auto Shop'
  const shopPhone = (settings?.shop_phone as string) || ''
  const shopAddress = (settings?.shop_address as string) || ''

  const parts = Array.isArray(doc.parts) ? doc.parts.filter((line): line is Record<string, unknown> => Boolean(line && typeof line === 'object')) : []
  const labors = Array.isArray(doc.labors) ? doc.labors.filter((line): line is Record<string, unknown> => Boolean(line && typeof line === 'object')) : []
  const totals = calculateDocumentTotals(doc)
  const { partsTotal, laborTotal, coreTotal, shopSupplies, sublet, taxRate, applyTax, taxAmount: tax, total, balanceDue, amountPaid } = totals
  const vehicle = [doc.vehicle_year, doc.vehicle_make, doc.vehicle_model]
    .filter(Boolean)
    .join(' ')

  const safeShopName = escapeHtml(shopName)
  const safeShopPhone = escapeHtml(shopPhone)
  const safeShopAddress = escapeHtml(shopAddress)
  const safeType = escapeHtml(doc.type)
  const safeDocNumber = escapeHtml(doc.doc_number)
  const safeDocDate = escapeHtml(doc.doc_date)
  const safeCustomerName = escapeHtml(doc.customer_name)
  const safeVehicle = escapeHtml(vehicle)

  const partsRows = parts
    .map(
      (p) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${escapeHtml(p.name || p.description || '')}</td><td style="padding:4px 8px;text-align:center;border-bottom:1px solid #f0f0f0">${escapeHtml(p.qty || 1)}</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #f0f0f0">$${partLineTotal(p).toFixed(2)}</td></tr>`
    )
    .join('')

  const laborRows = labors
    .map(
      (l) => {
        const flatAmount = getLaborFlatAmount(l)
        const qtyLabel = flatAmount !== null ? 'Flat' : `${l.hours || 0}h @ $${l.rate || 0}`
        return `<tr><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${escapeHtml(l.operation || l.description || 'Labor')}</td><td style="padding:4px 8px;text-align:center;border-bottom:1px solid #f0f0f0">${escapeHtml(qtyLabel)}</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #f0f0f0">$${laborLineTotal(l).toFixed(2)}</td></tr>`
      }
    )
    .join('')

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:20px;background:#f4f4f4">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#111827;padding:24px;text-align:center;color:#fff">
    <h2 style="margin:0;font-size:22px">${safeShopName}</h2>
  </div>
  <div style="padding:24px">
    <h3 style="margin:0 0 4px;font-size:18px">${safeType} #${safeDocNumber}</h3>
    <p style="margin:0 0 16px;color:#6b7280;font-size:14px">${safeDocDate}</p>
    <p style="margin:0 0 6px"><strong>Customer:</strong> ${safeCustomerName}</p>
    ${vehicle ? `<p style="margin:0 0 16px"><strong>Vehicle:</strong> ${safeVehicle}</p>` : '<br>'}
    ${partsRows || laborRows ? `
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
      <thead><tr style="background:#f9fafb;text-align:left">
        <th style="padding:8px">Description</th>
        <th style="padding:8px;text-align:center">Qty/Hrs</th>
        <th style="padding:8px;text-align:right">Amount</th>
      </tr></thead>
      <tbody>${partsRows}${laborRows}</tbody>
    </table>` : ''}
    <table style="width:260px;margin-left:auto;font-size:14px;margin-bottom:24px">
      ${partsTotal > 0 ? `<tr><td style="padding:3px 8px">Parts</td><td style="padding:3px 8px;text-align:right">$${partsTotal.toFixed(2)}</td></tr>` : ''}
      ${laborTotal > 0 ? `<tr><td style="padding:3px 8px">Labor</td><td style="padding:3px 8px;text-align:right">$${laborTotal.toFixed(2)}</td></tr>` : ''}
      ${coreTotal > 0 ? `<tr><td style="padding:3px 8px">Core Charges</td><td style="padding:3px 8px;text-align:right">$${coreTotal.toFixed(2)}</td></tr>` : ''}
      ${shopSupplies > 0 ? `<tr><td style="padding:3px 8px">Shop Supplies</td><td style="padding:3px 8px;text-align:right">$${shopSupplies.toFixed(2)}</td></tr>` : ''}
      ${sublet > 0 ? `<tr><td style="padding:3px 8px">Sublet</td><td style="padding:3px 8px;text-align:right">$${sublet.toFixed(2)}</td></tr>` : ''}
      ${applyTax ? `<tr><td style="padding:3px 8px">Tax (${taxRate}%)</td><td style="padding:3px 8px;text-align:right">$${tax.toFixed(2)}</td></tr>` : ''}
      <tr style="font-size:16px;font-weight:bold;border-top:2px solid #111">
        <td style="padding:8px">Total</td>
        <td style="padding:8px;text-align:right">$${total.toFixed(2)}</td>
      </tr>
      ${amountPaid > 0 ? `<tr><td style="padding:3px 8px;color:#16a34a">Amount Paid</td><td style="padding:3px 8px;text-align:right;color:#16a34a">-${amountPaid.toFixed(2)}</td></tr>
      <tr style="font-size:16px;font-weight:bold;border-top:2px solid #111">
        <td style="padding:8px">Balance Due</td>
        <td style="padding:8px;text-align:right">$${balanceDue.toFixed(2)}</td>
      </tr>` : ''}
    </table>
    <p style="font-size:13px;color:#6b7280">Questions? Call us at ${safeShopPhone}.</p>
  </div>
  <div style="border-top:1px solid #eee;padding:16px;text-align:center;font-size:12px;color:#888">
    ${safeShopName} · ${safeShopAddress}
  </div>
</div>
</body></html>`
}
