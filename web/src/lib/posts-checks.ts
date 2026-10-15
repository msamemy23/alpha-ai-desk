// The checks every social post goes through before an owner sees it as "ready".
// Pure, with relative imports only, so the browser, the server and `node --test` all load the same code.
// `components/growth/post-draft.ts` re-exports these two, so the Write a post sheet and the repair-post pipeline
// are held to exactly the same rules.

import { hasEmoji, unsupportedClaims } from './automation-rules.ts'

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
