/**
 * What happens during a phone call to the shop's number.
 *
 * The webhook route gives each Telnyx event to `handleCallEvent`; this returns the commands to send back to Telnyx
 * (answer, speak, transfer, hang up ...) after saving what happened. Nothing here makes a network call to Telnyx, so the whole
 * call flow can be tested by feeding it events.
 *
 * What the caller experiences: the call is answered with an AI notice and (if on) a recording notice; the assistant takes their
 * details; a person is brought in when the caller needs one and the shop is open; spam and sales calls are ended; when the
 * shop is closed the assistant takes a message. Afterwards the team gets a summary and the caller can get a text.
 */
import { decideTurn, deriveOutcome, emptyState, outcomeText, readState } from './engine.ts'
import type { ChatMessage, ConvState, ModelFn, Outcome } from './engine.ts'
import { isEchoOfAssistant } from './guardrails.ts'
import { inQuietHours, openState, wallClock } from './hours.ts'
import type { OpenState } from './hours.ts'
import { callGreeting, fallbackSummary, shopFromSettings, shopWord } from './prompt.ts'
import type { ShopProfile } from './prompt.ts'
import { phoneKey } from './rules.ts'
import type { VoiceRules } from './rules.ts'
import { applyBooking, raiseNeedsPerson, syncBooking } from './actions.ts'
import type { ActionDeps, EmailSender } from './actions.ts'
import { callSummaryEmail, textBackMessage, transferBriefing } from './notify.ts'
import {
  claim, customerContext, getInteractionByRef, loadRules, openInteraction, patchInteraction, recentTexts, unionFired, upcomingAppointments,
} from './store.ts'
import type { Db, InteractionRow } from './store.ts'
import { betterOutcome, probeTables } from './sms-pipeline.ts'
import type { ShopRow, SmsConsent } from './sms-pipeline.ts'

export type Command =
  | { type: 'answer' }
  | { type: 'speak'; text: string; callId?: string }
  | { type: 'transcription_start' }
  | { type: 'record_start'; beep?: boolean; maxLength?: number; timeoutSecs?: number }
  | { type: 'transfer'; to: string; clientState: string; timeoutSecs: number; commandId: string }
  | { type: 'playback_stop' }
  | { type: 'hangup'; callId?: string }

export interface CallDeps {
  db: Db
  now: () => Date
  model: ModelFn | null
  email: EmailSender
  appUrl: string
  sendText: (to: string, text: string, opts: { idempotencyKey: string }) => Promise<void>
  consent: SmsConsent
  /** Signs the small note attached to a transferred call, so a stranger cannot forge one. */
  signState: (data: Record<string, unknown>) => string
}

export interface CallEvent {
  type: string
  callId: string
  eventId?: string
  payload: Record<string, any>
  /** Set by the route when the event belongs to the second leg of a transfer; the id is the original call. */
  transferParent?: string
}

export interface CallResult { commands: Command[]; note: string }

type Turn = { speaker: string; text: string }

export interface CallMeta {
  v: 1
  state: ConvState
  after: '' | 'hangup' | 'transfer' | 'record_voicemail' | 'voicemail_wait'
  mode: 'ai' | 'forward' | 'voicemail'
  transferIndex: number
  transferStatus: '' | 'dialing' | 'connected' | 'failed'
  seen: string[]
  hoursKnown: boolean
  closedAtStart: boolean
  lockAt: number
  caller: string
}

const emptyMeta = (): CallMeta => ({ v: 1, state: emptyState(), after: '', mode: 'ai', transferIndex: 0, transferStatus: '', seen: [], hoursKnown: false, closedAtStart: false, lockAt: 0, caller: '' })

/** The conversation column holds the chat lines the model sees, plus one hidden note with the assistant's working state. */
export function splitConversation(raw: unknown): { messages: ChatMessage[]; meta: CallMeta } {
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
  const messages: ChatMessage[] = []
  let meta = emptyMeta()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    if (item.role === 'meta') {
      try {
        const m = JSON.parse(String(item.content || '{}')) as Partial<CallMeta>
        meta = { ...meta, ...m, state: readState(m.state), seen: Array.isArray(m.seen) ? m.seen.slice(-12).map(String) : [] }
      } catch { /* start fresh */ }
    } else if ((item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string') {
      messages.push({ role: item.role as 'user' | 'assistant', content: item.content })
    }
  }
  return { messages, meta }
}

export function joinConversation(messages: ChatMessage[], meta: CallMeta): Record<string, string>[] {
  return [...messages.slice(-30).map(m => ({ role: m.role, content: m.content })), { role: 'meta', content: JSON.stringify(meta) }]
}

function asTurns(raw: unknown): Turn[] {
  const list = typeof raw === 'string' ? safeJson(raw) : raw
  return Array.isArray(list) ? (list as Turn[]).filter(t => t && typeof t.text === 'string').slice(-80) : []
}
function safeJson(s: string): unknown { try { return JSON.parse(s) } catch { return [] } }

/* ---------------- the ai_calls row ---------------- */

async function getCall(db: Db, shopId: string, callId: string): Promise<Record<string, any> | null> {
  const { data, error } = await db.from('ai_calls').select('*').eq('id', callId).eq('shop_id', shopId).maybeSingle()
  if (error) throw new Error('call row unreadable')
  return data || null
}

async function saveCall(db: Db, shopId: string, callId: string, patch: Record<string, unknown>): Promise<void> {
  const existing = await getCall(db, shopId, callId)
  if (existing) {
    const { error } = await db.from('ai_calls').update(patch).eq('id', callId).eq('shop_id', shopId)
    if (error) throw new Error('call row not saved')
    return
  }
  const { data: other } = await db.from('ai_calls').select('shop_id').eq('id', callId).maybeSingle()
  if (other?.shop_id && other.shop_id !== shopId) throw new Error('Call belongs to another shop')
  const { error } = await db.from('ai_calls').insert({ id: callId, shop_id: shopId, ...patch })
  if (error) throw new Error('call row not created')
}

/** True for exactly one caller at a time: flips processing from false to true in one step. */
async function tryLock(db: Db, shopId: string, callId: string, stale: boolean): Promise<boolean> {
  const attempt = async (mode: 'false' | 'null' | 'any'): Promise<boolean> => {
    let q = db.from('ai_calls').update({ processing: true }).eq('id', callId).eq('shop_id', shopId)
    if (mode === 'false') q = q.eq('processing', false)
    else if (mode === 'null') q = q.is('processing', null)
    const { data, error } = await q.select('id')
    return !error && Array.isArray(data) && data.length > 0
  }
  if (stale) return attempt('any')
  return (await attempt('false')) || (await attempt('null'))
}

/* ---------------- small helpers ---------------- */

const speak = (text: string): Command => ({ type: 'speak', text: text.replace(/"/g, "'").slice(0, 900) })

function openAt(rules: VoiceRules, shop: ShopProfile, now: Date): OpenState {
  return openState(rules.hours, rules.closed_dates, shop.timezone, now)
}

function canTransferNow(rules: VoiceRules, open: OpenState, meta: CallMeta): boolean {
  if (!rules.transfer_when_open || rules.handoff.length === 0) return false
  if (meta.transferStatus === 'failed' && meta.transferIndex >= rules.handoff.length - 1) return false
  // Hours not saved: try the person anyway. Hours saved and closed: take a message instead.
  return open.known ? open.open : true
}

function transferCommand(deps: CallDeps, rules: VoiceRules, meta: CallMeta, callId: string, shopId: string): Command | null {
  const person = rules.handoff[meta.transferIndex]
  if (!person) return null
  const state = deps.signState({ shopId, kind: 'xfer', parent: callId, idx: meta.transferIndex })
  return { type: 'transfer', to: person.phone, clientState: state, timeoutSecs: 25, commandId: `xfer-${callId}-${meta.transferIndex}` }
}

function stripVoicemailWords(s: string): string { return s.replace(/\s+/g, ' ').trim() }

function voicemailGreeting(shop: ShopProfile): string {
  return stripVoicemailWords(`Thanks for calling ${shopWord(shop)}. We can't take your call right now. After the tone, please leave your name, your number and a short message. Your message will be recorded.`)
}

/* ---------------- events ---------------- */

export async function handleCallEvent(deps: CallDeps, shopRow: ShopRow, ev: CallEvent): Promise<CallResult> {
  const shopId = String(shopRow.shop_id)
  const shop = shopFromSettings(shopRow)
  const loaded = await loadRules(deps.db, shopId)
  const rules = loaded.rules
  const now = deps.now()
  const none: CallResult = { commands: [], note: 'nothing to do' }

  if (ev.transferParent) return handleTransferLeg(deps, shopId, shop, rules, ev)

  switch (ev.type) {
    case 'call.initiated': return onInitiated(deps, shopId, shopRow, ev)
    case 'call.answered': return onAnswered(deps, shopId, shop, rules, ev, now)
    case 'call.transcription': return onTranscription(deps, shopId, shopRow, shop, rules, ev, now)
    case 'call.speak.ended': return onSpeakEnded(deps, shopId, rules, ev)
    case 'call.recording.saved': return onRecordingSaved(deps, shopId, ev)
    case 'call.hangup': return onHangup(deps, shopId, shopRow, shop, rules, ev, now)
    default: return none
  }
}

async function onInitiated(deps: CallDeps, shopId: string, shopRow: ShopRow, ev: CallEvent): Promise<CallResult> {
  if (ev.payload.direction !== 'incoming') return { commands: [], note: 'not an incoming call' }
  const from = String(ev.payload.from || 'unknown').slice(0, 40)
  const shopNumber = String(shopRow.telnyx_phone_number || shopRow.shop_phone || '')
  if (shopNumber && phoneKey(from) === phoneKey(shopNumber)) return { commands: [{ type: 'hangup' }], note: 'call from the shop\'s own number' }
  await saveCall(deps.db, shopId, ev.callId, {
    task: `Inbound call from ${from}. Handled by the AI receptionist.`, status: 'ringing', caller: from, started_at: deps.now().getTime(),
    greeted: false, processing: false, is_speaking: false,
  })
  return { commands: [{ type: 'answer' }], note: 'answering' }
}

async function onAnswered(deps: CallDeps, shopId: string, shop: ShopProfile, rules: VoiceRules, ev: CallEvent, now: Date): Promise<CallResult> {
  const row = await getCall(deps.db, shopId, ev.callId)
  if (row?.greeted === true) return { commands: [], note: 'already greeted' }
  if (ev.payload.direction && ev.payload.direction !== 'incoming') return { commands: [], note: 'not an incoming call' }
  const from = String(ev.payload.from || row?.caller || 'unknown').slice(0, 40)
  const open = openAt(rules, shop, now)
  const meta = emptyMeta()
  meta.caller = from
  meta.hoursKnown = open.known
  meta.closedAtStart = open.known && !open.open
  const base = { task: `Inbound call from ${from}. Handled by the AI receptionist.`, status: 'active', caller: from, started_at: row?.started_at || now.getTime() }

  const customer = await customerContext(deps.db, shopId, from, false)
  const opened = await openInteraction(deps.db, shopId, { channel: 'call', refId: ev.callId, contactPhone: from, contactName: customer.name, customerId: customer.id, startedAt: now.toISOString() })

  /* Assistant switched off: send the call to a person, or take a recorded message. */
  if (!rules.calls_enabled) {
    if (rules.handoff.length > 0) {
      meta.mode = 'forward'
      meta.transferStatus = 'dialing'
      const cmd = transferCommand(deps, rules, meta, ev.callId, shopId)
      await saveCall(deps.db, shopId, ev.callId, { ...base, greeted: true, processing: false, transcript: [], conversation: joinConversation([], meta) })
      if (opened.row) await patchInteraction(deps.db, shopId, opened.row.id, { outcome: 'transferred', rules_fired: unionFired(opened.row.rules_fired, ['calls_off', 'forwarded']) })
      return { commands: [{ type: 'record_start' }, ...(cmd ? [cmd] : [])], note: 'forwarding (assistant off)' }
    }
    meta.mode = 'voicemail'
    meta.after = 'record_voicemail'
    const line = voicemailGreeting(shop)
    await saveCall(deps.db, shopId, ev.callId, { ...base, greeted: true, processing: false, is_speaking: true, transcript: [{ speaker: 'ai', text: line }], conversation: joinConversation([{ role: 'assistant', content: line }], meta), last_ai_text: line })
    if (opened.row) await patchInteraction(deps.db, shopId, opened.row.id, { outcome: 'message_taken', rules_fired: unionFired(opened.row.rules_fired, ['calls_off', 'voicemail']) })
    return { commands: [speak(line)], note: 'voicemail (assistant off)' }
  }

  const greeting = callGreeting(rules, shop, open)
  const fired = ['ai_disclosure', ...(rules.recording_notice ? ['recording_notice'] : []), ...(meta.closedAtStart ? ['after_hours'] : [])]
  await saveCall(deps.db, shopId, ev.callId, {
    ...base, greeted: true, processing: false, is_speaking: true, last_ai_text: greeting, greeting_sent_at: now.getTime(),
    transcript: [{ speaker: 'ai', text: greeting }], conversation: joinConversation([{ role: 'assistant', content: greeting }], meta),
  })
  if (opened.row) await patchInteraction(deps.db, shopId, opened.row.id, { rules_fired: unionFired(opened.row.rules_fired, fired) })
  return { commands: [{ type: 'transcription_start' }, { type: 'record_start' }, speak(greeting)], note: 'greeting' }
}

async function onTranscription(deps: CallDeps, shopId: string, shopRow: ShopRow, shop: ShopProfile, rules: VoiceRules, ev: CallEvent, now: Date): Promise<CallResult> {
  const td = (ev.payload.transcription_data && typeof ev.payload.transcription_data === 'object' ? ev.payload.transcription_data : {}) as Record<string, unknown>
  const text = String(td.transcript || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
  if (!text || td.is_final !== true || text.length < 3) return { commands: [], note: 'not a final utterance' }
  if (td.track === 'outbound') return { commands: [], note: 'the assistant\'s own voice' }

  const row = await getCall(deps.db, shopId, ev.callId)
  if (!row) return { commands: [], note: 'unknown call' }
  if (row.status === 'ended') return { commands: [], note: 'call ended' }
  const parsed = splitConversation(row.conversation)
  const meta = parsed.meta
  if (meta.mode !== 'ai') return { commands: [], note: 'not an assistant call' }
  if (meta.state.transferred && meta.transferStatus !== 'failed') return { commands: [], note: 'call handed to a person' }
  if (ev.eventId && meta.seen.includes(ev.eventId)) return { commands: [], note: 'duplicate event' }

  const aiLines = parsed.messages.filter(m => m.role === 'assistant').map(m => m.content)
  if (row.last_ai_text) aiLines.push(String(row.last_ai_text))
  if (isEchoOfAssistant(text, aiLines)) return { commands: [], note: 'echo of the assistant' }

  const stale = meta.lockAt > 0 && now.getTime() - meta.lockAt > 25_000
  if (!(await tryLock(deps.db, shopId, ev.callId, stale))) return { commands: [], note: 'still busy with the last sentence' }

  const commands: Command[] = []
  try {
    if (row.is_speaking === true && text.split(' ').length >= 2) commands.push({ type: 'playback_stop' })
    meta.lockAt = now.getTime()
    if (ev.eventId) meta.seen = [...meta.seen, ev.eventId].slice(-12)

    const open = openAt(rules, shop, now)
    const tables = await probeTables(deps.db, now.getTime())
    const bookingsOk = tables.bookings && tables.interactions
    const effective: VoiceRules = bookingsOk ? rules : { ...rules, booking_mode: 'off' }
    const caller = String(row.caller || meta.caller || '')
    const customer = await customerContext(deps.db, shopId, caller, rules.may_share_job_status)
    const appointments = effective.booking_mode === 'book'
      ? await upcomingAppointments(deps.db, shopId, wallClock(now, shop.timezone).ymd, new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10))
      : []

    const decision = await decideTurn({
      channel: 'call', text, rules: effective, shop, now, state: meta.state, history: parsed.messages,
      context: { customerName: customer.name, openJobs: customer.openJobs, appointments, fromNumber: caller },
      model: deps.model, canTransfer: canTransferNow(rules, open, meta),
    })
    meta.state = decision.state
    if (meta.transferStatus === 'failed') meta.transferStatus = ''
    if (decision.transfer) meta.after = 'transfer'
    else if (decision.end) meta.after = 'hangup'

    const transcript = asTurns(row.transcript)
    transcript.push({ speaker: 'customer', text })
    const messages = [...parsed.messages, { role: 'user' as const, content: text }]
    if (decision.say) {
      transcript.push({ speaker: 'ai', text: decision.say })
      messages.push({ role: 'assistant', content: decision.say })
      commands.push(speak(decision.say))
    } else if (decision.transfer || decision.end) {
      commands.push(...afterSpeech(deps, shopId, rules, meta, ev.callId))
    }
    await deps.db.from('ai_calls').update({
      transcript, conversation: joinConversation(messages, meta), last_ai_text: decision.say || row.last_ai_text || '', is_speaking: !!decision.say,
    }).eq('id', ev.callId).eq('shop_id', shopId)

    await recordTurn(deps, shopId, shopRow, shop, rules, effective, ev.callId, caller, customer.id, decision, text)
  } catch (e) {
    console.error('[call-pipeline] turn failed:', e instanceof Error ? e.message : e)
    commands.push(speak('Sorry, I had a problem. Our team will follow up with you. Goodbye.'))
    meta.after = 'hangup'
    try { await deps.db.from('ai_calls').update({ conversation: joinConversation(parsed.messages, meta) }).eq('id', ev.callId).eq('shop_id', shopId) } catch { /* the hangup still happens */ }
  } finally {
    try { await deps.db.from('ai_calls').update({ processing: false }).eq('id', ev.callId).eq('shop_id', shopId) } catch { /* ignore */ }
  }
  return { commands, note: 'replied' }
}

/** What to do right after the last words were spoken. Used when there is nothing to say. */
function afterSpeech(deps: CallDeps, shopId: string, rules: VoiceRules, meta: CallMeta, callId: string): Command[] {
  const after = meta.after
  meta.after = ''
  if (after === 'hangup') return [{ type: 'hangup' }]
  if (after === 'transfer') {
    meta.transferStatus = 'dialing'
    const cmd = transferCommand(deps, rules, meta, callId, shopId)
    return cmd ? [cmd] : [{ type: 'hangup' }]
  }
  return []
}

async function recordTurn(
  deps: CallDeps, shopId: string, shopRow: ShopRow, shop: ShopProfile, rules: VoiceRules, effective: VoiceRules, callId: string,
  caller: string, customerId: string | null, decision: Awaited<ReturnType<typeof decideTurn>>, heard: string,
): Promise<void> {
  const interaction: InteractionRow | null = await getInteractionByRef(deps.db, shopId, 'call', callId)
  const actionDeps: ActionDeps = { db: deps.db, now: deps.now, email: deps.email, appUrl: deps.appUrl }
  if (interaction) {
    await patchInteraction(deps.db, shopId, interaction.id, {
      outcome: betterOutcome(interaction.outcome, decision.outcome),
      captured: decision.state.captured,
      rules_fired: unionFired(interaction.rules_fired, decision.rulesFired),
      contact_name: decision.state.captured.name || interaction.contact_name || null,
      detail: { ...(interaction.detail || {}), state: decision.state },
    })
  }
  if (decision.booking) {
    await applyBooking(actionDeps, {
      shopId, rules: effective, shop, interactionId: interaction?.id || null, channel: 'call', booking: decision.booking,
      captured: decision.state.captured, phone: caller, customerId,
    })
  }
  if (!decision.booking && decision.state.booking && interaction) {
    await syncBooking(deps.db, shopId, { interactionId: interaction.id, captured: decision.state.captured, phone: caller })
  }
  if (decision.flag) {
    await raiseNeedsPerson(actionDeps, {
      shopId, rules, shop, channel: 'call', interactionId: interaction?.id || null, phone: caller, reason: decision.flag.reason,
      captured: decision.state.captured, lastMessage: heard, shopEmail: String(shopRow.shop_email || ''),
    })
  }
}

async function onSpeakEnded(deps: CallDeps, shopId: string, rules: VoiceRules, ev: CallEvent): Promise<CallResult> {
  const row = await getCall(deps.db, shopId, ev.callId)
  if (!row) return { commands: [], note: 'unknown call' }
  const { messages, meta } = splitConversation(row.conversation)
  const commands: Command[] = []
  const after = meta.after
  if (after === 'record_voicemail') {
    meta.after = 'voicemail_wait'
    commands.push({ type: 'record_start', beep: true, maxLength: 120, timeoutSecs: 5 })
  } else if (after === 'transfer' || after === 'hangup') {
    commands.push(...afterSpeech(deps, shopId, rules, meta, ev.callId))
    if (after === 'transfer') await briefPerson(deps, shopId, rules, ev.callId, meta, row)
  }
  await deps.db.from('ai_calls').update({ is_speaking: false, processing: false, conversation: joinConversation(messages, meta) }).eq('id', ev.callId).eq('shop_id', shopId)
  return { commands, note: after ? `after speaking: ${after}` : 'finished speaking' }
}

/** Texts the person who is about to get the call, so they know who it is and why. Once per call. */
async function briefPerson(deps: CallDeps, shopId: string, rules: VoiceRules, callId: string, meta: CallMeta, row: Record<string, any>): Promise<void> {
  if (!rules.transfer_briefing) return
  const person = rules.handoff[meta.transferIndex]
  if (!person) return
  const interaction = await getInteractionByRef(deps.db, shopId, 'call', callId)
  if (interaction && !(await claim(deps.db, shopId, interaction.id, 'briefed_at'))) return
  try {
    const reason = meta.state.flagged || 'asked'
    await deps.sendText(person.phone, transferBriefing({ phone: String(row.caller || meta.caller), captured: meta.state.captured, reason }), { idempotencyKey: `brief-${callId}-${meta.transferIndex}` })
  } catch { /* the call still goes through */ }
}

async function onRecordingSaved(deps: CallDeps, shopId: string, ev: CallEvent): Promise<CallResult> {
  const urls = ev.payload.recording_urls
  const url = typeof urls === 'string' ? urls
    : urls && typeof urls === 'object' ? String((urls as Record<string, unknown>).mp3 || (urls as Record<string, unknown>).wav || Object.values(urls as Record<string, unknown>)[0] || '')
    : String(ev.payload.public_url || '')
  const row = await getCall(deps.db, shopId, ev.callId)
  if (!row) return { commands: [], note: 'unknown call' }
  if (url) await deps.db.from('ai_calls').update({ recording_url: url.slice(0, 2000) }).eq('id', ev.callId).eq('shop_id', shopId)
  const { meta } = splitConversation(row.conversation)
  if (meta.mode === 'voicemail' && meta.after === 'voicemail_wait') return { commands: [{ type: 'hangup' }], note: 'voicemail saved' }
  return { commands: [], note: 'recording saved' }
}

/* ---------------- the second leg of a transfer ---------------- */

async function handleTransferLeg(deps: CallDeps, shopId: string, shop: ShopProfile, rules: VoiceRules, ev: CallEvent): Promise<CallResult> {
  const parentId = ev.transferParent as string
  const row = await getCall(deps.db, shopId, parentId)
  if (!row) return { commands: [], note: 'unknown parent call' }
  const { messages, meta } = splitConversation(row.conversation)
  const save = () => deps.db.from('ai_calls').update({ conversation: joinConversation(messages, meta) }).eq('id', parentId).eq('shop_id', shopId)

  if (ev.type === 'call.answered') {
    meta.transferStatus = 'connected'
    await save()
    const interaction = await getInteractionByRef(deps.db, shopId, 'call', parentId)
    if (interaction) await patchInteraction(deps.db, shopId, interaction.id, { outcome: 'transferred', rules_fired: unionFired(interaction.rules_fired, ['transfer']) })
    return { commands: [], note: 'a person answered' }
  }
  if (ev.type !== 'call.hangup') return { commands: [], note: 'transfer leg event' }
  if (meta.transferStatus === 'connected') return { commands: [], note: 'the person finished the call' }
  if (row.status === 'ended') return { commands: [], note: 'call already ended' }

  /* The person did not pick up. Try the next one, or take over again. */
  if (meta.transferStatus !== 'dialing') return { commands: [], note: 'no transfer in progress' }
  if (meta.transferIndex + 1 < rules.handoff.length) {
    meta.transferIndex += 1
    const cmd = transferCommand(deps, rules, meta, parentId, shopId)
    await save()
    return { commands: cmd ? [{ ...cmd }] : [], note: 'trying the next person' }
  }
  meta.transferStatus = 'failed'
  meta.state.transferred = false
  const wasForward = meta.mode === 'forward'
  const commands: Command[] = []
  if (wasForward) {
    meta.mode = 'voicemail'
    meta.after = 'record_voicemail'
    const line = voicemailGreeting(shop)
    messages.push({ role: 'assistant', content: line })
    commands.push({ type: 'speak', text: line, callId: parentId })
  } else {
    const haveNumber = !!(meta.state.captured.callback || meta.caller)
    if (!meta.state.captured.callback && meta.caller) meta.state.captured.callback = meta.caller
    meta.state.asked = haveNumber ? '' : 'callback'
    const line = haveNumber
      ? 'I was not able to reach anyone on the team right now. I have marked this as urgent and a person will follow up with you. Goodbye.'
      : 'I was not able to reach anyone on the team right now. I have marked this as urgent. What is the best number to reach you?'
    meta.after = haveNumber ? 'hangup' : ''
    messages.push({ role: 'assistant', content: line })
    commands.push({ type: 'speak', text: line, callId: parentId })
  }
  await save()
  const interaction = await getInteractionByRef(deps.db, shopId, 'call', parentId)
  if (interaction) {
    await patchInteraction(deps.db, shopId, interaction.id, {
      outcome: wasForward ? 'message_taken' : 'needs_person', needs_person: !wasForward, needs_reason: meta.state.flagged || 'asked',
      rules_fired: unionFired(interaction.rules_fired, ['transfer_unavailable']),
    })
    if (!wasForward) {
      await raiseNeedsPerson({ db: deps.db, now: deps.now, email: deps.email, appUrl: deps.appUrl }, {
        shopId, rules, shop, channel: 'call', interactionId: interaction.id, phone: String(row.caller || meta.caller),
        reason: meta.state.flagged || 'asked', captured: meta.state.captured,
      })
    }
  }
  return { commands, note: 'nobody answered' }
}

/* ---------------- the end of the call ---------------- */

const FOLLOW_UP: Outcome[] = ['message_taken', 'after_hours', 'booking_requested', 'needs_person', 'booked']

async function summarize(deps: CallDeps, shop: ShopProfile, transcript: Turn[], captured: ConvState['captured'], outcome: Outcome): Promise<string> {
  const fallback = fallbackSummary({ channel: 'call', captured, outcomeText: outcomeText(outcome) })
  if (!deps.model || !transcript.some(t => t.speaker !== 'ai')) return fallback
  const lines = transcript.map(t => `${t.speaker === 'ai' ? 'Assistant' : 'Caller'}: ${t.text}`).join('\n').slice(0, 6000)
  try {
    const raw = await deps.model([
      { role: 'system', content: `You summarize phone calls for an auto repair shop team. Write 2 to 4 short plain lines: what the caller wanted, the details they gave (name, vehicle, problem, number), and what the team should do next. Use only what was said. Never add prices or promises. No markdown.` },
      { role: 'user', content: `Shop: ${shopWord(shop)}\nHow it ended: ${outcomeText(outcome)}\n\n${lines}` },
    ], { maxTokens: 220, json: false })
    const clean = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/[*#`]/g, '').trim()
    return clean.length >= 20 ? clean.slice(0, 900) : fallback
  } catch {
    return fallback
  }
}

async function onHangup(deps: CallDeps, shopId: string, shopRow: ShopRow, shop: ShopProfile, rules: VoiceRules, ev: CallEvent, now: Date): Promise<CallResult> {
  const row = await getCall(deps.db, shopId, ev.callId)
  if (!row) return { commands: [], note: 'unknown call' }
  const { meta } = splitConversation(row.conversation)
  const transcript = asTurns(row.transcript)
  const caller = String(row.caller || meta.caller || '')
  const interaction = await getInteractionByRef(deps.db, shopId, 'call', ev.callId)
  const already = row.status === 'ended'
  await deps.db.from('ai_calls').update({ status: 'ended', processing: false, is_speaking: false }).eq('id', ev.callId).eq('shop_id', shopId)

  const customerTurns = transcript.filter(t => t.speaker !== 'ai').length
  const st = meta.state
  st.customerTurns = Math.max(st.customerTurns, customerTurns)
  let outcome: Outcome
  if (meta.mode === 'forward') outcome = meta.transferStatus === 'connected' ? 'transferred' : 'message_taken'
  else if (meta.mode === 'voicemail') outcome = 'message_taken'
  else if (interaction?.outcome === 'spam') outcome = 'spam'
  else outcome = deriveOutcome(st, { known: meta.hoursKnown, open: !meta.closedAtStart, reason: 'open', closesAt: '', nextOpen: '' })
  if (interaction && interaction.outcome === 'transferred') outcome = 'transferred'
  if (interaction && interaction.outcome === 'booked') outcome = 'booked'

  if (already && interaction?.ended_at) return { commands: [], note: 'already wrapped up' }

  const summary = await summarize(deps, shop, transcript, st.captured, outcome)
  await deps.db.from('ai_calls').update({ summary }).eq('id', ev.callId).eq('shop_id', shopId)
  if (interaction) {
    await patchInteraction(deps.db, shopId, interaction.id, {
      outcome, summary, ended_at: now.toISOString(), captured: st.captured, detail: { ...(interaction.detail || {}), state: st },
    })
  }

  /* Tell the team. Once per call, whatever happens to the webhook. */
  const to = rules.notify_email || String(shopRow.shop_email || '')
  const wantEmail = rules.summary_email === 'every_call' ? outcome !== 'spam' : rules.summary_email === 'follow_up' && FOLLOW_UP.includes(outcome)
  if (interaction && to && wantEmail && (await claim(deps.db, shopId, interaction.id, 'summary_emailed_at'))) {
    try {
      const mail = callSummaryEmail({ shop, phone: caller, outcome, summary, captured: st.captured, transcript, link: `${deps.appUrl}/messages/ai` })
      await deps.email({ to, subject: mail.subject, text: mail.text, idempotencyKey: `call-summary-${interaction.id}` })
    } catch { /* an email problem never blocks the call record */ }
  }

  /* Text the caller back, if the shop wants that and it is allowed. */
  await maybeTextBack(deps, shopId, shopRow, shop, rules, interaction, caller, outcome, now)
  return { commands: [], note: 'call wrapped up' }
}

async function maybeTextBack(
  deps: CallDeps, shopId: string, shopRow: ShopRow, shop: ShopProfile, rules: VoiceRules, interaction: InteractionRow | null,
  caller: string, outcome: Outcome, now: Date,
): Promise<void> {
  if (!rules.text_back_after_calls || !interaction) return
  if (!['message_taken', 'after_hours', 'booking_requested', 'needs_person', 'missed', 'booked'].includes(outcome)) return
  const key = phoneKey(caller)
  const from = String(shopRow.telnyx_phone_number || shopRow.shop_phone || '')
  if (key.length !== 10 || !from || phoneKey(from) === key) return
  if (inQuietHours(rules.quiet_hours, shop.timezone, now)) return
  try { if (await deps.consent.isOptedOut(shopId, caller)) return } catch { return }
  const recent = await recentTexts(deps.db, shopId, new Date(now.getTime() - 24 * 3_600_000).toISOString())
  const talked = recent.rows.some(r => phoneKey(r.direction === 'inbound' ? r.from_address : r.to_address) === key && (r.direction === 'inbound' || r.ai_handled))
  if (talked) return
  if (!(await claim(deps.db, shopId, interaction.id, 'textback_sent_at'))) return
  const body = textBackMessage(shop, outcome === 'missed' ? 'missed' : 'message')
  try {
    await deps.sendText(caller, body, { idempotencyKey: `call-textback-${interaction.id}` })
    await deps.db.from('messages').insert({
      shop_id: shopId, direction: 'outbound', channel: 'sms', from_address: from, to_address: caller, body, status: 'sent', ai_handled: true, read: true,
    })
    await patchInteraction(deps.db, shopId, interaction.id, { rules_fired: unionFired(interaction.rules_fired, ['textback']) })
  } catch { /* texting can fail (for example a landline); the call record is unaffected */ }
}
