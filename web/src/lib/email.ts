// Gmail SMTP email helper using nodemailer
import nodemailer from 'nodemailer'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER || 'msamemy23@gmail.com',
    pass: process.env.GMAIL_APP_PASSWORD,
  },
})

export async function sendEmail({
  to,
  subject,
  html,
  from,
  replyTo,
}: {
  to: string
  subject: string
  html: string
  from?: string
  replyTo?: string
}): Promise<void> {
  await transporter.sendMail({
    from: from || `"Alpha International Auto Center" <${process.env.GMAIL_USER || 'msamemy23@gmail.com'}>`,
    to,
    subject,
    html,
    replyTo: replyTo || process.env.GMAIL_USER || 'msamemy23@gmail.com',
  })
}

export function estimateEmailHtml(
  doc: Record<string, unknown>,
  settings: Record<string, unknown>
): string {
  const shopName = (settings?.shop_name as string) || 'Alpha International Auto Center'
  const shopPhone = (settings?.shop_phone as string) || ''
  const shopAddress = (settings?.shop_address as string) || ''

  const parts = (doc.parts as Record<string, unknown>[]) || []
  const labors = (doc.labors as Record<string, unknown>[]) || []
  const taxRate = Number(doc.tax_rate) || 8.25
  const shopSupplies = Number(doc.shop_supplies) || 0
  const partsTotal = parts.reduce(
    (s, p) => s + (Number(p.qty) || 1) * (Number(p.unitPrice) || 0),
    0
  )
  const laborTotal = labors.reduce(
    (s, l) => s + (Number(l.hours) || 0) * (Number(l.rate) || 0),
    0
  )
  const tax = partsTotal * (taxRate / 100)
  const total = partsTotal + laborTotal + shopSupplies + tax
  const vehicle = [doc.vehicle_year, doc.vehicle_make, doc.vehicle_model]
    .filter(Boolean)
    .join(' ')

  const partsRows = parts
    .map(
      (p) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${p.description || ''}</td><td style="padding:4px 8px;text-align:center;border-bottom:1px solid #f0f0f0">${p.qty || 1}</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #f0f0f0">$${((Number(p.qty) || 1) * (Number(p.unitPrice) || 0)).toFixed(2)}</td></tr>`
    )
    .join('')

  const laborRows = labors
    .map(
      (l) =>
        `<tr><td style="padding:4px 8px;border-bottom:1px solid #f0f0f0">${l.description || 'Labor'}</td><td style="padding:4px 8px;text-align:center;border-bottom:1px solid #f0f0f0">${l.hours || 0}h @ $${l.rate || 0}</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #f0f0f0">$${((Number(l.hours) || 0) * (Number(l.rate) || 0)).toFixed(2)}</td></tr>`
    )
    .join('')

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;margin:0;padding:20px;background:#f4f4f4">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
  <div style="background:#111827;padding:24px;text-align:center;color:#fff">
    <h2 style="margin:0;font-size:22px">${shopName}</h2>
  </div>
  <div style="padding:24px">
    <h3 style="margin:0 0 4px;font-size:18px">${doc.type} #${doc.doc_number}</h3>
    <p style="margin:0 0 16px;color:#6b7280;font-size:14px">${doc.doc_date || ''}</p>
    <p style="margin:0 0 6px"><strong>Customer:</strong> ${doc.customer_name || ''}</p>
    ${vehicle ? `<p style="margin:0 0 16px"><strong>Vehicle:</strong> ${vehicle}</p>` : '<br>'}
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
      ${shopSupplies > 0 ? `<tr><td style="padding:3px 8px">Shop Supplies</td><td style="padding:3px 8px;text-align:right">$${shopSupplies.toFixed(2)}</td></tr>` : ''}
      <tr><td style="padding:3px 8px">Tax (${taxRate}%)</td><td style="padding:3px 8px;text-align:right">$${tax.toFixed(2)}</td></tr>
      <tr style="font-size:16px;font-weight:bold;border-top:2px solid #111">
        <td style="padding:8px">Total</td>
        <td style="padding:8px;text-align:right">$${total.toFixed(2)}</td>
      </tr>
    </table>
    <p style="font-size:13px;color:#6b7280">Questions? Call us at ${shopPhone}.</p>
  </div>
  <div style="border-top:1px solid #eee;padding:16px;text-align:center;font-size:12px;color:#888">
    ${shopName} · ${shopAddress}
  </div>
</div>
</body></html>`
}
