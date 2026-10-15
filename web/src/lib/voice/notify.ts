/**
 * The notes the assistant sends the shop's own team: an alert when a person is needed, and the summary of a call.
 * Plain text so they read the same in any mail app. No customer is ever emailed from here.
 */
import { flagReasonLabel, outcomeText } from './engine.ts'
import type { Captured, Outcome } from './engine.ts'
import { prettyPhone, shopWord } from './prompt.ts'
import type { ShopProfile } from './prompt.ts'

export interface TeamEmail { subject: string; text: string }

function details(c: Partial<Captured>, phone: string): string[] {
  const out: string[] = []
  if (c.name) out.push(`Name: ${c.name}`)
  out.push(`Number: ${prettyPhone(phone) || 'not shown'}`)
  if (c.vehicle) out.push(`Vehicle: ${c.vehicle}`)
  if (c.problem) out.push(`Needs: ${c.problem}`)
  if (c.callback && c.callback !== prettyPhone(phone)) out.push(`Best number to call: ${c.callback}`)
  if (c.preferred) out.push(`Would like: ${c.preferred}`)
  return out
}

export function needsPersonEmail(opts: {
  shop: ShopProfile; channel: 'call' | 'sms'; phone: string; reason: string; captured: Partial<Captured>; lastMessage?: string; link: string
}): TeamEmail {
  const what = opts.channel === 'call' ? 'call' : 'text'
  const lines = [
    `A customer's ${what} needs a person on your team.`,
    '',
    `Why: ${flagReasonLabel(opts.reason)}`,
    ...details(opts.captured, opts.phone),
  ]
  if (opts.lastMessage) lines.push('', `They wrote: "${opts.lastMessage.slice(0, 240)}"`)
  lines.push('', 'The assistant has stopped replying to this customer until a person takes over.', `Open it: ${opts.link}`)
  return { subject: `Needs a person: ${what} from ${prettyPhone(opts.phone) || 'a customer'}`, text: lines.join('\n') }
}

export function callSummaryEmail(opts: {
  shop: ShopProfile; phone: string; outcome: Outcome; summary: string; captured: Partial<Captured>; transcript: { speaker: string; text: string }[]; link: string
}): TeamEmail {
  const lines = [
    `${shopWord(opts.shop)}: a call the assistant answered.`,
    '',
    `What happened: ${outcomeText(opts.outcome)}`,
    ...details(opts.captured, opts.phone),
    '',
    opts.summary || 'No summary was written.',
  ]
  if (opts.transcript.length) {
    lines.push('', 'What was said:')
    for (const t of opts.transcript.slice(0, 40)) lines.push(`${t.speaker === 'ai' ? 'Assistant' : 'Caller'}: ${t.text}`)
  }
  lines.push('', `Listen and review: ${opts.link}`)
  return { subject: `Call summary: ${outcomeText(opts.outcome)} (${prettyPhone(opts.phone) || 'unknown number'})`, text: lines.join('\n') }
}

export function newTextEmail(opts: { shop: ShopProfile; phone: string; body: string; link: string }): TeamEmail {
  return {
    subject: `New text from ${prettyPhone(opts.phone)}`,
    text: [`${shopWord(opts.shop)} got a text.`, '', `${prettyPhone(opts.phone)} wrote: "${opts.body.slice(0, 400)}"`, '', `Reply: ${opts.link}`].join('\n'),
  }
}

/** The text sent to the person who takes a transferred call, so they know who is on the line. */
export function transferBriefing(opts: { phone: string; captured: Partial<Captured>; reason: string }): string {
  const c = opts.captured
  const bits = [`Call coming in from ${prettyPhone(opts.phone) || 'a customer'}`]
  if (c.name) bits.push(c.name)
  if (c.vehicle) bits.push(c.vehicle)
  if (c.problem) bits.push(c.problem.slice(0, 100))
  bits.push(`Reason: ${flagReasonLabel(opts.reason)}`)
  return bits.join('. ') + '.'
}

export function textBackMessage(shop: ShopProfile, kind: 'message' | 'missed'): string {
  const who = shopWord(shop)
  if (kind === 'missed') return `Sorry we missed your call to ${who}. This is the virtual assistant (an AI). Reply here with what you need and our team will see it. Reply STOP to stop texts.`
  return `Thanks for calling ${who}. This is the virtual assistant (an AI). I passed your message to our team and they will follow up. Reply STOP to stop texts.`
}
