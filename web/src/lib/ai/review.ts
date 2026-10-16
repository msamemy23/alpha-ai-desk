/**
 * The one review card model. Every time the assistant asks "OK to go ahead?" (a saved
 * record, a text, an email, a connected-app post, a browser action) the card is built from
 * here, so the wording, the risk labels and the "can this be undone?" line always agree.
 *
 * The card must show, BEFORE anything is approved:
 *   - exactly what will happen, and to whom (recipient, channel, the exact words, amounts);
 *   - whether it can be undone (the same table the Activity screen uses to offer Undo);
 *   - whether the shop's rules forbid it (then it cannot be approved at all).
 *
 * Pure module: no imports from '@/' so node:test can load it directly.
 */
import { getActionInfo, reviewTags, undoSentence, humanize, type ReviewTag } from './action-risk.ts'
import { decideAction, findNeverSay, type AiRules } from './shop-rules.ts'

export type ReviewRow = {
  label: string
  value: string
  /** 'words' is shown in a box (a message the customer will read); 'minor' is small print. */
  kind?: 'text' | 'words' | 'minor'
}

export type ReviewModel = {
  action: string
  title: string
  effect: string
  tags: ReviewTag[]
  undoLine: string
  irreversible: boolean
  approveLabel: string
  danger: boolean
  rows: ReviewRow[]
  /** When not empty the card cannot be approved. It says why, in the shop's own terms. */
  blockedReason: string
  /** Can the owner change the words or details before approving? */
  editable: boolean
}

type Meta = { effect: string; approve: string }

const META: Record<string, Meta> = {
  createInvoice: { effect: 'Saves this as a draft. Nothing is emailed, texted, charged or marked paid.', approve: 'save draft' },
  sendEstimateEmail: { effect: 'Emails this document to the address below. It reaches the customer right away.', approve: 'send email' },
  createCustomer: { effect: 'Adds this person to your customer list.', approve: 'add customer' },
  updateCustomer: { effect: 'Changes these details on the customer record.', approve: 'save changes' },
  createJob: { effect: 'Opens this job on your shop board.', approve: 'open job' },
  updateJobStatus: { effect: 'Moves this job to the status below.', approve: 'change status' },
  voidDocument: { effect: 'Voids this document so it no longer counts. Its number stays on record.', approve: 'void document' },
  deleteRecord: { effect: 'Deletes this record for good, along with anything attached to it.', approve: 'delete' },
  scheduleFollowUp: { effect: 'Schedules this message to go to the customer at the time below.', approve: 'schedule it' },
  addStaff: { effect: 'Adds this person to your staff list.', approve: 'add staff member' },
  removeStaff: { effect: 'Marks this person inactive. Their history stays.', approve: 'deactivate' },
  createAppointment: { effect: 'Adds this appointment to your schedule.', approve: 'book it' },
  updateAppointment: { effect: 'Changes this appointment.', approve: 'save changes' },
  deleteAppointment: { effect: 'Removes this appointment from your schedule.', approve: 'delete' },
  updateInventory: { effect: 'Changes this inventory item.', approve: 'update inventory' },
  convertEstimateToInvoice: { effect: 'Creates a draft invoice from this estimate. The estimate is not touched.', approve: 'create invoice' },
  updateDocument: { effect: 'Changes this document. It is not sent and no payment is recorded.', approve: 'save changes' },
  'message.sms': { effect: 'Sends this text right now, exactly as written.', approve: 'send text' },
  'message.email': { effect: 'Sends this email right now, exactly as written.', approve: 'send email' },
  aiVoiceCall: { effect: 'Places a phone call right now. The person hears that it is an AI assistant before anything else.', approve: 'place call' },
  call: { effect: 'Opens your phone in the app and dials this number. You do the talking.', approve: 'open the phone' },
  scheduleTask: { effect: 'Creates an automation that will run on its own at the times below.', approve: 'schedule it' },
  automationControl: { effect: 'Changes an automation that is already set up.', approve: 'make the change' },
  webAutomation: { effect: 'Runs these steps in a hosted browser. It can click and fill in fields on a real website.', approve: 'run it' },
  'connector.post': { effect: 'Posts or sends this through your connected app. Anything published stays there until you remove it in that app.', approve: 'send it' },
}

const HIDDEN_KEYS = new Set(['shop_id', 'idempotency_key', 'approval'])
const ID_KEY = /(?:^|_)id$/i
const MONEY_KEY = /(?:price|cost|amount|total|deposit|sublet|supplies|retail|fee|balance)/i

export function labelFor(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export function formatWhen(value: string, timeZone?: string): string {
  const time = Date.parse(value)
  if (Number.isNaN(time)) return value
  return new Date(time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) })
}

export function formatValue(key: string, value: unknown, timeZone?: string): string {
  if (value === null || value === undefined || value === '') return 'Not provided'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (key === 'tax_rate') return `${value}%`
    if (/rate$/i.test(key)) return `${money(value)} per hour`
    if (MONEY_KEY.test(key)) return money(value)
    return String(value)
  }
  if (typeof value === 'string') {
    if (/(?:scheduled_for|_at$|^when$)/i.test(key) && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatWhen(value, timeZone)
    return value.trim().slice(0, 4000)
  }
  if (Array.isArray(value)) {
    if (value.every(item => typeof item === 'string' || typeof item === 'number')) return value.join(', ')
    return `${value.length} item${value.length === 1 ? '' : 's'}: ${JSON.stringify(value).slice(0, 600)}`
  }
  try { return JSON.stringify(value).slice(0, 600) } catch { return 'Details could not be shown' }
}

/** Plain list of what an action will use. The opaque record ids go last, in small print. */
export function payloadRows(payload: Record<string, unknown>, timeZone?: string): ReviewRow[] {
  const main: ReviewRow[] = []
  const minor: ReviewRow[] = []
  for (const [key, value] of Object.entries(payload)) {
    if (HIDDEN_KEYS.has(key)) continue
    if (ID_KEY.test(key) && typeof value === 'string') {
      minor.push({ label: key === 'id' ? 'Record ID' : labelFor(key), value: String(value), kind: 'minor' })
      continue
    }
    main.push({ label: labelFor(key), value: formatValue(key, value, timeZone), kind: /^(?:message|message_body|body|notes?|text|comment|caption|reply|content|post|task_prompt)$/i.test(key) ? 'words' : 'text' })
  }
  return [...main, ...minor]
}

/** How many texts a message will be billed and delivered as. Plain letters give 160 per text. */
export function smsSegments(body: string): { characters: number; texts: number; unicode: boolean } {
  const characters = [...body].length
  // GSM-7 basic set, roughly: anything outside printable ASCII plus a few common marks switches to the 70-character form.
  const unicode = /[^\x20-\x7E\n\r£¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ¡ÄÖÑÜ§¿äöñüà€]/.test(body)
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153
  const texts = characters === 0 ? 0 : characters <= single ? 1 : Math.ceil(characters / multi)
  return { characters, texts, unicode }
}

function gate(rules: AiRules | undefined, actionId: string, words: string[]): string {
  if (!rules) return ''
  const decision = decideAction(rules, actionId)
  if (!decision.allowed) return decision.reason
  for (const text of words) {
    const found = findNeverSay(rules, text)
    if (found.length) return `Your shop rules say the assistant must never use ${found.map(item => `"${item}"`).join(', ')} in a message to a customer. Edit the words, then try again.`
  }
  return ''
}

function approveText(meta: Meta | undefined, info: { title: string }): string {
  return `Approve and ${meta?.approve || info.title.toLowerCase()}`
}

/** The wording for an action, including families such as automationControl.pause or facebook.post. */
function metaFor(action: string): Meta | undefined {
  if (META[action]) return META[action]
  const head = action.split('.')[0]
  if (head === 'message') return /email/i.test(action) ? META['message.email'] : META['message.sms']
  if (META[head]) return META[head]
  if (getActionInfo(action).title === getActionInfo('connector.post').title) return META['connector.post']
  return undefined
}

function base(action: string): Pick<ReviewModel, 'action' | 'tags' | 'undoLine' | 'irreversible' | 'danger'> & { meta?: Meta; title: string } {
  const info = getActionInfo(action)
  const head = action.split('.')[0]
  // A connected app's action reads "Google business: reply to review", not just "Send through a connected app".
  const title = info.title === getActionInfo('connector.post').title && action.includes('.') ? `${humanize(head)}: ${humanize(action.slice(head.length + 1)).toLowerCase()}` : info.title
  return {
    action,
    title,
    meta: metaFor(action),
    tags: reviewTags(info),
    undoLine: undoSentence(info),
    irreversible: info.reversibility === 'irreversible',
    danger: info.danger,
  }
}

/** A review from the durable workflow: a saved record, a document draft, an email, a follow-up. */
export function buildWorkflowReview(approval: { action: string; payload: Record<string, unknown>; status?: string }, options: { rules?: AiRules; timeZone?: string } = {}): ReviewModel {
  const { action, payload } = approval
  const info = getActionInfo(action)
  const b = base(action)
  const document = action === 'createInvoice'
  const docType = String(payload.type || 'Invoice').toLowerCase()
  const title = document ? `Save this ${docType} as a draft` : b.title
  let rows: ReviewRow[]
  const words: string[] = []
  if (action === 'sendEstimateEmail') {
    rows = [
      { label: 'To', value: formatValue('email', payload.email) },
      { label: 'Document', value: formatValue('doc_number', payload.doc_number) },
      { label: 'How', value: 'Email' },
    ]
  } else if (action === 'scheduleFollowUp') {
    const channel = String(payload.channel || '').toLowerCase()
    rows = [
      { label: 'To', value: formatValue('customer_name', payload.customer_name ?? 'The customer on file') },
      { label: 'How', value: channel === 'email' ? 'Email' : channel === 'sms' ? 'Text message' : formatValue('channel', payload.channel) },
      { label: 'When', value: formatValue('scheduled_for', payload.scheduled_for, options.timeZone) },
    ]
    if (payload.subject) rows.push({ label: 'Subject', value: formatValue('subject', payload.subject) })
    rows.push({ label: 'Message', value: formatValue('message_body', payload.message_body), kind: 'words' })
    if (typeof payload.message_body === 'string') words.push(payload.message_body)
    if (typeof payload.subject === 'string') words.push(payload.subject)
    if (channel === 'sms' && typeof payload.message_body === 'string') {
      const seg = smsSegments(payload.message_body)
      rows.push({ label: 'Length', value: `${seg.characters} characters, ${seg.texts} text${seg.texts === 1 ? '' : 's'}${seg.unicode ? ' (emoji or special letters shorten each text)' : ''}`, kind: 'minor' })
    }
    if (payload.customer_id) rows.push({ label: 'Customer ID', value: String(payload.customer_id), kind: 'minor' })
  } else {
    rows = payloadRows(payload, options.timeZone)
  }
  return {
    action,
    title,
    effect: b.meta?.effect || 'Runs this action with the details below.',
    tags: b.tags,
    undoLine: b.undoLine,
    irreversible: b.irreversible,
    approveLabel: approveText(b.meta, info),
    danger: b.danger,
    rows,
    blockedReason: gate(options.rules, action, words),
    editable: true,
  }
}

/** A text or email the assistant drafted, shown with the exact recipient and words. */
export function buildMessageReview(message: { channel?: string; to: string; body: string; subject?: string; customerName?: string }, options: { rules?: AiRules } = {}): ReviewModel {
  const email = message.channel === 'email'
  const action = email ? 'message.email' : 'message.sms'
  const b = base(action)
  const who = message.customerName || 'the recipient'
  const rows: ReviewRow[] = [{ label: 'To', value: message.customerName ? `${message.customerName}, ${message.to}` : message.to }]
  rows.push({ label: 'How', value: email ? 'Email' : 'Text message' })
  if (email && message.subject) rows.push({ label: 'Subject', value: message.subject })
  rows.push({ label: 'Message', value: message.body, kind: 'words' })
  if (!email) {
    const seg = smsSegments(message.body)
    rows.push({ label: 'Length', value: `${seg.characters} characters, ${seg.texts} text${seg.texts === 1 ? '' : 's'}${seg.unicode ? ' (emoji or special letters shorten each text)' : ''}`, kind: 'minor' })
  }
  return {
    action,
    title: `Send this ${email ? 'email' : 'text'}${message.customerName ? ` to ${message.customerName}` : ''}?`,
    effect: `${b.meta?.effect || ''} It reaches ${who} right away.`.trim(),
    tags: b.tags,
    undoLine: b.undoLine,
    irreversible: b.irreversible,
    approveLabel: `Approve and send ${email ? 'email' : 'text'}`,
    danger: false,
    rows,
    blockedReason: gate(options.rules, action, [message.body, message.subject || '']),
    editable: true,
  }
}

/** What the call review card needs from the server's check: the plain-words preview of an assistant call. */
export type CallPreviewInfo = {
  hours: string
  disclosure: string
  limits: string[]
  /** Set when the number is a saved customer. */
  customerName?: string
  /** Why the call cannot be placed right now (do not call, STOP, outside calling hours), or empty. */
  blocked: string
  /** Things to fix before it can be approved (for example the shop name is missing). */
  problems: string[]
}

/**
 * A phone call the assistant proposed, or the owner typed. Shows exactly who, why, what the person hears first and what
 * Alpha will not do. A call Alpha places cannot be approved until the server has checked do-not-call, STOP and calling hours.
 */
export function buildCallReview(
  call: { kind: 'assistant' | 'personal'; to: string; task?: string; name?: string },
  preview: CallPreviewInfo | null,
  options: { rules?: AiRules } = {},
): ReviewModel {
  const personal = call.kind === 'personal'
  const action = personal ? 'call' : 'aiVoiceCall'
  const b = base(action)
  const name = preview?.customerName || call.name || ''
  const who = name ? `${name}, ${call.to}` : call.to
  const rows: ReviewRow[] = [{ label: 'Who', value: who }]
  if (personal) {
    rows.push({ label: 'How', value: 'Your own call from the phone in the app. Alpha is not on the call.' })
  } else {
    rows.push({ label: 'What Alpha will talk about', value: String(call.task || '').trim(), kind: 'words' })
    if (preview) {
      rows.push({ label: 'What they hear first', value: preview.disclosure, kind: 'words' })
      rows.push({ label: 'Calling hours', value: preview.hours })
      rows.push({ label: 'What Alpha will not do', value: preview.limits.map(l => `- ${l}`).join('\n'), kind: 'minor' })
    } else {
      rows.push({ label: 'Checking', value: 'Checking the do-not-call list and your calling hours.', kind: 'minor' })
    }
  }
  const blockedByRules = gate(options.rules, action, personal ? [] : [String(call.task || '')])
  // While the server check is still running the card shows 'Checking' and the page keeps Approve off.
  const blocked = blockedByRules || (!personal && preview ? preview.blocked || preview.problems.join(' ') : '')
  return {
    action,
    title: personal ? `Call ${name || call.to} from your phone?` : `Place this assistant call to ${name || call.to}?`,
    effect: b.meta?.effect || '',
    tags: b.tags,
    undoLine: b.undoLine,
    irreversible: b.irreversible,
    approveLabel: personal ? 'Approve and open the phone' : 'Approve and place call',
    danger: false,
    rows,
    blockedReason: blocked,
    editable: false,
  }
}

/** A tool call the legacy chat prepared: a connected app, an automation, a browser action, or a shop action. */
export function buildActionReview(pending: { action: string; payload: Record<string, unknown>; kind?: 'connector' | 'automation' | 'browser' }, options: { rules?: AiRules; timeZone?: string } = {}): ReviewModel {
  const b = base(pending.action)
  const known = b.meta
  const title = b.title
  const words: string[] = []
  for (const key of ['message', 'body', 'text', 'caption', 'comment', 'reply', 'content', 'post']) if (typeof pending.payload[key] === 'string') words.push(String(pending.payload[key]))
  return {
    action: pending.action,
    title,
    effect: known?.effect || (pending.kind === 'connector' ? META['connector.post'].effect : 'Runs this action with the details below. Nothing has changed yet.'),
    tags: b.tags,
    undoLine: b.undoLine,
    irreversible: b.irreversible,
    approveLabel: approveText(known, { title }),
    danger: b.danger,
    rows: payloadRows(pending.payload, options.timeZone),
    blockedReason: gate(options.rules, pending.action, words),
    editable: pending.kind === undefined,
  }
}

/** The draft estimate or invoice card (kept as saved HTML in the chat). Always a draft, never sent. */
export function documentDraftLines(type: string): { effect: string; undoLine: string; tags: ReviewTag[] } {
  const info = getActionInfo('createInvoice')
  return {
    effect: `Saving keeps this ${type.toLowerCase()} as a draft. It is not sent to the customer.`,
    undoLine: undoSentence(info),
    tags: reviewTags(info),
  }
}
