// Telnyx SMS helper — used by API routes

export async function sendSMS(to: string, body: string, from?: string) {
  const apiKey = process.env.TELNYX_API_KEY
  const fromNumber = from || process.env.TELNYX_PHONE_NUMBER

  if (!apiKey || !fromNumber) {
    throw new Error('Telnyx credentials not configured')
  }

  const res = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
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

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  return phone
}
