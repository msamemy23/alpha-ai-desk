/**
 * Plain words for what happened when a shop owner comes back from signing in to Facebook or Google,
 * and for the names on the Agents and tools screen.
 * It imports nothing, so the same code runs in the browser and under `node --test`.
 * Keep it to plain TypeScript (no enums, no parameter properties) so node can run it directly.
 */

export interface ConnectNotice { kind: 'success' | 'error'; message: string }

const APP_NAMES: Record<string, string> = { facebook: 'Facebook', google: 'Google' }

/** The reason an outside site gave, kept short and only when it reads like words. */
function reason(detail: string | null): string {
  const text = (detail || '').replace(/\s+/g, ' ').trim()
  if (!text || text.length > 160 || /https?:|env\b|vercel|[_]{1}[A-Z]{3,}|^no_code$/i.test(text)) return ''
  return text
}

/**
 * The address carries `success=facebook|google` or `error=<code>&detail=<text>`.
 * Returns null when there is nothing to say. Codes come from /api/auth/facebook and /api/auth/google.
 */
export function connectNotice(success: string | null, error: string | null, detail: string | null): ConnectNotice | null {
  if (success === 'facebook') return { kind: 'success', message: 'Facebook is connected. Instagram connects too when your Instagram business account is linked to that Facebook page.' }
  if (success === 'google') return { kind: 'success', message: 'Google Business and Google Calendar are connected.' }
  if (!error) return null

  const m = /^(facebook|google)_(.+)$/.exec(error)
  const app = m ? APP_NAMES[m[1]] : ''
  const kind = m ? m[2] : ''
  const why = reason(detail)

  if (app && kind === 'denied') {
    return { kind: 'error', message: `${app} was not connected because the sign-in was cancelled or refused${why ? ` (${app} said: ${why})` : ''}. Tap Connect ${app} to try again.` }
  }
  if (app && kind === 'not_configured') {
    return { kind: 'error', message: `${app} sign-in is not switched on for this Alpha Desk yet, so it cannot connect. Ask whoever set up Alpha Desk for you to add the ${app} app details, then try again.` }
  }
  if (app && kind === 'invalid_state') {
    return { kind: 'error', message: 'The sign-in took too long, or it was started in another window. Tap Connect and finish the sign-in in one go.' }
  }
  if (app && (kind === 'token_failed' || kind === 'internal')) {
    return { kind: 'error', message: `${app} did not finish connecting. Wait a minute and try again. If it keeps happening, contact support.` }
  }
  if (app && kind === 'multiple_pages') {
    return { kind: 'error', message: 'Facebook found more than one page on your account and could not tell which is your shop. Make the name of your shop’s Facebook page match your shop name in Settings, then connect again.' }
  }
  if (app && kind === 'no_pages') {
    return { kind: 'error', message: 'Facebook did not find a page that you manage. Create your shop’s page, or ask its owner to make you an admin, then connect again.' }
  }
  const readable = error.replace(/[_-]+/g, ' ').trim()
  return { kind: 'error', message: `Connecting did not finish (${readable}). Try again.` }
}

/* ---------- names on the Agents and tools screen ---------- */

/** "partsLookup" or "send_sms" as words: "Parts lookup", "Send sms". Used when a tool has no hand-written name. */
export function plainName(name: string): string {
  const spaced = String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : ''
}

/** A title that arrives in Title Case ("Browser Tab Inspection With Kapture") as a sentence: "Browser tab inspection with Kapture". */
export function sentenceTitle(title: string, keep: string[] = []): string {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean)
  const keepMap = new Map(keep.map(k => [k.toLowerCase(), k]))
  return words
    .map((w, i) => {
      const bare = w.replace(/[^A-Za-z]/g, '').toLowerCase()
      if (keepMap.has(bare)) return w.replace(new RegExp(bare, 'i'), keepMap.get(bare) as string)
      if (w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w)) return w
      const lower = w.toLowerCase()
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}
