/**
 * What can be done on a live page, and which of it needs a person.
 *
 * Three outcomes for any click or key press:
 *  - safe: just do it (open a link, scroll, fill a search box, dismiss a cookie banner),
 *  - approve: show the exact action and wait for a person to approve it (submit a form that sends data, buy, send a
 *    message, download, delete, agree to terms),
 *  - handoff: Alpha stops and the person does this step on their own computer (sign in, passwords, card numbers, one-time
 *    codes, captchas). Alpha never types these, whoever asks, and page text cannot ask for them.
 *
 * Imports nothing, so it runs in the browser, on the server and under `node --test`. Plain TypeScript only.
 */

export type ControlKind = 'link' | 'button' | 'submit' | 'text' | 'search' | 'email' | 'tel' | 'number' | 'url' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'file' | 'other'

/** Where a control is on the page. `loc` is a CSS path, `fp` is a fingerprint used to notice the page changed under us. */
export interface ControlRef { loc: string; fp: string }

/** What the in-page script reports about one control. Everything here came from the page: untrusted. */
export interface RawControl {
  tag: string
  type: string
  name: string
  id: string
  label: string
  placeholder: string
  ariaLabel: string
  title: string
  autocomplete: string
  text: string
  href: string
  value: string
  disabled: boolean
  checked: boolean
  formIndex: number
  rect: { x: number; y: number; w: number; h: number }
  options: string[]
  loc: string
  consent: boolean
  download: boolean
}

export interface FormMeta { index: number; method: string; action: string; sameOrigin: boolean; fieldCount: number; hasPassword?: boolean }

export type SensitiveKind = 'password' | 'card' | 'security_code' | 'otp' | 'ssn' | 'bank' | 'identity'

/** Kinds that nobody types through Alpha, person or AI. */
export const CREDENTIAL_KINDS: SensitiveKind[] = ['password', 'card', 'security_code', 'otp', 'ssn', 'bank']

const SENSITIVE_WORDS = 'Alpha does not type passwords, card numbers, security codes, bank details or one-time codes. Do this step on the website yourself.'

function words(c: RawControl): string {
  // Names like user_pwd, card-number and cardNumber all read as separate words, so word-boundary checks see them.
  return [c.type, c.name, c.id, c.label, c.placeholder, c.ariaLabel, c.title, c.autocomplete].join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_\-.[\]]+/g, ' ').toLowerCase()
}

export function sensitiveKind(c: RawControl): SensitiveKind | null {
  const ac = (c.autocomplete || '').toLowerCase()
  const type = (c.type || '').toLowerCase()
  const w = words(c)
  if (type === 'password' || /(^|\s)(current|new)-password(\s|$)/.test(ac) || /pass(word|code|phrase)|\bpwd\b/.test(w)) return 'password'
  if (/cc-csc/.test(ac) || /\b(cvv|cvc|csc|cid)\b|security.?code|card.?verification|verification.?value/.test(w)) return 'security_code'
  if (/cc-(number|exp|name|type)/.test(ac) || /card.?(number|no\b|num\b)|credit.?card|debit.?card|\bcc.?num|\bccnum|expir(y|ation).?(date|month|year)|\bexp(iry)?.?(mm|yy)/.test(w)) return 'card'
  if (/one-time-code/.test(ac) || /one.?time|\botp\b|verification.?code|\b2fa\b|two.?factor|authenticator|sms.?code|login.?code|\bpin\b/.test(w)) return 'otp'
  if (/\bssn\b|social.?security|tax.?id|\bitin\b|\bein\b|national.?id/.test(w)) return 'ssn'
  if (/routing.?(number|no\b)|account.?(number|no\b)|\biban\b|\bswift\b|bank.?account|\baba\b/.test(w)) return 'bank'
  if (/driver.?s?.?licen[sc]e|passport|date.?of.?birth|\bdob\b|birth.?date|maiden/.test(w) || /bday/.test(ac)) return 'identity'
  return null
}

export function controlKind(c: RawControl): ControlKind {
  const tag = c.tag.toLowerCase()
  const type = (c.type || '').toLowerCase()
  if (tag === 'a') return 'link'
  if (tag === 'select') return 'select'
  if (tag === 'textarea') return 'textarea'
  if (tag === 'button') return type === 'submit' || (type === '' && c.formIndex >= 0) ? 'submit' : 'button'
  if (tag === 'input') {
    if (type === 'submit' || type === 'image') return 'submit'
    if (type === 'button' || type === 'reset') return 'button'
    if (type === 'checkbox') return 'checkbox'
    if (type === 'radio') return 'radio'
    if (type === 'file') return 'file'
    if (type === 'search') return 'search'
    if (type === 'email') return 'email'
    if (type === 'tel') return 'tel'
    if (type === 'number') return 'number'
    if (type === 'url') return 'url'
    return 'text'
  }
  return 'other'
}

export function isTypable(kind: ControlKind): boolean {
  return ['text', 'search', 'email', 'tel', 'number', 'url', 'textarea'].includes(kind)
}

/** Best human name for a control: what a person would call it. */
export function controlLabel(c: RawControl): string {
  // A button's value is its caption. A field's value is what someone typed, which is not its name.
  const caption = c.tag === 'input' && ['submit', 'button', 'reset', 'image'].includes((c.type || '').toLowerCase()) ? c.value : ''
  const pick = c.ariaLabel || c.label || c.text || c.placeholder || c.title || caption || c.name || c.id || ''
  const tidy = pick.replace(/\s+/g, ' ').trim()
  return tidy.slice(0, 80) || (c.tag === 'a' ? 'Link' : 'Control')
}

/** A short stable fingerprint. If the page changes and this control is no longer the same one, the fingerprints differ. */
export function fingerprint(c: Pick<RawControl, 'tag' | 'type' | 'name' | 'id' | 'label' | 'text' | 'placeholder' | 'ariaLabel'>): string {
  const s = [c.tag, c.type, c.name, c.id, c.ariaLabel || c.label || c.text || c.placeholder].map(x => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 40)).join('|')
  let h1 = 0x811c9dc5, h2 = 0x1b873593
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 16777619) >>> 0
    h2 = Math.imul(h2 + ch, 2246822519) >>> 0
  }
  return h1.toString(36) + h2.toString(36)
}

/** What to show for a field's value. Sensitive fields never show what they hold. */
export function maskValue(c: RawControl, value: string): string {
  if (!value) return ''
  if (sensitiveKind(c)) return '••••••'
  return value.slice(0, 120)
}

function luhn(digits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

export type SecretValue = 'card' | 'ssn' | 'secret'

/** Does this text look like a card number, a social security number or a secret key? Checked on whatever is about to be typed. */
export function looksLikeSecretValue(text: string): SecretValue | null {
  const t = String(text || '')
  const compact = t.replace(/[\s-]/g, '')
  if (/^\d{13,19}$/.test(compact) && luhn(compact)) return 'card'
  for (const m of t.matchAll(/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g)) {
    const d = m[0].replace(/[\s-]/g, '')
    if (d.length >= 13 && d.length <= 19 && luhn(d)) return 'card'
  }
  if (/(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/.test(t)) return 'ssn'
  if (/\b(sk|pk|rk)[-_](live|test)?[-_]?[A-Za-z0-9]{16,}\b|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}\b/.test(t)) return 'secret'
  return null
}

/** Can this value go into this control? Returns a plain-words reason to refuse, or null. Applies to the person and the AI alike. */
export function vetFill(c: RawControl, value: string, actor: 'user' | 'ai'): string | null {
  const kind = controlKind(c)
  if (kind === 'file') return 'Alpha does not attach files. Do that step on the website yourself.'
  if (!isTypable(kind) && kind !== 'select' && kind !== 'checkbox' && kind !== 'radio') return 'That is not a field Alpha can fill in.'
  if (c.disabled) return 'That field is turned off on the page.'
  const sens = sensitiveKind(c)
  if (sens && CREDENTIAL_KINDS.includes(sens)) return SENSITIVE_WORDS
  if (sens === 'identity' && actor === 'ai') return 'Alpha does not fill in identity details such as a date of birth or licence number. Type this one yourself.'
  const secret = looksLikeSecretValue(value)
  if (secret === 'card') return 'That looks like a card number. Alpha does not type card numbers. Do this step on the website yourself.'
  if (secret === 'ssn') return 'That looks like a social security number. Alpha does not type it. Do this step on the website yourself.'
  if (secret === 'secret') return 'That looks like a password or secret key. Alpha does not type it.'
  return null
}

/* ---------- risk of a click or key press ---------- */

export type ApprovalKind = 'submit' | 'purchase' | 'send' | 'download' | 'delete' | 'terms' | 'open_site'

export type ActionRisk =
  | { level: 'safe' }
  | { level: 'approve'; kind: ApprovalKind; why: string }
  | { level: 'handoff'; reason: 'sign_in' | 'credential' | 'captcha'; message: string }

const RE_SIGN_IN = /\b(sign|log)[ -]?(in|on)\b|\blogin\b|\bsso\b|forgot (my )?(password|username)|reset (your )?password|\bcreate (an |your )?account\b|\bregister\b|\bsign[ -]?up\b/i
const RE_PURCHASE = /\b(buy( it)? now|place (my |your )?order|pay( now| with)?|check ?out|purchase|complete (my |your )?(order|purchase)|confirm (my |your )?(order|payment|purchase)|add to (cart|bag|basket)|subscribe|start (a |your )?(free )?trial|donate|submit order)\b/i
const RE_DELETE = /\b(delete|remove|cancel (my |your |the )?(order|account|subscription|membership|appointment)|close (my |your )?account|unsubscribe|deactivate|erase)\b/i
const RE_SEND = /\b(send|submit|post|reply|publish|share|e-?mail|message|contact us|request (a |an )?(quote|callback|call|estimate)|book|schedule|reserve|apply|enroll|file (a )?claim|upload)\b/i
const RE_TERMS = /\b(i agree|agree (to|and)|accept (the )?(terms|conditions|agreement|policy)|terms (of|and) (service|use|conditions))\b/i
const RE_DOWNLOAD = /\.(pdf|zip|rar|7z|gz|tar|exe|msi|dmg|pkg|apk|bat|cmd|sh|jar|csv|xlsx?|docx?|pptx?|iso)(\?|#|$)|^\s*download\b|\bdownload (file|pdf|now|the)/i

export interface RiskContext { pageUrl: string; forms: FormMeta[]; captcha?: boolean }

/** Decide what a click on this control needs. `isEnter` is a press of the Enter key inside a field. */
export function classifyClick(c: RawControl, ctx: RiskContext, isEnter = false): ActionRisk {
  const kind = controlKind(c)
  const sens = sensitiveKind(c)
  if (sens && CREDENTIAL_KINDS.includes(sens)) return { level: 'handoff', reason: 'credential', message: SENSITIVE_WORDS }
  if (ctx.captcha && /captcha|recaptcha|verify you are human|i.?m not a robot/i.test(`${c.text} ${c.ariaLabel} ${c.title} ${c.id} ${c.name}`)) {
    return { level: 'handoff', reason: 'captcha', message: 'This site wants you to prove you are a person. Do that step yourself.' }
  }
  const label = `${c.text} ${c.label} ${c.ariaLabel} ${c.title} ${c.value} ${c.name} ${c.id}`.replace(/\s+/g, ' ')
  const form = c.formIndex >= 0 ? ctx.forms.find(f => f.index === c.formIndex) : undefined

  // A cookie banner button is not a decision about the shop's data. Accepting terms is.
  if (c.consent && !RE_TERMS.test(label) && kind !== 'link') return { level: 'safe' }

  if (c.download || (kind === 'link' && RE_DOWNLOAD.test(c.href)) || (kind === 'link' && RE_DOWNLOAD.test(c.text))) {
    return { level: 'approve', kind: 'download', why: 'This downloads a file. Alpha never opens or runs downloaded files.' }
  }
  if (kind === 'link') {
    if (RE_DELETE.test(label) && /\b(delete|cancel|close account|unsubscribe)\b/i.test(c.text)) return { level: 'approve', kind: 'delete', why: 'This looks like it deletes or cancels something.' }
    return { level: 'safe' }
  }
  // Any form that holds a password field is a sign-in form, however the button is worded.
  if (form?.hasPassword && (kind === 'submit' || isEnter)) {
    return { level: 'handoff', reason: 'sign_in', message: 'This form signs in. Alpha does not sign in to websites. Do this step on the website yourself.' }
  }
  if ((kind === 'submit' || kind === 'button' || isEnter) && RE_SIGN_IN.test(label) && (!form || form.method === 'post')) {
    return { level: 'handoff', reason: 'sign_in', message: 'This is a sign-in step. Alpha does not sign in to websites. Do this step on the website yourself.' }
  }
  if (RE_TERMS.test(label)) return { level: 'approve', kind: 'terms', why: 'This agrees to terms or conditions.' }
  if (RE_PURCHASE.test(label) || (/checkout|payment|order/i.test(form?.action || '') && (kind === 'submit' || isEnter))) {
    return { level: 'approve', kind: 'purchase', why: 'This may start or complete a purchase.' }
  }
  if (RE_DELETE.test(label)) return { level: 'approve', kind: 'delete', why: 'This looks like it deletes or cancels something.' }

  if (kind === 'submit' || isEnter) {
    if (!form) return { level: 'approve', kind: 'submit', why: 'This sends what is on the page to the website.' }
    // A search that only changes the address bar on the same site is a lookup, not a submission.
    if (form.method === 'get' && form.sameOrigin && !/\b(send|message|contact|quote)\b/i.test(label)) return { level: 'safe' }
    if (RE_SEND.test(label)) return { level: 'approve', kind: 'send', why: 'This sends a message or request to the website.' }
    return { level: 'approve', kind: 'submit', why: form.method === 'get' ? 'This sends what you filled in to a different website.' : 'This sends what you filled in to the website.' }
  }
  if (kind === 'button') {
    if (RE_SEND.test(label) && /\b(send|submit|publish|post|reply)\b/i.test(label)) return { level: 'approve', kind: 'send', why: 'This sends something to the website.' }
    return { level: 'safe' }
  }
  return { level: 'safe' }
}

/* ---------- the live-page request ---------- */

export interface PreparedStep { kind: 'fill' | 'select' | 'check'; ref: ControlRef; value: string }

export type LiveAction =
  | { kind: 'fill'; ref: ControlRef; value: string }
  | { kind: 'select'; ref: ControlRef; value: string }
  | { kind: 'check'; ref: ControlRef; value: string }
  | { kind: 'click'; ref: ControlRef }
  | { kind: 'press'; ref?: ControlRef; key: 'Enter' }
  | { kind: 'scroll'; dy: number }

export interface LiveRequest {
  url: string
  prepared: PreparedStep[]
  action?: LiveAction
  actor: 'user' | 'ai'
  approvalId?: string
  scrollY: number
  viewport: 'phone' | 'desktop'
  tabId?: string
}

function str(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.length <= max ? v : null
}

function validRef(v: unknown): ControlRef | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const loc = str(r.loc, 500)
  const fp = str(r.fp, 40)
  if (!loc || !fp || /[\u0000-\u001f<]/.test(loc) || !/^[a-z0-9]{1,40}$/.test(fp)) return null
  return { loc, fp }
}

export function parseAction(v: unknown): LiveAction | null {
  if (!v || typeof v !== 'object') return null
  const a = v as Record<string, unknown>
  if (a.kind === 'fill' || a.kind === 'select' || a.kind === 'check') {
    const ref = validRef(a.ref)
    const value = str(a.value, a.kind === 'fill' ? 2000 : 300)
    return ref && value !== null ? { kind: a.kind, ref, value } : null
  }
  if (a.kind === 'click') { const ref = validRef(a.ref); return ref ? { kind: 'click', ref } : null }
  if (a.kind === 'press') {
    if (a.key !== 'Enter') return null
    const ref = a.ref === undefined ? undefined : validRef(a.ref)
    if (a.ref !== undefined && !ref) return null
    return { kind: 'press', key: 'Enter', ...(ref ? { ref } : {}) }
  }
  if (a.kind === 'scroll') {
    const dy = Number(a.dy)
    return Number.isFinite(dy) ? { kind: 'scroll', dy: Math.max(-4000, Math.min(4000, Math.round(dy))) } : null
  }
  return null
}

/** Clean up a request body. Returns a reason string if the request cannot be understood. */
export function parseLiveRequest(body: unknown): { ok: true; req: LiveRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'The request was empty.' }
  const b = body as Record<string, unknown>
  const url = str(b.url, 2048)
  if (!url) return { ok: false, error: 'A page address is required.' }
  const actor = b.actor === 'ai' ? 'ai' : 'user'
  const preparedIn = Array.isArray(b.prepared) ? b.prepared : []
  if (preparedIn.length > 30) return { ok: false, error: 'Too many fields were filled in on this page. Reload the page and start again.' }
  const prepared: PreparedStep[] = []
  for (const p of preparedIn) {
    const a = parseAction(p)
    if (!a || (a.kind !== 'fill' && a.kind !== 'select' && a.kind !== 'check')) return { ok: false, error: 'A saved field entry was not understood. Reload the page and start again.' }
    prepared.push(a)
  }
  let action: LiveAction | undefined
  if (b.action !== undefined && b.action !== null) {
    const a = parseAction(b.action)
    if (!a) return { ok: false, error: 'That action was not understood.' }
    action = a
  }
  const scrollY = Number.isFinite(Number(b.scrollY)) ? Math.max(0, Math.min(200000, Math.round(Number(b.scrollY)))) : 0
  const approvalId = typeof b.approvalId === 'string' && /^[0-9a-f-]{36}$/i.test(b.approvalId) ? b.approvalId : undefined
  const tabId = typeof b.tabId === 'string' ? b.tabId.replace(/[^a-z0-9_-]/gi, '').slice(0, 40) : undefined
  return { ok: true, req: { url, prepared, action, actor, approvalId, scrollY, viewport: b.viewport === 'phone' ? 'phone' : 'desktop', tabId } }
}

/* ---------- plain-words descriptions ---------- */

export interface FieldValue { label: string; value: string }

export interface ApprovalDetails {
  kind: ApprovalKind
  title: string
  /** One sentence naming exactly what will happen and where. */
  summary: string
  host: string
  url: string
  fields: FieldValue[]
  why: string
}

const KIND_TITLE: Record<ApprovalKind, string> = {
  submit: 'Send a form', purchase: 'Possible purchase', send: 'Send a message or request', download: 'Download a file',
  delete: 'Delete or cancel', terms: 'Agree to terms', open_site: 'Open a new site',
}

export function approvalTitle(kind: ApprovalKind): string { return KIND_TITLE[kind] }

export function describeApproval(kind: ApprovalKind, args: { host: string; url: string; label: string; why: string; fields: FieldValue[]; method?: string; actionHost?: string }): ApprovalDetails {
  const where = args.actionHost && args.actionHost !== args.host ? `${args.host}, which sends it to ${args.actionHost}` : args.host
  let summary: string
  switch (kind) {
    case 'submit': summary = `Press "${args.label}" on ${where}${args.fields.length ? ` with the ${args.fields.length} ${args.fields.length === 1 ? 'entry' : 'entries'} below` : ''}. This sends information to the website.`; break
    case 'send': summary = `Press "${args.label}" on ${where}. This sends a message or request to the website${args.fields.length ? ', including the entries below' : ''}.`; break
    case 'purchase': summary = `Press "${args.label}" on ${where}. This may start a purchase or add to an order.`; break
    case 'download': summary = `Download "${args.label}" from ${args.host}. Alpha saves it for you to open. It never opens or runs it.`; break
    case 'delete': summary = `Press "${args.label}" on ${where}. This may delete or cancel something.`; break
    case 'terms': summary = `Press "${args.label}" on ${where}. This agrees to the site's terms.`; break
    case 'open_site': summary = `Open ${args.host}. Alpha typed this address itself instead of following a link on the page.`; break
  }
  return { kind, title: KIND_TITLE[kind], summary, host: args.host, url: args.url, fields: args.fields.slice(0, 12), why: args.why }
}

/** Stable text for an action, used to bind an approval to the exact thing shown. */
export function canonicalAction(parts: { kind: string; url: string; fp: string; method: string; actionUrl: string; fields: FieldValue[] }): string {
  const fields = [...parts.fields].map(f => `${f.label}=${f.value}`).sort()
  return JSON.stringify([parts.kind, parts.url.split('#')[0], parts.fp, parts.method.toLowerCase(), parts.actionUrl.split('#')[0], fields])
}
