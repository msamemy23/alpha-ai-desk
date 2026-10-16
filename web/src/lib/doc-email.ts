// Email for estimates and invoices: the message with the link, the signed copy for the customer, and
// the note to the shop when a customer answers.
//
// Email programs cannot read the app's style sheet, so colors here are written inline. The shop's
// accent color (from Estimates settings) is used for the heading and the button when it is set.

import type { DisplayLine } from '@/lib/doc-lines'
import type { PublicDocument, PublicShop } from '@/lib/doc-public'
import { readableOn, isHexColor } from '@/lib/doc-prefs'

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const usd = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const INK = '#111827'
const MUTED = '#6b7280'
const LINE = '#e5e7eb'
const PAPER = '#ffffff'
const PAGE = '#f4f4f5'
const DEFAULT_ACCENT = '#2563eb'

export interface EmailBrand { accent: string; onAccent: string }

export function brandFor(accent: string): EmailBrand {
  const a = isHexColor(accent) ? accent : DEFAULT_ACCENT
  return { accent: a, onAccent: readableOn(a) }
}

function linesTable(lines: DisplayLine[]): string {
  if (lines.length === 0) return ''
  const rows = lines
    .map((l) => {
      const detail = [l.detail, l.note].filter(Boolean).join('. ')
      const was = l.listTotal > 0 ? `<span style="color:${MUTED};text-decoration:line-through;margin-right:6px">${usd(l.listTotal)}</span>` : ''
      return `<tr>
  <td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:14px;color:${INK}">${escapeHtml(l.description)}${detail ? `<div style="font-size:12px;color:${MUTED};margin-top:2px">${escapeHtml(detail)}</div>` : ''}</td>
  <td style="padding:8px 0 8px 12px;border-bottom:1px solid ${LINE};font-size:14px;color:${INK};text-align:right;white-space:nowrap;vertical-align:top">${was}${usd(l.total)}</td>
</tr>`
    })
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:8px 0 0">${rows}</table>`
}

function jobsBlock(doc: PublicDocument): string {
  const showHeadings = doc.groups.length > 1
  return doc.groups
    .map((g) => `${showHeadings ? `<div style="margin-top:18px;font-size:13px;font-weight:700;color:${INK}">${escapeHtml(g.name)}<span style="float:right;font-weight:600">${usd(g.subtotal)}</span></div>` : ''}${linesTable(g.lines)}`)
    .join('')
}

function totalsBlock(doc: PublicDocument): string {
  const t = doc.totals
  const row = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:3px 0;font-size:${bold ? 16 : 14}px;color:${bold ? INK : MUTED};${bold ? 'font-weight:700;' : ''}">${escapeHtml(label)}</td><td style="padding:3px 0;font-size:${bold ? 16 : 14}px;color:${INK};text-align:right;${bold ? 'font-weight:700;' : ''}">${value}</td></tr>`
  const rows = [
    t.laborTotal > 0 ? row('Labor', usd(t.laborTotal)) : '',
    t.partsTotal > 0 ? row('Parts', usd(t.partsTotal)) : '',
    t.coreTotal > 0 ? row('Core charges, refundable', usd(t.coreTotal)) : '',
    t.shopSupplies > 0 ? row('Shop supplies', usd(t.shopSupplies)) : '',
    t.sublet > 0 ? row('Outside work', usd(t.sublet)) : '',
    t.discount > 0 ? row('You save', usd(t.discount)) : '',
    t.taxAmount > 0 ? row(`Tax (${t.taxRate}%)`, usd(t.taxAmount)) : '',
    row('Total', usd(t.total), true),
    t.amountPaid > 0 ? row('Paid', usd(t.amountPaid)) : '',
    t.amountPaid > 0 ? row('Balance due', usd(t.balanceDue), true) : '',
  ].join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0 0 auto;min-width:240px">${rows}</table>`
}

function shell(shop: PublicShop, brand: EmailBrand, logoUrl: string | null, inner: string, footer: string, pixelUrl: string | null): string {
  const mark = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(shop.name)}" style="max-height:56px;max-width:220px;display:block;margin:0 auto 6px" />`
    : ''
  const contact = [shop.address, shop.phone, shop.email].filter(Boolean).map(escapeHtml).join(' · ')
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:20px 12px;background:${PAGE};font-family:Arial,Helvetica,sans-serif;color:${INK}">
<div style="max-width:620px;margin:0 auto;background:${PAPER};border:1px solid ${LINE};border-radius:10px;overflow:hidden">
  <div style="padding:22px 24px 16px;text-align:center;border-bottom:3px solid ${brand.accent}">
    ${mark}
    <div style="font-size:20px;font-weight:700;color:${INK}">${escapeHtml(shop.name)}</div>
  </div>
  <div style="padding:24px">${inner}</div>
  <div style="border-top:1px solid ${LINE};padding:16px 24px;text-align:center;font-size:12px;color:${MUTED};line-height:1.6">
    ${contact ? `<div>${contact}</div>` : ''}
    ${footer ? `<div style="margin-top:4px">${escapeHtml(footer)}</div>` : ''}
  </div>
</div>
${pixelUrl ? `<img src="${escapeHtml(pixelUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />` : ''}
</body></html>`
}

function button(href: string, label: string, brand: EmailBrand): string {
  return `<p style="text-align:center;margin:26px 0 8px"><a href="${escapeHtml(href)}" style="display:inline-block;background:${brand.accent};color:${brand.onAccent};text-decoration:none;padding:14px 34px;border-radius:8px;font-size:16px;font-weight:700">${escapeHtml(label)}</a></p>`
}

export interface SendEmailInput {
  doc: PublicDocument
  shop: PublicShop
  link: string
  logoUrl: string | null
  pixelUrl: string | null
  linkGoodThrough: string
}

export interface BuiltEmail { subject: string; html: string; text: string }


/** The message that carries the link. Shows the work and the total so the customer sees it in the inbox. */
export function buildSendEmail(input: SendEmailInput): BuiltEmail {
  const { doc, shop, link } = input
  const brand = brandFor(doc.accent)
  const title = `${doc.docType} ${doc.docNumber}`
  const hi = doc.customerName ? `Hi ${escapeHtml(doc.customerName)},` : 'Hello,'
  const ask = doc.kind === 'estimate'
    ? 'Review the work below and tell us which jobs to go ahead with. It takes a minute on your phone.'
    : doc.kind === 'invoice'
      ? 'Your work is done. The details are below.'
      : 'Here is your receipt.'
  const expiry = doc.kind === 'estimate' && doc.expiresDate ? `<p style="font-size:13px;color:${MUTED};margin:0 0 4px">Prices are good through ${escapeHtml(doc.expiresDate)}.</p>` : ''
  const vehicle = doc.vehicle ? `<div style="font-size:14px;color:${MUTED};margin-top:2px">${escapeHtml(doc.vehicle)}</div>` : ''
  const intro = doc.intro ? `<p style="font-size:14px;line-height:1.55;margin:0 0 14px">${escapeHtml(doc.intro)}</p>` : ''
  const cta = doc.kind === 'estimate' ? 'Review and respond' : doc.kind === 'invoice' ? 'View your invoice' : 'View your receipt'
  const inner = `
    <p style="font-size:15px;margin:0 0 14px">${hi}</p>
    <p style="font-size:15px;line-height:1.55;margin:0 0 14px">${escapeHtml(ask)}</p>
    ${intro}
    <div style="font-size:17px;font-weight:700">${escapeHtml(title)}</div>
    ${vehicle}
    ${jobsBlock(doc)}
    ${totalsBlock(doc)}
    ${button(link, cta, brand)}
    ${expiry}
    <p style="font-size:12px;color:${MUTED};margin:6px 0 0;line-height:1.5">This link is for you only. It works until ${escapeHtml(input.linkGoodThrough)}. Questions? Reply to this email${shop.phone ? ` or call ${escapeHtml(shop.phone)}` : ''}.</p>`
  const text = [
    doc.customerName ? `Hi ${doc.customerName},` : 'Hello,',
    ask,
    `${title}${doc.vehicle ? ` for ${doc.vehicle}` : ''}. Total ${usd(doc.totals.total)}.`,
    `${cta}: ${link}`,
    shop.phone ? `Questions? Call ${shop.phone}.` : '',
    shop.name,
  ].filter(Boolean).join('\n\n')
  return { subject: `${title} from ${shop.name}`, html: shell(shop, brand, input.logoUrl, inner, doc.footer, input.pixelUrl), text }
}

/** The text message that carries the link. Short, with the total and one clear thing to do. */
export function buildSendText(input: { doc: PublicDocument; shop: PublicShop; link: string }): string {
  const { doc, shop, link } = input
  const first = doc.customerName.trim().split(/\s+/)[0] || ''
  const hi = first ? `Hi ${first}, ` : 'Hi, '
  const car = doc.vehicle ? ` for your ${doc.vehicle}` : ''
  const ask = doc.kind === 'estimate' ? 'Review it and tell us which jobs to do' : doc.kind === 'invoice' ? 'See the details' : 'See your receipt'
  const phone = shop.phone ? ` Questions? Call ${shop.phone}.` : ''
  return `${shop.name ? `${shop.name}: ` : ''}${hi}your ${doc.kind} ${doc.docNumber}${car} is ready. Total ${usd(doc.totals.total)}. ${ask}: ${link}${phone}`
}

export interface SignedEmailInput {
  doc: PublicDocument
  shop: PublicShop
  link: string
  logoUrl: string | null
  signerName: string
  signedAt: string
  outcomeWords: string
  declined: { job: string; amount: number }[]
  recordId: string
}

/** The signed copy for the customer. */
export function buildSignedCopyEmail(input: SignedEmailInput): BuiltEmail {
  const { doc, shop } = input
  const brand = brandFor(doc.accent)
  const title = `${doc.docType} ${doc.docNumber}`
  const declined = input.declined.length
    ? `<div style="margin:14px 0 0;padding:12px;border:1px solid ${LINE};border-radius:8px;font-size:13px;line-height:1.6"><strong>Not included</strong> (you said no for now):<br>${input.declined.map((d) => `${escapeHtml(d.job)}, ${usd(d.amount)}`).join('<br>')}<br><span style="color:${MUTED}">Call us any time if you change your mind.</span></div>`
    : ''
  const inner = `
    <p style="font-size:15px;margin:0 0 12px">Thanks${input.signerName ? `, ${escapeHtml(input.signerName)}` : ''}. We recorded your answer on ${escapeHtml(title)}.</p>
    <p style="font-size:14px;margin:0 0 4px"><strong>${escapeHtml(input.outcomeWords)}</strong></p>
    <p style="font-size:13px;color:${MUTED};margin:0 0 14px">Signed ${escapeHtml(new Date(input.signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }))}. Record ${escapeHtml(input.recordId.slice(0, 12))}.</p>
    ${jobsBlock(doc)}
    ${totalsBlock(doc)}
    ${declined}
    ${button(input.link, 'Open your signed copy', brand)}
    <p style="font-size:12px;color:${MUTED};margin:6px 0 0">Keep this email for your records.${shop.phone ? ` Questions? Call ${escapeHtml(shop.phone)}.` : ''}</p>`
  const text = `Thanks. We recorded your answer on ${title}: ${input.outcomeWords}. Total ${usd(doc.totals.total)}. Your signed copy: ${input.link}`
  return { subject: `Your signed copy: ${title}`, html: shell(shop, brand, input.logoUrl, inner, doc.footer, null), text }
}

export interface ShopNoticeInput {
  doc: PublicDocument
  shop: PublicShop
  customerName: string
  outcomeWords: string
  note: string
  declined: { job: string; amount: number }[]
  openUrl: string
}

/** The note to the shop when a customer answers. */
export function buildShopNotice(input: ShopNoticeInput): BuiltEmail {
  const { doc, shop } = input
  const brand = brandFor(doc.accent)
  const title = `${doc.docType} ${doc.docNumber}`
  const who = input.customerName || doc.customerName || 'The customer'
  const note = input.note ? `<div style="margin:12px 0;padding:12px;border-left:3px solid ${brand.accent};background:${PAGE};font-size:14px;line-height:1.5"><strong>Their note:</strong><br>${escapeHtml(input.note)}</div>` : ''
  const declined = input.declined.length
    ? `<p style="font-size:14px;margin:8px 0">Declined: ${input.declined.map((d) => `${escapeHtml(d.job)} (${usd(d.amount)})`).join(', ')}. These are saved under declined work.</p>`
    : ''
  const inner = `
    <p style="font-size:15px;margin:0 0 8px"><strong>${escapeHtml(who)}</strong> answered ${escapeHtml(title)}${doc.vehicle ? ` for ${escapeHtml(doc.vehicle)}` : ''}.</p>
    <p style="font-size:16px;margin:0 0 8px"><strong>${escapeHtml(input.outcomeWords)}.</strong> New total ${usd(doc.totals.total)}.</p>
    ${declined}${note}
    ${button(input.openUrl, `Open ${doc.kind}`, brand)}`
  return {
    subject: `${who} answered ${title}: ${input.outcomeWords}`,
    html: shell(shop, brand, null, inner, '', null),
    text: `${who} answered ${title}: ${input.outcomeWords}. New total ${usd(doc.totals.total)}.${input.note ? ` Note: ${input.note}` : ''}`,
  }
}
