// SMS sending — provider-agnostic.
//
// Picks the provider from the SMS_PROVIDER env var so the same sendSMS() call
// (used by auto-replies, document sends, follow-ups, etc.) can go out through
// Telnyx OR through the shop's OWN phone via a cloud SMS-gateway service.
//
// Why a cloud gateway and not the phone directly: the site runs on Vercel, which
// can't reach a phone on home/shop wifi. Gateway apps (TextBee, httpSMS) put the
// phone online through their cloud, so Vercel calls the cloud and the cloud pushes
// the text to your phone, which sends it from your real number/SIM.
//
//   SMS_PROVIDER = telnyx (default) | textbee | httpsms | custom
//
// TextBee:  SMS_PROVIDER=textbee  TEXTBEE_API_KEY=...  TEXTBEE_DEVICE_ID=...
// httpSMS:  SMS_PROVIDER=httpsms  HTTPSMS_API_KEY=...   HTTPSMS_FROM=+1XXXXXXXXXX
// custom:   SMS_PROVIDER=custom   SMS_CUSTOM_URL=...    (+ optional auth/field env, see below)

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  return phone
}

export async function sendSMS(to: string, body: string, from?: string) {
  const provider = (process.env.SMS_PROVIDER || 'telnyx').toLowerCase()
  const dest = formatPhone(to)
  switch (provider) {
    case 'textbee': return sendViaTextbee(dest, body)
    case 'httpsms': return sendViaHttpSms(dest, body, from)
    case 'custom':  return sendViaCustom(dest, body)
    default:        return sendViaTelnyx(dest, body, from)
  }
}

// ── Telnyx (original behavior) ───────────────────────────────────────────────
async function sendViaTelnyx(to: string, body: string, from?: string) {
  const apiKey = process.env.TELNYX_API_KEY
  const fromNumber = from || process.env.TELNYX_PHONE_NUMBER
  if (!apiKey || !fromNumber) throw new Error('Telnyx credentials not configured')

  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromNumber,
      to,
      text: body,
      messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.errors?.[0]?.detail || 'SMS send failed')
  return data.data
}

// ── TextBee (https://textbee.dev) — send through your own Android phone ───────
async function sendViaTextbee(to: string, body: string) {
  const apiKey = process.env.TEXTBEE_API_KEY
  const deviceId = process.env.TEXTBEE_DEVICE_ID
  const base = process.env.TEXTBEE_BASE_URL || 'https://api.textbee.dev/api/v1'
  if (!apiKey || !deviceId) {
    throw new Error('Phone SMS (TextBee) not configured: set TEXTBEE_API_KEY and TEXTBEE_DEVICE_ID')
  }
  const res = await fetch(`${base}/gateway/devices/${deviceId}/send-sms`, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipients: [to], message: body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message || data?.error || `Phone SMS send failed (${res.status})`)
  return data
}

// ── httpSMS (https://httpsms.com) — send through your own Android phone ───────
async function sendViaHttpSms(to: string, body: string, from?: string) {
  const apiKey = process.env.HTTPSMS_API_KEY
  const fromNumber = from || process.env.HTTPSMS_FROM
  if (!apiKey || !fromNumber) {
    throw new Error('Phone SMS (httpSMS) not configured: set HTTPSMS_API_KEY and HTTPSMS_FROM (your phone number)')
  }
  const res = await fetch('https://api.httpsms.com/v1/messages/send', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: body, from: fromNumber, to }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message || `Phone SMS send failed (${res.status})`)
  return data
}

// ── Custom gateway — any service that accepts a JSON POST ────────────────────
// SMS_CUSTOM_URL            (required) endpoint to POST to
// SMS_CUSTOM_API_KEY_HEADER + SMS_CUSTOM_API_KEY   (optional) auth header
// SMS_CUSTOM_TO_FIELD       (default "to")     JSON field name for the number
// SMS_CUSTOM_MSG_FIELD      (default "message") JSON field name for the text
async function sendViaCustom(to: string, body: string) {
  const url = process.env.SMS_CUSTOM_URL
  if (!url) throw new Error('Custom SMS gateway not configured: set SMS_CUSTOM_URL')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const authHeader = process.env.SMS_CUSTOM_API_KEY_HEADER
  const authValue = process.env.SMS_CUSTOM_API_KEY
  if (authHeader && authValue) headers[authHeader] = authValue
  const toField = process.env.SMS_CUSTOM_TO_FIELD || 'to'
  const msgField = process.env.SMS_CUSTOM_MSG_FIELD || 'message'
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ [toField]: to, [msgField]: body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message || data?.error || `Phone SMS send failed (${res.status})`)
  return data
}
