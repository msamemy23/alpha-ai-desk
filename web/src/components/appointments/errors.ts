// Plain-words reasons for the Schedule screen. No imports, so it can be tested on its own.

const messageOf = (e: unknown): string => {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message || '')
  return ''
}

/** What went wrong with a save, status change or delete, in words a shop owner can act on. */
export function plainError(e: unknown, fallback: string): string {
  const raw = messageOf(e).trim()
  if (!raw) return fallback
  if (/failed to fetch|networkerror|network request|load failed|timed? ?out/i.test(raw)) return 'No connection. Check your internet and try again.'
  if (/row-level security|permission denied|not allowed|forbidden/i.test(raw)) return 'Your account is not allowed to change the schedule. Ask the shop owner.'
  if (/jwt|token.*expired|not authenticated|not signed in/i.test(raw)) return 'You were signed out. Sign in again, then try once more.'
  if (/no shop is associated|could not find your shop/i.test(raw)) return 'We could not find your shop. Refresh, or sign out and back in.'
  if (/violates|constraint|invalid input syntax|duplicate key/i.test(raw)) return 'Some of the details were not accepted. Check the date, time and customer, then try again.'
  // Anything that reads like a database message is not for the owner.
  if (/relation |column |schema|pgrst|postgres|sql/i.test(raw) || raw.length > 160) return fallback
  return raw.endsWith('.') ? raw : `${raw}.`
}

/** Why a text from the appointment did not send, in plain words. `status` is 0 when the request never got an answer. */
export function textProblem(status: number, serverText: string): string {
  const t = serverText.trim()
  if (status === 0) return 'No connection. Check your internet, then try again. If you tried twice, look in your Inbox before sending again.'
  if (status === 401) return 'You were signed out. Sign in again, then try once more.'
  if (status === 403) return 'Your account can look at the schedule but not send texts. Ask the shop owner.'
  if (status === 429) return 'Too many texts in a minute. Wait a moment, then try again.'
  if (/opted out/i.test(t)) return 'This customer replied STOP, so Alpha cannot text them. Call them instead.'
  if (/does not match/i.test(t)) return 'This phone number is not the one saved for the customer. Fix the number on the appointment, then try again.'
  if (/more than one customer/i.test(t)) return 'Two customers share this phone number, so Alpha cannot tell who to text. Open the appointment, choose the right customer, then try again.'
  if (/already in progress/i.test(t)) return 'This text is already being sent. Wait a minute before trying again.'
  if (/uncertain|reconcile/i.test(t)) return 'Alpha could not confirm the text went out. Look in your Inbox before you send it again.'
  if (status === 503 && /not configured|configured/i.test(t)) return 'Texting is not set up for this shop yet. Set it up in Settings, then try again.'
  if (t && t.length < 160 && !/relation |column |pgrst|postgres|sql/i.test(t)) return t.endsWith('.') ? t : `${t}.`
  return 'The text did not send. Try again in a moment.'
}

/** The last ten digits of a phone number, for matching one against another. */
export const phoneTail = (p: unknown): string => String(p ?? '').replace(/\D/g, '').slice(-10)
