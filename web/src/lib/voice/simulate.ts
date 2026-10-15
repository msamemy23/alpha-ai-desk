/**
 * Test mode: one pretend turn of a call or a text, using exactly the same decision engine, hours check, wording and safety
 * rules as the real thing. It reads nothing about real customers, saves nothing and sends nothing. It also says, in plain
 * words, what would have happened for real (who would be alerted, what would be saved, whether the reply would wait for
 * quiet hours or approval), so the owner can see the effect of each rule before a real customer does.
 */
import { decideTurn, emptyState, flagReasonLabel, OUTCOME_LABELS, readState } from './engine.ts'
import type { ChatMessage, ConvState, ModelFn, Outcome } from './engine.ts'
import { inQuietHours, openState, fmt12 } from './hours.ts'
import type { BookedAppointment } from './hours.ts'
import { callGreeting, prettyPhone } from './prompt.ts'
import type { ShopProfile } from './prompt.ts'
import type { VoiceRules } from './rules.ts'
import { composeSms } from './sms-pipeline.ts'

export interface SimTurnInput {
  channel: 'call' | 'sms'
  /** What the pretend customer says. Empty on a call means "the call just connected". */
  text: string
  rules: VoiceRules
  shop: ShopProfile
  now: Date
  state?: unknown
  history?: ChatMessage[]
  appointments?: BookedAppointment[]
  model: ModelFn | null
  /** Number of messages the assistant has already sent in this pretend conversation. */
  priorAi: number
}

export interface SimTurnOutput {
  /** What the customer would see or hear. Empty when nothing would be sent. */
  say: string
  state: ConvState
  outcome: Outcome
  outcomeLabel: string
  ended: boolean
  /** Plain-words list of what would really happen. */
  effects: string[]
  rulesFired: string[]
  usedModel: boolean
}

function transferReachable(rules: VoiceRules, now: Date, shop: ShopProfile): boolean {
  if (!rules.transfer_when_open || rules.handoff.length === 0) return false
  const open = openState(rules.hours, rules.closed_dates, shop.timezone, now)
  return open.known ? open.open : true
}

export async function simulateTurn(input: SimTurnInput): Promise<SimTurnOutput> {
  const { channel, rules, shop, now } = input
  const effects: string[] = []
  const open = openState(rules.hours, rules.closed_dates, shop.timezone, now)
  let state = readState(input.state ?? emptyState())

  /* A call that has just connected: the greeting, before the customer says anything. */
  if (channel === 'call' && !input.text.trim()) {
    const greeting = callGreeting(rules, shop, open)
    effects.push(rules.calls_enabled
      ? 'The call is answered with this greeting. It says the caller is talking to an AI, and the recording notice if you have it on.'
      : 'The assistant is switched off for calls, so a real caller would not hear this. They would be sent to the first handoff number, or asked to leave a recorded message.')
    if (open.known && !open.open) effects.push('You are closed now, so the assistant takes a message instead of passing the call to a person.')
    return { say: greeting, state, outcome: 'answered', outcomeLabel: OUTCOME_LABELS.answered, ended: false, effects, rulesFired: ['ai_disclosure', ...(rules.recording_notice ? ['recording_notice'] : [])], usedModel: false }
  }

  const decision = await decideTurn({
    channel, text: input.text, rules, shop, now, state, history: input.history || [],
    context: { appointments: input.appointments || [], fromNumber: '' },
    model: input.model, canTransfer: channel === 'call' ? transferReachable(rules, now, shop) : false,
  })
  state = decision.state

  let say = decision.say
  const fired = [...decision.rulesFired]
  if (channel === 'sms') {
    if (rules.texts_mode === 'off') {
      effects.push('Text replies are switched off, so the assistant would not answer. The text would wait in your inbox for you.')
      say = ''
    } else if (rules.texts_mode === 'auto' && inQuietHours(rules.quiet_hours, shop.timezone, now)) {
      effects.push(`This is inside your quiet hours (${fmt12(rules.quiet_hours.from)} to ${fmt12(rules.quiet_hours.to)}), so no reply would be sent. The text would wait for you.`)
      say = ''
    } else if (say) {
      const composed = composeSms(say, rules, shop, input.priorAi > 0)
      say = composed.text
      for (const f of composed.fired) if (!fired.includes(f)) fired.push(f)
      effects.push(rules.texts_mode === 'draft'
        ? 'Text replies are set to wait for your approval, so this would be saved as a draft for you to send, edit or dismiss.'
        : 'This reply would be sent as a text.')
    }
  }

  if (decision.flag) {
    effects.push(`A person would be alerted${rules.notify_email ? ` by email at ${rules.notify_email}` : ' in the app (add a notify email in the rules to also get an email)'}. Reason: ${flagReasonLabel(decision.flag.reason)}. The assistant stops replying on this thread until someone answers.`)
  }
  if (decision.transfer) {
    const person = rules.handoff[0]
    effects.push(person
      ? `The call would be transferred to ${person.name || 'your first handoff number'} at ${prettyPhone(person.phone)}${rules.transfer_briefing ? ', who would first get a short text saying who is calling and why' : ''}. If nobody answers it tries the next number, then takes a message.`
      : 'The call would be transferred, but no handoff number is set.')
  } else if (decision.flag && channel === 'call' && open.known && !open.open) {
    effects.push('You are closed now, so the assistant takes a message and marks it for follow-up instead of transferring.')
  }
  if (decision.booking) {
    effects.push(decision.booking.kind === 'book'
      ? `An appointment would be put on your schedule for ${decision.booking.label}, after checking the time is still open.`
      : `A booking request would be saved for you to approve (${decision.booking.preferred || decision.booking.label}). Nothing goes on your schedule until you approve it.`)
  }
  if (decision.optOut) effects.push('Texts to this number would stop. They would be recorded as opted out.')
  if (decision.outcome === 'spam') effects.push('This would be treated as a sales or spam call and ended politely.')
  if (decision.end && channel === 'call') effects.push('The assistant would end the call here.')
  if (!effects.length && say) effects.push('This is a normal reply. Nothing else would happen.')

  return {
    say, state, outcome: decision.outcome, outcomeLabel: OUTCOME_LABELS[decision.outcome] || '', ended: decision.end || decision.transfer || decision.silent && !say,
    effects, rulesFired: fired, usedModel: decision.usedModel,
  }
}
