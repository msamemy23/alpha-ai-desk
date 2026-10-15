/**
 * How a customer may be contacted, in plain words. Texting is blocked by a STOP reply (the shop's consent record) or by the
 * old opt-out flag on the card; calls and email by the choices saved on the customer. The screen shows this next to the Text,
 * Call and Email buttons, and the server checks the same rules again when anything is actually sent. A failed lookup is
 * shown as "could not check", never as "OK to text". Imports nothing.
 */

export interface ConsentInput {
  phone: string
  email: string
  /** The old flag on the customer card (migration 004), if the column came back. */
  cardOptedOut: boolean
  /** The shop's consent record for this phone number. undefined means the lookup failed or has not run. */
  record: { optedOut: boolean; source: string; updatedAt: string } | null | undefined
  /** Choices saved with the customer (migration 053). undefined when that table is not set up. */
  prefs?: { doNotCall: boolean; doNotEmail: boolean; doNotText: boolean; bestTime: string; channel: string } | null
}

export type ChannelState = 'ok' | 'blocked' | 'missing' | 'unknown'

export interface ChannelView {
  state: ChannelState
  label: string
  detail: string
}

export interface ConsentView { text: ChannelView; call: ChannelView; email: ChannelView }

const SOURCE_WORDS: Record<string, string> = {
  inbound_stop: 'The customer replied STOP.',
  owner: 'Recorded by the shop at the customer\'s request.',
  import: 'Came in with an imported list.',
}

function dayWords(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}

export function consentView(i: ConsentInput): ConsentView {
  const prefs = i.prefs || null
  let text: ChannelView
  if (!i.phone.trim()) text = { state: 'missing', label: 'No phone number', detail: 'Add a phone number to text this customer.' }
  else if (i.record === undefined && !i.cardOptedOut && !prefs?.doNotText) text = { state: 'unknown', label: 'Could not check', detail: 'The text permission could not be checked just now. Nothing sends until it can be.' }
  else if (i.record?.optedOut || i.cardOptedOut || prefs?.doNotText) {
    const when = i.record?.updatedAt ? dayWords(i.record.updatedAt) : ''
    const why = i.record?.optedOut ? SOURCE_WORDS[i.record.source] || 'Opted out.' : prefs?.doNotText ? 'Marked do not text by the shop.' : 'Opted out of texts.'
    text = { state: 'blocked', label: 'Opted out of texts', detail: `${why}${when ? ` ${when}.` : ''} No texts will send, including reminders.` }
  } else text = { state: 'ok', label: 'Can text', detail: 'No opt-out on file. Marketing texts still end with how to stop.' }

  const call: ChannelView = !i.phone.trim()
    ? { state: 'missing', label: 'No phone number', detail: 'Add a phone number to call this customer.' }
    : prefs?.doNotCall
      ? { state: 'blocked', label: 'Do not call', detail: 'The customer asked not to be called.' }
      : { state: 'ok', label: 'Can call', detail: prefs?.bestTime ? `Best time: ${prefs.bestTime}.` : 'No call restrictions on file.' }

  const email: ChannelView = !i.email.trim()
    ? { state: 'missing', label: 'No email address', detail: 'Add an email address to email this customer.' }
    : prefs?.doNotEmail
      ? { state: 'blocked', label: 'Do not email', detail: 'The customer asked not to get email.' }
      : { state: 'ok', label: 'Can email', detail: 'No email restrictions on file.' }
  return { text, call, email }
}

/** Marketing may go out only when texting is allowed. Used by the lists that pick who to send a campaign to. */
export const canText = (v: ConsentView): boolean => v.text.state === 'ok'
