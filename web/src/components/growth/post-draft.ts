import { hasEmoji, unsupportedClaims } from '@/lib/automation-rules'
import { getAuthJsonHeaders } from './helpers'

/** The most characters each place takes. Google Business posts stop at 1,500. */
export const POST_LIMITS: Record<string, number> = { google: 1500, facebook: 2000, instagram: 2200, tiktok: 2200 }

/**
 * What to tell the owner before they approve wording: things an AI must never decide for them.
 * `facts` is everything the owner supplied (the topic they typed, the shop name and phone), so only those numbers and offers pass.
 */
export function copyFlags(text: string, facts: string[]): string[] {
  const out: string[] = []
  const t = text.trim()
  if (!t) return out
  if (hasEmoji(t)) out.push('The wording has an emoji. Take it out so it looks professional.')
  const claims = unsupportedClaims(t, ...facts)
  if (claims.length) out.push(`The wording has ${claims.join(', ')} that you did not give. Take it out unless it is true for your shop.`)
  return out
}

type Asked = { ok: true; text: string } | { ok: false; error: string }

async function ask(system: string, user: string, maxTokens: number): Promise<Asked> {
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 30_000)
    const res = await fetch('/api/ai-completions', {
      method: 'POST',
      headers: await getAuthJsonHeaders(),
      signal: ctl.signal,
      body: JSON.stringify({ max_tokens: maxTokens, temperature: 0.5, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    }).finally(() => clearTimeout(timer))
    const d = await res.json().catch(() => ({} as Record<string, unknown>))
    if (!res.ok) {
      const msg = typeof d.error === 'string' ? d.error : (d.error as { message?: string } | undefined)?.message || ''
      if (/not configured|api key/i.test(msg)) return { ok: false, error: 'Alpha cannot write until an AI key is added in Settings. You can write it yourself below.' }
      return { ok: false, error: 'Alpha could not write this right now. You can write it yourself below.' }
    }
    const raw = (d.choices as { message?: { content?: string } }[] | undefined)?.[0]?.message?.content
    const text = String(raw || '').replace(/```[a-z]*\n?/gi, '').replace(/^["'\s]+|["'\s]+$/g, '').trim()
    return text ? { ok: true, text } : { ok: false, error: 'Alpha did not return anything. Try again, or write it yourself.' }
  } catch {
    return { ok: false, error: 'Alpha could not write this right now. You can write it yourself below.' }
  }
}

const RULES = 'Plain, friendly and specific. No emoji, no hashtags. Never invent prices, discounts, offers, guarantees, awards, years in business or deadlines: use only what the owner gave you. Output only the finished wording.'

export async function draftPost(input: { shopName: string; shopPhone: string; city: string; platforms: string[]; topic: string }): Promise<Asked> {
  const limit = input.platforms.includes('google') ? 'Keep it under 600 characters.' : 'Keep it under 400 characters.'
  return ask(
    `You write one short social media post for ${input.shopName || 'an independent auto repair shop'}${input.city ? ` in ${input.city}` : ''}. ${limit} ${RULES}${input.shopPhone ? ` End by inviting people to call ${input.shopPhone}.` : ''}`,
    `What the owner wants to say: ${input.topic}`,
    500,
  )
}

export async function draftAd(input: { shopName: string; city: string; platform: 'google' | 'facebook'; topic: string }): Promise<{ ok: true; headline: string; text: string } | { ok: false; error: string }> {
  const g = input.platform === 'google'
  const r = await ask(
    `You write one ${g ? 'Google search' : 'Facebook'} ad for ${input.shopName || 'an independent auto repair shop'}${input.city ? ` in ${input.city}` : ''}. ${RULES} Reply with JSON only, like {"headline":"...","text":"..."}. The headline is at most ${g ? 30 : 40} characters. The text is at most ${g ? 90 : 250} characters.`,
    `What the owner wants to advertise: ${input.topic}`,
    400,
  )
  if (!r.ok) return r
  try {
    const m = /\{[\s\S]*\}/.exec(r.text)
    const o = JSON.parse(m ? m[0] : r.text) as { headline?: unknown; text?: unknown }
    const headline = String(o.headline ?? '').trim().slice(0, g ? 30 : 40)
    const text = String(o.text ?? '').trim().slice(0, g ? 90 : 250)
    if (!headline && !text) throw new Error('empty')
    return { ok: true, headline, text }
  } catch {
    return { ok: false, error: 'Alpha’s answer could not be read. Try again, or write it yourself.' }
  }
}
